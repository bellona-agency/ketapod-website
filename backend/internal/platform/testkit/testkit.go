// Package testkit boots the real Postgres and Redis that integration
// tests run against.
//
// One container per test binary, not per test: starting Postgres costs
// seconds, and a suite that pays that cost per test stops being run.
// Schema isolation comes from TruncateAll between tests instead, which
// is milliseconds.
//
// 04-architecture.md picked testcontainers precisely so integration
// tests exercise the real database: half of what this backend gets wrong
// would be invisible against a fake — advisory locks, ON CONFLICT
// targets, generated columns, trigram matching and last-write-wins
// upserts have no meaningful in-memory equivalent.
package testkit

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
	"github.com/redis/go-redis/v9"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"
	tcredis "github.com/testcontainers/testcontainers-go/modules/redis"
)

var (
	pgOnce    sync.Once
	pgPool    *pgxpool.Pool
	pgConnStr string
	pgErr     error

	redisOnce   sync.Once
	redisClient *redis.Client
	redisErr    error
)

// migrationsDir is relative to the package under test. Integration tests
// live one or two directories deep under the repo root, so callers pass
// their own path when it differs.
const defaultMigrationsDir = "../../migrations"

// Postgres returns a pooled connection to a migrated database, starting
// the container on first use.
func Postgres(t *testing.T) *pgxpool.Pool {
	t.Helper()
	return PostgresWithMigrations(t, defaultMigrationsDir)
}

func PostgresWithMigrations(t *testing.T, migrationsDir string) *pgxpool.Pool {
	t.Helper()

	pgOnce.Do(func() {
		ctx := context.Background()

		container, err := tcpostgres.Run(ctx, "postgres:16-alpine",
			tcpostgres.WithDatabase("ketapod"),
			tcpostgres.WithUsername("ketapod"),
			tcpostgres.WithPassword("ketapod"),
		)
		if err != nil {
			pgErr = fmt.Errorf("start postgres container: %w", err)
			return
		}

		connStr, err := container.ConnectionString(ctx, "sslmode=disable")
		if err != nil {
			pgErr = fmt.Errorf("postgres connection string: %w", err)
			return
		}
		pgConnStr = connStr

		if err := waitForPostgres(connStr); err != nil {
			pgErr = err
			return
		}
		if err := runMigrations(connStr, migrationsDir); err != nil {
			pgErr = err
			return
		}

		pool, err := pgxpool.New(ctx, connStr)
		if err != nil {
			pgErr = fmt.Errorf("postgres pool: %w", err)
			return
		}
		pgPool = pool
	})

	if pgErr != nil {
		t.Fatalf("testkit: postgres unavailable: %v\n%s", pgErr, dockerHint())
	}
	return pgPool
}

func PostgresConnString(t *testing.T) string {
	t.Helper()
	Postgres(t)
	return pgConnStr
}

// Redis returns a client to a running Redis, starting it on first use.
func Redis(t *testing.T) *redis.Client {
	t.Helper()

	redisOnce.Do(func() {
		ctx := context.Background()

		container, err := tcredis.Run(ctx, "redis:7-alpine")
		if err != nil {
			redisErr = fmt.Errorf("start redis container: %w", err)
			return
		}

		connStr, err := container.ConnectionString(ctx)
		if err != nil {
			redisErr = fmt.Errorf("redis connection string: %w", err)
			return
		}
		parsed, err := url.Parse(connStr)
		if err != nil {
			redisErr = fmt.Errorf("parse redis url: %w", err)
			return
		}

		// The forwarded port can accept connections a moment after the
		// container reports ready under colima's Virtualization.framework
		// driver — a host networking quirk no container-side wait
		// strategy can fix.
		deadline := time.Now().Add(20 * time.Second)
		for {
			client := redis.NewClient(&redis.Options{Addr: parsed.Host})
			if err := client.Ping(ctx).Err(); err == nil {
				redisClient = client
				return
			} else if time.Now().After(deadline) {
				redisErr = fmt.Errorf("redis never became reachable: %w", err)
				return
			}
			_ = client.Close()
			time.Sleep(300 * time.Millisecond)
		}
	})

	if redisErr != nil {
		t.Fatalf("testkit: redis unavailable: %v\n%s", redisErr, dockerHint())
	}

	// Each test gets a clean keyspace; the rate limiter in particular
	// carries state that would otherwise leak between tests and make
	// failures depend on execution order.
	if err := redisClient.FlushAll(context.Background()).Err(); err != nil {
		t.Fatalf("testkit: flush redis: %v", err)
	}
	return redisClient
}

// truncatedSchemas is every application schema. A migration that adds a
// new one must add it here too, or its rows leak between tests.
var truncatedSchemas = []string{
	"identity", "catalog", "media", "commerce", "home", "library", "kids", "jobs",
}

// TruncateAll empties every application table, leaving the schema in
// place. RESTART IDENTITY and CASCADE together mean a test never has to
// know the foreign-key order.
func TruncateAll(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()

	ctx := context.Background()
	rows, err := pool.Query(ctx, `
		SELECT schemaname, tablename FROM pg_tables
		WHERE schemaname = ANY($1::text[])`, truncatedSchemas)
	if err != nil {
		t.Fatalf("testkit: list tables: %v", err)
	}
	defer rows.Close()

	var tables []string
	for rows.Next() {
		var schema, table string
		if err := rows.Scan(&schema, &table); err != nil {
			t.Fatalf("testkit: scan table name: %v", err)
		}
		tables = append(tables, fmt.Sprintf("%s.%s", schema, table))
	}
	if len(tables) == 0 {
		return
	}

	stmt := "TRUNCATE " + join(tables, ", ") + " RESTART IDENTITY CASCADE"
	if _, err := pool.Exec(ctx, stmt); err != nil {
		t.Fatalf("testkit: truncate: %v", err)
	}

	assertNoUntruncatedSchema(t, pool)
}

// assertNoUntruncatedSchema fails loudly when a migration adds a schema
// that TruncateAll does not know about.
//
// This is not hypothetical: adding jobs.outbox without updating the list
// above let outbox rows leak between tests, and the symptom was two
// tests that passed alone and failed together — the most expensive kind
// of test failure to diagnose.
func assertNoUntruncatedSchema(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()

	rows, err := pool.Query(context.Background(), `
		SELECT DISTINCT schemaname FROM pg_tables
		WHERE schemaname NOT IN ('pg_catalog', 'information_schema', 'public')
		  AND schemaname <> ALL($1::text[])`, truncatedSchemas)
	if err != nil {
		t.Fatalf("testkit: check schemas: %v", err)
	}
	defer rows.Close()

	var unknown []string
	for rows.Next() {
		var schema string
		if err := rows.Scan(&schema); err != nil {
			t.Fatalf("testkit: scan schema: %v", err)
		}
		unknown = append(unknown, schema)
	}
	if len(unknown) > 0 {
		t.Fatalf("testkit: schema(s) %v are not truncated between tests; add them to truncatedSchemas", unknown)
	}
}

func join(parts []string, sep string) string {
	out := ""
	for i, p := range parts {
		if i > 0 {
			out += sep
		}
		out += p
	}
	return out
}

func runMigrations(connStr, dir string) error {
	db, err := sql.Open("pgx", connStr)
	if err != nil {
		return fmt.Errorf("open db for migrations: %w", err)
	}
	defer db.Close()

	if err := goose.SetDialect("postgres"); err != nil {
		return fmt.Errorf("goose dialect: %w", err)
	}
	goose.SetLogger(goose.NopLogger())
	if err := goose.Up(db, dir); err != nil {
		return fmt.Errorf("goose up: %w", err)
	}
	return nil
}

func waitForPostgres(connStr string) error {
	deadline := time.Now().Add(30 * time.Second)
	var lastErr error
	for time.Now().Before(deadline) {
		db, err := sql.Open("pgx", connStr)
		if err == nil {
			lastErr = db.Ping()
			_ = db.Close()
			if lastErr == nil {
				return nil
			}
		} else {
			lastErr = err
		}
		time.Sleep(300 * time.Millisecond)
	}
	return fmt.Errorf("database never became reachable: %w", lastErr)
}

// dockerHint surfaces the two environment problems that actually happen
// on this project's dev machines, so a failing suite says what to do
// instead of only that Docker was unreachable.
func dockerHint() string {
	hint := "integration tests need Docker. Run `make docker-up` or start colima."
	if os.Getenv("TESTCONTAINERS_RYUK_DISABLED") == "" {
		hint += "\nOn colima with the Virtualization.framework driver the Ryuk reaper" +
			" cannot bind-mount the docker socket; export TESTCONTAINERS_RYUK_DISABLED=true."
	}
	if os.Getenv("DOCKER_HOST") == "" {
		hint += "\nIf colima is the runtime, export DOCKER_HOST=\"unix://$HOME/.colima/default/docker.sock\"."
	}
	return hint
}
