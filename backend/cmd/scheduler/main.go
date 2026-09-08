// cmd/scheduler runs asynq's cron scheduler.
//
// It enqueues periodic work rather than doing it: the scheduler is a
// single process (two would double-run every job), while the workers
// that actually execute the tasks can scale horizontally.
package main

import (
	"log"
	"log/slog"
	"time"

	"github.com/hibiken/asynq"

	"ketapod/internal/commerce"
	"ketapod/internal/ingest"
	"ketapod/internal/platform/config"
	"ketapod/internal/platform/telemetry"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("scheduler: load config: %v", err)
	}

	logger := telemetry.NewLogger(cfg.LogLevel)
	slog.SetDefault(logger)

	scheduler := asynq.NewScheduler(
		asynq.RedisClientOpt{Addr: cfg.RedisAddr, Password: cfg.RedisPassword, DB: cfg.RedisDB},
		&asynq.SchedulerOpts{
			// Cron expressions are evaluated in the family's timezone
			// for the same reason every other calendar boundary is: a
			// "daily" job that fires at 20:30 local time is not daily to
			// anyone reading the report.
			Location: mustLoadLocation(cfg.Timezone),
		},
	)

	entries := []struct {
		spec, taskType, queue string
	}{
		// One job renews and then expires, in that order. As two
		// separate schedules they raced, and the loser was always the
		// user whose subscription lapsed instead of renewing.
		//
		// Running every 15 minutes rather than hourly shortens the
		// window a missed run leaves behind; the grace window in
		// commerce.DefaultRenewalWindow is what actually recovers it.
		{"@every 15m", commerce.TaskTypeReconcileSubscriptions, "critical"},

		// Narrations produced by the AI service become playable
		// editions here. Every two minutes is a compromise: the sweep
		// is a single indexed query when there is nothing to do, and an
		// editor who just uploaded a book should not have to wait a
		// quarter of an hour to hear it. It runs on the low queue
		// because joining audio must never delay a subscription
		// renewal.
		{"@every 2m", ingest.TaskTypeSyncAudio, "low"},
	}

	for _, entry := range entries {
		id, err := scheduler.Register(entry.spec, asynq.NewTask(entry.taskType, nil), asynq.Queue(entry.queue))
		if err != nil {
			log.Fatalf("scheduler: register %s: %v", entry.taskType, err)
		}
		logger.Info("scheduler: registered",
			slog.String("task", entry.taskType), slog.String("spec", entry.spec), slog.String("entry_id", id))
	}

	logger.Info("scheduler: starting", slog.String("redis_addr", cfg.RedisAddr))
	if err := scheduler.Run(); err != nil {
		log.Fatalf("scheduler: run: %v", err)
	}
}

func mustLoadLocation(name string) *time.Location {
	loc, err := time.LoadLocation(name)
	if err != nil {
		log.Fatalf("scheduler: unknown timezone %q: %v", name, err)
	}
	return loc
}
