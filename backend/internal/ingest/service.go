package ingest

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"path"
	"strings"
	"unicode"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"ketapod/internal/catalog"
	"ketapod/internal/ingest/sqlcgen"
	"ketapod/internal/platform/apiversion"
	"ketapod/internal/platform/outbox"
	"ketapod/internal/platform/storage"
)

// ObjectStore is the slice of platform/storage this module uses. Both
// files go to the same bucket the AI service reads, under the key layout
// its own uploads already use (books/{bookId}/original/...), so nothing
// on that side has to learn a second convention.
type ObjectStore interface {
	PutObject(ctx context.Context, key string, body io.Reader, contentType string) error
	GetObject(ctx context.Context, key string, rangeHeader string) (*storage.Object, error)
}

type Service struct {
	repo    Repository
	store   ObjectStore
	ai      *AIClient
	audio   AudioConfig
	baseURL string
}

func NewService(repo Repository, store ObjectStore, ai *AIClient, audio AudioConfig, publicBaseURL string) *Service {
	return &Service{repo: repo, store: store, ai: ai, audio: audio.withDefaults(), baseURL: publicBaseURL}
}

// ValidationError carries per-field messages in the shape the panel
// renders and the rest of the API already uses.
type ValidationError struct {
	Fields map[string][]string
}

func (e *ValidationError) Error() string { return "ingest: validation failed" }

// Submit is the whole panel action.
//
// Order matters. The two files go to object storage *before* the
// transaction, because an object written for a transaction that then
// rolls back is a few megabytes of garbage in a bucket, while a
// committed row pointing at an object that was never written is a book
// the AI service will fail on and nobody can explain. Cheap garbage
// beats an inconsistent handoff.
func (s *Service) Submit(ctx context.Context, in SubmitInput) (Submission, error) {
	if err := validate(in); err != nil {
		return Submission{}, err
	}

	aiBookID := uuid.New()
	documentID := uuid.New()

	pdfKey := fmt.Sprintf("books/%s/original/%s", aiBookID, safeFileName(in.PDF.FileName, "book.pdf"))
	if err := s.store.PutObject(ctx, pdfKey, bytes.NewReader(in.PDF.Data), contentTypeOr(in.PDF.ContentType, "application/pdf")); err != nil {
		return Submission{}, fmt.Errorf("ingest: upload pdf: %w", err)
	}

	coverKey := ""
	if in.Cover != nil {
		coverKey = fmt.Sprintf("books/%s/cover/%s", aiBookID, safeFileName(in.Cover.FileName, "cover.jpg"))
		if err := s.store.PutObject(ctx, coverKey, bytes.NewReader(in.Cover.Data), contentTypeOr(in.Cover.ContentType, "image/jpeg")); err != nil {
			return Submission{}, fmt.Errorf("ingest: upload cover: %w", err)
		}
	}

	var submissionID string

	err := s.repo.InTx(ctx, func(tx Repository) error {
		if err := tx.CreateAIBook(ctx, aiBookID, in.Title, in.Author, in.Description, "fa", coverKey); err != nil {
			return fmt.Errorf("ingest: create AI book: %w", err)
		}

		if err := tx.CreateAIDocument(ctx, documentID, aiBookID,
			in.PDF.FileName, pdfKey, contentTypeOr(in.PDF.ContentType, "application/pdf"),
			in.PDF.Size(), "pdf"); err != nil {
			return fmt.Errorf("ingest: create AI document: %w", err)
		}

		// The book joins the site's catalogue here, whichever way the
		// two checkboxes are set — that is what the panel promises. It
		// has no audio edition yet, so it lists and opens but cannot be
		// played until TTS produces one.
		catalogBookID, _, err := tx.CreateCatalogBook(ctx, catalog.NewBook{
			Title:       in.Title,
			AuthorName:  in.Author,
			Description: in.Description,
			Language:    "fa",
			Status:      "published",
		})
		if err != nil {
			return err
		}

		id, err := tx.CreateSubmission(ctx, sqlcgen.CreateSubmissionParams{
			AiBookID:        aiBookID,
			AiDocumentID:    documentID,
			CatalogBookID:   uuidParam(catalogBookID),
			Title:           in.Title,
			Author:          optional(in.Author),
			Description:     optional(in.Description),
			PdfFileName:     in.PDF.FileName,
			PdfStorageKey:   pdfKey,
			PdfSizeBytes:    in.PDF.Size(),
			CoverStorageKey: optional(coverKey),
			WantTts:         in.WantTTS,
			WantAssistant:   in.WantAssistant,
			CreatedBy:       optional(in.CreatedBy),
		})
		if err != nil {
			return fmt.Errorf("ingest: create submission: %w", err)
		}
		submissionID = id

		// The cover URL is only knowable now: it is served through this
		// API by submission id, so that the bucket can stay private.
		if coverKey != "" {
			if err := tx.SetCatalogCover(ctx, catalogBookID, s.CoverURL(id)); err != nil {
				return fmt.Errorf("ingest: set catalog cover: %w", err)
			}
		}

		// A book with the TTS box ticked is waiting for narration from
		// the moment it is accepted; the sweep picks it up as soon as
		// the AI service writes its first file. Without the box, there
		// is nothing to wait for and the status stays "none".
		if in.WantTTS {
			if err := tx.MarkAudioPending(ctx, id); err != nil {
				return err
			}
		}

		return tx.EnqueueTask(ctx, outbox.Task{
			Type:      TaskTypeDispatch,
			Payload:   DispatchPayload{SubmissionID: id},
			Queue:     outbox.QueueDefault,
			MaxRetry:  5,
			DedupeKey: id,
		})
	})
	if err != nil {
		return Submission{}, err
	}

	return s.Get(ctx, submissionID)
}

// Dispatch tells the AI service about one submission. It is called by
// the worker, and again by the panel's retry button.
func (s *Service) Dispatch(ctx context.Context, submissionID string) error {
	sub, err := s.repo.Get(ctx, submissionID)
	if err != nil {
		return err
	}

	if !s.ai.Configured() {
		_ = s.repo.MarkDispatchFailed(ctx, submissionID, ErrAINotConfigured.Error())
		return ErrAINotConfigured
	}

	err = s.ai.StartProcessing(ctx, ProcessRequest{
		BookID:          sub.AIBookID,
		DocumentID:      sub.AIDocumentID,
		StorageKey:      sub.pdfKey,
		FileName:        sub.PDFFileName,
		MimeType:        "application/pdf",
		Title:           sub.Title,
		Author:          sub.Author,
		Language:        "fa",
		EnableTTS:       sub.WantTTS,
		EnableAssistant: sub.WantAssistant,
	})
	if err != nil {
		_ = s.repo.MarkDispatchFailed(ctx, submissionID, err.Error())
		return err
	}

	return s.repo.MarkDispatched(ctx, submissionID)
}

// Redispatch puts a failed submission back in the queue. The outbox row
// carries the same dedupe key as the first attempt, but that key only
// collapses jobs that are still pending — a dispatched or failed one is
// re-queued, which is exactly what the retry button must do.
func (s *Service) Redispatch(ctx context.Context, submissionID string) error {
	if _, err := s.repo.Get(ctx, submissionID); err != nil {
		return err
	}
	if err := s.repo.MarkDispatchPending(ctx, submissionID); err != nil {
		return err
	}
	return s.repo.EnqueueTask(ctx, outbox.Task{
		Type:      TaskTypeDispatch,
		Payload:   DispatchPayload{SubmissionID: submissionID},
		Queue:     outbox.QueueDefault,
		MaxRetry:  5,
		DedupeKey: submissionID,
	})
}

func (s *Service) Get(ctx context.Context, id string) (Submission, error) {
	sub, err := s.repo.Get(ctx, id)
	if err != nil {
		return Submission{}, err
	}
	sub.CoverURL = s.coverURLIfAny(sub)

	if sub.Job != nil {
		steps, err := s.repo.JobSteps(ctx, sub.Job.ID)
		if err != nil {
			return Submission{}, err
		}
		sub.Job.Steps = steps
	}
	return sub, nil
}

func (s *Service) List(ctx context.Context, limit, offset int) ([]Submission, int64, error) {
	subs, total, err := s.repo.List(ctx, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	for i := range subs {
		subs[i].CoverURL = s.coverURLIfAny(subs[i])
	}
	return subs, total, nil
}

// Cover streams a submission's cover image. Covers are public by design
// — they are shown on the site — so this needs no token, unlike audio.
func (s *Service) Cover(ctx context.Context, submissionID string) (*storage.Object, error) {
	key, err := s.repo.CoverKey(ctx, submissionID)
	if err != nil {
		return nil, err
	}
	return s.store.GetObject(ctx, key, "")
}

func (s *Service) CoverURL(submissionID string) string {
	return apiversion.V1.URL(s.baseURL, "public/covers/"+submissionID)
}

// coverURLIfAny turns a stored object key into the public URL that
// serves it. A submission uploaded without a cover simply has none — the
// site falls back to its own generated cover art.
func (s *Service) coverURLIfAny(sub Submission) string {
	if sub.coverKey == "" {
		return ""
	}
	return s.CoverURL(sub.ID)
}

func validate(in SubmitInput) error {
	errs := map[string][]string{}

	if len(strings.TrimSpace(in.Title)) < 2 {
		errs["title"] = append(errs["title"], "عنوان کتاب الزامی است")
	}
	if len(in.PDF.Data) == 0 {
		errs["pdf"] = append(errs["pdf"], "فایل PDF کتاب الزامی است")
	} else if int64(len(in.PDF.Data)) > MaxPDFBytes {
		errs["pdf"] = append(errs["pdf"], "حجم فایل بیش از حد مجاز است")
	} else if !looksLikePDF(in.PDF.Data) {
		// The extension and the browser-declared type are both caller
		// controlled; the magic number is the only claim the file makes
		// about itself. Sending a non-PDF to the OCR pipeline just
		// fails there, hours later and out of context.
		errs["pdf"] = append(errs["pdf"], "فایل ارسالی PDF معتبر نیست")
	}

	if in.Cover != nil {
		if int64(len(in.Cover.Data)) > MaxCoverBytes {
			errs["cover"] = append(errs["cover"], "حجم تصویر کاور بیش از حد مجاز است")
		}
		if !strings.HasPrefix(in.Cover.ContentType, "image/") {
			errs["cover"] = append(errs["cover"], "کاور باید یک تصویر باشد")
		}
	}

	if len(errs) > 0 {
		return &ValidationError{Fields: errs}
	}
	return nil
}

func looksLikePDF(data []byte) bool {
	return len(data) >= 5 && bytes.HasPrefix(data, []byte("%PDF-"))
}

// safeFileName keeps the original name recognisable in the bucket while
// making sure it cannot escape its prefix or carry characters that break
// an S3 key.
func safeFileName(name, fallback string) string {
	name = path.Base(strings.ReplaceAll(name, "\\", "/"))

	var b strings.Builder
	for _, r := range name {
		switch {
		case unicode.IsLetter(r), unicode.IsDigit(r), r == '.', r == '-', r == '_':
			b.WriteRune(r)
		case unicode.IsSpace(r):
			b.WriteRune('-')
		}
	}

	cleaned := strings.Trim(b.String(), ".-")
	if cleaned == "" || cleaned == "." || cleaned == ".." {
		return fallback
	}
	if len(cleaned) > 120 {
		cleaned = cleaned[len(cleaned)-120:]
	}
	return cleaned
}

func contentTypeOr(ct, fallback string) string {
	if strings.TrimSpace(ct) == "" {
		return fallback
	}
	return ct
}

func uuidParam(id string) pgtype.UUID {
	parsed, err := uuid.Parse(id)
	if err != nil {
		return pgtype.UUID{}
	}
	return pgtype.UUID{Bytes: parsed, Valid: true}
}
