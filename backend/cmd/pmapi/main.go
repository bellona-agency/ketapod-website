// cmd/pmapi is the HTTP server for the team's internal
// project-management tool.
//
// It is a second binary rather than a route group on cmd/api, and that
// is the whole point: the tool the team uses to coordinate must not be
// able to take the customer API down, and — the direction that actually
// bites — a bad afternoon on the customer API must not take away the
// board the team is using to fix it. They share the platform layer and
// the Postgres instance; they share no process, no port, no JWT secret
// and no deploy.
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"log/slog"
	"net/http"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	chimiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"

	"ketapod/internal/platform/apiversion"
	"ketapod/internal/platform/config"
	"ketapod/internal/platform/db"
	"ketapod/internal/platform/httpkit"
	"ketapod/internal/platform/mailer"
	platformredis "ketapod/internal/platform/redis"
	"ketapod/internal/platform/storage"
	"ketapod/internal/platform/telemetry"
	"ketapod/internal/pm"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	cfg, err := config.LoadPM()
	if err != nil {
		log.Fatalf("pmapi: load config: %v", err)
	}

	logger := telemetry.NewLogger(cfg.LogLevel)
	slog.SetDefault(logger)

	pool, err := db.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("pmapi: connect db: %v", err)
	}
	defer pool.Close()

	redisClient, err := platformredis.NewClient(ctx, cfg.RedisAddr, cfg.RedisPassword, cfg.RedisDB)
	if err != nil {
		log.Fatalf("pmapi: connect redis: %v", err)
	}
	defer redisClient.Close()

	store, err := storage.New(ctx, storage.Config{
		Endpoint: cfg.S3Endpoint, Region: cfg.S3Region, Bucket: cfg.S3Bucket,
		AccessKey: cfg.S3AccessKey, SecretKey: cfg.S3SecretKey, UseSSL: cfg.S3UseSSL,
	})
	if err != nil {
		log.Fatalf("pmapi: init storage: %v", err)
	}
	if err := store.EnsureBucket(ctx); err != nil {
		log.Fatalf("pmapi: ensure bucket: %v", err)
	}

	// With no SMTP host configured the invite mail is written to the
	// log instead of sent. That is a supported way to run this — the
	// invite endpoint returns the link in its response either way — and
	// it means a fresh environment does not need a mail account before
	// the first person can log in.
	var mail mailer.Sender = mailer.NewLogSender(logger)
	mailEnabled := cfg.SMTPHost != ""
	if mailEnabled {
		mail = mailer.NewSMTPSender(mailer.Config{
			Host: cfg.SMTPHost, Port: cfg.SMTPPort,
			Username: cfg.SMTPUsername, Password: cfg.SMTPPassword,
			From: cfg.SMTPFrom, FromName: cfg.SMTPFromName,
			StartTLS: cfg.SMTPStartTLS,
		}, logger)
	}

	service := pm.NewService(pm.NewRepository(pool), store, mail, pm.Config{
		JWTSecret:       cfg.JWTSecret,
		AccessTokenTTL:  cfg.AccessTokenTTL,
		RefreshTokenTTL: cfg.RefreshTokenTTL,
		InviteTTL:       cfg.InviteTTL,
		AppBaseURL:      cfg.AppBaseURL,
		MailEnabled:     mailEnabled,
	}, logger)

	authenticator := pm.NewAuthenticator(service, cfg.JWTSecret, redisClient)
	handler := pm.NewHandler(service, authenticator, logger)

	router := chi.NewRouter()
	router.Use(chimiddleware.RequestID)
	router.Use(chimiddleware.RealIP)
	router.Use(chimiddleware.Recoverer)
	router.Use(telemetry.RequestLogger(logger))

	// The timeout skips the notification stream. SSE connections are
	// meant to stay open for as long as the tab is; a request timeout
	// would cut them every thirty seconds and turn the bell into a
	// reconnect loop.
	streamPath := apiversion.Current.Path("notifications/stream")
	router.Use(skipPath(chimiddleware.Timeout(30*time.Second), streamPath))

	router.Use(cors.Handler(cors.Options{
		AllowedOrigins:   cfg.CORSAllowedOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	router.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		if err := pool.Ping(r.Context()); err != nil {
			httpkit.Error(w, http.StatusServiceUnavailable, "unhealthy", "دیتابیس در دسترس نیست")
			return
		}
		httpkit.JSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	router.Route(apiversion.Current.Prefix(), handler.Routes)

	server := &http.Server{
		Addr:    fmt.Sprintf(":%d", cfg.HTTPPort),
		Handler: router,
		// No WriteTimeout: it would cap the SSE stream regardless of
		// the middleware exemption above, because it is enforced by the
		// server rather than per-route.
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	go func() {
		logger.Info("pmapi: listening", slog.Int("port", cfg.HTTPPort), slog.String("env", cfg.Env))
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("pmapi: serve: %v", err)
		}
	}()

	<-ctx.Done()
	logger.Info("pmapi: shutting down")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		logger.Error("pmapi: shutdown", slog.String("error", err.Error()))
	}
}

// skipPath applies a middleware everywhere except one exact path.
func skipPath(middleware func(http.Handler) http.Handler, path string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		wrapped := middleware(next)
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == path {
				next.ServeHTTP(w, r)
				return
			}
			wrapped.ServeHTTP(w, r)
		})
	}
}
