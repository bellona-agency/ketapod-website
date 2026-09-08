package media

import (
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"ketapod/internal/platform/httpkit"
)

type Handler struct {
	svc *Service
	log *slog.Logger
}

func NewHandler(svc *Service, log *slog.Logger) *Handler {
	return &Handler{svc: svc, log: log}
}

func (h *Handler) Routes(r chi.Router, optionalAuth func(http.Handler) http.Handler) {
	// The byte-serving endpoint authenticates with the signed token in
	// the query string, not with a bearer header — an HTML <audio>
	// element cannot send headers. See media/access.go.
	r.Get("/media/stream/{assetId}", h.streamAsset)

	r.Group(func(r chi.Router) {
		r.Use(optionalAuth)
		r.Get("/media/editions/{editionId}/playback", h.getPlayback)
	})
}

// getPlayback is what a client calls before playing: it returns the
// signed URL plus the access decision, so the player knows whether it is
// about to play a full title, a 60-second preview, or nothing — and can
// show a paywall or a parental-control message instead of failing
// silently mid-stream.
func (h *Handler) getPlayback(w http.ResponseWriter, r *http.Request) {
	userID, _ := httpkit.UserIDFromContext(r.Context())
	profileID := httpkit.ProfileIDFromContext(r.Context())
	editionID := chi.URLParam(r, "editionId")

	url, decision, err := h.svc.PlaybackURL(r.Context(), userID, profileID, editionID)
	switch {
	case errors.Is(err, ErrNotFound):
		httpkit.Error(w, http.StatusNotFound, "not_found", "نسخه صوتی یافت نشد")
		return
	case errors.Is(err, ErrForbidden):
		httpkit.JSON(w, http.StatusForbidden, map[string]any{
			"status": "forbidden", "access": decision.Level, "reason": decision.Reason,
		})
		return
	case err != nil:
		h.log.ErrorContext(r.Context(), "media: resolve playback failed",
			slog.String("edition_id", editionID), slog.String("error", err.Error()))
		httpkit.Error(w, http.StatusInternalServerError, "error", "")
		return
	}

	httpkit.JSON(w, http.StatusOK, map[string]any{
		"audioUrl":          url,
		"access":            decision.Level,
		"reason":            decision.Reason,
		"previewMaxSeconds": decision.MaxSeconds,
	})
}

// streamAsset proxies bytes from object storage straight through to the
// client, forwarding the incoming Range header (or its absence) to the
// storage GetObject call and mirroring back whatever partial-content
// shape S3 returns. This is the concrete reason chi/v5 was chosen over
// Fiber: net/http's ResponseWriter plus this handler is enough to get
// correct 206 Partial Content behavior for seeking in an audio player.
func (h *Handler) streamAsset(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("t")
	if token == "" {
		httpkit.Error(w, http.StatusUnauthorized, "unauthorized", "دسترسی به فایل صوتی نیاز به توکن دارد")
		return
	}

	obj, err := h.svc.OpenAsset(r.Context(), token, r.Header.Get("Range"))
	switch {
	case errors.Is(err, ErrInvalidStreamToken):
		httpkit.Error(w, http.StatusUnauthorized, "invalid_token", "لینک پخش منقضی شده است")
		return
	case errors.Is(err, ErrRangeOutsidePreview):
		// 416 rather than 403: a player that gets 403 retries, a player
		// that gets 416 stops at the end of the preview, which is the
		// behaviour we want.
		w.Header().Set("Content-Range", "bytes */*")
		httpkit.Error(w, http.StatusRequestedRangeNotSatisfiable, "preview_limit", "پایان پیش‌نمایش رایگان")
		return
	case err != nil:
		h.log.WarnContext(r.Context(), "media: stream asset failed", slog.String("error", err.Error()))
		httpkit.Error(w, http.StatusNotFound, "not_found", "فایل صوتی یافت نشد")
		return
	}
	defer obj.Body.Close()

	w.Header().Set("Accept-Ranges", "bytes")
	w.Header().Set("Content-Type", obj.ContentType)
	// Signed URLs are per-user and short-lived; a shared cache holding
	// this response would serve one listener's grant to another.
	w.Header().Set("Cache-Control", "private, max-age=0, no-store")
	w.Header().Set("Content-Length", strconv.FormatInt(obj.ContentLength, 10))

	if obj.IsPartial {
		w.Header().Set("Content-Range", obj.ContentRange)
		w.WriteHeader(http.StatusPartialContent)
	} else {
		w.WriteHeader(http.StatusOK)
	}

	if _, err := io.Copy(w, obj.Body); err != nil && !errors.Is(err, http.ErrHandlerTimeout) {
		h.log.WarnContext(r.Context(), "media: stream copy failed", slog.String("error", err.Error()))
	}
}
