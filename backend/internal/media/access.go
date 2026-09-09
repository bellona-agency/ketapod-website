package media

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// AccessLevel is the outcome of asking "may this listener play these
// bytes". It is computed on the server for every playback request —
// entitlement, kids policy and preview limits are business rules, and
// 04-architecture.md is explicit that business rules live in Go, never
// in one of the three clients.
type AccessLevel string

const (
	AccessFull    AccessLevel = "full"
	AccessPreview AccessLevel = "preview"
	AccessDenied  AccessLevel = "denied"
)

type AccessDecision struct {
	Level AccessLevel
	// MaxSeconds is the playable prefix for AccessPreview. Zero with
	// AccessPreview means the edition has no preview configured, which
	// is equivalent to denied.
	MaxSeconds int
	// Reason is a machine-readable code the client turns into UI: a
	// paywall, a "ask a parent" screen, or a daily-limit message. These
	// are meaningfully different screens, so one generic 403 would not
	// be enough.
	Reason string
}

func (d AccessDecision) Playable() bool {
	return d.Level == AccessFull || (d.Level == AccessPreview && d.MaxSeconds > 0)
}

const (
	ReasonFree            = "free"
	ReasonEntitled        = "entitled"
	ReasonPreviewOnly     = "preview_only"
	ReasonNoPreview       = "no_preview"
	ReasonKidsBlocked     = "kids_content_blocked"
	ReasonKidsTimeLimit   = "kids_daily_limit_reached"
	ReasonKidsOutsideHour = "kids_outside_allowed_hours"
	ReasonKidsAgeLimit    = "kids_age_limit"
	ReasonUnpublished     = "edition_unpublished"
)

var ErrInvalidStreamToken = errors.New("media: invalid or expired stream token")

// StreamToken is what makes a gated audio URL usable from a plain HTML
// <audio> element.
//
// The browser's audio element cannot attach an Authorization header, so
// bearer-token auth alone would make the web player impossible and push
// us back to unauthenticated audio. Instead the API mints a short-lived
// HMAC over (assetID, expiry, maxSeconds) and the stream endpoint
// verifies it. The token is not a session: it grants exactly one asset
// for a few minutes, so leaking it leaks one file for one window rather
// than an account.
type StreamToken struct {
	AssetID    string
	ExpiresAt  time.Time
	MaxSeconds int
}

type Signer struct {
	secret []byte
	ttl    time.Duration
}

func NewSigner(secret string, ttl time.Duration) *Signer {
	if ttl <= 0 {
		ttl = 15 * time.Minute
	}
	return &Signer{secret: []byte(secret), ttl: ttl}
}

func (s *Signer) Sign(assetID string, maxSeconds int) string {
	payload := fmt.Sprintf("%s|%d|%d", assetID, time.Now().Add(s.ttl).Unix(), maxSeconds)
	encoded := base64.RawURLEncoding.EncodeToString([]byte(payload))
	return encoded + "." + s.mac(encoded)
}

func (s *Signer) Verify(token string) (StreamToken, error) {
	encoded, signature, ok := strings.Cut(token, ".")
	if !ok {
		return StreamToken{}, ErrInvalidStreamToken
	}
	if !hmac.Equal([]byte(signature), []byte(s.mac(encoded))) {
		return StreamToken{}, ErrInvalidStreamToken
	}

	raw, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		return StreamToken{}, ErrInvalidStreamToken
	}

	parts := strings.Split(string(raw), "|")
	if len(parts) != 3 {
		return StreamToken{}, ErrInvalidStreamToken
	}

	expUnix, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil {
		return StreamToken{}, ErrInvalidStreamToken
	}
	expiresAt := time.Unix(expUnix, 0)
	if time.Now().After(expiresAt) {
		return StreamToken{}, ErrInvalidStreamToken
	}

	maxSeconds, err := strconv.Atoi(parts[2])
	if err != nil {
		return StreamToken{}, ErrInvalidStreamToken
	}

	return StreamToken{AssetID: parts[0], ExpiresAt: expiresAt, MaxSeconds: maxSeconds}, nil
}

func (s *Signer) mac(encoded string) string {
	m := hmac.New(sha256.New, s.secret)
	m.Write([]byte(encoded))
	return base64.RawURLEncoding.EncodeToString(m.Sum(nil))
}

// PreviewByteLimit converts a preview window in seconds to a byte offset.
//
// This works because every asset is encoded at a fixed 48 kbit mono
// (08-decisions.md) — a constant bitrate makes byte offset a linear
// function of time. The 64 KiB headroom covers container overhead so a
// preview never cuts mid-frame and leaves the player with a truncated
// sample it refuses to decode.
//
// It depends on the moov atom sitting at the *front* of the file: an m4a
// muxed without `-movflags +faststart` puts it at the end, and a client
// that can only read the first N bytes then has no index and plays
// nothing. The transcode pipeline must pass that flag; cmd/seed does.
func PreviewByteLimit(maxSeconds, bitrateKbps int) int64 {
	if maxSeconds <= 0 {
		return 0
	}
	if bitrateKbps <= 0 {
		bitrateKbps = 48
	}
	const containerHeadroomBytes = 64 * 1024
	return int64(maxSeconds)*int64(bitrateKbps)*1000/8 + containerHeadroomBytes
}
