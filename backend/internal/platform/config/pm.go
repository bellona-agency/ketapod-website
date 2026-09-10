package config

import (
	"fmt"
	"strings"
	"time"
)

// PMConfig is the internal project-management tool's environment.
//
// It is a separate loader rather than more fields on Config because
// Load's production guardrails are the customer API's: it refuses to
// start with the stub payment gateway, and the pm binary has no payment
// gateway at all. Sharing the struct would mean either weakening those
// checks or configuring a payment provider for a Kanban board.
//
// Everything the two genuinely share — database, Redis, object storage —
// is read from the same variable names, so one .env still runs the whole
// stack.
type PMConfig struct {
	Env      string
	HTTPPort int

	DatabaseURL string

	RedisAddr     string
	RedisPassword string
	RedisDB       int

	S3Endpoint  string
	S3Region    string
	S3Bucket    string
	S3AccessKey string
	S3SecretKey string
	S3UseSSL    bool

	// JWTSecret is deliberately its own variable. If the tool signed
	// with the customer API's secret, a token minted for a listener
	// would be accepted as a teammate's — the subject is just a uuid,
	// and nothing in the claim says which user table it came from.
	JWTSecret string

	AccessTokenTTL  time.Duration
	RefreshTokenTTL time.Duration
	InviteTTL       time.Duration

	// AppBaseURL is the tool's own frontend origin. Invite links are
	// built from it and are opened from an email client, so it has to be
	// absolute.
	AppBaseURL         string
	CORSAllowedOrigins []string

	SMTPHost     string
	SMTPPort     int
	SMTPUsername string
	SMTPPassword string
	SMTPFrom     string
	SMTPFromName string
	SMTPStartTLS bool

	Timezone string
	LogLevel string
}

func LoadPM() (PMConfig, error) {
	cfg := PMConfig{
		Env:      getEnv("APP_ENV", "development"),
		HTTPPort: getEnvInt("PM_HTTP_PORT", 8090),

		DatabaseURL:   getEnv("DATABASE_URL", ""),
		RedisAddr:     getEnv("REDIS_ADDR", "localhost:6379"),
		RedisPassword: getEnv("REDIS_PASSWORD", ""),
		// A different logical database from the customer API's, so
		// flushing one cache never empties the other's.
		RedisDB: getEnvInt("PM_REDIS_DB", 1),

		S3Endpoint:  getEnv("S3_ENDPOINT", "localhost:9000"),
		S3Region:    getEnv("S3_REGION", "us-east-1"),
		S3Bucket:    getEnv("S3_BUCKET", "ketapod-media"),
		S3AccessKey: getEnv("S3_ACCESS_KEY", "ketapod"),
		S3SecretKey: getEnv("S3_SECRET_KEY", "ketapod-secret"),
		S3UseSSL:    getEnvBool("S3_USE_SSL", false),

		JWTSecret: getEnv("PM_JWT_SECRET", ""),
		// Longer than the customer API's fifteen minutes. This is a
		// desktop tool people keep open all day, and a token that
		// expires while a form is half-filled costs a lost draft.
		AccessTokenTTL:  getEnvDuration("PM_ACCESS_TOKEN_TTL", time.Hour),
		RefreshTokenTTL: getEnvDuration("PM_REFRESH_TOKEN_TTL", 30*24*time.Hour),
		InviteTTL:       getEnvDuration("PM_INVITE_TTL", 7*24*time.Hour),

		AppBaseURL:         getEnv("PM_APP_BASE_URL", "http://localhost:3001"),
		CORSAllowedOrigins: splitAndTrim(getEnv("PM_CORS_ALLOWED_ORIGINS", "*")),

		SMTPHost:     getEnv("SMTP_HOST", ""),
		SMTPPort:     getEnvInt("SMTP_PORT", 587),
		SMTPUsername: getEnv("SMTP_USERNAME", ""),
		SMTPPassword: getEnv("SMTP_PASSWORD", ""),
		SMTPFrom:     getEnv("SMTP_FROM", ""),
		SMTPFromName: getEnv("SMTP_FROM_NAME", "کتاپاد"),
		SMTPStartTLS: getEnvBool("SMTP_STARTTLS", true),

		Timezone: getEnv("TIMEZONE", "Asia/Tehran"),
		LogLevel: getEnv("LOG_LEVEL", "info"),
	}

	if cfg.DatabaseURL == "" {
		return cfg, fmt.Errorf("config: DATABASE_URL is required")
	}

	if cfg.JWTSecret == "" {
		if cfg.Env == "production" {
			return cfg, fmt.Errorf("config: PM_JWT_SECRET is required in production")
		}
		cfg.JWTSecret = "dev-only-insecure-pm-secret-change-me"
	}

	if cfg.Env == "production" {
		switch {
		case len(cfg.CORSAllowedOrigins) == 1 && cfg.CORSAllowedOrigins[0] == "*":
			return cfg, fmt.Errorf("config: PM_CORS_ALLOWED_ORIGINS must be an explicit allowlist in production")
		case strings.HasPrefix(cfg.AppBaseURL, "http://"):
			return cfg, fmt.Errorf("config: PM_APP_BASE_URL must be https in production")
		// Sharing the secret would make a listener's access token valid
		// here. The check is cheap and the mistake is invisible.
		case cfg.JWTSecret == getEnv("JWT_SECRET", ""):
			return cfg, fmt.Errorf("config: PM_JWT_SECRET must differ from JWT_SECRET")
		}
	}

	return cfg, nil
}
