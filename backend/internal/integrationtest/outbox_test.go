package integrationtest

import (
	"context"
	"errors"
	"log/slog"
	"testing"
	"time"

	"github.com/hibiken/asynq"
	"github.com/stretchr/testify/require"

	"ketapod/internal/catalog"
	"ketapod/internal/commerce"
	"ketapod/internal/library"
	"ketapod/internal/platform/outbox"
	"ketapod/internal/platform/testkit"
)

// recordingEnqueuer stands in for asynq so the relay can be tested
// without Redis, and — more importantly — so a queue *outage* can be
// simulated on demand. That failure is the whole reason the outbox
// exists, and it cannot be provoked against a healthy Redis.
type recordingEnqueuer struct {
	tasks []*asynq.Task
	fail  error
}

func (e *recordingEnqueuer) Enqueue(task *asynq.Task, opts ...asynq.Option) (*asynq.TaskInfo, error) {
	if e.fail != nil {
		return nil, e.fail
	}
	e.tasks = append(e.tasks, task)
	return &asynq.TaskInfo{}, nil
}

func discardLogger() *slog.Logger {
	return slog.New(slog.DiscardHandler)
}

// The core claim: a job written inside a transaction that rolls back
// must not exist. Anything less and a failed operation still fires its
// side effects.
func TestOutboxJobSharesTheCallersTransaction(t *testing.T) {
	pool := newPool(t)
	ctx := context.Background()

	t.Run("a rolled-back transaction leaves no job", func(t *testing.T) {
		tx, err := pool.Begin(ctx)
		require.NoError(t, err)

		require.NoError(t, outbox.Write(ctx, tx, outbox.Task{
			Type: "test:never_happens", Payload: map[string]string{"k": "v"},
		}))
		require.NoError(t, tx.Rollback(ctx))

		var n int
		require.NoError(t, pool.QueryRow(ctx,
			`SELECT count(*) FROM jobs.outbox WHERE task_type = 'test:never_happens'`).Scan(&n))
		require.Equal(t, 0, n, "the job must die with the transaction that created it")
	})

	t.Run("a committed transaction leaves exactly one job", func(t *testing.T) {
		tx, err := pool.Begin(ctx)
		require.NoError(t, err)

		require.NoError(t, outbox.Write(ctx, tx, outbox.Task{
			Type: "test:happens", Payload: map[string]string{"k": "v"},
		}))
		require.NoError(t, tx.Commit(ctx))

		var n int
		require.NoError(t, pool.QueryRow(ctx,
			`SELECT count(*) FROM jobs.outbox WHERE task_type = 'test:happens' AND status = 'pending'`).Scan(&n))
		require.Equal(t, 1, n)
	})
}

func TestOutboxDeduplicatesPendingJobs(t *testing.T) {
	pool := newPool(t)
	ctx := context.Background()

	task := outbox.Task{Type: "test:dedupe", Payload: map[string]int{"n": 1}, DedupeKey: "same-thing"}
	require.NoError(t, outbox.Write(ctx, pool, task))
	require.NoError(t, outbox.Write(ctx, pool, task))
	require.NoError(t, outbox.Write(ctx, pool, task))

	var pending int
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT count(*) FROM jobs.outbox WHERE task_type = 'test:dedupe'`).Scan(&pending))
	require.Equal(t, 1, pending, "identical pending jobs collapse into one")

	t.Run("a different key is a different job", func(t *testing.T) {
		other := task
		other.DedupeKey = "another-thing"
		require.NoError(t, outbox.Write(ctx, pool, other))

		var n int
		require.NoError(t, pool.QueryRow(ctx,
			`SELECT count(*) FROM jobs.outbox WHERE task_type = 'test:dedupe'`).Scan(&n))
		require.Equal(t, 2, n)
	})
}

// This is the failure the outbox is for: Redis is down when the user
// acts. The job must survive and go out later, rather than being lost at
// the moment of the enqueue call.
func TestRelaySurvivesAQueueOutage(t *testing.T) {
	pool := newPool(t)
	ctx := context.Background()

	enqueuer := &recordingEnqueuer{fail: errors.New("redis: connection refused")}
	relay := outbox.NewRelay(pool, enqueuer, discardLogger(), outbox.RelayConfig{
		BatchSize: 10, MaxDispatchAttempts: 5,
	})

	require.NoError(t, outbox.Write(ctx, pool, outbox.Task{
		Type: "test:during_outage", Payload: map[string]string{"phone": "09120000001"},
	}))

	dispatched, err := relay.DispatchBatch(ctx)
	require.NoError(t, err)
	require.Equal(t, 0, dispatched, "nothing goes out while the queue is down")

	var status string
	var attempts int
	var lastError *string
	require.NoError(t, pool.QueryRow(ctx, `
		SELECT status, attempts, last_error FROM jobs.outbox
		WHERE task_type = 'test:during_outage'`).Scan(&status, &attempts, &lastError))

	require.Equal(t, "pending", status, "the job is still owed, not dropped")
	require.Equal(t, 1, attempts)
	require.NotNil(t, lastError)
	require.Contains(t, *lastError, "connection refused")

	t.Run("a failed attempt backs off instead of hot-looping", func(t *testing.T) {
		// Retrying flat out against a service that is already
		// struggling is how a blip becomes an outage.
		again, err := relay.DispatchBatch(ctx)
		require.NoError(t, err)
		require.Equal(t, 0, again, "the row is not due again yet")
	})

	t.Run("it goes out once the queue recovers", func(t *testing.T) {
		enqueuer.fail = nil
		// Clear the backoff the way the passage of time would.
		_, err := pool.Exec(ctx, `UPDATE jobs.outbox SET available_at = now()`)
		require.NoError(t, err)

		dispatched, err := relay.DispatchBatch(ctx)
		require.NoError(t, err)
		require.Equal(t, 1, dispatched)
		require.Len(t, enqueuer.tasks, 1)
		require.Equal(t, "test:during_outage", enqueuer.tasks[0].Type())

		var status string
		require.NoError(t, pool.QueryRow(ctx,
			`SELECT status FROM jobs.outbox WHERE task_type = 'test:during_outage'`).Scan(&status))
		require.Equal(t, "dispatched", status)
	})
}

// A job that can never be dispatched is parked as 'failed' rather than
// deleted. A row someone can look at is the difference between "no job
// is ever missed" and a claim nobody can check.
func TestRelayParksPermanentlyUndeliverableJobs(t *testing.T) {
	pool := newPool(t)
	ctx := context.Background()

	enqueuer := &recordingEnqueuer{fail: errors.New("permanent failure")}
	relay := outbox.NewRelay(pool, enqueuer, discardLogger(), outbox.RelayConfig{
		BatchSize: 10, MaxDispatchAttempts: 3,
	})

	require.NoError(t, outbox.Write(ctx, pool, outbox.Task{Type: "test:doomed"}))

	for range 3 {
		_, err := relay.DispatchBatch(ctx)
		require.NoError(t, err)
		_, err = pool.Exec(ctx, `UPDATE jobs.outbox SET available_at = now()`)
		require.NoError(t, err)
	}

	var status string
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT status FROM jobs.outbox WHERE task_type = 'test:doomed'`).Scan(&status))
	require.Equal(t, "failed", status)

	t.Run("health stats surface it", func(t *testing.T) {
		// This is what an alert reads. A silent failure is the thing
		// being prevented.
		stats, err := outbox.ReadStats(ctx, pool)
		require.NoError(t, err)
		require.Equal(t, int64(1), stats.Failed)
	})
}

func TestRelayDrainsABacklogAndPurgesOldRows(t *testing.T) {
	pool := newPool(t)
	ctx := context.Background()

	enqueuer := &recordingEnqueuer{}
	relay := outbox.NewRelay(pool, enqueuer, discardLogger(), outbox.RelayConfig{BatchSize: 5})

	for i := range 12 {
		require.NoError(t, outbox.Write(ctx, pool, outbox.Task{
			Type: "test:backlog", Payload: map[string]int{"i": i},
		}))
	}

	total := 0
	for range 5 {
		n, err := relay.DispatchBatch(ctx)
		require.NoError(t, err)
		total += n
		if n == 0 {
			break
		}
	}
	require.Equal(t, 12, total, "a backlog drains rather than trickling one batch per tick")

	t.Run("delayed jobs are not dispatched early", func(t *testing.T) {
		require.NoError(t, outbox.Write(ctx, pool, outbox.Task{
			Type: "test:later", AvailableAt: time.Now().Add(time.Hour),
		}))
		n, err := relay.DispatchBatch(ctx)
		require.NoError(t, err)
		require.Equal(t, 0, n)
	})

	t.Run("dispatched rows are kept as an audit trail, then purged", func(t *testing.T) {
		// Someone will eventually ask "did that job ever run". Until the
		// retention window passes, the outbox is the only answer.
		stats, err := outbox.ReadStats(ctx, pool)
		require.NoError(t, err)
		require.Equal(t, int64(0), stats.Failed)

		purged, err := outbox.Purge(ctx, pool, 24*time.Hour)
		require.NoError(t, err)
		require.Equal(t, int64(0), purged, "recent rows stay")

		_, err = pool.Exec(ctx, `UPDATE jobs.outbox SET dispatched_at = now() - interval '30 days'`)
		require.NoError(t, err)

		purged, err = outbox.Purge(ctx, pool, 24*time.Hour)
		require.NoError(t, err)
		require.Equal(t, int64(12), purged)
	})
}

// The end-to-end shape: a user action writes its job, the relay carries
// it, and the handler receives it. Nothing in between can drop it.
func TestBookmarkSummaryJobReachesTheQueue(t *testing.T) {
	pool := newPool(t)
	ctx := context.Background()
	f := newFixtures(t, pool)

	catalogSvc := catalog.NewService(catalog.NewRepository(pool))
	commerceSvc := commerce.NewService(commerce.NewRepository(pool), catalogSvc, nil,
		commerce.NewStubProvider("http://localhost/cb"))
	librarySvc := library.NewService(library.NewRepository(pool), catalogSvc, commerceSvc, catalogSvc, true)

	userID := f.user("09120000600")
	bookID := f.book(bookOpts{Slug: "outbox-book", Title: "کتاب صف"})
	editionID := f.edition(editionOpts{BookID: bookID, VoiceID: "v1", DurationSeconds: 600, WithAsset: true})

	bookmark, err := librarySvc.AddBookmark(ctx, userID, editionID, 120, "جای خوب")
	require.NoError(t, err)
	require.Equal(t, "pending", bookmark.SummaryStatus)

	enqueuer := &recordingEnqueuer{}
	relay := outbox.NewRelay(pool, enqueuer, discardLogger(), outbox.RelayConfig{BatchSize: 10})

	dispatched, err := relay.DispatchBatch(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, dispatched)
	require.Equal(t, library.TaskTypeSummarizeBookmark, enqueuer.tasks[0].Type())

	t.Run("re-bookmarking the same spot does not queue it twice", func(t *testing.T) {
		_, err := librarySvc.AddBookmark(ctx, userID, editionID, 120, "برچسب تازه")
		require.NoError(t, err)

		var n int
		require.NoError(t, pool.QueryRow(ctx, `
			SELECT count(*) FROM jobs.outbox
			WHERE task_type = $1 AND status = 'pending'`,
			library.TaskTypeSummarizeBookmark).Scan(&n))
		require.Equal(t, 1, n, "the first job is still pending, so the second is collapsed into it")
	})
}

var _ = testkit.Redis
