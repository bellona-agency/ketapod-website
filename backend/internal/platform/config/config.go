// Package config loads process configuration from environment variables.
// Single source of truth: no viper, no config files — the twelve-factor
// way, since every binary (api, worker, scheduler, migrate, seed) reads
// the same environment in docker-compose.
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"ketapod/internal/platform/apiversion"
)

type Config struct {
	Env string

	HTTPPort int

	// PublicBaseURL is this API's own externally-reachable origin (e.g.
	// http://localhost:8080 in dev, https://api.ketapod.ir in prod).
	// media.Service needs it to build fully-qualified stream URLs —
	// a path-only URL resolves against whatever origin the browser's
	// current page is on, which breaks the moment API and frontend
	// aren't served from the same origin (true for every local dev
	// setup, where the frontend runs on its own port).
	PublicBaseURL string

	DatabaseURL string

	RedisAddr     string
	RedisPassword string
	RedisDB       int

	JWTSecret       string
	AccessTokenTTL  time.Duration
	RefreshTokenTTL time.Duration

	S3Endpoint  string
	S3Region    string
	S3Bucket    string
	S3AccessKey string
	S3SecretKey string
	S3UseSSL    bool

	OTPCodeTTL     time.Duration
	OTPCodeLength  int
	OTPMaxAttempts int

	// MaxActiveDevices caps concurrent playback. The devices table
	// exists for exactly this (04-architecture.md); without a number it
	// is only a push-token registry.
	MaxActiveDevices int

	// MediaURLTTL is how long a signed audio URL stays usable. Short
	// enough that a leaked URL is worthless quickly, long enough that a
	// listener does not lose playback mid-chapter on a slow connection.
	MediaURLTTL time.Duration

	// PaymentCallbackURL is where the gateway returns the user. It must
	// be an absolute, publicly reachable URL — the bank redirects the
	// browser there, so it is not resolvable relative to anything.
	PaymentCallbackURL string
	PaymentProvider    string

	// Timezone drives every calendar boundary the product has: the
	// daily kids limit, streak days, weekly reports. UTC would reset a
	// child's daily allowance at 03:30 local time.
	Timezone string

	// CORSAllowedOrigins is a real allowlist in production. A wildcard
	// is fine for a public read API but not once cookies or per-user
	// data are in play.
	CORSAllowedOrigins []string

	// AdminAPIKey unlocks the internal content-production panel without
	// an OTP login. Empty means the header path is off and only a JWT
	// with the admin role gets in — which is what production runs with.
	AdminAPIKey string

	// The AI service (OCR, text processing, summary, TTS, Ketabyar
	// ingestion) is a separate process that now shares this database.
	// Its address is configuration rather than code because its API is
	// still moving; aligning with it must not mean a redeploy of the
	// ingest pipeline.
	AIServiceBaseURL     string
	AIServiceProcessPath string
	AIServiceAPIKey      string
	AIServiceTimeout     time.Duration

	// The narrated edition the TTS output becomes. The voice id is the
	// one the rest of the system will see in sources[].voiceId, so it is
	// configuration rather than a literal buried in the pipeline.
	TTSVoiceID        string
	TTSVoiceName      string
	TTSPriceIRR       int64
	TTSPreviewSeconds int
	// FFmpegPath joins per-chapter narration into the single continuous
	// file the player expects.
	FFmpegPath string

	LogLevel string
}

func Load() (Config, error) {
	cfg := Config{
		Env:             getEnv("APP_ENV", "development"),
		HTTPPort:        getEnvInt("HTTP_PORT", 8080),
		PublicBaseURL:   getEnv("PUBLIC_BASE_URL", "http://localhost:8080"),
		DatabaseURL:     getEnv("DATABASE_URL", ""),
		RedisAddr:       getEnv("REDIS_ADDR", "localhost:6379"),
		RedisPassword:   getEnv("REDIS_PASSWORD", ""),
		RedisDB:         getEnvInt("REDIS_DB", 0),
		JWTSecret:       getEnv("JWT_SECRET", ""),
		AccessTokenTTL:  getEnvDuration("ACCESS_TOKEN_TTL", 15*time.Minute),
		RefreshTokenTTL: getEnvDuration("REFRESH_TOKEN_TTL", 30*24*time.Hour),
		S3Endpoint:      getEnv("S3_ENDPOINT", "localhost:9000"),
		S3Region:        getEnv("S3_REGION", "us-east-1"),
		S3Bucket:        getEnv("S3_BUCKET", "ketapod-media"),
		S3AccessKey:     getEnv("S3_ACCESS_KEY", "ketapod"),
		S3SecretKey:     getEnv("S3_SECRET_KEY", "ketapod-secret"),
		S3UseSSL:        getEnvBool("S3_USE_SSL", false),
		OTPCodeTTL:      getEnvDuration("OTP_CODE_TTL", 2*time.Minute),
		OTPCodeLength:   getEnvInt("OTP_CODE_LENGTH", 5),
		OTPMaxAttempts:  getEnvInt("OTP_MAX_ATTEMPTS", 5),

		MaxActiveDevices:   getEnvInt("MAX_ACTIVE_DEVICES", 5),
		MediaURLTTL:        getEnvDuration("MEDIA_URL_TTL", 30*time.Minute),
		PaymentProvider:    getEnv("PAYMENT_PROVIDER", "stub"),
		PaymentCallbackURL: getEnv("PAYMENT_CALLBACK_URL", ""),
		Timezone:           getEnv("TIMEZONE", "Asia/Tehran"),
		CORSAllowedOrigins: splitAndTrim(getEnv("CORS_ALLOWED_ORIGINS", "*")),

		AdminAPIKey:          getEnv("ADMIN_API_KEY", ""),
		AIServiceBaseURL:     getEnv("AI_SERVICE_BASE_URL", ""),
		AIServiceProcessPath: getEnv("AI_SERVICE_PROCESS_PATH", "/api/v1/books/{bookId}/process"),
		AIServiceAPIKey:      getEnv("AI_SERVICE_API_KEY", ""),
		AIServiceTimeout:     getEnvDuration("AI_SERVICE_TIMEOUT", 30*time.Second),

		TTSVoiceID:        getEnv("TTS_VOICE_ID", "voice_narrator_fa_ai"),
		TTSVoiceName:      getEnv("TTS_VOICE_NAME", "گوینده هوش مصنوعی"),
		TTSPriceIRR:       int64(getEnvInt("TTS_PRICE_IRR", 0)),
		TTSPreviewSeconds: getEnvInt("TTS_PREVIEW_SECONDS", 60),
		FFmpegPath:        getEnv("FFMPEG_PATH", "ffmpeg"),

		LogLevel: getEnv("LOG_LEVEL", "info"),
	}

	if cfg.PaymentCallbackURL == "" {
		// This URL is registered with the payment gateway and lives
		// outside our control once it is. Pinning it to a specific
		// version explicitly — rather than to whatever "current" happens
		// to be later — is deliberate: a version bump must not silently
		// change an address the bank has on file.
		cfg.PaymentCallbackURL = apiversion.V1.URL(cfg.PublicBaseURL, "payments/callback")
	}

	if cfg.DatabaseURL == "" {
		return cfg, fmt.Errorf("config: DATABASE_URL is required")
	}
	if cfg.JWTSecret == "" {
		if cfg.Env == "production" {
			return cfg, fmt.Errorf("config: JWT_SECRET is required in production")
		}
		cfg.JWTSecret = "dev-only-insecure-secret-change-me"
	}

	// Guardrails that only apply in production. Each of these is a
	// configuration mistake that is invisible until it costs money or
	// leaks data, so the process refuses to start instead.
	if cfg.Env == "production" {
		switch {
		case cfg.PaymentProvider == "stub":
			return cfg, fmt.Errorf("config: PAYMENT_PROVIDER must not be the stub gateway in production")
		case len(cfg.CORSAllowedOrigins) == 1 && cfg.CORSAllowedOrigins[0] == "*":
			return cfg, fmt.Errorf("config: CORS_ALLOWED_ORIGINS must be an explicit allowlist in production")
		case strings.HasPrefix(cfg.PublicBaseURL, "http://"):
			return cfg, fmt.Errorf("config: PUBLIC_BASE_URL must be https in production")
		// A shared key that unlocks book uploads is a password, and a
		// short one is a password that gets guessed. If it is set at
		// all in production it has to be long enough to be worth
		// having; leaving it empty (JWT-only) stays the default.
		case cfg.AdminAPIKey != "" && len(cfg.AdminAPIKey) < 32:
			return cfg, fmt.Errorf("config: ADMIN_API_KEY must be at least 32 characters in production")
		}
	}

	return cfg, nil
}

func splitAndTrim(raw string) []string {
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if trimmed := strings.TrimSpace(p); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

func getEnv(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	v, ok := os.LookupEnv(key)
	if !ok || v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return fallback
	}
	return n
}

func getEnvBool(key string, fallback bool) bool {
	v, ok := os.LookupEnv(key)
	if !ok || v == "" {
		return fallback
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return fallback
	}
	return b
}

func getEnvDuration(key string, fallback time.Duration) time.Duration {
	v, ok := os.LookupEnv(key)
	if !ok || v == "" {
		return fallback
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		return fallback
	}
	return d
}
