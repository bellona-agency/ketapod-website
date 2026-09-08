package media

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"ketapod/internal/catalog"
	"ketapod/internal/platform/apiversion"
	"ketapod/internal/platform/storage"
)

var (
	ErrNotFound  = errors.New("media: not found")
	ErrForbidden = errors.New("media: playback not permitted")
)

// Repository is the narrow persistence contract Service needs. repo.go
// implements it against sqlc-generated code; tests fake it directly
// without a database.
type Repository interface {
	GetAudioAssetByID(ctx context.Context, id string) (AudioAsset, error)
	GetPrimaryAudioAssetForEdition(ctx context.Context, audioEditionID string) (AudioAsset, error)
	ListAssetsForEdition(ctx context.Context, audioEditionID string) ([]AudioAsset, error)
}

type ObjectStore interface {
	GetObject(ctx context.Context, key string, rangeHeader string) (*storage.Object, error)
}

// EditionReader is catalog's slice: price, preview window and publish
// status of the edition being requested.
type EditionReader interface {
	GetEdition(ctx context.Context, editionID string) (catalog.Edition, error)
}

// EntitlementChecker is commerce's slice: does this user hold a live
// entitlement for this edition (directly, or through a subscription /
// org grant recorded against the whole book).
type EntitlementChecker interface {
	IsEntitledToEdition(ctx context.Context, userID, editionID, bookID string) (bool, error)
}

// KidsGuard is the kids module's slice. It is consulted whenever the
// request carries an active child profile, and it can veto playback that
// entitlement alone would allow — a parent's purchase does not make a
// title age-appropriate, and a paid-for book still stops at the daily
// screen-time limit.
type KidsGuard interface {
	CheckPlayback(ctx context.Context, parentUserID, childProfileID, bookID string) (allowed bool, reason string, err error)
}

type Service struct {
	repo          Repository
	store         ObjectStore
	editions      EditionReader
	entitlements  EntitlementChecker
	kids          KidsGuard
	signer        *Signer
	publicBaseURL string
}

func NewService(repo Repository, store ObjectStore, editions EditionReader, entitlements EntitlementChecker, kids KidsGuard, signer *Signer, publicBaseURL string) *Service {
	return &Service{
		repo: repo, store: store, editions: editions, entitlements: entitlements,
		kids: kids, signer: signer, publicBaseURL: strings.TrimRight(publicBaseURL, "/"),
	}
}

// ResolveAccess is the single decision point for "may this listener play
// this edition, and how much of it".
//
// Order matters. Kids policy runs first and can only ever restrict: a
// child profile that fails an age or time check is denied even for a
// free title the parent owns. Entitlement runs second. Preview is the
// fallback, not a permission — a paid edition with previewSeconds = 0 is
// simply denied.
func (s *Service) ResolveAccess(ctx context.Context, userID, childProfileID, editionID string) (AccessDecision, catalog.Edition, error) {
	edition, err := s.editions.GetEdition(ctx, editionID)
	if err != nil {
		return AccessDecision{Level: AccessDenied}, catalog.Edition{}, ErrNotFound
	}
	if edition.Status != "" && edition.Status != "published" {
		return AccessDecision{Level: AccessDenied, Reason: ReasonUnpublished}, edition, nil
	}

	if childProfileID != "" && s.kids != nil {
		allowed, reason, err := s.kids.CheckPlayback(ctx, userID, childProfileID, edition.BookID)
		if err != nil {
			return AccessDecision{Level: AccessDenied}, edition, fmt.Errorf("media: kids policy check: %w", err)
		}
		if !allowed {
			return AccessDecision{Level: AccessDenied, Reason: reason}, edition, nil
		}
	}

	if edition.IsFree() {
		return AccessDecision{Level: AccessFull, Reason: ReasonFree}, edition, nil
	}

	if userID != "" && s.entitlements != nil {
		entitled, err := s.entitlements.IsEntitledToEdition(ctx, userID, edition.AudioEditionID, edition.BookID)
		if err != nil {
			return AccessDecision{Level: AccessDenied}, edition, fmt.Errorf("media: entitlement check: %w", err)
		}
		if entitled {
			return AccessDecision{Level: AccessFull, Reason: ReasonEntitled}, edition, nil
		}
	}

	if edition.PreviewSeconds <= 0 {
		return AccessDecision{Level: AccessDenied, Reason: ReasonNoPreview}, edition, nil
	}
	return AccessDecision{Level: AccessPreview, MaxSeconds: edition.PreviewSeconds, Reason: ReasonPreviewOnly}, edition, nil
}

// PlaybackURL resolves access and mints a signed, short-lived URL for
// exactly what the caller is allowed to hear.
//
// The URL must be absolute, not a bare path: the frontend and API run on
// different origins in every local dev setup (Next.js on :3000, this API
// on :8080), so a path-only URL silently resolves against the *page's*
// origin and the browser fetches audio from the wrong server.
func (s *Service) PlaybackURL(ctx context.Context, userID, childProfileID, editionID string) (string, AccessDecision, error) {
	decision, _, err := s.ResolveAccess(ctx, userID, childProfileID, editionID)
	if err != nil {
		return "", decision, err
	}
	if !decision.Playable() {
		return "", decision, ErrForbidden
	}

	asset, err := s.repo.GetPrimaryAudioAssetForEdition(ctx, editionID)
	if err != nil {
		return "", decision, ErrNotFound
	}

	maxSeconds := 0
	if decision.Level == AccessPreview {
		maxSeconds = decision.MaxSeconds
	}

	// The version is part of the URL and the URL outlives the request:
	// clients hold a signed playback URL for minutes. Deriving it from
	// apiversion rather than writing "/api/v1" here is what stops a
	// future v2 from invalidating tokens already in flight without
	// anyone noticing.
	route := fmt.Sprintf("media/stream/%s?t=%s", asset.ID, s.signer.Sign(asset.ID, maxSeconds))
	return apiversion.Current.URL(s.publicBaseURL, route), decision, nil
}

// StreamURL keeps the anonymous-visitor contract used by the Home demo
// (07-api-contract.md): it returns whatever an unauthenticated listener
// may hear — the full clip for a free edition, the preview prefix for a
// paid one. It never returns an unguarded URL.
func (s *Service) StreamURL(ctx context.Context, audioEditionID string) (string, int, error) {
	url, _, err := s.PlaybackURL(ctx, "", "", audioEditionID)
	if err != nil {
		return "", 0, err
	}

	asset, err := s.repo.GetPrimaryAudioAssetForEdition(ctx, audioEditionID)
	if err != nil {
		return "", 0, ErrNotFound
	}
	return url, asset.DurationSeconds, nil
}

// OpenAsset streams bytes for a verified token, clamping the requested
// byte range to the preview window when the token grants one.
//
// The clamp is applied to the Range header before it reaches object
// storage, so a preview listener cannot ask for a later byte offset and
// receive it: the limit is enforced where the bytes come from, not in
// the player.
func (s *Service) OpenAsset(ctx context.Context, token, rangeHeader string) (*storage.Object, error) {
	claims, err := s.signer.Verify(token)
	if err != nil {
		return nil, err
	}

	asset, err := s.repo.GetAudioAssetByID(ctx, claims.AssetID)
	if err != nil {
		return nil, ErrNotFound
	}

	effectiveRange := rangeHeader
	if claims.MaxSeconds > 0 {
		limit := PreviewByteLimit(claims.MaxSeconds, asset.BitrateKbps)
		effectiveRange, err = clampRange(rangeHeader, limit)
		if err != nil {
			return nil, err
		}
	}

	obj, err := s.store.GetObject(ctx, asset.StorageKey, effectiveRange)
	if err != nil {
		return nil, fmt.Errorf("media: open object: %w", err)
	}
	if obj.ContentType == "" {
		obj.ContentType = "audio/mp4"
	}
	return obj, nil
}
