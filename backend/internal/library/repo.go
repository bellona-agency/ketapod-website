package library

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

	"ketapod/internal/library/sqlcgen"
	"ketapod/internal/platform/outbox"
)

type pgRepo struct {
	pool *pgxpool.Pool
	db   outbox.DBTX
	q    *sqlcgen.Queries
}

func NewRepository(pool *pgxpool.Pool) Repository {
	return &pgRepo{pool: pool, db: pool, q: sqlcgen.New(pool)}
}

// InTx runs fn in a transaction, so a bookmark and its "summarise this"
// job commit together. Before the outbox, a crash between the two left
// the bookmark stuck on summaryStatus = pending forever.
func (r *pgRepo) InTx(ctx context.Context, fn func(Repository) error) error {
	if r.pool == nil {
		return fn(r)
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("library: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if err := fn(&pgRepo{pool: nil, db: tx, q: r.q.WithTx(tx)}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (r *pgRepo) EnqueueTask(ctx context.Context, task outbox.Task) error {
	return outbox.Write(ctx, r.db, task)
}

// UpsertPosition returns ok=false when the write lost the last-write-wins
// comparison. That is not an error: a phone that was offline is
// *supposed* to lose against a newer write from a tablet, and the client
// should adopt the stored position instead of retrying.
func (r *pgRepo) UpsertPosition(ctx context.Context, userID, bookID string, update PositionUpdate) (Position, bool, error) {
	userUUID, err := uuid.Parse(userID)
	if err != nil {
		return Position{}, false, fmt.Errorf("library: parse user id: %w", err)
	}
	editionUUID, err := uuid.Parse(update.AudioEditionID)
	if err != nil {
		return Position{}, false, fmt.Errorf("library: parse audio edition id: %w", err)
	}
	bookUUID, err := uuid.Parse(bookID)
	if err != nil {
		return Position{}, false, fmt.Errorf("library: parse book id: %w", err)
	}
	profileUUID, err := toPgUUID(update.ProfileID)
	if err != nil {
		return Position{}, false, fmt.Errorf("library: parse profile id: %w", err)
	}

	row, err := r.q.UpsertListeningPosition(ctx, sqlcgen.UpsertListeningPositionParams{
		UserID:          userUUID,
		ProfileID:       profileUUID,
		AudioEditionID:  editionUUID,
		BookID:          bookUUID,
		PositionSeconds: floatToNumeric(update.PositionSeconds),
		DurationSeconds: floatToNumeric(update.DurationSeconds),
		IsFinished:      update.IsFinished,
		DeviceUpdatedAt: update.DeviceUpdatedAt,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Position{}, false, nil
		}
		return Position{}, false, err
	}
	return toPosition(row), true, nil
}

func (r *pgRepo) GetPosition(ctx context.Context, userID, profileID, audioEditionID string) (Position, error) {
	userUUID, err := uuid.Parse(userID)
	if err != nil {
		return Position{}, fmt.Errorf("library: parse user id: %w", err)
	}
	editionUUID, err := uuid.Parse(audioEditionID)
	if err != nil {
		return Position{}, ErrNotFound
	}
	profileUUID, err := toPgUUID(profileID)
	if err != nil {
		return Position{}, fmt.Errorf("library: parse profile id: %w", err)
	}

	row, err := r.q.GetListeningPosition(ctx, sqlcgen.GetListeningPositionParams{
		UserID: userUUID, AudioEditionID: editionUUID, ProfileID: profileUUID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Position{}, ErrNotFound
		}
		return Position{}, err
	}
	return toPosition(row), nil
}

func (r *pgRepo) ListContinueListening(ctx context.Context, userID, profileID string, limit int32) ([]Position, error) {
	userUUID, err := uuid.Parse(userID)
	if err != nil {
		return nil, fmt.Errorf("library: parse user id: %w", err)
	}
	profileUUID, err := toPgUUID(profileID)
	if err != nil {
		return nil, fmt.Errorf("library: parse profile id: %w", err)
	}

	rows, err := r.q.ListContinueListening(ctx, sqlcgen.ListContinueListeningParams{
		UserID: userUUID, ProfileID: profileUUID, PageLimit: limit,
	})
	if err != nil {
		return nil, err
	}

	positions := make([]Position, len(rows))
	for i, row := range rows {
		positions[i] = Position{
			ID: row.ID.String(), UserID: row.UserID.String(),
			ProfileID: fromPgUUID(row.ProfileID), AudioEditionID: row.AudioEditionID.String(),
			BookID: row.BookID.String(), PositionSeconds: numericToFloat(row.PositionSeconds),
			DurationSeconds: numericToFloat(row.DurationSeconds), IsFinished: row.IsFinished,
			DeviceUpdatedAt: row.DeviceUpdatedAt, UpdatedAt: row.UpdatedAt,
			BookTitle: row.Title, BookSlug: row.Slug, BookCoverURL: stringOrEmpty(row.CoverUrl),
		}
	}
	return positions, nil
}

func (r *pgRepo) CreateListeningEvent(ctx context.Context, userID, profileID, audioEditionID, bookID string, seconds int, occurredAt time.Time) error {
	userUUID, err := uuid.Parse(userID)
	if err != nil {
		return fmt.Errorf("library: parse user id: %w", err)
	}
	editionUUID, err := uuid.Parse(audioEditionID)
	if err != nil {
		return fmt.Errorf("library: parse audio edition id: %w", err)
	}
	bookUUID, err := uuid.Parse(bookID)
	if err != nil {
		return fmt.Errorf("library: parse book id: %w", err)
	}
	profileUUID, err := toPgUUID(profileID)
	if err != nil {
		return fmt.Errorf("library: parse profile id: %w", err)
	}

	_, err = r.q.CreateListeningEvent(ctx, sqlcgen.CreateListeningEventParams{
		UserID: userUUID, ProfileID: profileUUID, AudioEditionID: editionUUID,
		BookID: bookUUID, SecondsListened: int32(seconds), OccurredAt: occurredAt,
	})
	return err
}

func (r *pgRepo) SecondsListenedForProfileSince(ctx context.Context, profileID string, since time.Time) (int64, error) {
	profileUUID, err := uuid.Parse(profileID)
	if err != nil {
		return 0, fmt.Errorf("library: parse profile id: %w", err)
	}
	return r.q.SumSecondsListenedForProfileSince(ctx, sqlcgen.SumSecondsListenedForProfileSinceParams{
		ProfileID: profileUUID, Since: since,
	})
}

func (r *pgRepo) SecondsListenedForUserSince(ctx context.Context, userID string, since time.Time) (int64, error) {
	userUUID, err := uuid.Parse(userID)
	if err != nil {
		return 0, fmt.Errorf("library: parse user id: %w", err)
	}
	return r.q.SumSecondsListenedForUserSince(ctx, sqlcgen.SumSecondsListenedForUserSinceParams{
		UserID: userUUID, OccurredAt: since,
	})
}

func (r *pgRepo) ListeningDaysSince(ctx context.Context, userID, tz string, since time.Time) ([]time.Time, error) {
	userUUID, err := uuid.Parse(userID)
	if err != nil {
		return nil, fmt.Errorf("library: parse user id: %w", err)
	}
	rows, err := r.q.ListListeningDaysSince(ctx, sqlcgen.ListListeningDaysSinceParams{
		Tz: tz, UserID: userUUID, Since: since,
	})
	if err != nil {
		return nil, err
	}
	days := make([]time.Time, len(rows))
	for i, row := range rows {
		days[i] = row.Time
	}
	return days, nil
}

func (r *pgRepo) DailyBreakdown(ctx context.Context, userID, profileID, tz string, since time.Time) ([]DayTotal, error) {
	userUUID, err := uuid.Parse(userID)
	if err != nil {
		return nil, fmt.Errorf("library: parse user id: %w", err)
	}
	profileUUID, err := toPgUUID(profileID)
	if err != nil {
		return nil, fmt.Errorf("library: parse profile id: %w", err)
	}
	rows, err := r.q.DailyListeningBreakdown(ctx, sqlcgen.DailyListeningBreakdownParams{
		Tz: tz, UserID: userUUID, ProfileID: profileUUID, Since: since,
	})
	if err != nil {
		return nil, err
	}
	totals := make([]DayTotal, len(rows))
	for i, row := range rows {
		totals[i] = DayTotal{Date: row.ListenedOn.Time, SecondsListened: row.TotalSeconds}
	}
	return totals, nil
}

func (r *pgRepo) TopBooks(ctx context.Context, userID, profileID string, since time.Time, limit int32) ([]BookTotal, error) {
	userUUID, err := uuid.Parse(userID)
	if err != nil {
		return nil, fmt.Errorf("library: parse user id: %w", err)
	}
	profileUUID, err := toPgUUID(profileID)
	if err != nil {
		return nil, fmt.Errorf("library: parse profile id: %w", err)
	}
	rows, err := r.q.TopBooksListened(ctx, sqlcgen.TopBooksListenedParams{
		UserID: userUUID, ProfileID: profileUUID, Since: since, PageLimit: limit,
	})
	if err != nil {
		return nil, err
	}
	totals := make([]BookTotal, len(rows))
	for i, row := range rows {
		totals[i] = BookTotal{
			BookID: row.BookID.String(), Title: row.Title,
			CoverURL: stringOrEmpty(row.CoverUrl), SecondsListened: row.TotalSeconds,
		}
	}
	return totals, nil
}

func toPosition(row sqlcgen.LibraryListeningPosition) Position {
	return Position{
		ID: row.ID.String(), UserID: row.UserID.String(),
		ProfileID: fromPgUUID(row.ProfileID), AudioEditionID: row.AudioEditionID.String(),
		BookID: row.BookID.String(), PositionSeconds: numericToFloat(row.PositionSeconds),
		DurationSeconds: numericToFloat(row.DurationSeconds), IsFinished: row.IsFinished,
		DeviceUpdatedAt: row.DeviceUpdatedAt, UpdatedAt: row.UpdatedAt,
	}
}

func stringOrEmpty(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func nullableString(s string) *string {
	if s == "" {
		return nil
	}
	return &s
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
	if err := n.Scan(big.NewFloat(f).Text('f', 3)); err != nil {
		return pgtype.Numeric{Valid: false}
	}
	return n
}
