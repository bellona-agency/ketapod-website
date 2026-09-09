// Package redis wraps a go-redis client. One Redis instance, four jobs:
// cache, rate limiting, distributed locks, and the asynq queue backing
// store — asynq gets its own redis.RedisConnOpt built from the same
// address in cmd/worker and cmd/scheduler.
package redis

import (
	"context"
	"fmt"

	"github.com/redis/go-redis/v9"
)

func NewClient(ctx context.Context, addr, password string, db int) (*redis.Client, error) {
	client := redis.NewClient(&redis.Options{
		Addr:     addr,
		Password: password,
		DB:       db,
	})

	if err := client.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("redis: ping: %w", err)
	}

	return client, nil
}
