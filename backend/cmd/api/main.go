// cmd/api is the HTTP server. It wires the platform layer (db, redis,
// storage, sms, ratelimit) and each module's repo -> service -> handler
// stack, then mounts every module's routes under /api/v1 on one chi
// router.
//
// This file is also where the module graph is made explicit. Modules
// never import each other's storage; they declare narrow interfaces for
// what they need, and this is the only place that knows which concrete
// service satisfies which interface. Read the wiring below as the
// dependency diagram from 04-architecture.md:
//
//	catalog  <- media, library, commerce, kids, home   (reads)
//	commerce <- media (entitlement), catalog (ownership badge)
//	kids     <- media (playback veto), identity (service registry)
//	library  <- commerce (subscription hours), catalog (popularity)
//
// chi/v5 was picked specifically so this binary can serve audio with
// correct HTTP Range behavior — see media.Handler.
package main

import (
	"context"
	"log"
	"log/slog"
	"net/http"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	chimiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"

	"ketapod/internal/catalog"
	"ketapod/internal/commerce"
	"ketapod/internal/home"
	"ketapod/internal/identity"
	"ketapod/internal/ingest"
	"ketapod/internal/kids"
	"ketapod/internal/library"
	"ketapod/internal/media"
	"ketapod/internal/platform/apiversion"
	"ketapod/internal/platform/config"
	"ketapod/internal/platform/db"
	"ketapod/internal/platform/httpkit"
	"ketapod/internal/platform/ratelimit"
	platformredis "ketapod/internal/platform/redis"
	"ketapod/internal/platform/storage"
	"ketapod/internal/platform/telemetry"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("api: load config: %v", err)
	}

	logger := telemetry.NewLogger(cfg.LogLevel)
	slog.SetDefault(logger)

	pool, err := db.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("api: connect db: %v", err)
	}
	defer pool.Close()

	redisClient, err := platformredis.NewClient(ctx, cfg.RedisAddr, cfg.RedisPassword, cfg.RedisDB)
	if err != nil {
		log.Fatalf("api: connect redis: %v", err)
	}
	defer redisClient.Close()

	store, err := storage.New(ctx, storage.Config{
		Endpoint: cfg.S3Endpoint, Region: cfg.S3Region, Bucket: cfg.S3Bucket,
		AccessKey: cfg.S3AccessKey, SecretKey: cfg.S3SecretKey, UseSSL: cfg.S3UseSSL,
	})
	if err != nil {
		log.Fatalf("api: init storage: %v", err)
	}

	// A fresh object store has no bucket, and the first upload is not
	// the moment to find that out. It is a HEAD on every start and a
	// CREATE only once, so it costs nothing to do here rather than
	// leaving it to whoever happens to run the seeder.
	if err := store.EnsureBucket(ctx); err != nil {
		log.Fatalf("api: ensure bucket: %v", err)
	}

	// The API no longer talks to the queue directly. Background work is
	// written to jobs.outbox inside the same transaction as the data
	// that caused it, and cmd/worker's relay moves it into asynq — so a
	// job cannot be lost between the database write and the enqueue.
	limiter := ratelimit.New(redisClient)

	// catalog has no dependencies: it is the bottom of the graph.
	catalogSvc := catalog.NewService(catalog.NewRepository(pool))

	// commerce needs catalog for prices. Its ListeningReader (used only
	// by the refund rule) is wired after library exists.
	paymentProvider := commerce.NewStubProvider(cfg.PaymentCallbackURL)
	commerceRepo := commerce.NewRepository(pool)
	commerceSvc := commerce.NewService(commerceRepo, catalogSvc, nil, paymentProvider)

	// library needs catalog (book id for an edition, popularity) and
	// commerce (subscription hour accounting).
	librarySvc := library.NewService(library.NewRepository(pool), catalogSvc, commerceSvc, catalogSvc, true)

	// Close the commerce -> library edge now that library exists. The
	// refund rule needs to know how much of a book was actually heard,
	// and commerce must not read library.* tables to find out.
	commerceSvc = commerce.NewService(commerceRepo, catalogSvc, librarySvc, paymentProvider)

	// kids needs catalog (is the title kids-appropriate) and library
	// (how long has the child listened today).
	kidsSvc := kids.NewService(kids.NewRepository(pool), catalogSvc, kidsListening{lib: librarySvc}, cfg.Timezone)

	// media sits on top: it asks catalog for the edition, commerce for
	// entitlement, and kids for a veto, then decides what bytes to
	// serve. This is the one place all three meet.
	mediaSigner := media.NewSigner(cfg.JWTSecret, cfg.MediaURLTTL)
	mediaSvc := media.NewService(
		media.NewRepository(pool), store,
		catalogSvc, commerceSvc, kidsSvc,
		mediaSigner, cfg.PublicBaseURL,
	)

	identitySvc := identity.NewService(identity.NewRepository(pool), limiter, identity.Config{
		JWTSecret: cfg.JWTSecret, AccessTokenTTL: cfg.AccessTokenTTL, RefreshTokenTTL: cfg.RefreshTokenTTL,
		OTPCodeTTL: cfg.OTPCodeTTL, OTPCodeLength: cfg.OTPCodeLength, OTPMaxAttempts: cfg.OTPMaxAttempts,
		MaxActiveDevices: cfg.MaxActiveDevices,
	})

	homeSvc := home.NewService(home.NewRepository(pool), catalogSvc, mediaSvc)

	// ingest is the content-production panel. It sits beside the module
	// graph rather than inside it: it writes the AI service's work item,
	// the catalogue row and the dispatch job in one transaction, and
	// reads processing state straight from the tables the AI service
	// owns in this same database.
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

	// The authenticator re-checks account status behind every valid JWT,
	// so a suspended user loses access within the cache window rather
	// than when their access token happens to expire.
	authenticator := identity.NewAuthenticator(identitySvc, cfg.JWTSecret, redisClient)
	requireAuth := authenticator.Middleware()
	optionalAuth := httpkit.OptionalAuth(cfg.JWTSecret)
	requireAdmin := httpkit.RequireRole(identity.RoleAdmin)

	// The panel accepts either: the shared admin key, or a normal admin
	// JWT. With ADMIN_API_KEY unset only the JWT path exists.
	adminGate := httpkit.AdminKeyOr(cfg.AdminAPIKey, requireAuth, requireAdmin)

	identityHandler := identity.NewHandler(identitySvc, kidsSvc, logger)
	catalogHandler := catalog.NewHandler(catalogSvc, commerceSvc, mediaSvc, logger)
	mediaHandler := media.NewHandler(mediaSvc, logger)
	libraryHandler := library.NewHandler(librarySvc, logger)
	commerceHandler := commerce.NewHandler(commerceSvc, cfg.PaymentCallbackURL, logger)
	kidsHandler := kids.NewHandler(kidsSvc, logger)
	ingestHandler := ingest.NewHandler(ingestSvc, logger)
	homeHandler := home.NewHandler(homeSvc, limiter, logger)

	router := chi.NewRouter()
	router.Use(chimiddleware.RequestID)
	router.Use(chimiddleware.RealIP)
	router.Use(chimiddleware.Recoverer)
	router.Use(telemetry.RequestLogger(logger))
	// The timeout deliberately does NOT wrap the media stream: a long
	// audio file legitimately takes longer than any request timeout, and
	// cutting it off mid-stream looks to the listener like the app
	// crashing. The path is derived per version rather than written out,
	// so a new version does not silently lose the exemption.
	router.Use(skipPaths(chimiddleware.Timeout(30*time.Second), streamPrefixes()...))
	router.Use(cors.Handler(cors.Options{
		AllowedOrigins: cfg.CORSAllowedOrigins,
		AllowedMethods: []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		// X-Admin-Key is on this list for the same reason as the
		// others: a header the browser sends must be named here or the
		// preflight fails and the request never leaves the tab.
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Profile-Id", "Idempotency-Key", "X-Admin-Key"},
		AllowCredentials: false,
		MaxAge:           300,
	}))

	router.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		httpkit.JSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	// readyz differs from healthz on purpose: healthz says the process
	// is alive, readyz says it can actually serve. A load balancer that
	// only checks liveness happily routes traffic to an instance whose
	// database connection died.
	router.Get("/readyz", func(w http.ResponseWriter, r *http.Request) {
		checkCtx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()

		if err := pool.Ping(checkCtx); err != nil {
			httpkit.Error(w, http.StatusServiceUnavailable, "db_unavailable", "")
			return
		}
		if err := redisClient.Ping(checkCtx).Err(); err != nil {
			httpkit.Error(w, http.StatusServiceUnavailable, "redis_unavailable", "")
			return
		}
		httpkit.JSON(w, http.StatusOK, map[string]string{"status": "ready"})
	})

	// Routes are mounted per version. v2 will be a second Route block
	// with its own handlers — the versions coexist in one binary rather
	// than one replacing the other, because clients on Cafe Bazaar
	// update late and cannot be cut off on a deploy.
	router.Route(apiversion.V1.Prefix(), func(api chi.Router) {
		identityHandler.Routes(api, requireAuth)
		homeHandler.Routes(api)
		catalogHandler.Routes(api, optionalAuth)
		mediaHandler.Routes(api, optionalAuth)
		libraryHandler.Routes(api, requireAuth)
		commerceHandler.Routes(api, requireAuth, requireAdmin)
		kidsHandler.Routes(api, requireAuth)
		ingestHandler.Routes(api, adminGate)
	})

	// A caller asking for a version this build does not serve gets a
	// clear answer instead of a bare 404 that looks like a broken route.
	router.Get("/api/{version}/*", unsupportedVersion)

	srv := &http.Server{
		Addr:              ":" + strconv.Itoa(cfg.HTTPPort),
		Handler:           router,
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		logger.Info("api: listening",
			slog.Int("port", cfg.HTTPPort),
			slog.String("env", cfg.Env),
			slog.String("payment_provider", paymentProvider.Name()),
		)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("api: listen: %v", err)
		}
	}()

	<-ctx.Done()
	logger.Info("api: shutting down")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		logger.Error("api: shutdown error", slog.String("error", err.Error()))
	}
}

func streamPrefixes() []string {
	prefixes := make([]string, 0, len(apiversion.Supported))
	for _, v := range apiversion.Supported {
		prefixes = append(prefixes, v.Path("media/stream/"))
	}
	return prefixes
}

func unsupportedVersion(w http.ResponseWriter, r *http.Request) {
	requested := chi.URLParam(r, "version")
	if apiversion.IsSupported(requested) {
		httpkit.Error(w, http.StatusNotFound, "not_found", "")
		return
	}
	httpkit.JSON(w, http.StatusGone, map[string]any{
		"status":    "unsupported_api_version",
		"message":   "این نسخه API پشتیبانی نمی‌شود",
		"requested": requested,
		"supported": apiversion.Supported,
		"current":   apiversion.Current,
	})
}

// skipPaths applies mw to every request except those under one of the
// given path prefixes.
func skipPaths(mw func(http.Handler) http.Handler, prefixes ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		wrapped := mw(next)
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			for _, prefix := range prefixes {
				if len(r.URL.Path) >= len(prefix) && r.URL.Path[:len(prefix)] == prefix {
					next.ServeHTTP(w, r)
					return
				}
			}
			wrapped.ServeHTTP(w, r)
		})
	}
}
