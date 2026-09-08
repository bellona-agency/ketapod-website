// Package integrationtest exercises the modules against a real Postgres
// and Redis.
//
// Every DB-backed test in the project lives here rather than in its own
// package, for one reason: testcontainers starts one container per test
// *binary*, so a test spread across six packages pays for six Postgres
// instances. Consolidating means the whole suite runs on one, and a
// suite that runs in seconds is a suite that gets run.
//
// These tests use the real database on purpose. Half of what this
// backend gets right has no in-memory equivalent — advisory locks,
// partial unique indexes, ON CONFLICT targets, generated columns,
// trigram matching, and the last-write-wins upsert are all database
// behaviour, and a fake repository would assert only that the fake works.
package integrationtest

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"

	"ketapod/internal/platform/testkit"
)

// newPool returns a migrated pool with every application table empty, so
// tests never inherit each other's rows.
func newPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	pool := testkit.PostgresWithMigrations(t, "../../migrations")
	testkit.TruncateAll(t, pool)
	return pool
}

type fixtures struct {
	t    *testing.T
	pool *pgxpool.Pool
}

func newFixtures(t *testing.T, pool *pgxpool.Pool) *fixtures {
	return &fixtures{t: t, pool: pool}
}

func (f *fixtures) user(phoneNumber string) string {
	f.t.Helper()
	var id string
	require.NoError(f.t, f.pool.QueryRow(context.Background(),
		`INSERT INTO identity.users (phone_number) VALUES ($1) RETURNING id`, phoneNumber,
	).Scan(&id))
	return id
}

func (f *fixtures) voice(id, name, style string, isKids bool) {
	f.t.Helper()
	_, err := f.pool.Exec(context.Background(), `
		INSERT INTO catalog.voices (id, name, style, is_default, is_kids, sort_order)
		VALUES ($1, $2, $3, false, $4, 1)
		ON CONFLICT (id) DO NOTHING`, id, name, style, isKids)
	require.NoError(f.t, err)
}

type bookOpts struct {
	Slug           string
	Title          string
	Description    string
	IsKidsFriendly bool
	AuthorName     string
}

func (f *fixtures) book(opts bookOpts) string {
	f.t.Helper()
	ctx := context.Background()

	var authorID *string
	if opts.AuthorName != "" {
		var id string
		require.NoError(f.t, f.pool.QueryRow(ctx,
			`INSERT INTO catalog.authors (name, slug) VALUES ($1, $2) RETURNING id`,
			opts.AuthorName, "author-"+opts.Slug,
		).Scan(&id))
		authorID = &id
	}

	var bookID string
	require.NoError(f.t, f.pool.QueryRow(ctx, `
		INSERT INTO catalog.books (slug, title, description, author_id, is_kids_friendly, cover_url, published_at)
		VALUES ($1, $2, $3, $4, $5, 'https://example.test/cover.jpg', now())
		RETURNING id`,
		opts.Slug, opts.Title, opts.Description, authorID, opts.IsKidsFriendly,
	).Scan(&bookID))
	return bookID
}

type editionOpts struct {
	BookID          string
	VoiceID         string
	PriceIRR        int64
	PreviewSeconds  int
	DurationSeconds int
	IsKidsFriendly  bool
	Status          string
	// WithAsset controls whether a playable media row is created. Some
	// tests need an edition that exists in the catalogue but has no
	// audio yet — a real state during production.
	WithAsset bool
}

func (f *fixtures) edition(opts editionOpts) string {
	f.t.Helper()
	ctx := context.Background()

	if opts.Status == "" {
		opts.Status = "published"
	}
	if opts.DurationSeconds == 0 {
		opts.DurationSeconds = 600
	}
	f.voice(opts.VoiceID, "صدای آزمون", "calm", opts.IsKidsFriendly)

	var editionID string
	require.NoError(f.t, f.pool.QueryRow(ctx, `
		INSERT INTO catalog.audio_editions
			(book_id, voice_id, narrator_type, is_kids_friendly, price_irr, preview_seconds, duration_seconds, status, published_at)
		VALUES ($1, $2, 'ai', $3, $4, $5, $6, $7, now())
		RETURNING id`,
		opts.BookID, opts.VoiceID, opts.IsKidsFriendly, opts.PriceIRR,
		opts.PreviewSeconds, opts.DurationSeconds, opts.Status,
	).Scan(&editionID))

	if opts.WithAsset {
		_, err := f.pool.Exec(ctx, `
			INSERT INTO media.audio_assets (audio_edition_id, storage_key, format, bitrate_kbps, duration_seconds)
			VALUES ($1, $2, 'm4a', 48, $3)`,
			editionID, "test/"+editionID+".m4a", opts.DurationSeconds)
		require.NoError(f.t, err)
	}

	return editionID
}

// creditWallet seeds balance directly through the ledger rather than
// through a fake top-up, because the balance is a SUM over the ledger:
// there is no balance column to set.
func (f *fixtures) creditWallet(userID string, amountIRR int64) {
	f.t.Helper()
	_, err := f.pool.Exec(context.Background(), `
		INSERT INTO commerce.wallet_ledger (user_id, entry_type, amount_irr, reason)
		VALUES ($1, 'credit', $2, 'test_seed')`, userID, amountIRR)
	require.NoError(f.t, err)
}

func (f *fixtures) walletBalance(userID string) int64 {
	f.t.Helper()
	var balance int64
	require.NoError(f.t, f.pool.QueryRow(context.Background(), `
		SELECT COALESCE(SUM(CASE WHEN entry_type = 'credit' THEN amount_irr ELSE -amount_irr END), 0)
		FROM commerce.wallet_ledger WHERE user_id = $1`, userID).Scan(&balance))
	return balance
}

func (f *fixtures) coupon(code string, kind string, value, maxDiscount, minSubtotal int64, perUserLimit int) {
	f.t.Helper()
	_, err := f.pool.Exec(context.Background(), `
		INSERT INTO commerce.coupons (code, kind, value, max_discount_irr, min_subtotal_irr, per_user_limit)
		VALUES ($1, $2, $3, NULLIF($4, 0), $5, $6)`,
		code, kind, value, maxDiscount, minSubtotal, perUserLimit)
	require.NoError(f.t, err)
}

func (f *fixtures) subscriptionPlan(code string, priceIRR int64, periodDays, hourCap int) string {
	f.t.Helper()
	var id string
	require.NoError(f.t, f.pool.QueryRow(context.Background(), `
		INSERT INTO commerce.subscription_plans (code, name, price_irr, period_days, monthly_hour_cap)
		VALUES ($1, $1, $2, $3, $4) RETURNING id`,
		code, priceIRR, periodDays, hourCap,
	).Scan(&id))
	return id
}

func (f *fixtures) childProfile(parentUserID, name string, ageYears int) string {
	f.t.Helper()
	var id string
	require.NoError(f.t, f.pool.QueryRow(context.Background(), `
		INSERT INTO kids.child_profiles (parent_user_id, display_name, age_years)
		VALUES ($1, $2, $3) RETURNING id`, parentUserID, name, ageYears,
	).Scan(&id))
	return id
}

// listeningEvent backdates listening so screen-time and streak logic can
// be tested without waiting a day.
func (f *fixtures) listeningEvent(userID, profileID, editionID, bookID string, seconds int, occurredAt time.Time) {
	f.t.Helper()
	var profile any
	if profileID != "" {
		profile = profileID
	}
	_, err := f.pool.Exec(context.Background(), `
		INSERT INTO library.listening_events (user_id, profile_id, audio_edition_id, book_id, seconds_listened, occurred_at)
		VALUES ($1, $2, $3, $4, $5, $6)`,
		userID, profile, editionID, bookID, seconds, occurredAt)
	require.NoError(f.t, err)
}

func (f *fixtures) countRows(table, where string, args ...any) int {
	f.t.Helper()
	var n int
	query := fmt.Sprintf("SELECT count(*) FROM %s WHERE %s", table, where)
	require.NoError(f.t, f.pool.QueryRow(context.Background(), query, args...).Scan(&n))
	return n
}
