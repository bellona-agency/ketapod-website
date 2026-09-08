package library

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"ketapod/internal/library/sqlcgen"
)

func (r *pgRepo) CreateBookmark(ctx context.Context, userID, audioEditionID, bookID string, positionSeconds float64, label, summaryStatus string) (Bookmark, error) {
	userUUID, err := uuid.Parse(userID)
	if err != nil {
		return Bookmark{}, fmt.Errorf("library: parse user id: %w", err)
	}
	editionUUID, err := uuid.Parse(audioEditionID)
	if err != nil {
		return Bookmark{}, fmt.Errorf("library: parse audio edition id: %w", err)
	}
	bookUUID, err := uuid.Parse(bookID)
	if err != nil {
		return Bookmark{}, fmt.Errorf("library: parse book id: %w", err)
	}

	row, err := r.q.CreateBookmark(ctx, sqlcgen.CreateBookmarkParams{
		UserID: userUUID, AudioEditionID: editionUUID, BookID: bookUUID,
		PositionSeconds: floatToNumeric(positionSeconds),
		Label:           nullableString(label), SummaryStatus: summaryStatus,
	})
	if err != nil {
		return Bookmark{}, err
	}
	return toBookmark(row), nil
}

func (r *pgRepo) ListBookmarks(ctx context.Context, userID, audioEditionID string, limit, offset int32) ([]Bookmark, int64, error) {
	userUUID, err := uuid.Parse(userID)
	if err != nil {
		return nil, 0, fmt.Errorf("library: parse user id: %w", err)
	}
	editionUUID, err := toPgUUID(audioEditionID)
	if err != nil {
		return nil, 0, fmt.Errorf("library: parse audio edition id: %w", err)
	}

	rows, err := r.q.ListBookmarksForUser(ctx, sqlcgen.ListBookmarksForUserParams{
		UserID: userUUID, AudioEditionID: editionUUID, PageLimit: limit, PageOffset: offset,
	})
	if err != nil {
		return nil, 0, err
	}

	bookmarks := make([]Bookmark, len(rows))
	var total int64
	for i, row := range rows {
		total = row.TotalCount
		bookmarks[i] = Bookmark{
			ID: row.ID.String(), UserID: row.UserID.String(),
			AudioEditionID: row.AudioEditionID.String(), BookID: row.BookID.String(),
			PositionSeconds: numericToFloat(row.PositionSeconds), Label: stringOrEmpty(row.Label),
			Summary: stringOrEmpty(row.Summary), SummaryStatus: row.SummaryStatus,
			CreatedAt: row.CreatedAt, BookTitle: row.Title, BookCoverURL: stringOrEmpty(row.CoverUrl),
		}
	}
	return bookmarks, total, nil
}

func (r *pgRepo) GetBookmark(ctx context.Context, bookmarkID string) (Bookmark, error) {
	parsedID, err := uuid.Parse(bookmarkID)
	if err != nil {
		return Bookmark{}, ErrNotFound
	}
	row, err := r.q.GetBookmarkByID(ctx, parsedID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Bookmark{}, ErrNotFound
		}
		return Bookmark{}, err
	}
	return toBookmark(row), nil
}

func (r *pgRepo) SetBookmarkSummary(ctx context.Context, bookmarkID, summary, status string) error {
	parsedID, err := uuid.Parse(bookmarkID)
	if err != nil {
		return ErrNotFound
	}
	_, err = r.q.SetBookmarkSummary(ctx, sqlcgen.SetBookmarkSummaryParams{
		ID: parsedID, Summary: nullableString(summary), SummaryStatus: status,
	})
	return err
}

func (r *pgRepo) DeleteBookmark(ctx context.Context, bookmarkID, userID string) error {
	bookmarkUUID, err := uuid.Parse(bookmarkID)
	if err != nil {
		return ErrNotFound
	}
	userUUID, err := uuid.Parse(userID)
	if err != nil {
		return fmt.Errorf("library: parse user id: %w", err)
	}
	return r.q.DeleteBookmark(ctx, sqlcgen.DeleteBookmarkParams{ID: bookmarkUUID, UserID: userUUID})
}

func (r *pgRepo) CreateNote(ctx context.Context, userID, audioEditionID, bookID string, positionSeconds float64, body string) (Note, error) {
	userUUID, err := uuid.Parse(userID)
	if err != nil {
		return Note{}, fmt.Errorf("library: parse user id: %w", err)
	}
	editionUUID, err := uuid.Parse(audioEditionID)
	if err != nil {
		return Note{}, fmt.Errorf("library: parse audio edition id: %w", err)
	}
	bookUUID, err := uuid.Parse(bookID)
	if err != nil {
		return Note{}, fmt.Errorf("library: parse book id: %w", err)
	}

	row, err := r.q.CreateNote(ctx, sqlcgen.CreateNoteParams{
		UserID: userUUID, AudioEditionID: editionUUID, BookID: bookUUID,
		PositionSeconds: floatToNumeric(positionSeconds), Body: body,
	})
	if err != nil {
		return Note{}, err
	}
	return toNote(row), nil
}

func (r *pgRepo) UpdateNote(ctx context.Context, noteID, userID, body string) (Note, error) {
	noteUUID, err := uuid.Parse(noteID)
	if err != nil {
		return Note{}, ErrNotFound
	}
	userUUID, err := uuid.Parse(userID)
	if err != nil {
		return Note{}, fmt.Errorf("library: parse user id: %w", err)
	}
	row, err := r.q.UpdateNote(ctx, sqlcgen.UpdateNoteParams{ID: noteUUID, UserID: userUUID, Body: body})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Note{}, ErrNotFound
		}
		return Note{}, err
	}
	return toNote(row), nil
}

func (r *pgRepo) DeleteNote(ctx context.Context, noteID, userID string) error {
	noteUUID, err := uuid.Parse(noteID)
	if err != nil {
		return ErrNotFound
	}
	userUUID, err := uuid.Parse(userID)
	if err != nil {
		return fmt.Errorf("library: parse user id: %w", err)
	}
	return r.q.DeleteNote(ctx, sqlcgen.DeleteNoteParams{ID: noteUUID, UserID: userUUID})
}

func (r *pgRepo) ListNotes(ctx context.Context, userID, audioEditionID string, limit, offset int32) ([]Note, int64, error) {
	userUUID, err := uuid.Parse(userID)
	if err != nil {
		return nil, 0, fmt.Errorf("library: parse user id: %w", err)
	}
	editionUUID, err := toPgUUID(audioEditionID)
	if err != nil {
		return nil, 0, fmt.Errorf("library: parse audio edition id: %w", err)
	}
	rows, err := r.q.ListNotesForUser(ctx, sqlcgen.ListNotesForUserParams{
		UserID: userUUID, AudioEditionID: editionUUID, PageLimit: limit, PageOffset: offset,
	})
	if err != nil {
		return nil, 0, err
	}
	notes := make([]Note, len(rows))
	var total int64
	for i, row := range rows {
		total = row.TotalCount
		notes[i] = Note{
			ID: row.ID.String(), UserID: row.UserID.String(),
			AudioEditionID: row.AudioEditionID.String(), BookID: row.BookID.String(),
			PositionSeconds: numericToFloat(row.PositionSeconds), Body: row.Body,
			CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
			BookTitle: row.Title, BookCoverURL: stringOrEmpty(row.CoverUrl),
		}
	}
	return notes, total, nil
}

func (r *pgRepo) CreateHighlight(ctx context.Context, userID, audioEditionID, bookID string, start, end float64, quote string) (Highlight, error) {
	userUUID, err := uuid.Parse(userID)
	if err != nil {
		return Highlight{}, fmt.Errorf("library: parse user id: %w", err)
	}
	editionUUID, err := uuid.Parse(audioEditionID)
	if err != nil {
		return Highlight{}, fmt.Errorf("library: parse audio edition id: %w", err)
	}
	bookUUID, err := uuid.Parse(bookID)
	if err != nil {
		return Highlight{}, fmt.Errorf("library: parse book id: %w", err)
	}
	row, err := r.q.CreateHighlight(ctx, sqlcgen.CreateHighlightParams{
		UserID: userUUID, AudioEditionID: editionUUID, BookID: bookUUID,
		StartSeconds: floatToNumeric(start), EndSeconds: floatToNumeric(end), Quote: quote,
	})
	if err != nil {
		return Highlight{}, err
	}
	return Highlight{
		ID: row.ID.String(), UserID: row.UserID.String(),
		AudioEditionID: row.AudioEditionID.String(), BookID: row.BookID.String(),
		StartSeconds: numericToFloat(row.StartSeconds), EndSeconds: numericToFloat(row.EndSeconds),
		Quote: row.Quote, CreatedAt: row.CreatedAt,
	}, nil
}

func (r *pgRepo) DeleteHighlight(ctx context.Context, highlightID, userID string) error {
	highlightUUID, err := uuid.Parse(highlightID)
	if err != nil {
		return ErrNotFound
	}
	userUUID, err := uuid.Parse(userID)
	if err != nil {
		return fmt.Errorf("library: parse user id: %w", err)
	}
	return r.q.DeleteHighlight(ctx, sqlcgen.DeleteHighlightParams{ID: highlightUUID, UserID: userUUID})
}

func (r *pgRepo) ListHighlights(ctx context.Context, userID, audioEditionID string, limit, offset int32) ([]Highlight, int64, error) {
	userUUID, err := uuid.Parse(userID)
	if err != nil {
		return nil, 0, fmt.Errorf("library: parse user id: %w", err)
	}
	editionUUID, err := toPgUUID(audioEditionID)
	if err != nil {
		return nil, 0, fmt.Errorf("library: parse audio edition id: %w", err)
	}
	rows, err := r.q.ListHighlightsForUser(ctx, sqlcgen.ListHighlightsForUserParams{
		UserID: userUUID, AudioEditionID: editionUUID, PageLimit: limit, PageOffset: offset,
	})
	if err != nil {
		return nil, 0, err
	}
	highlights := make([]Highlight, len(rows))
	var total int64
	for i, row := range rows {
		total = row.TotalCount
		highlights[i] = Highlight{
			ID: row.ID.String(), UserID: row.UserID.String(),
			AudioEditionID: row.AudioEditionID.String(), BookID: row.BookID.String(),
			StartSeconds: numericToFloat(row.StartSeconds), EndSeconds: numericToFloat(row.EndSeconds),
			Quote: row.Quote, CreatedAt: row.CreatedAt, BookTitle: row.Title,
		}
	}
	return highlights, total, nil
}

func (r *pgRepo) TopQuotes(ctx context.Context, bookID string, limit int32) ([]string, error) {
	parsedID, err := uuid.Parse(bookID)
	if err != nil {
		return nil, ErrNotFound
	}
	rows, err := r.q.TopHighlightedQuotes(ctx, sqlcgen.TopHighlightedQuotesParams{BookID: parsedID, Limit: limit})
	if err != nil {
		return nil, err
	}
	quotes := make([]string, len(rows))
	for i, row := range rows {
		quotes[i] = row.Quote
	}
	return quotes, nil
}

func (r *pgRepo) UpsertShelfItem(ctx context.Context, userID, bookID, shelf string) error {
	userUUID, err := uuid.Parse(userID)
	if err != nil {
		return fmt.Errorf("library: parse user id: %w", err)
	}
	bookUUID, err := uuid.Parse(bookID)
	if err != nil {
		return fmt.Errorf("library: parse book id: %w", err)
	}
	_, err = r.q.UpsertShelfItem(ctx, sqlcgen.UpsertShelfItemParams{
		UserID: userUUID, BookID: bookUUID, Shelf: shelf,
	})
	return err
}

func (r *pgRepo) DeleteShelfItem(ctx context.Context, userID, bookID, shelf string) error {
	userUUID, err := uuid.Parse(userID)
	if err != nil {
		return fmt.Errorf("library: parse user id: %w", err)
	}
	bookUUID, err := uuid.Parse(bookID)
	if err != nil {
		return fmt.Errorf("library: parse book id: %w", err)
	}
	return r.q.DeleteShelfItem(ctx, sqlcgen.DeleteShelfItemParams{
		UserID: userUUID, BookID: bookUUID, Shelf: shelf,
	})
}

func (r *pgRepo) ListShelf(ctx context.Context, userID, shelf string, limit, offset int32) ([]ShelfItem, int64, error) {
	userUUID, err := uuid.Parse(userID)
	if err != nil {
		return nil, 0, fmt.Errorf("library: parse user id: %w", err)
	}
	rows, err := r.q.ListShelf(ctx, sqlcgen.ListShelfParams{
		UserID: userUUID, Shelf: shelf, PageLimit: limit, PageOffset: offset,
	})
	if err != nil {
		return nil, 0, err
	}
	items := make([]ShelfItem, len(rows))
	var total int64
	for i, row := range rows {
		total = row.TotalCount
		items[i] = ShelfItem{
			ID: row.ID.String(), UserID: row.UserID.String(), BookID: row.BookID.String(),
			Shelf: row.Shelf, CreatedAt: row.CreatedAt, BookTitle: row.Title,
			BookSlug: row.Slug, BookCoverURL: stringOrEmpty(row.CoverUrl),
			IsKidsFriendly: row.IsKidsFriendly,
		}
	}
	return items, total, nil
}

func (r *pgRepo) CreateClip(ctx context.Context, userID, audioEditionID string, start, end float64) (Clip, error) {
	userUUID, err := uuid.Parse(userID)
	if err != nil {
		return Clip{}, fmt.Errorf("library: parse user id: %w", err)
	}
	editionUUID, err := uuid.Parse(audioEditionID)
	if err != nil {
		return Clip{}, fmt.Errorf("library: parse audio edition id: %w", err)
	}
	row, err := r.q.CreateClip(ctx, sqlcgen.CreateClipParams{
		UserID: userUUID, AudioEditionID: editionUUID,
		StartSeconds: floatToNumeric(start), EndSeconds: floatToNumeric(end),
	})
	if err != nil {
		return Clip{}, err
	}
	return Clip{
		ID: row.ID.String(), UserID: row.UserID.String(),
		AudioEditionID: row.AudioEditionID.String(),
		StartSeconds:   numericToFloat(row.StartSeconds), EndSeconds: numericToFloat(row.EndSeconds),
		Status: row.Status, CreatedAt: row.CreatedAt,
	}, nil
}

func toBookmark(row sqlcgen.LibraryBookmark) Bookmark {
	return Bookmark{
		ID: row.ID.String(), UserID: row.UserID.String(),
		AudioEditionID: row.AudioEditionID.String(), BookID: row.BookID.String(),
		PositionSeconds: numericToFloat(row.PositionSeconds), Label: stringOrEmpty(row.Label),
		Summary: stringOrEmpty(row.Summary), SummaryStatus: row.SummaryStatus, CreatedAt: row.CreatedAt,
	}
}

func toNote(row sqlcgen.LibraryNote) Note {
	return Note{
		ID: row.ID.String(), UserID: row.UserID.String(),
		AudioEditionID: row.AudioEditionID.String(), BookID: row.BookID.String(),
		PositionSeconds: numericToFloat(row.PositionSeconds), Body: row.Body,
		CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
	}
}
