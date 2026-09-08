package outbox

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/hibiken/asynq"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Enqueuer is asynq's client, narrowed so the relay can be tested
// without Redis.
type Enqueuer interface {
	Enqueue(task *asynq.Task, opts ...asynq.Option) (*asynq.TaskInfo, error)
}

type RelayConfig struct {
	// Interval is the idle poll period. The relay does not wait for it
	// when it finds a full batch — a backlog drains at whatever rate the
	// queue accepts, not one batch per tick.
	Interval  time.Duration
	BatchSize int
	// MaxDispatchAttempts before a row is parked as 'failed'. This is
	// dispatch attempts (getting the job *into* Redis), which is
	// separate from asynq's own retry of the job itself.
	MaxDispatchAttempts int
	// Retention keeps dispatched rows around as an audit trail.
	Retention time.Duration
}

func (c RelayConfig) withDefaults() RelayConfig {
	if c.Interval <= 0 {
		c.Interval = 2 * time.Second
	}
	if c.BatchSize <= 0 {
		c.BatchSize = 100
	}
	if c.MaxDispatchAttempts <= 0 {
		c.MaxDispatchAttempts = 10
	}
	if c.Retention <= 0 {
		c.Retention = 7 * 24 * time.Hour
	}
	return c
}

// Relay moves pending outbox rows into asynq.
type Relay struct {
	pool     *pgxpool.Pool
	enqueuer Enqueuer
	log      *slog.Logger
	cfg      RelayConfig
}

func NewRelay(pool *pgxpool.Pool, enqueuer Enqueuer, log *slog.Logger, cfg RelayConfig) *Relay {
	return &Relay{pool: pool, enqueuer: enqueuer, log: log, cfg: cfg.withDefaults()}
}

// Run blocks until ctx is cancelled. It is started by cmd/worker.
func (r *Relay) Run(ctx context.Context) error {
	r.log.Info("outbox: relay started",
		slog.Duration("interval", r.cfg.Interval),
		slog.Int("batch_size", r.cfg.BatchSize))

	ticker := time.NewTicker(r.cfg.Interval)
	defer ticker.Stop()

	purgeTicker := time.NewTicker(time.Hour)
	defer purgeTicker.Stop()

	for {
		// Drain fully before sleeping. A backlog after an outage should
		// clear in seconds, not at one batch every two seconds.
		for {
			dispatched, err := r.DispatchBatch(ctx)
			if err != nil {
				r.log.ErrorContext(ctx, "outbox: dispatch batch failed", slog.String("error", err.Error()))
				break
			}
			if dispatched < r.cfg.BatchSize {
				break
			}
		}

		select {
		case <-ctx.Done():
			r.log.Info("outbox: relay stopping")
			return nil
		case <-purgeTicker.C:
			if n, err := Purge(ctx, r.pool, r.cfg.Retention); err != nil {
				r.log.ErrorContext(ctx, "outbox: purge failed", slog.String("error", err.Error()))
			} else if n > 0 {
				r.log.InfoContext(ctx, "outbox: purged dispatched rows", slog.Int64("count", n))
			}
			r.reportStats(ctx)
		case <-ticker.C:
		}
	}
}

// DispatchBatch claims and enqueues one batch. Exported so a test can
// drive it directly instead of racing a background loop.
func (r *Relay) DispatchBatch(ctx context.Context) (int, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	records, err := Claim(ctx, tx, r.cfg.BatchSize)
	if err != nil {
		return 0, err
	}
	if len(records) == 0 {
		return 0, nil
	}

	dispatched := 0
	for _, record := range records {
		task := asynq.NewTask(record.TaskType, record.Payload, asynq.MaxRetry(record.MaxRetry))

		if _, err := r.enqueuer.Enqueue(task, asynq.Queue(record.Queue)); err != nil {
			r.log.WarnContext(ctx, "outbox: enqueue failed, will retry",
				slog.String("task_type", record.TaskType),
				slog.String("outbox_id", record.ID),
				slog.Int("attempts", record.Attempts),
				slog.String("error", err.Error()))

			if markErr := MarkAttemptFailed(ctx, tx, record.ID, err, r.cfg.MaxDispatchAttempts); markErr != nil {
				return dispatched, markErr
			}
			continue
		}

		if err := MarkDispatched(ctx, tx, record.ID); err != nil {
			return dispatched, err
		}
		dispatched++
	}

	if err := tx.Commit(ctx); err != nil {
		// The rows stay pending and get re-dispatched. That is the
		// at-least-once edge this design accepts, and why handlers are
		// written to be idempotent.
		return 0, err
	}
	return dispatched, nil
}

func (r *Relay) reportStats(ctx context.Context) {
	stats, err := ReadStats(ctx, r.pool)
	if err != nil {
		r.log.ErrorContext(ctx, "outbox: read stats failed", slog.String("error", err.Error()))
		return
	}

	level := slog.LevelInfo
	// A non-zero failed count, or a job that has been waiting far longer
	// than the poll interval, means something needs a human. Logging it
	// at ERROR is the cheapest possible alert until Prometheus is wired.
	if stats.Failed > 0 || stats.OldestAge > 15*time.Minute {
		level = slog.LevelError
	}
	r.log.LogAttrs(ctx, level, "outbox: health",
		slog.Int64("pending", stats.Pending),
		slog.Int64("failed", stats.Failed),
		slog.Duration("oldest_pending_age", stats.OldestAge))
}

// AsynqErrorHandler logs every task failure, and shouts when a task has
// exhausted its retries and is about to be archived.
//
// Without this, asynq moves a dead task to its archive silently: the job
// really is lost and nobody finds out. This is the second half of "no
// job is ever missed" — the outbox guarantees a job reaches the queue,
// this guarantees somebody hears about it if it dies there.
func AsynqErrorHandler(log *slog.Logger) asynq.ErrorHandler {
	return asynq.ErrorHandlerFunc(func(ctx context.Context, task *asynq.Task, err error) {
		retried, _ := asynq.GetRetryCount(ctx)
		maxRetry, _ := asynq.GetMaxRetry(ctx)

		attrs := []slog.Attr{
			slog.String("task_type", task.Type()),
			slog.Int("retried", retried),
			slog.Int("max_retry", maxRetry),
			slog.String("error", err.Error()),
		}

		if retried >= maxRetry {
			log.LogAttrs(ctx, slog.LevelError,
				"worker: task exhausted retries and was archived", attrs...)
			return
		}
		if errors.Is(err, context.Canceled) {
			log.LogAttrs(ctx, slog.LevelWarn, "worker: task canceled on shutdown", attrs...)
			return
		}
		log.LogAttrs(ctx, slog.LevelWarn, "worker: task failed, will retry", attrs...)
	})
}
