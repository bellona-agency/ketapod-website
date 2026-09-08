package catalog

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"ketapod/internal/platform/httpkit"
)

// EntitlementReader is the slice of commerce the book page needs: given
// a signed-in caller, which of this book's editions they already own.
// Without it the frontend would have to ask a second endpoint and
// reconcile, and the "buy" button would flicker for owners.
type EntitlementReader interface {
	IsEntitledToEdition(ctx context.Context, userID, editionID, bookID string) (bool, error)
}

// StreamURLResolver is media's contribution to the book page: a playable
// URL per edition. catalog never touches media.audio_assets itself.
type StreamURLResolver interface {
	StreamURL(ctx context.Context, audioEditionID string) (url string, durationSeconds int, err error)
}

type Handler struct {
	svc          *Service
	entitlements EntitlementReader
	media        StreamURLResolver
	log          *slog.Logger
}

func NewHandler(svc *Service, entitlements EntitlementReader, media StreamURLResolver, log *slog.Logger) *Handler {
	return &Handler{svc: svc, entitlements: entitlements, media: media, log: log}
}

// Routes mounts the public catalog surface. optionalAuth rather than
// requireAuth throughout: these are the pages Google indexes and a
// first-time visitor browses, and they must work signed out — but when
// a token *is* present the response carries ownership, which is what
// keeps purchase state out of the client's head.
func (h *Handler) Routes(r chi.Router, optionalAuth func(http.Handler) http.Handler) {
	r.Group(func(r chi.Router) {
		r.Use(optionalAuth)
		r.Get("/catalog/books", h.listBooks)
		r.Get("/catalog/books/{slug}", h.getBook)
		r.Get("/catalog/search", h.search)
		r.Get("/catalog/categories", h.listCategories)
		r.Get("/catalog/voices", h.listVoices)
		r.Get("/catalog/authors/{slug}", h.getAuthor)
		r.Get("/catalog/editions/{editionId}/chapters", h.listChapters)
		r.Get("/catalog/editions/{editionId}/transcript", h.getTranscript)
	})
}

func (h *Handler) listBooks(w http.ResponseWriter, r *http.Request) {
	page := httpkit.PageFromRequest(r)
	books, total, err := h.svc.ListBooks(r.Context(), BookFilter{
		CategorySlug: httpkit.QueryStringPtr(r, "category"),
		AuthorSlug:   httpkit.QueryStringPtr(r, "author"),
		Language:     httpkit.QueryStringPtr(r, "language"),
		KidsOnly:     httpkit.QueryBoolPtr(r, "kids"),
		Sort:         httpkit.QueryString(r, "sort"),
		Limit:        page.Limit,
		Offset:       page.Offset,
	})
	if err != nil {
		h.log.ErrorContext(r.Context(), "catalog: list books failed", slog.String("error", err.Error()))
		httpkit.Error(w, http.StatusInternalServerError, "error", "")
		return
	}

	httpkit.Page200(w, bookSummaries(books), total, page)
}

func (h *Handler) search(w http.ResponseWriter, r *http.Request) {
	page := httpkit.PageFromRequest(r)
	books, total, err := h.svc.Search(r.Context(), httpkit.QueryString(r, "q"), httpkit.QueryBoolPtr(r, "kids"), page.Limit, page.Offset)
	if err != nil {
		if errors.Is(err, ErrQueryTooShort) {
			httpkit.ValidationError(w, map[string][]string{"q": {"عبارت جستجو باید حداقل ۲ نویسه باشد"}})
			return
		}
		h.log.ErrorContext(r.Context(), "catalog: search failed", slog.String("error", err.Error()))
		httpkit.Error(w, http.StatusInternalServerError, "error", "")
		return
	}

	httpkit.Page200(w, bookSummaries(books), total, page)
}

func (h *Handler) getBook(w http.ResponseWriter, r *http.Request) {
	book, err := h.svc.GetBookBySlug(r.Context(), chi.URLParam(r, "slug"))
	if err != nil {
		httpkit.Error(w, http.StatusNotFound, "not_found", "کتاب یافت نشد")
		return
	}

	editions, err := h.svc.ListEditionsForBook(r.Context(), book.ID)
	if err != nil {
		h.log.ErrorContext(r.Context(), "catalog: list editions failed", slog.String("error", err.Error()))
		httpkit.Error(w, http.StatusInternalServerError, "error", "")
		return
	}

	userID, _ := httpkit.UserIDFromContext(r.Context())

	out := make([]map[string]any, len(editions))
	for i, ed := range editions {
		owned := ed.IsFree()
		if !owned && userID != "" && h.entitlements != nil {
			if ok, err := h.entitlements.IsEntitledToEdition(r.Context(), userID, ed.AudioEditionID, ed.BookID); err == nil {
				owned = ok
			}
		}

		out[i] = map[string]any{
			"id":              ed.AudioEditionID,
			"voiceId":         ed.VoiceID,
			"voiceName":       ed.VoiceName,
			"voiceStyle":      ed.VoiceStyle,
			"narratorType":    ed.NarratorType,
			"dialect":         ed.Dialect,
			"language":        ed.Language,
			"isKidsFriendly":  ed.IsKidsFriendly,
			"priceIrr":        ed.PriceIRR,
			"previewSeconds":  ed.PreviewSeconds,
			"durationSeconds": ed.DurationSeconds,
			"isOwned":         owned,
		}
		if h.media != nil {
			if url, dur, err := h.media.StreamURL(r.Context(), ed.AudioEditionID); err == nil {
				out[i]["audioUrl"] = url
				if ed.DurationSeconds == 0 {
					out[i]["durationSeconds"] = dur
				}
			}
		}
	}

	httpkit.JSON(w, http.StatusOK, map[string]any{
		"book":     bookDetail(book),
		"editions": out,
	})
}

func (h *Handler) listCategories(w http.ResponseWriter, r *http.Request) {
	categories, err := h.svc.ListCategories(r.Context())
	if err != nil {
		httpkit.Error(w, http.StatusInternalServerError, "error", "")
		return
	}
	out := make([]map[string]any, len(categories))
	for i, c := range categories {
		out[i] = map[string]any{"id": c.ID, "name": c.Name, "slug": c.Slug, "bookCount": c.BookCount}
	}
	httpkit.JSON(w, http.StatusOK, map[string]any{"categories": out})
}

func (h *Handler) listVoices(w http.ResponseWriter, r *http.Request) {
	voices, err := h.svc.ListVoices(r.Context())
	if err != nil {
		httpkit.Error(w, http.StatusInternalServerError, "error", "")
		return
	}
	out := make([]map[string]any, len(voices))
	for i, v := range voices {
		out[i] = map[string]any{"id": v.ID, "name": v.Name, "style": v.Style, "isDefault": v.IsDefault, "isKids": v.IsKids}
	}
	httpkit.JSON(w, http.StatusOK, map[string]any{"voices": out})
}

func (h *Handler) getAuthor(w http.ResponseWriter, r *http.Request) {
	author, err := h.svc.GetAuthorBySlug(r.Context(), chi.URLParam(r, "slug"))
	if err != nil {
		httpkit.Error(w, http.StatusNotFound, "not_found", "نویسنده یافت نشد")
		return
	}

	page := httpkit.PageFromRequest(r)
	books, total, err := h.svc.ListBooks(r.Context(), BookFilter{
		AuthorSlug: &author.Slug, Limit: page.Limit, Offset: page.Offset,
	})
	if err != nil {
		httpkit.Error(w, http.StatusInternalServerError, "error", "")
		return
	}

	httpkit.JSON(w, http.StatusOK, map[string]any{
		"author": map[string]any{"id": author.ID, "name": author.Name, "slug": author.Slug, "bio": author.Bio},
		"books":  bookSummaries(books),
		"total":  total,
	})
}

func (h *Handler) listChapters(w http.ResponseWriter, r *http.Request) {
	chapters, err := h.svc.ListChapters(r.Context(), chi.URLParam(r, "editionId"))
	if err != nil {
		httpkit.Error(w, http.StatusNotFound, "not_found", "نسخه صوتی یافت نشد")
		return
	}
	out := make([]map[string]any, len(chapters))
	for i, c := range chapters {
		out[i] = map[string]any{
			"id": c.ID, "title": c.Title, "order": c.SortOrder,
			"startSeconds": c.StartSeconds, "endSeconds": c.EndSeconds,
		}
	}
	httpkit.JSON(w, http.StatusOK, map[string]any{"chapters": out})
}

// getTranscript serves a time window, defaulting to the first ten
// minutes. It is public on purpose: the synced transcript is the SEO
// asset no Iranian competitor has (03-product-surfaces.md), and hiding
// it behind auth would waste that.
func (h *Handler) getTranscript(w http.ResponseWriter, r *http.Request) {
	from := queryFloat(r, "from", 0)
	to := queryFloat(r, "to", 600)

	segments, err := h.svc.TranscriptWindow(r.Context(), chi.URLParam(r, "editionId"), from, to)
	if err != nil {
		httpkit.Error(w, http.StatusNotFound, "not_found", "ترنسکریپت یافت نشد")
		return
	}

	out := make([]map[string]any, len(segments))
	for i, seg := range segments {
		out[i] = map[string]any{"text": seg.Text, "startSeconds": seg.StartSeconds, "endSeconds": seg.EndSeconds}
	}
	httpkit.JSON(w, http.StatusOK, map[string]any{
		"segments": out, "fromSeconds": from, "toSeconds": to,
	})
}

func queryFloat(r *http.Request, key string, fallback float64) float64 {
	raw := r.URL.Query().Get(key)
	if raw == "" {
		return fallback
	}
	v, err := strconv.ParseFloat(raw, 64)
	if err != nil || v < 0 {
		return fallback
	}
	return v
}

func bookSummaries(books []Book) []map[string]any {
	out := make([]map[string]any, len(books))
	for i, b := range books {
		out[i] = map[string]any{
			"id": b.ID, "slug": b.Slug, "title": b.Title, "subtitle": b.Subtitle,
			"authorName": b.AuthorName, "authorSlug": b.AuthorSlug,
			"coverUrl": b.CoverURL, "language": b.Language,
			"isKidsFriendly": b.IsKidsFriendly,
			"ratingAverage":  b.RatingAverage, "ratingCount": b.RatingCount,
		}
	}
	return out
}

func bookDetail(b Book) map[string]any {
	return map[string]any{
		"id": b.ID, "slug": b.Slug, "title": b.Title, "subtitle": b.Subtitle,
		"description": b.Description,
		"authorName":  b.AuthorName, "authorSlug": b.AuthorSlug,
		"publisherName": b.PublisherName,
		"categoryName":  b.CategoryName, "categorySlug": b.CategorySlug,
		"coverUrl": b.CoverURL, "language": b.Language,
		"isKidsFriendly": b.IsKidsFriendly, "publishedAt": b.PublishedAt,
		"listenCount":   b.ListenCount,
		"ratingAverage": b.RatingAverage, "ratingCount": b.RatingCount,
	}
}
