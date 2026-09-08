package library

import (
	"errors"
	"log/slog"
	"net/http"
	"time"

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

func (h *Handler) Routes(r chi.Router, requireAuth func(http.Handler) http.Handler) {
	r.Group(func(r chi.Router) {
		r.Use(requireAuth)

		r.Put("/me/positions", h.syncPosition)
		r.Get("/me/positions/{editionId}", h.getPosition)
		r.Get("/me/continue-listening", h.continueListening)
		r.Get("/me/stats", h.getStats)

		r.Post("/me/bookmarks", h.createBookmark)
		r.Get("/me/bookmarks", h.listBookmarks)
		r.Delete("/me/bookmarks/{bookmarkId}", h.deleteBookmark)

		r.Post("/me/notes", h.createNote)
		r.Get("/me/notes", h.listNotes)
		r.Patch("/me/notes/{noteId}", h.updateNote)
		r.Delete("/me/notes/{noteId}", h.deleteNote)

		r.Post("/me/highlights", h.createHighlight)
		r.Get("/me/highlights", h.listHighlights)
		r.Delete("/me/highlights/{highlightId}", h.deleteHighlight)

		r.Get("/me/shelf", h.listShelf)
		r.Put("/me/shelf/{bookId}", h.addToShelf)
		r.Delete("/me/shelf/{bookId}", h.removeFromShelf)

		r.Post("/me/clips", h.createClip)
	})
}

type positionBody struct {
	AudioEditionID  string  `json:"audioEditionId"`
	PositionSeconds float64 `json:"positionSeconds"`
	DurationSeconds float64 `json:"durationSeconds"`
	IsFinished      bool    `json:"isFinished"`
	SecondsListened int     `json:"secondsListened"`
	// DeviceUpdatedAt is the client's own clock. Last-write-wins uses it
	// rather than server arrival time, so an offline device syncing late
	// cannot overwrite newer progress from another device.
	DeviceUpdatedAt *time.Time `json:"deviceUpdatedAt"`
}

func (h *Handler) syncPosition(w http.ResponseWriter, r *http.Request) {
	var body positionBody
	if err := httpkit.DecodeJSON(r, &body); err != nil || body.AudioEditionID == "" {
		httpkit.ValidationError(w, map[string][]string{"audioEditionId": {"این فیلد الزامی است"}})
		return
	}

	update := PositionUpdate{
		AudioEditionID:  body.AudioEditionID,
		ProfileID:       httpkit.ProfileIDFromContext(r.Context()),
		PositionSeconds: body.PositionSeconds,
		DurationSeconds: body.DurationSeconds,
		IsFinished:      body.IsFinished,
		SecondsListened: body.SecondsListened,
	}
	if body.DeviceUpdatedAt != nil {
		update.DeviceUpdatedAt = *body.DeviceUpdatedAt
	}

	userID, _ := httpkit.UserIDFromContext(r.Context())
	position, err := h.svc.SyncPosition(r.Context(), userID, update)
	if err != nil && !errors.Is(err, ErrStaleWrite) {
		h.log.ErrorContext(r.Context(), "library: sync position failed", slog.String("error", err.Error()))
		httpkit.Error(w, http.StatusInternalServerError, "error", "")
		return
	}

	// A stale write is a normal outcome, not a failure: 200 with the
	// authoritative position and a flag, so the player adopts it instead
	// of retrying forever.
	httpkit.JSON(w, http.StatusOK, map[string]any{
		"position": positionResponse(position),
		"accepted": !errors.Is(err, ErrStaleWrite),
	})
}

func (h *Handler) getPosition(w http.ResponseWriter, r *http.Request) {
	userID, _ := httpkit.UserIDFromContext(r.Context())
	position, err := h.svc.GetPosition(r.Context(), userID,
		httpkit.ProfileIDFromContext(r.Context()), chi.URLParam(r, "editionId"))
	if err != nil {
		httpkit.JSON(w, http.StatusOK, map[string]any{"position": nil})
		return
	}
	httpkit.JSON(w, http.StatusOK, map[string]any{"position": positionResponse(position)})
}

func (h *Handler) continueListening(w http.ResponseWriter, r *http.Request) {
	userID, _ := httpkit.UserIDFromContext(r.Context())
	page := httpkit.PageFromRequest(r)

	positions, err := h.svc.ContinueListening(r.Context(), userID, httpkit.ProfileIDFromContext(r.Context()), page.Limit)
	if err != nil {
		httpkit.Error(w, http.StatusInternalServerError, "error", "")
		return
	}

	out := make([]map[string]any, len(positions))
	for i, p := range positions {
		item := positionResponse(p)
		item["title"] = p.BookTitle
		item["slug"] = p.BookSlug
		item["coverUrl"] = p.BookCoverURL
		out[i] = item
	}
	httpkit.JSON(w, http.StatusOK, map[string]any{"items": out})
}

func (h *Handler) getStats(w http.ResponseWriter, r *http.Request) {
	userID, _ := httpkit.UserIDFromContext(r.Context())

	days := 30
	if raw := httpkit.QueryString(r, "days"); raw != "" {
		if parsed := parsePositiveInt(raw, 30); parsed > 0 {
			days = min(parsed, 365)
		}
	}

	stats, err := h.svc.StatsFor(r.Context(), userID,
		httpkit.ProfileIDFromContext(r.Context()),
		httpkit.QueryString(r, "tz"),
		time.Now().AddDate(0, 0, -days))
	if err != nil {
		h.log.ErrorContext(r.Context(), "library: stats failed", slog.String("error", err.Error()))
		httpkit.Error(w, http.StatusInternalServerError, "error", "")
		return
	}

	daily := make([]map[string]any, len(stats.DailyBreakdown))
	for i, d := range stats.DailyBreakdown {
		daily[i] = map[string]any{"date": d.Date.Format("2006-01-02"), "secondsListened": d.SecondsListened}
	}
	top := make([]map[string]any, len(stats.TopBooks))
	for i, b := range stats.TopBooks {
		top[i] = map[string]any{
			"bookId": b.BookID, "title": b.Title, "coverUrl": b.CoverURL,
			"secondsListened": b.SecondsListened,
		}
	}

	httpkit.JSON(w, http.StatusOK, map[string]any{
		"totalSeconds": stats.TotalSeconds, "currentStreak": stats.CurrentStreak,
		"longestStreak": stats.LongestStreak, "dailyBreakdown": daily, "topBooks": top,
	})
}

type bookmarkBody struct {
	AudioEditionID  string  `json:"audioEditionId"`
	PositionSeconds float64 `json:"positionSeconds"`
	Label           string  `json:"label"`
}

func (h *Handler) createBookmark(w http.ResponseWriter, r *http.Request) {
	var body bookmarkBody
	if err := httpkit.DecodeJSON(r, &body); err != nil || body.AudioEditionID == "" {
		httpkit.ValidationError(w, map[string][]string{"audioEditionId": {"این فیلد الزامی است"}})
		return
	}

	userID, _ := httpkit.UserIDFromContext(r.Context())
	bookmark, err := h.svc.AddBookmark(r.Context(), userID, body.AudioEditionID, body.PositionSeconds, body.Label)
	if err != nil {
		httpkit.Error(w, http.StatusBadRequest, "invalid", "ثبت نشانک ممکن نشد")
		return
	}
	httpkit.JSON(w, http.StatusCreated, bookmarkResponse(bookmark))
}

func (h *Handler) listBookmarks(w http.ResponseWriter, r *http.Request) {
	userID, _ := httpkit.UserIDFromContext(r.Context())
	page := httpkit.PageFromRequest(r)

	bookmarks, total, err := h.svc.ListBookmarks(r.Context(), userID, httpkit.QueryString(r, "editionId"), page.Limit, page.Offset)
	if err != nil {
		httpkit.Error(w, http.StatusInternalServerError, "error", "")
		return
	}
	out := make([]map[string]any, len(bookmarks))
	for i, b := range bookmarks {
		out[i] = bookmarkResponse(b)
	}
	httpkit.Page200(w, out, total, page)
}

func (h *Handler) deleteBookmark(w http.ResponseWriter, r *http.Request) {
	userID, _ := httpkit.UserIDFromContext(r.Context())
	if err := h.svc.DeleteBookmark(r.Context(), userID, chi.URLParam(r, "bookmarkId")); err != nil {
		httpkit.Error(w, http.StatusInternalServerError, "error", "")
		return
	}
	httpkit.NoContent(w)
}

type noteBody struct {
	AudioEditionID  string  `json:"audioEditionId"`
	PositionSeconds float64 `json:"positionSeconds"`
	Body            string  `json:"body"`
}

func (h *Handler) createNote(w http.ResponseWriter, r *http.Request) {
	var body noteBody
	if err := httpkit.DecodeJSON(r, &body); err != nil || body.AudioEditionID == "" {
		httpkit.ValidationError(w, map[string][]string{"audioEditionId": {"این فیلد الزامی است"}})
		return
	}

	userID, _ := httpkit.UserIDFromContext(r.Context())
	note, err := h.svc.AddNote(r.Context(), userID, body.AudioEditionID, body.PositionSeconds, body.Body)
	if err != nil {
		httpkit.ValidationError(w, map[string][]string{"body": {"متن یادداشت الزامی است"}})
		return
	}
	httpkit.JSON(w, http.StatusCreated, noteResponse(note))
}

func (h *Handler) listNotes(w http.ResponseWriter, r *http.Request) {
	userID, _ := httpkit.UserIDFromContext(r.Context())
	page := httpkit.PageFromRequest(r)

	notes, total, err := h.svc.ListNotes(r.Context(), userID, httpkit.QueryString(r, "editionId"), page.Limit, page.Offset)
	if err != nil {
		httpkit.Error(w, http.StatusInternalServerError, "error", "")
		return
	}
	out := make([]map[string]any, len(notes))
	for i, n := range notes {
		out[i] = noteResponse(n)
	}
	httpkit.Page200(w, out, total, page)
}

func (h *Handler) updateNote(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Body string `json:"body"`
	}
	if err := httpkit.DecodeJSON(r, &body); err != nil {
		httpkit.BadJSON(w)
		return
	}

	userID, _ := httpkit.UserIDFromContext(r.Context())
	note, err := h.svc.UpdateNote(r.Context(), userID, chi.URLParam(r, "noteId"), body.Body)
	if err != nil {
		httpkit.Error(w, http.StatusNotFound, "not_found", "یادداشت یافت نشد")
		return
	}
	httpkit.JSON(w, http.StatusOK, noteResponse(note))
}

func (h *Handler) deleteNote(w http.ResponseWriter, r *http.Request) {
	userID, _ := httpkit.UserIDFromContext(r.Context())
	if err := h.svc.DeleteNote(r.Context(), userID, chi.URLParam(r, "noteId")); err != nil {
		httpkit.Error(w, http.StatusInternalServerError, "error", "")
		return
	}
	httpkit.NoContent(w)
}

type highlightBody struct {
	AudioEditionID string  `json:"audioEditionId"`
	StartSeconds   float64 `json:"startSeconds"`
	EndSeconds     float64 `json:"endSeconds"`
	Quote          string  `json:"quote"`
}

func (h *Handler) createHighlight(w http.ResponseWriter, r *http.Request) {
	var body highlightBody
	if err := httpkit.DecodeJSON(r, &body); err != nil {
		httpkit.BadJSON(w)
		return
	}

	userID, _ := httpkit.UserIDFromContext(r.Context())
	highlight, err := h.svc.AddHighlight(r.Context(), userID, body.AudioEditionID, body.StartSeconds, body.EndSeconds, body.Quote)
	if err != nil {
		httpkit.ValidationError(w, map[string][]string{"quote": {"بازه یا متن هایلایت معتبر نیست"}})
		return
	}
	httpkit.JSON(w, http.StatusCreated, map[string]any{
		"id": highlight.ID, "audioEditionId": highlight.AudioEditionID, "bookId": highlight.BookID,
		"startSeconds": highlight.StartSeconds, "endSeconds": highlight.EndSeconds,
		"quote": highlight.Quote, "createdAt": highlight.CreatedAt,
	})
}

func (h *Handler) listHighlights(w http.ResponseWriter, r *http.Request) {
	userID, _ := httpkit.UserIDFromContext(r.Context())
	page := httpkit.PageFromRequest(r)

	highlights, total, err := h.svc.ListHighlights(r.Context(), userID, httpkit.QueryString(r, "editionId"), page.Limit, page.Offset)
	if err != nil {
		httpkit.Error(w, http.StatusInternalServerError, "error", "")
		return
	}
	out := make([]map[string]any, len(highlights))
	for i, hl := range highlights {
		out[i] = map[string]any{
			"id": hl.ID, "audioEditionId": hl.AudioEditionID, "bookId": hl.BookID,
			"startSeconds": hl.StartSeconds, "endSeconds": hl.EndSeconds,
			"quote": hl.Quote, "title": hl.BookTitle, "createdAt": hl.CreatedAt,
		}
	}
	httpkit.Page200(w, out, total, page)
}

func (h *Handler) deleteHighlight(w http.ResponseWriter, r *http.Request) {
	userID, _ := httpkit.UserIDFromContext(r.Context())
	if err := h.svc.DeleteHighlight(r.Context(), userID, chi.URLParam(r, "highlightId")); err != nil {
		httpkit.Error(w, http.StatusInternalServerError, "error", "")
		return
	}
	httpkit.NoContent(w)
}

func (h *Handler) listShelf(w http.ResponseWriter, r *http.Request) {
	userID, _ := httpkit.UserIDFromContext(r.Context())
	page := httpkit.PageFromRequest(r)

	items, total, err := h.svc.ListShelf(r.Context(), userID, httpkit.QueryString(r, "shelf"), page.Limit, page.Offset)
	if err != nil {
		httpkit.Error(w, http.StatusInternalServerError, "error", "")
		return
	}
	out := make([]map[string]any, len(items))
	for i, item := range items {
		out[i] = map[string]any{
			"bookId": item.BookID, "shelf": item.Shelf, "title": item.BookTitle,
			"slug": item.BookSlug, "coverUrl": item.BookCoverURL,
			"isKidsFriendly": item.IsKidsFriendly, "createdAt": item.CreatedAt,
		}
	}
	httpkit.Page200(w, out, total, page)
}

func (h *Handler) addToShelf(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Shelf string `json:"shelf"`
	}
	if err := httpkit.DecodeJSON(r, &body); err != nil {
		body.Shelf = ShelfFavorites
	}
	if body.Shelf == "" {
		body.Shelf = ShelfFavorites
	}

	userID, _ := httpkit.UserIDFromContext(r.Context())
	if err := h.svc.SetShelf(r.Context(), userID, chi.URLParam(r, "bookId"), body.Shelf); err != nil {
		httpkit.ValidationError(w, map[string][]string{"shelf": {"قفسه نامعتبر است"}})
		return
	}
	httpkit.NoContent(w)
}

func (h *Handler) removeFromShelf(w http.ResponseWriter, r *http.Request) {
	shelf := httpkit.QueryString(r, "shelf")
	if shelf == "" {
		shelf = ShelfFavorites
	}

	userID, _ := httpkit.UserIDFromContext(r.Context())
	if err := h.svc.RemoveFromShelf(r.Context(), userID, chi.URLParam(r, "bookId"), shelf); err != nil {
		httpkit.Error(w, http.StatusInternalServerError, "error", "")
		return
	}
	httpkit.NoContent(w)
}

type clipBody struct {
	AudioEditionID string  `json:"audioEditionId"`
	StartSeconds   float64 `json:"startSeconds"`
	EndSeconds     float64 `json:"endSeconds"`
}

func (h *Handler) createClip(w http.ResponseWriter, r *http.Request) {
	var body clipBody
	if err := httpkit.DecodeJSON(r, &body); err != nil {
		httpkit.BadJSON(w)
		return
	}

	userID, _ := httpkit.UserIDFromContext(r.Context())
	clip, err := h.svc.RequestClip(r.Context(), userID, body.AudioEditionID, body.StartSeconds, body.EndSeconds)
	if err != nil {
		httpkit.ValidationError(w, map[string][]string{"endSeconds": {"بازه کلیپ باید بین ۱ تا ۱۲۰ ثانیه باشد"}})
		return
	}
	httpkit.JSON(w, http.StatusAccepted, map[string]any{
		"id": clip.ID, "status": clip.Status,
		"startSeconds": clip.StartSeconds, "endSeconds": clip.EndSeconds,
	})
}

func positionResponse(p Position) map[string]any {
	return map[string]any{
		"audioEditionId": p.AudioEditionID, "bookId": p.BookID,
		"positionSeconds": p.PositionSeconds, "durationSeconds": p.DurationSeconds,
		"isFinished": p.IsFinished, "updatedAt": p.UpdatedAt,
	}
}

func bookmarkResponse(b Bookmark) map[string]any {
	return map[string]any{
		"id": b.ID, "audioEditionId": b.AudioEditionID, "bookId": b.BookID,
		"positionSeconds": b.PositionSeconds, "label": b.Label,
		"summary": b.Summary, "summaryStatus": b.SummaryStatus,
		"title": b.BookTitle, "coverUrl": b.BookCoverURL, "createdAt": b.CreatedAt,
	}
}

func noteResponse(n Note) map[string]any {
	return map[string]any{
		"id": n.ID, "audioEditionId": n.AudioEditionID, "bookId": n.BookID,
		"positionSeconds": n.PositionSeconds, "body": n.Body,
		"title": n.BookTitle, "coverUrl": n.BookCoverURL,
		"createdAt": n.CreatedAt, "updatedAt": n.UpdatedAt,
	}
}

func parsePositiveInt(raw string, fallback int) int {
	n := 0
	for _, r := range raw {
		if r < '0' || r > '9' {
			return fallback
		}
		n = n*10 + int(r-'0')
		if n > 100000 {
			return fallback
		}
	}
	if n == 0 {
		return fallback
	}
	return n
}
