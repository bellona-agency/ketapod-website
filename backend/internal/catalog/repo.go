package catalog

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"ketapod/internal/catalog/sqlcgen"
)

type pgRepo struct {
	q *sqlcgen.Queries
}

func NewRepository(pool *pgxpool.Pool) Repository {
	return &pgRepo{q: sqlcgen.New(pool)}
}

func (r *pgRepo) GetBookByID(ctx context.Context, id string) (Book, error) {
	parsedID, err := uuid.Parse(id)
	if err != nil {
		return Book{}, ErrNotFound
	}

	row, err := r.q.GetBookByID(ctx, parsedID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Book{}, ErrNotFound
		}
		return Book{}, err
	}
	return r.hydrateBook(ctx, row), nil
}

func (r *pgRepo) GetBookBySlug(ctx context.Context, slug string) (Book, error) {
	row, err := r.q.GetBookBySlug(ctx, slug)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Book{}, ErrNotFound
		}
		return Book{}, err
	}
	return r.hydrateBook(ctx, row), nil
}

// hydrateBook fills author name on the single-book path. ListBooks joins
// instead — the extra query here is bounded (one book) and keeps the
// two by-id/by-slug queries plain `SELECT *`, which is what the rest of
// the module and the tests expect.
func (r *pgRepo) hydrateBook(ctx context.Context, row sqlcgen.CatalogBook) Book {
	book := Book{
		ID:             row.ID.String(),
		Slug:           row.Slug,
		Title:          row.Title,
		Subtitle:       stringOrEmpty(row.Subtitle),
		Description:    stringOrEmpty(row.Description),
		CoverURL:       stringOrEmpty(row.CoverUrl),
		Language:       row.Language,
		IsKidsFriendly: row.IsKidsFriendly,
		PublishedAt:    fromPgTimestamptz(row.PublishedAt),
		ListenCount:    row.ListenCount,
		RatingAverage:  numericToFloat(row.RatingAverage),
		RatingCount:    int(row.RatingCount),
	}
	if row.AuthorID.Valid {
		if author, err := r.q.GetAuthorByID(ctx, uuid.UUID(row.AuthorID.Bytes)); err == nil {
			book.AuthorName = author.Name
			book.AuthorSlug = author.Slug
		}
	}
	return book
}

func (r *pgRepo) ListBooks(ctx context.Context, filter BookFilter) ([]Book, int64, error) {
	sort := filter.Sort
	if sort == "" {
		sort = "newest"
	}

	rows, err := r.q.ListBooks(ctx, sqlcgen.ListBooksParams{
		CategorySlug: filter.CategorySlug,
		AuthorSlug:   filter.AuthorSlug,
		Language:     filter.Language,
		KidsOnly:     filter.KidsOnly,
		Sort:         sort,
		PageLimit:    filter.Limit,
		PageOffset:   filter.Offset,
	})
	if err != nil {
		return nil, 0, err
	}

	books := make([]Book, len(rows))
	var total int64
	for i, row := range rows {
		total = row.TotalCount
		books[i] = Book{
			ID:             row.ID.String(),
			Slug:           row.Slug,
			Title:          row.Title,
			Subtitle:       stringOrEmpty(row.Subtitle),
			Description:    stringOrEmpty(row.Description),
			AuthorName:     stringOrEmpty(row.AuthorName),
			AuthorSlug:     stringOrEmpty(row.AuthorSlug),
			PublisherName:  stringOrEmpty(row.PublisherName),
			CategoryName:   stringOrEmpty(row.CategoryName),
			CategorySlug:   stringOrEmpty(row.CategorySlug),
			CoverURL:       stringOrEmpty(row.CoverUrl),
			Language:       row.Language,
			IsKidsFriendly: row.IsKidsFriendly,
			PublishedAt:    fromPgTimestamptz(row.PublishedAt),
			ListenCount:    row.ListenCount,
			RatingAverage:  numericToFloat(row.RatingAverage),
			RatingCount:    int(row.RatingCount),
		}
	}
	return books, total, nil
}

func (r *pgRepo) SearchBooks(ctx context.Context, query string, kidsOnly *bool, limit, offset int32) ([]Book, int64, error) {
	rows, err := r.q.SearchBooks(ctx, sqlcgen.SearchBooksParams{
		Query:      query,
		KidsOnly:   kidsOnly,
		PageLimit:  limit,
		PageOffset: offset,
	})
	if err != nil {
		return nil, 0, err
	}

	books := make([]Book, len(rows))
	var total int64
	for i, row := range rows {
		total = row.TotalCount
		books[i] = Book{
			ID:             row.ID.String(),
			Slug:           row.Slug,
			Title:          row.Title,
			Subtitle:       stringOrEmpty(row.Subtitle),
			AuthorName:     stringOrEmpty(row.AuthorName),
			AuthorSlug:     stringOrEmpty(row.AuthorSlug),
			CoverURL:       stringOrEmpty(row.CoverUrl),
			Language:       row.Language,
			IsKidsFriendly: row.IsKidsFriendly,
			ListenCount:    row.ListenCount,
			RatingAverage:  numericToFloat(row.RatingAverage),
		}
	}
	return books, total, nil
}

func (r *pgRepo) ListVoices(ctx context.Context) ([]Voice, error) {
	rows, err := r.q.ListVoices(ctx)
	if err != nil {
		return nil, err
	}

	voices := make([]Voice, len(rows))
	for i, row := range rows {
		voices[i] = Voice{
			ID:        row.ID,
			Name:      row.Name,
			Style:     row.Style,
			IsDefault: row.IsDefault,
			IsKids:    row.IsKids,
		}
	}
	return voices, nil
}

func (r *pgRepo) ListEditionsForBook(ctx context.Context, bookID string) ([]Edition, error) {
	parsedID, err := uuid.Parse(bookID)
	if err != nil {
		return nil, ErrNotFound
	}

	rows, err := r.q.ListEditionsForBook(ctx, parsedID)
	if err != nil {
		return nil, err
	}

	editions := make([]Edition, len(rows))
	for i, row := range rows {
		editions[i] = Edition{
			AudioEditionID:  row.AudioEditionID.String(),
			BookID:          row.BookID.String(),
			VoiceID:         row.VoiceID,
			VoiceName:       row.VoiceName,
			VoiceStyle:      row.VoiceStyle,
			NarratorType:    row.NarratorType,
			Dialect:         stringOrEmpty(row.Dialect),
			Language:        row.Language,
			IsKidsFriendly:  row.IsKidsFriendly,
			PriceIRR:        row.PriceIrr,
			PreviewSeconds:  int(row.PreviewSeconds),
			DurationSeconds: int(row.DurationSeconds),
			Status:          "published",
		}
	}
	return editions, nil
}

func (r *pgRepo) GetEditionByID(ctx context.Context, editionID string) (Edition, error) {
	parsedID, err := uuid.Parse(editionID)
	if err != nil {
		return Edition{}, ErrNotFound
	}
	row, err := r.q.GetEditionByID(ctx, parsedID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Edition{}, ErrNotFound
		}
		return Edition{}, err
	}
	return Edition{
		AudioEditionID:  row.AudioEditionID.String(),
		BookID:          row.BookID.String(),
		VoiceID:         row.VoiceID,
		VoiceName:       row.VoiceName,
		VoiceStyle:      row.VoiceStyle,
		NarratorType:    row.NarratorType,
		Dialect:         stringOrEmpty(row.Dialect),
		Language:        row.Language,
		IsKidsFriendly:  row.IsKidsFriendly,
		PriceIRR:        row.PriceIrr,
		PreviewSeconds:  int(row.PreviewSeconds),
		DurationSeconds: int(row.DurationSeconds),
		Status:          row.Status,
	}, nil
}

func (r *pgRepo) SetEditionDuration(ctx context.Context, editionID string, seconds int) error {
	parsedID, err := uuid.Parse(editionID)
	if err != nil {
		return ErrNotFound
	}
	return r.q.SetEditionDuration(ctx, sqlcgen.SetEditionDurationParams{
		ID: parsedID, DurationSeconds: int32(seconds),
	})
}

func (r *pgRepo) ListChapters(ctx context.Context, editionID string) ([]Chapter, error) {
	parsedID, err := uuid.Parse(editionID)
	if err != nil {
		return nil, ErrNotFound
	}
	rows, err := r.q.ListChaptersForEdition(ctx, parsedID)
	if err != nil {
		return nil, err
	}
	chapters := make([]Chapter, len(rows))
	for i, row := range rows {
		chapters[i] = Chapter{
			ID:           row.ID.String(),
			Title:        row.Title,
			SortOrder:    int(row.SortOrder),
			StartSeconds: numericToFloat(row.StartSeconds),
			EndSeconds:   numericToFloat(row.EndSeconds),
		}
	}
	return chapters, nil
}

func (r *pgRepo) GetTranscriptSegments(ctx context.Context, editionID string, fromSeconds, toSeconds float64) ([]TranscriptSegment, error) {
	parsedID, err := uuid.Parse(editionID)
	if err != nil {
		return nil, ErrNotFound
	}
	rows, err := r.q.GetTranscriptSegmentsInRange(ctx, sqlcgen.GetTranscriptSegmentsInRangeParams{
		AudioEditionID: parsedID,
		FromSeconds:    floatToNumeric(fromSeconds),
		ToSeconds:      floatToNumeric(toSeconds),
	})
	if err != nil {
		return nil, err
	}
	segments := make([]TranscriptSegment, len(rows))
	for i, row := range rows {
		segments[i] = TranscriptSegment{
			Text:         row.Text,
			StartSeconds: numericToFloat(row.StartSeconds),
			EndSeconds:   numericToFloat(row.EndSeconds),
		}
	}
	return segments, nil
}

func (r *pgRepo) UpsertTranscript(ctx context.Context, editionID, language string, contentJSON []byte) error {
	parsedID, err := uuid.Parse(editionID)
	if err != nil {
		return ErrNotFound
	}
	_, err = r.q.UpsertTranscript(ctx, sqlcgen.UpsertTranscriptParams{
		AudioEditionID: parsedID, Language: language, Content: contentJSON,
	})
	return err
}

func (r *pgRepo) ListCategories(ctx context.Context) ([]Category, error) {
	rows, err := r.q.ListCategories(ctx)
	if err != nil {
		return nil, err
	}
	categories := make([]Category, len(rows))
	for i, row := range rows {
		categories[i] = Category{
			ID: row.ID.String(), Name: row.Name, Slug: row.Slug, BookCount: row.BookCount,
		}
	}
	return categories, nil
}

func (r *pgRepo) GetAuthorBySlug(ctx context.Context, slug string) (Author, error) {
	row, err := r.q.GetAuthorBySlug(ctx, slug)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Author{}, ErrNotFound
		}
		return Author{}, err
	}
	return Author{ID: row.ID.String(), Name: row.Name, Slug: row.Slug, Bio: stringOrEmpty(row.Bio)}, nil
}

func (r *pgRepo) ResolveLexicon(ctx context.Context, bookID, language string) ([]LexiconEntry, error) {
	book, err := toPgUUID(bookID)
	if err != nil {
		return nil, fmt.Errorf("catalog: parse book id: %w", err)
	}
	rows, err := r.q.ResolveLexicon(ctx, sqlcgen.ResolveLexiconParams{Language: language, BookID: book})
	if err != nil {
		return nil, err
	}
	entries := make([]LexiconEntry, len(rows))
	for i, row := range rows {
		entries[i] = LexiconEntry{Grapheme: row.Grapheme, Phoneme: row.Phoneme, BookID: fromPgUUID(row.BookID)}
	}
	return entries, nil
}

func (r *pgRepo) HasActiveRights(ctx context.Context, bookID string) (bool, error) {
	parsedID, err := uuid.Parse(bookID)
	if err != nil {
		return false, ErrNotFound
	}
	return r.q.HasActiveRights(ctx, parsedID)
}

func (r *pgRepo) IncrementListenCount(ctx context.Context, bookID string, by int64) error {
	parsedID, err := uuid.Parse(bookID)
	if err != nil {
		return ErrNotFound
	}
	return r.q.IncrementListenCount(ctx, sqlcgen.IncrementListenCountParams{ID: parsedID, ListenCount: by})
}

func stringOrEmpty(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func toPgUUID(id string) (pgtype.UUID, error) {
	if id == "" {
		return pgtype.UUID{}, nil
	}
	parsed, err := uuid.Parse(id)
	if err != nil {
		return pgtype.UUID{}, err
	}
	return pgtype.UUID{Bytes: parsed, Valid: true}, nil
}

func fromPgUUID(id pgtype.UUID) string {
	if !id.Valid {
		return ""
	}
	return uuid.UUID(id.Bytes).String()
}

func fromPgTimestamptz(ts pgtype.Timestamptz) *time.Time {
	if !ts.Valid {
		return nil
	}
	t := ts.Time
	return &t
}

// numericToFloat converts pgtype.Numeric to float64. Timestamps in a
// transcript and chapter boundaries are numeric in Postgres so they keep
// sub-second precision without float drift in storage; float64 at the
// edge of the API is fine because a player seeks in milliseconds.
func numericToFloat(n pgtype.Numeric) float64 {
	if !n.Valid || n.NaN {
		return 0
	}
	f, err := n.Float64Value()
	if err != nil || !f.Valid {
		return 0
	}
	return f.Float64
}

func floatToNumeric(f float64) pgtype.Numeric {
	var n pgtype.Numeric
	if err := n.Scan(big.NewFloat(f).Text('f', 6)); err != nil {
		return pgtype.Numeric{Valid: false}
	}
	return n
}
