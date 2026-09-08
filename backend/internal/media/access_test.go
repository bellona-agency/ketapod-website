package media

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// clampRange is the enforcement point for the free preview. It is
// unexported and tested from inside the package because it is pure
// arithmetic on an HTTP header, and every case below is a real request
// shape an audio player produces.
func TestClampRange(t *testing.T) {
	const limit = 1000

	tests := []struct {
		name        string
		rangeHeader string
		want        string
		wantErr     bool
	}{
		{
			name:        "no Range at all gets the preview window",
			rangeHeader: "",
			want:        "bytes=0-999",
		},
		{
			name:        "open-ended from the start is clamped to the window",
			rangeHeader: "bytes=0-",
			want:        "bytes=0-999",
		},
		{
			name:        "a range inside the window is passed through untouched",
			rangeHeader: "bytes=100-500",
			want:        "bytes=100-500",
		},
		{
			name:        "a range overshooting the window has its end clamped",
			rangeHeader: "bytes=100-5000",
			want:        "bytes=100-999",
		},
		{
			name:        "the last byte of the window is reachable",
			rangeHeader: "bytes=999-999",
			want:        "bytes=999-999",
		},
		{
			name:        "a start past the window is refused",
			rangeHeader: "bytes=1000-",
			wantErr:     true,
		},
		{
			name:        "a suffix range would read the end of the file, so it is refused",
			rangeHeader: "bytes=-500",
			wantErr:     true,
		},
		{
			name:        "a backwards range is nonsense",
			rangeHeader: "bytes=500-100",
			wantErr:     true,
		},
		{
			name:        "multi-range is refused rather than partly honoured",
			rangeHeader: "bytes=0-10,20-30",
			wantErr:     true,
		},
		{
			name:        "a non-bytes unit is refused",
			rangeHeader: "items=0-10",
			wantErr:     true,
		},
		{
			name:        "garbage is refused",
			rangeHeader: "bytes=abc-def",
			wantErr:     true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := clampRange(tc.rangeHeader, limit)
			if tc.wantErr {
				require.ErrorIs(t, err, ErrRangeOutsidePreview)
				return
			}
			require.NoError(t, err)
			require.Equal(t, tc.want, got)
		})
	}

	t.Run("a zero-length window admits nothing", func(t *testing.T) {
		_, err := clampRange("bytes=0-10", 0)
		require.ErrorIs(t, err, ErrRangeOutsidePreview)
	})
}

func TestPreviewByteLimit(t *testing.T) {
	// 48 kbit mono is a locked decision (08-decisions.md), which is what
	// makes byte offset a linear function of seconds. If the bitrate ever
	// changes, this arithmetic — and this test — must change with it.
	const headroom = 64 * 1024

	require.Equal(t, int64(60*48*1000/8+headroom), PreviewByteLimit(60, 48))
	require.Equal(t, int64(0), PreviewByteLimit(0, 48), "no preview window means no bytes")
	require.Equal(t, int64(0), PreviewByteLimit(-5, 48))

	t.Run("a missing bitrate falls back to the platform default", func(t *testing.T) {
		require.Equal(t, PreviewByteLimit(60, 48), PreviewByteLimit(60, 0))
	})
}

func TestStreamTokenSignVerify(t *testing.T) {
	signer := NewSigner("test-secret", 15*time.Minute)

	t.Run("a freshly signed token verifies and carries its claims", func(t *testing.T) {
		token := signer.Sign("asset-123", 60)

		claims, err := signer.Verify(token)
		require.NoError(t, err)
		require.Equal(t, "asset-123", claims.AssetID)
		require.Equal(t, 60, claims.MaxSeconds)
		require.WithinDuration(t, time.Now().Add(15*time.Minute), claims.ExpiresAt, time.Minute)
	})

	t.Run("a token signed with another key is rejected", func(t *testing.T) {
		// This is the whole point of signing: without it, anyone who can
		// guess an asset id can stream a paid book.
		attacker := NewSigner("not-the-secret", 15*time.Minute)
		_, err := signer.Verify(attacker.Sign("asset-123", 0))
		require.ErrorIs(t, err, ErrInvalidStreamToken)
	})

	t.Run("tampering with the payload invalidates the signature", func(t *testing.T) {
		token := signer.Sign("asset-123", 60)
		// Flip the first character of the payload half.
		tampered := "X" + token[1:]
		_, err := signer.Verify(tampered)
		require.ErrorIs(t, err, ErrInvalidStreamToken)
	})

	t.Run("raising MaxSeconds requires re-signing, which an attacker cannot do", func(t *testing.T) {
		// A preview listener must not be able to widen their own window
		// by editing the token, so the max is inside the signed payload
		// rather than a separate query parameter.
		preview := signer.Sign("asset-123", 60)
		full := signer.Sign("asset-123", 0)
		require.NotEqual(t, preview, full)

		claims, err := signer.Verify(preview)
		require.NoError(t, err)
		require.Equal(t, 60, claims.MaxSeconds)
	})

	t.Run("an expired token is rejected", func(t *testing.T) {
		// A real TTL, just a very short one. NewSigner deliberately
		// coerces a zero or negative TTL to the safe default, so expiry
		// has to be produced by time passing rather than by configuring
		// a signer into the past.
		shortLived := NewSigner("test-secret", time.Millisecond)
		token := shortLived.Sign("asset-123", 0)
		time.Sleep(1100 * time.Millisecond)

		_, err := shortLived.Verify(token)
		require.ErrorIs(t, err, ErrInvalidStreamToken)
	})

	t.Run("a nonsensical TTL falls back to the safe default instead of never expiring", func(t *testing.T) {
		// Zero would otherwise mean "expires at the epoch" or "never",
		// depending on how the comparison is written. Neither is a good
		// accident to have in a signing path.
		misconfigured := NewSigner("test-secret", 0)
		claims, err := misconfigured.Verify(misconfigured.Sign("asset-1", 0))
		require.NoError(t, err)
		require.WithinDuration(t, time.Now().Add(15*time.Minute), claims.ExpiresAt, time.Minute)
	})

	t.Run("malformed tokens are rejected, not panicked on", func(t *testing.T) {
		for _, bad := range []string{"", "nodot", "a.b.c", ".", "not-base64.sig"} {
			_, err := signer.Verify(bad)
			require.ErrorIs(t, err, ErrInvalidStreamToken, "input %q", bad)
		}
	})
}

func TestAccessDecisionPlayable(t *testing.T) {
	require.True(t, AccessDecision{Level: AccessFull}.Playable())
	require.True(t, AccessDecision{Level: AccessPreview, MaxSeconds: 60}.Playable())
	require.False(t, AccessDecision{Level: AccessPreview, MaxSeconds: 0}.Playable(),
		"a preview of zero seconds is a denial, not a permission")
	require.False(t, AccessDecision{Level: AccessDenied}.Playable())
}
