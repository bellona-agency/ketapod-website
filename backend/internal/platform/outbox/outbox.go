// Package outbox implements the transactional outbox pattern.
//
// The problem it solves is the dual write. Before it, every background
// job was written to the database and *then* pushed to Redis, outside
// the transaction. If the process died in between — or Redis blinked —
// the job was gone for good: a bookmark stuck on "pending" forever, or
// a user who never received their login code. Both are exactly the
// failure mode that shows up under load, and never in development.
//
// With the outbox, the job is inserted in the same transaction as the
// data that caused it. Either both land or neither does. A relay then
// moves pending rows into asynq.
//
// The guarantee is at-least-once, not exactly-once: a relay that crashes
// after enqueueing but before marking the row dispatched will enqueue
// again. Every handler must therefore be idempotent. That trade is
// deliberate — a duplicated job is survivable, a lost one is not.
package outbox

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// DBTX is the subset of pgx satisfied by both a pool and a transaction.
// Writing against it is what lets a caller pass its own open transaction
// so the job and the domain row commit together.
type DBTX interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// Task is a job waiting to be dispatched.
type Task struct {
	Type     string
	Payload  any
	Queue    string
	MaxRetry int
	// DedupeKey collapses logically identical jobs that are still
	// pending. Empty means no de-duplication.
	DedupeKey string
	// AvailableAt delays dispatch. Zero means "as soon as possible".
	AvailableAt time.Time
}

const (
	QueueCritical = "critical"
	QueueDefault  = "default"
	QueueLow      = "low"
)

// Write inserts a task. Pass the transaction that is writing the domain
// row — that is the entire point of this package. Passing a pool works
// and is still better than a bare Enqueue (the row survives a Redis
// outage), but it gives up atomicity with the domain write.
func Write(ctx context.Context, db DBTX, task Task) error {
	payload, err := json.Marshal(task.Payload)
	if err != nil {
		return fmt.Errorf("outbox: marshal payload for %s: %w", task.Type, err)
	}

	queue := task.Queue
	if queue == "" {
		queue = QueueDefault
	}
	maxRetry := task.MaxRetry
	if maxRetry <= 0 {
		maxRetry = 3
	}
	availableAt := task.AvailableAt
	if availableAt.IsZero() {
		availableAt = time.Now()
	}

	var dedupe *string
	if task.DedupeKey != "" {
		dedupe = &task.DedupeKey
	}

	// ON CONFLICT DO NOTHING against the partial unique index: a second
	// identical job while the first is still pending is simply dropped.
	_, err = db.Exec(ctx, `
		INSERT INTO jobs.outbox (task_type, payload, queue, max_retry, available_at, dedupe_key)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT DO NOTHING`,
		task.Type, payload, queue, maxRetry, availableAt, dedupe)
	if err != nil {
		return fmt.Errorf("outbox: write %s: %w", task.Type, err)
	}
	return nil
}

// Record is a row the relay has claimed.
type Record struct {
	ID       string
	TaskType string
	Payload  []byte
	Queue    string
	MaxRetry int
	Attempts int
}

// Claim locks up to limit ready rows for this relay instance.
//
// FOR UPDATE SKIP LOCKED is what allows more than one relay to run at
// once: each grabs a disjoint set instead of blocking on the other. That
// matters because the relay lives in the worker, and workers scale
// horizontally.
func Claim(ctx context.Context, db DBTX, limit int) ([]Record, error) {
	rows, err := db.Query(ctx, `
		SELECT id, task_type, payload, queue, max_retry, attempts
		FROM jobs.outbox
		WHERE status = 'pending' AND available_at <= now()
		ORDER BY available_at, created_at
		LIMIT $1
		FOR UPDATE SKIP LOCKED`, limit)
	if err != nil {
		return nil, fmt.Errorf("outbox: claim: %w", err)
	}
	defer rows.Close()

	var records []Record
	for rows.Next() {
		var r Record
		if err := rows.Scan(&r.ID, &r.TaskType, &r.Payload, &r.Queue, &r.MaxRetry, &r.Attempts); err != nil {
			return nil, fmt.Errorf("outbox: scan claimed row: %w", err)
		}
		records = append(records, r)
	}
	return records, rows.Err()
}

func MarkDispatched(ctx context.Context, db DBTX, id string) error {
	_, err := db.Exec(ctx, `
		UPDATE jobs.outbox
		SET status = 'dispatched', dispatched_at = now(), attempts = attempts + 1
		WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("outbox: mark dispatched: %w", err)
	}
	return nil
}

// MarkAttemptFailed records a dispatch failure and either backs off or
// gives up.
//
// Giving up writes status 'failed' rather than deleting: a job that
// could never be dispatched is exactly the thing someone needs to see
// later, and a silently vanished row is how "no job is ever missed"
// turns into a lie.
func MarkAttemptFailed(ctx context.Context, db DBTX, id string, cause error, maxAttempts int) error {
	// Exponential-ish backoff so a Redis outage does not turn into a
	// tight retry loop against a service that is already struggling.
	_, err := db.Exec(ctx, `
		UPDATE jobs.outbox
		SET attempts   = attempts + 1,
		    last_error = $2,
		    status     = CASE WHEN attempts + 1 >= $3 THEN 'failed' ELSE 'pending' END,
		    available_at = now() + (interval '10 seconds' * power(2, least(attempts, 6)))
		WHERE id = $1`, id, cause.Error(), maxAttempts)
	if err != nil {
		return fmt.Errorf("outbox: mark attempt failed: %w", err)
	}
	return nil
}

// Stats is what a health endpoint or an alert reads. A growing failed
// count is the signal that something needs a human.
type Stats struct {
	Pending   int64
	Failed    int64
	OldestAge time.Duration
}

func ReadStats(ctx context.Context, db DBTX) (Stats, error) {
	var s Stats
	var oldestSeconds *float64

	err := db.QueryRow(ctx, `
		SELECT
			count(*) FILTER (WHERE status = 'pending'),
			count(*) FILTER (WHERE status = 'failed'),
			EXTRACT(EPOCH FROM (now() - min(created_at) FILTER (WHERE status = 'pending')))
		FROM jobs.outbox`).Scan(&s.Pending, &s.Failed, &oldestSeconds)
	if err != nil {
		return Stats{}, fmt.Errorf("outbox: read stats: %w", err)
	}
	if oldestSeconds != nil {
		s.OldestAge = time.Duration(*oldestSeconds * float64(time.Second))
	}
	return s, nil
}

// Purge removes dispatched rows older than the retention window. They
// are kept for a while on purpose: when someone asks "did that job ever
// run", the outbox is the only place with the answer.
func Purge(ctx context.Context, db DBTX, olderThan time.Duration) (int64, error) {
	tag, err := db.Exec(ctx, `
		DELETE FROM jobs.outbox
		WHERE status = 'dispatched' AND dispatched_at < now() - $1::interval`,
		olderThan.String())
	if err != nil {
		return 0, fmt.Errorf("outbox: purge: %w", err)
	}
	return tag.RowsAffected(), nil
}
