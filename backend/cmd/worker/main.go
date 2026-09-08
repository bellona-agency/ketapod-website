// cmd/worker runs the asynq task processor.
//
// Everything registered here is work that must not happen inside an HTTP
// request: an SMS send that depends on a flaky provider, an LLM call
// that takes seconds, a periodic sweep over subscriptions. The queue is
// asynq on the same Redis the API already needs for cache and rate
// limiting — one service, four jobs (08-decisions.md).
package main

import (
	"context"
	"log"
	"log/slog"
	"os/signal"
	"syscall"

	"github.com/hibiken/asynq"

	"ketapod/internal/catalog"
	"ketapod/internal/commerce"
	"ketapod/internal/identity"
	"ketapod/internal/ingest"
	"ketapod/internal/library"
	"ketapod/internal/platform/aigw"
	"ketapod/internal/platform/config"
	"ketapod/internal/platform/db"
	"ketapod/internal/platform/outbox"
	"ketapod/internal/platform/sms"
	"ketapod/internal/platform/storage"
	"ketapod/internal/platform/telemetry"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("worker: load config: %v", err)
	}

	logger := telemetry.NewLogger(cfg.LogLevel)
	slog.SetDefault(logger)

	pool, err := db.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("worker: connect db: %v", err)
	}
	defer pool.Close()

	smsSender := sms.NewStubSender(logger)
	aiProvider := aigw.NewNoopProvider()

	catalogSvc := catalog.NewService(catalog.NewRepository(pool))
	commerceRepo := commerce.NewRepository(pool)
	commerceSvc := commerce.NewService(commerceRepo, catalogSvc, nil, commerce.NewStubProvider(cfg.PaymentCallbackURL))
	// The worker consumes bookmark summaries rather than producing them,
	// so summary scheduling is off here — a failing summariser must not
	// queue itself again.
	librarySvc := library.NewService(library.NewRepository(pool), catalogSvc, commerceSvc, catalogSvc, false)

	// The worker is where the handoff to the AI service actually
	// happens: an HTTP call to another team's service must not sit
	// inside the upload request, and a failed call has to be retried
	// rather than lost.
	store, err := storage.New(ctx, storage.Config{
		Endpoint: cfg.S3Endpoint, Region: cfg.S3Region, Bucket: cfg.S3Bucket,
		AccessKey: cfg.S3AccessKey, SecretKey: cfg.S3SecretKey, UseSSL: cfg.S3UseSSL,
	})
	if err != nil {
		log.Fatalf("worker: init storage: %v", err)
	}

	// A fresh object store has no bucket, and the first upload is not
	// the moment to find that out. It is a HEAD on every start and a
	// CREATE only once, so it costs nothing to do here rather than
	// leaving it to whoever happens to run the seeder.
	if err := store.EnsureBucket(ctx); err != nil {
		log.Fatalf("worker: ensure bucket: %v", err)
	}

	ingestSvc := ingest.NewService(
		ingest.NewRepository(pool), store,
		ingest.NewAIClient(ingest.AIConfig{
			BaseURL:     cfg.AIServiceBaseURL,
			ProcessPath: cfg.AIServiceProcessPath,
			APIKey:      cfg.AIServiceAPIKey,
			Timeout:     cfg.AIServiceTimeout,
		}),
		ingest.AudioConfig{
			VoiceID:        cfg.TTSVoiceID,
			VoiceName:      cfg.TTSVoiceName,
			PriceIRR:       cfg.TTSPriceIRR,
			PreviewSeconds: cfg.TTSPreviewSeconds,
			FFmpegPath:     cfg.FFmpegPath,
		},
		cfg.PublicBaseURL,
	)

	mux := asynq.NewServeMux()
	mux.Handle(ingest.TaskTypeDispatch, &ingest.DispatchHandler{Svc: ingestSvc, Log: logger})
	mux.Handle(ingest.TaskTypeSyncAudio, &ingest.SyncAudioHandler{Svc: ingestSvc, Log: logger})
	mux.Handle(identity.TaskTypeSendOTP, &identity.SendOTPTaskHandler{Sender: smsSender})
	mux.Handle(library.TaskTypeSummarizeBookmark, &library.SummarizeBookmarkHandler{
		Svc:        librarySvc,
		Transcript: transcriptAdapter{catalog: catalogSvc},
		AI:         aiProvider,
	})

	mux.Handle(commerce.TaskTypeReconcileSubscriptions, &commerce.SubscriptionMaintenanceHandler{
		Svc: commerceSvc, Window: commerce.DefaultRenewalWindow, Log: logger,
	})

	redisOpt := asynq.RedisClientOpt{Addr: cfg.RedisAddr, Password: cfg.RedisPassword, DB: cfg.RedisDB}

	srv := asynq.NewServer(redisOpt, asynq.Config{
		Concurrency: 10,
		Logger:      asynqLogAdapter{logger},
		// Money-touching work jumps the queue ahead of best-effort
		// enrichment: a subscription renewal that runs late costs a
		// user their access, a bookmark summary that runs late costs
		// nothing.
		Queues: map[string]int{
			outbox.QueueCritical: 6,
			outbox.QueueDefault:  3,
			outbox.QueueLow:      1,
		},
		// Without this, asynq archives a task that has exhausted its
		// retries and says nothing. The job really is lost and nobody
		// finds out — which is the failure this whole change exists to
		// prevent.
		ErrorHandler: outbox.AsynqErrorHandler(logger),
	})

	// The relay is what makes the outbox work: it moves rows that were
	// committed alongside their domain data into the queue. It runs in
	// the worker rather than the API so the API stays a request/response
	// process with no background loops.
	relay := outbox.NewRelay(pool, asynq.NewClient(redisOpt), logger, outbox.RelayConfig{})

	relayDone := make(chan struct{})
	go func() {
		defer close(relayDone)
		if err := relay.Run(ctx); err != nil {
			logger.Error("worker: relay stopped", slog.String("error", err.Error()))
		}
	}()

	go func() {
		<-ctx.Done()
		// Stop accepting new work, then let in-flight handlers finish.
		srv.Shutdown()
	}()

	logger.Info("worker: starting", slog.String("redis_addr", cfg.RedisAddr))
	if err := srv.Run(mux); err != nil {
		log.Fatalf("worker: run: %v", err)
	}
	<-relayDone
}

// transcriptAdapter maps catalog's transcript window onto the shape
// library's summarizer declares, so neither module has to know the
// other's types. Same reasoning as cmd/api/adapters.go.
type transcriptAdapter struct {
	catalog *catalog.Service
}

func (a transcriptAdapter) TranscriptWindow(ctx context.Context, editionID string, from, to float64) ([]library.TranscriptSegmentText, error) {
	segments, err := a.catalog.TranscriptWindow(ctx, editionID, from, to)
	if err != nil {
		return nil, err
	}
	out := make([]library.TranscriptSegmentText, len(segments))
	for i, seg := range segments {
		out[i] = library.TranscriptSegmentText{Text: seg.Text}
	}
	return out, nil
}

// asynqLogAdapter routes asynq's internal logging through slog so worker
// logs are structured JSON like every other binary, not asynq's default
// plain-text format.
type asynqLogAdapter struct {
	log *slog.Logger
}

func (a asynqLogAdapter) Debug(args ...any) { a.log.Debug("asynq", slog.Any("args", args)) }
func (a asynqLogAdapter) Info(args ...any)  { a.log.Info("asynq", slog.Any("args", args)) }
func (a asynqLogAdapter) Warn(args ...any)  { a.log.Warn("asynq", slog.Any("args", args)) }
func (a asynqLogAdapter) Error(args ...any) { a.log.Error("asynq", slog.Any("args", args)) }
func (a asynqLogAdapter) Fatal(args ...any) { a.log.Error("asynq fatal", slog.Any("args", args)) }
