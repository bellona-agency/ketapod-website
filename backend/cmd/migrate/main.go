// cmd/migrate runs goose migrations against DATABASE_URL. It exists as
// its own binary (rather than only a `goose` CLI invocation from the
// Makefile) so migrations can run from a plain `go run` in any
// environment that has Go but not the goose CLI — a deploy container,
// for instance.
package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"os"

	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
)

func main() {
	if len(os.Args) < 2 {
		log.Fatal("usage: migrate <up|down|status|redo> [args...]")
	}
	command := os.Args[1]

	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		log.Fatal("migrate: DATABASE_URL is required")
	}

	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		log.Fatalf("migrate: open db: %v", err)
	}
	defer db.Close()

	goose.SetBaseFS(nil)
	if err := goose.SetDialect("postgres"); err != nil {
		log.Fatalf("migrate: set dialect: %v", err)
	}

	if err := goose.RunContext(context.Background(), command, db, "migrations", os.Args[2:]...); err != nil {
		log.Fatal(fmt.Errorf("migrate: %s: %w", command, err))
	}
}
