package integrationtest

import (
	"bytes"
	"context"
	"io"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"ketapod/internal/catalog"
	"ketapod/internal/commerce"
	"ketapod/internal/kids"
	"ketapod/internal/library"
	"ketapod/internal/media"
	"ketapod/internal/platform/storage"
)

// stubStore returns bytes without an object store. What is being tested
// here is the access decision and the Range clamp, not S3 — and the
// clamp is applied to the Range header *before* it reaches storage, so
// recording that header is enough to prove it.
type stubStore struct {
	size            int64
	lastRangeHeader string
}

func (s *stubStore) GetObject(ctx context.Context, key, rangeHeader string) (*storage.Object, error) {
	s.lastRangeHeader = rangeHeader
	return &storage.Object{
		Body:          io.NopCloser(bytes.NewReader(make([]byte, 16))),
		ContentLength: s.size,
		ContentType:   "audio/mp4",
		IsPartial:     rangeHeader != "",
	}, nil
}

type playbackEnv struct {
	media    *media.Service
	commerce *commerce.Service
	kids     *kids.Service
	library  *library.Service
	store    *stubStore
	f        *fixtures
}

func newPlaybackEnv(t *testing.T) *playbackEnv {
	t.Helper()
	pool := newPool(t)

	catalogSvc := catalog.NewService(catalog.NewRepository(pool))
	commerceRepo := commerce.NewRepository(pool)
	commerceSvc := commerce.NewService(commerceRepo, catalogSvc, nil,
		commerce.NewStubProvider("http://localhost/cb"))
	librarySvc := library.NewService(library.NewRepository(pool), catalogSvc, commerceSvc, catalogSvc, false)
	commerceSvc = commerce.NewService(commerceRepo, catalogSvc, librarySvc,
		commerce.NewStubProvider("http://localhost/cb"))
	kidsSvc := kids.NewService(kids.NewRepository(pool), catalogSvc,
		kidsListeningAdapter{lib: librarySvc}, "Asia/Tehran")

	store := &stubStore{size: 4_000_000}
	mediaSvc := media.NewService(
		media.NewRepository(pool), store,
		catalogSvc, commerceSvc, kidsSvc,
		media.NewSigner("test-secret", 15*time.Minute),
		"https://api.test",
	)

	return &playbackEnv{
		media: mediaSvc, commerce: commerceSvc, kids: kidsSvc,
		library: librarySvc, store: store, f: newFixtures(t, pool),
	}
}

// kidsListeningAdapter mirrors cmd/api's adapter: kids expresses what it
// needs from library in its own types so neither module imports the
// other.
type kidsListeningAdapter struct{ lib *library.Service }

func (a kidsListeningAdapter) SecondsListenedToday(ctx context.Context, profileID string, loc *time.Location) (int64, error) {
	return a.lib.SecondsListenedToday(ctx, profileID, loc)
}

func (a kidsListeningAdapter) WeeklyTotals(ctx context.Context, parentUserID, profileID, tz string, since time.Time) (int64, []kids.DayTotal, []kids.BookTotal, error) {
	stats, err := a.lib.StatsFor(ctx, parentUserID, profileID, tz, since)
	if err != nil {
		return 0, nil, nil, err
	}
	daily := make([]kids.DayTotal, len(stats.DailyBreakdown))
	for i, d := range stats.DailyBreakdown {
		daily[i] = kids.DayTotal{Date: d.Date, SecondsListened: d.SecondsListened}
	}
	top := make([]kids.BookTotal, len(stats.TopBooks))
	for i, b := range stats.TopBooks {
		top[i] = kids.BookTotal{BookID: b.BookID, Title: b.Title, CoverURL: b.CoverURL, SecondsListened: b.SecondsListened}
	}
	return stats.TotalSeconds, daily, top, nil
}

// This is the regression test for the hole that existed before this
// change: /media/stream served any asset to anyone, unauthenticated,
// with no entitlement check at all — on a platform whose entire business
// is selling audiobooks.
func TestPaidAudioIsNotServedToStrangers(t *testing.T) {
	env := newPlaybackEnv(t)
	ctx := context.Background()

	bookID := env.f.book(bookOpts{Slug: "paid", Title: "کتاب پولی"})
	editionID := env.f.edition(editionOpts{
		BookID: bookID, VoiceID: "v1", PriceIRR: 450_000,
		PreviewSeconds: 60, DurationSeconds: 600, WithAsset: true,
	})

	t.Run("an anonymous visitor gets a preview, not the book", func(t *testing.T) {
		decision, _, err := env.media.ResolveAccess(ctx, "", "", editionID)
		require.NoError(t, err)
		require.Equal(t, media.AccessPreview, decision.Level)
		require.Equal(t, 60, decision.MaxSeconds)
		require.Equal(t, media.ReasonPreviewOnly, decision.Reason)
	})

	t.Run("a signed-in non-buyer gets the same preview", func(t *testing.T) {
		userID := env.f.user("09120000300")
		decision, _, err := env.media.ResolveAccess(ctx, userID, "", editionID)
		require.NoError(t, err)
		require.Equal(t, media.AccessPreview, decision.Level)
	})

	t.Run("an edition with no preview configured is denied outright", func(t *testing.T) {
		// A preview is a fallback, not a permission: previewSeconds = 0
		// means the paywall is absolute.
		noPreview := env.f.edition(editionOpts{
			BookID: bookID, VoiceID: "v2", PriceIRR: 450_000,
			PreviewSeconds: 0, WithAsset: true,
		})
		decision, _, err := env.media.ResolveAccess(ctx, "", "", noPreview)
		require.NoError(t, err)
		require.Equal(t, media.AccessDenied, decision.Level)
		require.Equal(t, media.ReasonNoPreview, decision.Reason)
		require.False(t, decision.Playable())
	})

	t.Run("buying it opens full access", func(t *testing.T) {
		buyerID := env.f.user("09120000301")
		env.f.creditWallet(buyerID, 1_000_000)

		_, err := env.commerce.Purchase(ctx, buyerID,
			[]commerce.PurchaseLine{{AudioEditionID: editionID}}, "", "")
		require.NoError(t, err)

		decision, _, err := env.media.ResolveAccess(ctx, buyerID, "", editionID)
		require.NoError(t, err)
		require.Equal(t, media.AccessFull, decision.Level)
		require.Equal(t, media.ReasonEntitled, decision.Reason)
	})

	t.Run("a free edition plays for anyone", func(t *testing.T) {
		// The landing page demo depends on this: free means price zero,
		// not a separate code path.
		freeBook := env.f.book(bookOpts{Slug: "free", Title: "رایگان"})
		freeEdition := env.f.edition(editionOpts{BookID: freeBook, VoiceID: "v3", PriceIRR: 0, WithAsset: true})

		decision, _, err := env.media.ResolveAccess(ctx, "", "", freeEdition)
		require.NoError(t, err)
		require.Equal(t, media.AccessFull, decision.Level)
		require.Equal(t, media.ReasonFree, decision.Reason)
	})

	t.Run("an unpublished edition plays for nobody", func(t *testing.T) {
		draft := env.f.edition(editionOpts{
			BookID: bookID, VoiceID: "v4", PriceIRR: 0, Status: "draft", WithAsset: true,
		})
		decision, _, err := env.media.ResolveAccess(ctx, "", "", draft)
		require.NoError(t, err)
		require.Equal(t, media.AccessDenied, decision.Level)
		require.Equal(t, media.ReasonUnpublished, decision.Reason)
	})
}

// The signed URL is what makes gated audio usable from a plain <audio>
// element, which cannot send an Authorization header. It must grant
// exactly what the listener is entitled to and nothing more.
func TestPlaybackURLCarriesTheAccessLevel(t *testing.T) {
	env := newPlaybackEnv(t)
	ctx := context.Background()

	bookID := env.f.book(bookOpts{Slug: "signed", Title: "امضاشده"})
	editionID := env.f.edition(editionOpts{
		BookID: bookID, VoiceID: "v1", PriceIRR: 300_000,
		PreviewSeconds: 45, DurationSeconds: 600, WithAsset: true,
	})

	previewURL, decision, err := env.media.PlaybackURL(ctx, "", "", editionID)
	require.NoError(t, err)
	require.Equal(t, media.AccessPreview, decision.Level)
	require.Contains(t, previewURL, "https://api.test/api/v1/media/stream/")
	require.Contains(t, previewURL, "?t=", "the URL carries a signed token, not a bare asset id")

	token := tokenFromURL(t, previewURL)

	t.Run("a preview token clamps the bytes storage is asked for", func(t *testing.T) {
		_, err := env.media.OpenAsset(ctx, token, "")
		require.NoError(t, err)

		// 45s at 48 kbit + 64 KiB container headroom.
		expected := media.PreviewByteLimit(45, 48)
		require.Equal(t, "bytes=0-"+strconv.FormatInt(expected-1, 10), env.store.lastRangeHeader)
	})

	t.Run("seeking past the preview is refused at the storage boundary", func(t *testing.T) {
		// Enforced where the bytes come from, not in the player: a
		// client that asks for a later offset simply does not get it.
		_, err := env.media.OpenAsset(ctx, token, "bytes=3000000-")
		require.ErrorIs(t, err, media.ErrRangeOutsidePreview)
	})

	t.Run("an owner's token has no clamp", func(t *testing.T) {
		buyerID := env.f.user("09120000302")
		env.f.creditWallet(buyerID, 500_000)
		_, err := env.commerce.Purchase(ctx, buyerID,
			[]commerce.PurchaseLine{{AudioEditionID: editionID}}, "", "")
		require.NoError(t, err)

		fullURL, fullDecision, err := env.media.PlaybackURL(ctx, buyerID, "", editionID)
		require.NoError(t, err)
		require.Equal(t, media.AccessFull, fullDecision.Level)

		fullToken := tokenFromURL(t, fullURL)
		_, err = env.media.OpenAsset(ctx, fullToken, "bytes=3000000-3000100")
		require.NoError(t, err, "an owner can seek anywhere")
		require.Equal(t, "bytes=3000000-3000100", env.store.lastRangeHeader)
	})

	t.Run("an unsigned or forged token is refused", func(t *testing.T) {
		_, err := env.media.OpenAsset(ctx, "forged.token", "")
		require.ErrorIs(t, err, media.ErrInvalidStreamToken)
	})
}

// Kids policy can only ever restrict. A parent's purchase does not make
// a title age-appropriate, and a paid-for book still stops at the daily
// screen-time limit.
func TestKidsPolicyOverridesEntitlement(t *testing.T) {
	env := newPlaybackEnv(t)
	ctx := context.Background()

	parentID := env.f.user("09120000303")
	childID := env.f.childProfile(parentID, "سارا", 6)

	adultBook := env.f.book(bookOpts{Slug: "adult", Title: "بزرگسال", IsKidsFriendly: false})
	adultEdition := env.f.edition(editionOpts{BookID: adultBook, VoiceID: "v1", PriceIRR: 200_000, WithAsset: true})

	env.f.creditWallet(parentID, 500_000)
	_, err := env.commerce.Purchase(ctx, parentID,
		[]commerce.PurchaseLine{{AudioEditionID: adultEdition}}, "", "")
	require.NoError(t, err)

	t.Run("the parent can play what they bought", func(t *testing.T) {
		decision, _, err := env.media.ResolveAccess(ctx, parentID, "", adultEdition)
		require.NoError(t, err)
		require.Equal(t, media.AccessFull, decision.Level)
	})

	t.Run("the child cannot, even though the household owns it", func(t *testing.T) {
		decision, _, err := env.media.ResolveAccess(ctx, parentID, childID, adultEdition)
		require.NoError(t, err)
		require.Equal(t, media.AccessDenied, decision.Level)
		require.Equal(t, kids.ReasonNotKidsContent, decision.Reason)
	})

	t.Run("the parent can approve it for this child specifically", func(t *testing.T) {
		require.NoError(t, env.kids.SetApproval(ctx, parentID, childID, adultBook, "allow"))

		decision, _, err := env.media.ResolveAccess(ctx, parentID, childID, adultEdition)
		require.NoError(t, err)
		require.Equal(t, media.AccessFull, decision.Level)
	})

	t.Run("a profile belonging to someone else is refused without leaking its existence", func(t *testing.T) {
		// X-Profile-Id names a profile; it does not prove ownership.
		strangerID := env.f.user("09120000304")
		otherChild := env.f.childProfile(strangerID, "کودک دیگر", 7)

		decision, _, err := env.media.ResolveAccess(ctx, parentID, otherChild, adultEdition)
		require.NoError(t, err)
		require.Equal(t, media.AccessDenied, decision.Level)
		require.Equal(t, kids.ReasonProfileInactive, decision.Reason)
	})
}

func TestKidsDailyLimitStopsPlayback(t *testing.T) {
	env := newPlaybackEnv(t)
	ctx := context.Background()

	parentID := env.f.user("09120000305")
	childID := env.f.childProfile(parentID, "سارا", 6)
	require.NoError(t, seedDefaultControls(ctx, env, childID, 30)) // 30 minutes

	kidsBook := env.f.book(bookOpts{Slug: "kids-story", Title: "قصه کودک", IsKidsFriendly: true})
	kidsEdition := env.f.edition(editionOpts{BookID: kidsBook, VoiceID: "v1", PriceIRR: 0, IsKidsFriendly: true, WithAsset: true})

	decision, _, err := env.media.ResolveAccess(ctx, parentID, childID, kidsEdition)
	require.NoError(t, err)
	require.Equal(t, media.AccessFull, decision.Level)

	// 30 minutes of listening today, recorded in the family's timezone.
	env.f.listeningEvent(parentID, childID, kidsEdition, kidsBook, 30*60, time.Now())

	decision, _, err = env.media.ResolveAccess(ctx, parentID, childID, kidsEdition)
	require.NoError(t, err)
	require.Equal(t, media.AccessDenied, decision.Level)
	require.Equal(t, kids.ReasonDailyLimit, decision.Reason)

	t.Run("the countdown the app shows matches what the server enforces", func(t *testing.T) {
		st, err := env.kids.ScreenTime(ctx, parentID, childID)
		require.NoError(t, err)
		require.Equal(t, int64(30*60), st.SecondsToday)
		require.Equal(t, int64(0), st.RemainingSeconds)
	})
}

func seedDefaultControls(ctx context.Context, env *playbackEnv, childProfileID string, limitMinutes int) error {
	_, err := env.kids.UpdateControls(ctx, parentOf(ctx, env, childProfileID), kids.Controls{
		ChildProfileID:    childProfileID,
		DailyLimitMinutes: limitMinutes,
		AllowedFromMinute: 0,
		AllowedToMinute:   1439,
		MaxContentAge:     12,
		ApprovalMode:      kids.ApprovalKidsCatalog,
	})
	return err
}

func parentOf(ctx context.Context, env *playbackEnv, childProfileID string) string {
	var parentID string
	_ = env.f.pool.QueryRow(ctx,
		`SELECT parent_user_id FROM kids.child_profiles WHERE id = $1`, childProfileID).Scan(&parentID)
	return parentID
}

func tokenFromURL(t *testing.T, rawURL string) string {
	t.Helper()
	_, token, found := strings.Cut(rawURL, "?t=")
	require.True(t, found, "playback URL must carry a signed token: %s", rawURL)
	return token
}
