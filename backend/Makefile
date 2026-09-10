SHELL := /bin/bash
-include .env
export

.PHONY: build run-api run-worker run-scheduler run-pmapi \
	migrate-up migrate-down migrate-status migrate-create \
	sqlc-generate oapi-generate api-docs generate \
	seed test test-unit test-integration tidy \
	docker-up docker-down docker-logs docker-app docker-pm

build:
	go build ./...

run-api:
	go run ./cmd/api

# ابزار داخلی مدیریت پروژه. باینری جداست تا افتادنش هیچ ربطی به API
# مشتری‌ها نداشته باشد و برعکس — docs/11-pm-tool.md
run-pmapi:
	go run ./cmd/pmapi

run-worker:
	go run ./cmd/worker

run-scheduler:
	go run ./cmd/scheduler

migrate-up:
	go run ./cmd/migrate up

migrate-down:
	go run ./cmd/migrate down

migrate-status:
	go run ./cmd/migrate status

migrate-create:
	cd migrations && goose create $(name) sql

sqlc-generate:
	sqlc generate

# یک هدف به‌ازای هر نسخه. افزودن v2 یعنی یک خط اینجا، نه بازنویسی.
oapi-generate:
	oapi-codegen -config api/v1/oapi-codegen.server.yaml api/v1/openapi.yaml

# سند خوانا از خود قرارداد ساخته می‌شود تا جدول endpointها نتواند از کد
# جدا بیفتد. فقط متن سرآیند دستی است.
api-docs:
	python3 scripts/gen_api_docs.py v1

generate: sqlc-generate oapi-generate api-docs

seed:
	go run ./cmd/seed

# Integration tests start a real Postgres and Redis with testcontainers.
# The two exports below are colima-specific and harmless elsewhere: the
# Virtualization.framework driver cannot bind-mount the socket the Ryuk
# reaper needs, and testcontainers does not look in colima's socket path
# on its own. See README.
TESTCONTAINERS_ENV := TESTCONTAINERS_RYUK_DISABLED=true \
	DOCKER_HOST=$${DOCKER_HOST:-unix://$$HOME/.colima/default/docker.sock}

test:
	$(TESTCONTAINERS_ENV) go test ./... -count=1

# Unit tests only: pure business rules, no containers, no Docker needed.
# Coupon arithmetic, kids policy, streaks, the preview Range clamp,
# stream-token signing and Persian normalization all live here.
test-unit:
	go test -count=1 $$(go list ./internal/... | grep -v 'integrationtest$$')

# تست‌های مخصوص یک نسخه API: قرارداد در برابر روترِ واقعی.
# دیتابیس لازم ندارد، پس در CI روی هر push اجرا می‌شود.
test-contract:
	go test -count=1 ./internal/integrationtest/v1/

test-integration:
	$(TESTCONTAINERS_ENV) go test ./internal/integrationtest/ -count=1 -v

tidy:
	go mod tidy

# فایل compose در ریشه پروژه است، نه اینجا: یک استک واحد برای بک، فرانت و
# زیرساخت. بدون profile فقط زیرساخت بالا می‌آید — همان چیزی که برای اجرای
# Go روی ماشین خودت لازم است.
COMPOSE := docker compose -f ../docker-compose.yml

docker-up:
	$(COMPOSE) up -d

docker-down:
	$(COMPOSE) down

docker-logs:
	$(COMPOSE) logs -f

# کل استک داخل داکر، شامل API، worker، scheduler و وب.
docker-app:
	$(COMPOSE) --profile app up -d --build

# تخته کارها. پروفایل جدا چون ابزار تیم است، نه محصول.
docker-pm:
	$(COMPOSE) --profile pm up -d --build
