package ingest

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"ketapod/internal/catalog"
	"ketapod/internal/ingest/sqlcgen"
	"ketapod/internal/media"
	"ketapod/internal/platform/outbox"
)

var ErrNotFound = errors.New("ingest: submission not found")

type Repository interface {
	// InTx runs fn against a repository bound to one transaction. The
	// upload only counts as accepted if the AI service's work item, the
	// catalogue row and the dispatch job all commit together.
	InTx(ctx context.Context, fn func(Repository) error) error

	CreateAIBook(ctx context.Context, id uuid.UUID, title, author, description, language, cover string) error
	CreateAIDocument(ctx context.Context, id, bookID uuid.UUID, fileName, storageKey, mimeType string, size int64, docType string) error
	CreateCatalogBook(ctx context.Context, in catalog.NewBook) (bookID, slug string, err error)
	SetCatalogCover(ctx context.Context, bookID, coverURL string) error
	CreateSubmission(ctx context.Context, arg sqlcgen.CreateSubmissionParams) (string, error)

	EnqueueTask(ctx context.Context, task outbox.Task) error

	Get(ctx context.Context, id string) (Submission, error)
	List(ctx context.Context, limit, offset int) ([]Submission, int64, error)
	JobSteps(ctx context.Context, jobID string) ([]JobStep, error)
	CoverKey(ctx context.Context, id string) (string, error)

	// The audio side. UpsertNarratedEdition and UpsertEditionAsset go
	// through catalog's and media's own write seams — this module owns
	// ingest.* and nothing else.
	AIAudioParts(ctx context.Context, aiBookID string) ([]aiAudioPart, error)
	AIBookDescription(ctx context.Context, aiBookID string) (string, error)
	AudioSyncCandidates(ctx context.Context, limit int) ([]string, error)
	UpsertNarratedEdition(ctx context.Context, in catalog.NarratedEdition) (string, error)
	UpsertEditionAsset(ctx context.Context, editionID, storageKey, format string, durationSeconds int) (string, error)
	SetBookDescriptionIfEmpty(ctx context.Context, bookID, description string) error
	MarkAudioSynced(ctx context.Context, id, editionID, signature string) error
	MarkAudioFailed(ctx context.Context, id, reason string) error
	MarkAudioPending(ctx context.Context, id string) error

	MarkDispatched(ctx context.Context, id string) error
	MarkDispatchFailed(ctx context.Context, id, reason string) error
	MarkDispatchPending(ctx context.Context, id string) error
}

type pgRepo struct {
	pool *pgxpool.Pool
	db   sqlcgen.DBTX
	q    *sqlcgen.Queries
}

func NewRepository(pool *pgxpool.Pool) Repository {
	return &pgRepo{pool: pool, db: pool, q: sqlcgen.New(pool)}
}

func (r *pgRepo) InTx(ctx context.Context, fn func(Repository) error) error {
	if r.pool == nil {
		return fn(r)
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("ingest: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if err := fn(&pgRepo{pool: nil, db: tx, q: r.q.WithTx(tx)}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (r *pgRepo) CreateAIBook(ctx context.Context, id uuid.UUID, title, author, description, language, cover string) error {
	return r.q.CreateAIBook(ctx, sqlcgen.CreateAIBookParams{
		ID:          id,
		Title:       title,
		Author:      optional(author),
		Description: optional(description),
		Language:    language,
		Cover:       optional(cover),
	})
}

func (r *pgRepo) CreateAIDocument(ctx context.Context, id, bookID uuid.UUID, fileName, storageKey, mimeType string, size int64, docType string) error {
	return r.q.CreateAIDocument(ctx, sqlcgen.CreateAIDocumentParams{
		ID:         id,
		BookID:     bookID,
		FileName:   fileName,
		StorageKey: storageKey,
		MimeType:   mimeType,
		// public.book_documents.size is a 32-bit integer on the AI
		// side. MaxPDFBytes is far below that ceiling, so the
		// conversion cannot silently wrap.
		Size:         int32(size),
		DocumentType: docType,
	})
}

func (r *pgRepo) CreateCatalogBook(ctx context.Context, in catalog.NewBook) (string, string, error) {
	return catalog.CreateBookInTx(ctx, r.db, in)
}

func (r *pgRepo) SetCatalogCover(ctx context.Context, bookID, coverURL string) error {
	return catalog.SetBookCoverURL(ctx, r.db, bookID, coverURL)
}

func (r *pgRepo) CreateSubmission(ctx context.Context, arg sqlcgen.CreateSubmissionParams) (string, error) {
	row, err := r.q.CreateSubmission(ctx, arg)
	if err != nil {
		return "", err
	}
	return row.ID.String(), nil
}

func (r *pgRepo) EnqueueTask(ctx context.Context, task outbox.Task) error {
	// sqlcgen.DBTX and outbox.DBTX describe the same three methods, so
	// this is a conversion the compiler checks — not a runtime assertion
	// that could panic on a handle that does not satisfy it.
	return outbox.Write(ctx, outbox.DBTX(r.db), task)
}

// submissionColumns is written once and used by both readers so a column
// added to the panel cannot show up in the list and be missing from the
// detail view.
const submissionColumns = `
    s.id, s.ai_book_id, s.ai_document_id, s.catalog_book_id, s.title, s.author, s.description,
    s.pdf_file_name, s.pdf_storage_key, s.pdf_size_bytes, s.cover_storage_key,
    s.want_tts, s.want_assistant, s.dispatch_status, s.dispatch_error,
    s.dispatched_at, s.created_by, s.created_at,
    s.catalog_edition_id, s.audio_status, s.audio_error, s.audio_signature, s.audio_synced_at,
    (SELECT j.id            FROM public.jobs j WHERE j.book_id = s.ai_book_id ORDER BY j.created_at DESC LIMIT 1),
    (SELECT j.status::text  FROM public.jobs j WHERE j.book_id = s.ai_book_id ORDER BY j.created_at DESC LIMIT 1),
    (SELECT j.current_step  FROM public.jobs j WHERE j.book_id = s.ai_book_id ORDER BY j.created_at DESC LIMIT 1),
    (SELECT j.progress      FROM public.jobs j WHERE j.book_id = s.ai_book_id ORDER BY j.created_at DESC LIMIT 1),
    (SELECT j.error_message FROM public.jobs j WHERE j.book_id = s.ai_book_id ORDER BY j.created_at DESC LIMIT 1),
    (SELECT b.status::text  FROM public.books b WHERE b.id = s.ai_book_id),
    (SELECT cb.slug         FROM catalog.books cb WHERE cb.id = s.catalog_book_id)`

// scanSubmission reads one row of submissionColumns.
//
// Everything that comes from the AI service's tables is scanned into a
// pointer: a submission that has not reached the AI service yet has no
// job, and a book row the service deleted has no status. This is the
// reason these two queries are hand-written instead of generated — see
// queries/ingest.sql.
func scanSubmission(row pgx.Row) (Submission, error) {
	var (
		s                Submission
		id               uuid.UUID
		aiBookID         uuid.UUID
		aiDocumentID     uuid.UUID
		catalogBookID    pgtype.UUID
		author           *string
		description      *string
		coverKey         *string
		dispatchError    *string
		dispatchedAt     pgtype.Timestamptz
		createdBy        *string
		catalogEditionID pgtype.UUID
		audioError       *string
		audioSignature   *string
		audioSyncedAt    pgtype.Timestamptz
		jobID            *uuid.UUID
		jobStatus        *string
		jobCurrentStep   *string
		jobProgress      *int32
		jobError         *string
		aiBookStatus     *string
		catalogSlug      *string
	)

	if err := row.Scan(
		&id, &aiBookID, &aiDocumentID, &catalogBookID, &s.Title, &author, &description,
		&s.PDFFileName, &s.pdfKey, &s.PDFSizeBytes, &coverKey,
		&s.WantTTS, &s.WantAssistant, &s.DispatchStatus, &dispatchError,
		&dispatchedAt, &createdBy, &s.CreatedAt,
		&catalogEditionID, &s.AudioStatus, &audioError, &audioSignature, &audioSyncedAt,
		&jobID, &jobStatus, &jobCurrentStep, &jobProgress, &jobError,
		&aiBookStatus, &catalogSlug,
	); err != nil {
		return Submission{}, err
	}

	s.ID = id.String()
	s.AIBookID = aiBookID.String()
	s.AIDocumentID = aiDocumentID.String()
	s.coverKey = deref(coverKey)
	s.audioSignature = deref(audioSignature)
	s.AudioError = deref(audioError)
	if catalogEditionID.Valid {
		s.CatalogEditionID = uuid.UUID(catalogEditionID.Bytes).String()
	}
	if audioSyncedAt.Valid {
		t := audioSyncedAt.Time
		s.AudioSyncedAt = &t
	}
	if catalogBookID.Valid {
		s.CatalogBookID = uuid.UUID(catalogBookID.Bytes).String()
	}
	s.Author = deref(author)
	s.Description = deref(description)
	s.DispatchError = deref(dispatchError)
	s.CreatedBy = deref(createdBy)
	s.AIBookStatus = deref(aiBookStatus)
	s.CatalogSlug = deref(catalogSlug)
	if dispatchedAt.Valid {
		t := dispatchedAt.Time
		s.DispatchedAt = &t
	}
	if jobID != nil {
		s.Job = &Job{
			ID:          jobID.String(),
			Status:      deref(jobStatus),
			CurrentStep: deref(jobCurrentStep),
			Error:       deref(jobError),
		}
		if jobProgress != nil {
			s.Job.Progress = int(*jobProgress)
		}
	}
	return s, nil
}

func (r *pgRepo) Get(ctx context.Context, id string) (Submission, error) {
	parsed, err := uuid.Parse(id)
	if err != nil {
		return Submission{}, ErrNotFound
	}

	row := r.db.QueryRow(ctx,
		`SELECT`+submissionColumns+` FROM ingest.submissions s WHERE s.id = $1`, parsed)

	s, err := scanSubmission(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return Submission{}, ErrNotFound
	}
	return s, err
}

func (r *pgRepo) List(ctx context.Context, limit, offset int) ([]Submission, int64, error) {
	rows, err := r.db.Query(ctx,
		`SELECT`+submissionColumns+`, count(*) OVER ()
		 FROM ingest.submissions s
		 ORDER BY s.created_at DESC
		 LIMIT $1 OFFSET $2`, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var (
		out   []Submission
		total int64
	)
	for rows.Next() {
		// The window count rides along on every row, so it is scanned
		// with the row rather than costing a second query.
		var rowTotal int64
		s, err := scanSubmissionWithTotal(rows, &rowTotal)
		if err != nil {
			return nil, 0, err
		}
		total = rowTotal
		out = append(out, s)
	}
	return out, total, rows.Err()
}

// scanSubmissionWithTotal exists because pgx.Rows and pgx.Row have
// different Scan signatures in the type system but the same semantics;
// this adapts the row to the shared scanner and picks up the extra
// column.
func scanSubmissionWithTotal(rows pgx.Rows, total *int64) (Submission, error) {
	return scanSubmission(rowWithExtra{rows: rows, extra: total})
}

type rowWithExtra struct {
	rows  pgx.Rows
	extra *int64
}

func (r rowWithExtra) Scan(dest ...any) error {
	return r.rows.Scan(append(dest, r.extra)...)
}

func (r *pgRepo) JobSteps(ctx context.Context, jobID string) ([]JobStep, error) {
	parsed, err := uuid.Parse(jobID)
	if err != nil {
		return nil, nil
	}

	rows, err := r.q.ListJobSteps(ctx, parsed)
	if err != nil {
		return nil, err
	}

	out := make([]JobStep, len(rows))
	for i, row := range rows {
		out[i] = JobStep{
			Step:     row.Step,
			Status:   row.Status,
			Progress: int(row.Progress),
			Attempt:  int(row.Attempt),
			Error:    deref(row.ErrorMessage),
		}
		if row.StartedAt.Valid {
			t := row.StartedAt.Time
			out[i].StartedAt = &t
		}
		if row.CompletedAt.Valid {
			t := row.CompletedAt.Time
			out[i].CompletedAt = &t
		}
	}
	return out, nil
}

func (r *pgRepo) CoverKey(ctx context.Context, id string) (string, error) {
	parsed, err := uuid.Parse(id)
	if err != nil {
		return "", ErrNotFound
	}
	key, err := r.q.GetCoverKey(ctx, parsed)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	if key == nil || *key == "" {
		return "", ErrNotFound
	}
	return *key, nil
}

func (r *pgRepo) AIAudioParts(ctx context.Context, aiBookID string) ([]aiAudioPart, error) {
	parsed, err := uuid.Parse(aiBookID)
	if err != nil {
		return nil, ErrNotFound
	}

	rows, err := r.q.ListAIAudioAssets(ctx, parsed)
	if err != nil {
		return nil, err
	}

	out := make([]aiAudioPart, len(rows))
	for i, row := range rows {
		out[i] = aiAudioPart{
			StorageKey:   row.StorageKey,
			Format:       row.Format,
			Status:       row.Status,
			ChapterTitle: deref(row.ChapterTitle),
		}
		if row.Duration != nil {
			out[i].Duration = *row.Duration
		}
	}
	return out, nil
}

func (r *pgRepo) AIBookDescription(ctx context.Context, aiBookID string) (string, error) {
	parsed, err := uuid.Parse(aiBookID)
	if err != nil {
		return "", ErrNotFound
	}
	row, err := r.q.GetAIBook(ctx, parsed)
	if err != nil {
		return "", err
	}
	return deref(row.Description), nil
}

func (r *pgRepo) AudioSyncCandidates(ctx context.Context, limit int) ([]string, error) {
	if limit <= 0 {
		limit = 20
	}
	ids, err := r.q.ListAudioSyncCandidates(ctx, int32(limit))
	if err != nil {
		return nil, err
	}
	out := make([]string, len(ids))
	for i, id := range ids {
		out[i] = id.String()
	}
	return out, nil
}

func (r *pgRepo) UpsertNarratedEdition(ctx context.Context, in catalog.NarratedEdition) (string, error) {
	return catalog.UpsertNarratedEditionInTx(ctx, r.db, in)
}

func (r *pgRepo) UpsertEditionAsset(ctx context.Context, editionID, storageKey, format string, durationSeconds int) (string, error) {
	return media.UpsertEditionAsset(ctx, r.db, editionID, storageKey, format, durationSeconds)
}

func (r *pgRepo) SetBookDescriptionIfEmpty(ctx context.Context, bookID, description string) error {
	return catalog.SetBookDescriptionIfEmptyInTx(ctx, r.db, bookID, description)
}

func (r *pgRepo) MarkAudioSynced(ctx context.Context, id, editionID, signature string) error {
	parsed, err := uuid.Parse(id)
	if err != nil {
		return ErrNotFound
	}
	edition, err := uuid.Parse(editionID)
	if err != nil {
		return fmt.Errorf("ingest: parse edition id: %w", err)
	}
	return r.q.MarkAudioSynced(ctx, sqlcgen.MarkAudioSyncedParams{
		ID:               parsed,
		CatalogEditionID: pgtype.UUID{Bytes: edition, Valid: true},
		AudioSignature:   &signature,
	})
}

func (r *pgRepo) MarkAudioFailed(ctx context.Context, id, reason string) error {
	parsed, err := uuid.Parse(id)
	if err != nil {
		return ErrNotFound
	}
	if len(reason) > 500 {
		reason = reason[:500]
	}
	return r.q.MarkAudioFailed(ctx, sqlcgen.MarkAudioFailedParams{ID: parsed, AudioError: &reason})
}

func (r *pgRepo) MarkAudioPending(ctx context.Context, id string) error {
	parsed, err := uuid.Parse(id)
	if err != nil {
		return ErrNotFound
	}
	return r.q.MarkAudioPending(ctx, parsed)
}

func (r *pgRepo) MarkDispatched(ctx context.Context, id string) error {
	parsed, err := uuid.Parse(id)
	if err != nil {
		return ErrNotFound
	}
	return r.q.MarkDispatched(ctx, parsed)
}

func (r *pgRepo) MarkDispatchFailed(ctx context.Context, id, reason string) error {
	parsed, err := uuid.Parse(id)
	if err != nil {
		return ErrNotFound
	}
	// The panel shows this string. Truncating here rather than at render
	// time keeps a provider that returns an HTML error page from filling
	// the column with a kilobyte of markup.
	if len(reason) > 500 {
		reason = reason[:500]
	}
	return r.q.MarkDispatchFailed(ctx, sqlcgen.MarkDispatchFailedParams{ID: parsed, DispatchError: &reason})
}

func (r *pgRepo) MarkDispatchPending(ctx context.Context, id string) error {
	parsed, err := uuid.Parse(id)
	if err != nil {
		return ErrNotFound
	}
	return r.q.MarkDispatchPending(ctx, parsed)
}

func optional(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
