// Package ratelimit implements a Redis-backed fixed-window limiter.
// Used ahead of OTP request (SMS is a real cost per send, and an
// unlimited endpoint is a free SMS bomb) and lead submission (07-api-contract.md
// flags IP-based rate limiting as missing and required before launch).
package ratelimit

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

type Limiter struct {
	client *redis.Client
}

func New(client *redis.Client) *Limiter {
	return &Limiter{client: client}
}

// Allow reports whether the caller identified by key may proceed under a
// fixed-window limit of max requests per window. It increments first and
// checks second, so a burst that lands exactly on the limit is allowed.
func (l *Limiter) Allow(ctx context.Context, key string, max int64, window time.Duration) (bool, error) {
	redisKey := fmt.Sprintf("ratelimit:%s", key)

	count, err := l.client.Incr(ctx, redisKey).Result()
	if err != nil {
		return false, fmt.Errorf("ratelimit: incr: %w", err)
	}
	if count == 1 {
		if err := l.client.Expire(ctx, redisKey, window).Err(); err != nil {
			return false, fmt.Errorf("ratelimit: expire: %w", err)
		}
	}

	return count <= max, nil
}
