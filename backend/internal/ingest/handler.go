package ingest

import (
	"errors"
	"io"
	"log/slog"
	"mime/multipart"
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

// Routes mounts the panel's API.
//
// requireAdmin is the gate from cmd/api: an admin key header, or a JWT
// carrying the admin role. Everything here writes files and creates
// catalogue entries, so none of it is ever public — except the cover,
// which is an image the site itself displays.
func (h *Handler) Routes(r chi.Router, requireAdmin func(http.Handler) http.Handler) {
	r.Get("/public/covers/{submissionId}", h.getCover)

	r.Group(func(r chi.Router) {
		r.Use(requireAdmin)

		r.Post("/admin/ingestions", h.create)
		r.Get("/admin/ingestions", h.list)
		r.Get("/admin/ingestions/{submissionId}", h.get)
		r.Post("/admin/ingestions/{submissionId}/dispatch", h.redispatch)
		r.Post("/admin/ingestions/{submissionId}/sync-audio", h.syncAudio)
	})
}

// maxRequestBytes bounds the whole multipart body — both files plus the
// fields. Without it a request can stream unbounded bytes into memory
// before any per-file limit is reached.
const maxRequestBytes = MaxPDFBytes + MaxCoverBytes + (1 << 20)

func (h *Handler) create(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBytes)

	// 32MB stays in memory, the rest spills to temp files. The parsed
	// parts are read into the domain type immediately after.
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		httpkit.ValidationError(w, map[string][]string{
			"body": {"فرم ارسالی نامعتبر یا بیش از حد بزرگ است"},
		})
		return
	}
	defer func() { _ = r.MultipartForm.RemoveAll() }()

	pdf, err := readUpload(r, "pdf", MaxPDFBytes)
	if err != nil {
		httpkit.ValidationError(w, map[string][]string{"pdf": {"فایل PDF کتاب الزامی است"}})
		return
	}

	var cover *Upload
	if c, err := readUpload(r, "cover", MaxCoverBytes); err == nil {
		cover = c
	}

	in := SubmitInput{
		Title:         r.FormValue("title"),
		Author:        r.FormValue("author"),
		Description:   r.FormValue("description"),
		PDF:           *pdf,
		Cover:         cover,
		WantTTS:       formBool(r, "tts"),
		WantAssistant: formBool(r, "assistant"),
		CreatedBy:     createdBy(r),
	}

	sub, err := h.svc.Submit(r.Context(), in)
	if err != nil {
		var invalid *ValidationError
		if errors.As(err, &invalid) {
			httpkit.ValidationError(w, invalid.Fields)
			return
		}
		h.log.ErrorContext(r.Context(), "ingest: submit failed", slog.String("error", err.Error()))
		httpkit.Error(w, http.StatusInternalServerError, "error", "ثبت کتاب انجام نشد")
		return
	}

	httpkit.JSON(w, http.StatusCreated, sub)
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	page := httpkit.PageFromRequest(r)

	subs, total, err := h.svc.List(r.Context(), int(page.Limit), int(page.Offset))
	if err != nil {
		h.log.ErrorContext(r.Context(), "ingest: list failed", slog.String("error", err.Error()))
		httpkit.Error(w, http.StatusInternalServerError, "error", "")
		return
	}
	if subs == nil {
		subs = []Submission{}
	}
	httpkit.Page200(w, subs, total, page)
}

func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	sub, err := h.svc.Get(r.Context(), chi.URLParam(r, "submissionId"))
	if errors.Is(err, ErrNotFound) {
		httpkit.Error(w, http.StatusNotFound, "not_found", "یافت نشد")
		return
	}
	if err != nil {
		h.log.ErrorContext(r.Context(), "ingest: get failed", slog.String("error", err.Error()))
		httpkit.Error(w, http.StatusInternalServerError, "error", "")
		return
	}
	httpkit.JSON(w, http.StatusOK, sub)
}

func (h *Handler) redispatch(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "submissionId")

	if err := h.svc.Redispatch(r.Context(), id); err != nil {
		if errors.Is(err, ErrNotFound) {
			httpkit.Error(w, http.StatusNotFound, "not_found", "یافت نشد")
			return
		}
		h.log.ErrorContext(r.Context(), "ingest: redispatch failed", slog.String("error", err.Error()))
		httpkit.Error(w, http.StatusInternalServerError, "error", "")
		return
	}

	sub, err := h.svc.Get(r.Context(), id)
	if err != nil {
		httpkit.Error(w, http.StatusInternalServerError, "error", "")
		return
	}
	httpkit.JSON(w, http.StatusAccepted, sub)
}

// syncAudio is the manual version of the periodic sweep, for when an
// operator does not want to wait for the next tick — or wants to see the
// reason it failed right now.
func (h *Handler) syncAudio(w http.ResponseWriter, r *http.Request) {
	sub, err := h.svc.SyncAudio(r.Context(), chi.URLParam(r, "submissionId"))
	switch {
	case err == nil:
		httpkit.JSON(w, http.StatusOK, sub)
	case errors.Is(err, ErrNotFound):
		httpkit.Error(w, http.StatusNotFound, "not_found", "یافت نشد")
	case errors.Is(err, ErrNoAudioYet):
		// Not a failure: the AI service simply has not produced audio
		// yet. 409 says "not in a state where this can happen" rather
		// than pretending something went wrong.
		httpkit.Error(w, http.StatusConflict, "no_audio_yet", "هنوز فایل صوتی‌ای از سرویس هوش مصنوعی نرسیده است")
	default:
		h.log.ErrorContext(r.Context(), "ingest: sync audio failed", slog.String("error", err.Error()))
		httpkit.Error(w, http.StatusInternalServerError, "error", "ساخت نسخه صوتی انجام نشد")
	}
}

func (h *Handler) getCover(w http.ResponseWriter, r *http.Request) {
	obj, err := h.svc.Cover(r.Context(), chi.URLParam(r, "submissionId"))
	if err != nil {
		httpkit.Error(w, http.StatusNotFound, "not_found", "")
		return
	}
	defer obj.Body.Close()

	contentType := obj.ContentType
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	w.Header().Set("Content-Type", contentType)
	if obj.ContentLength > 0 {
		w.Header().Set("Content-Length", strconv.FormatInt(obj.ContentLength, 10))
	}
	// A cover never changes for a given submission id — a new upload is
	// a new id — so it can be cached hard.
	w.Header().Set("Cache-Control", "public, max-age=86400, immutable")

	if _, err := io.Copy(w, obj.Body); err != nil {
		h.log.WarnContext(r.Context(), "ingest: cover stream interrupted", slog.String("error", err.Error()))
	}
}

func readUpload(r *http.Request, field string, max int64) (*Upload, error) {
	file, header, err := r.FormFile(field)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	data, err := io.ReadAll(io.LimitReader(file, max+1))
	if err != nil {
		return nil, err
	}

	return &Upload{
		FileName:    header.Filename,
		ContentType: contentTypeOf(header),
		Data:        data,
	}, nil
}

func contentTypeOf(h *multipart.FileHeader) string {
	if h == nil {
		return ""
	}
	return h.Header.Get("Content-Type")
}

// formBool accepts what an HTML checkbox and a JSON-minded client each
// send: "on", "true", "1".
func formBool(r *http.Request, field string) bool {
	switch r.FormValue(field) {
	case "on", "true", "1", "yes":
		return true
	default:
		return false
	}
}

// createdBy records who uploaded. A JWT gives a real user id; the shared
// admin key cannot identify a person, and saying "admin-key" is honest
// about that rather than inventing an author.
func createdBy(r *http.Request) string {
	if userID, ok := httpkit.UserIDFromContext(r.Context()); ok && userID != "" {
		return userID
	}
	return "admin-key"
}
