package identity

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/redis/go-redis/v9"

	"ketapod/internal/platform/httpkit"
)

// activeUserCacheTTL is the window in which a suspension is not yet
// visible to an in-flight session. Thirty seconds is the trade: without
// a cache every authenticated request costs two extra queries (user +
// roles); without a limit a banned user keeps access until their access
// token expires. Thirty seconds is short enough that moderation feels
// immediate and long enough that the cache does its job.
const activeUserCacheTTL = 30 * time.Second

// Authenticator wraps httpkit.RequireAuth with a database-backed check
// that the account is still active, and puts the resolved User in the
// request context so handlers don't re-fetch it.
type Authenticator struct {
	svc    *Service
	secret string
	cache  *redis.Client
}

func NewAuthenticator(svc *Service, secret string, cache *redis.Client) *Authenticator {
	return &Authenticator{svc: svc, secret: secret, cache: cache}
}

type userCtxKey struct{}

func (a *Authenticator) Middleware() func(http.Handler) http.Handler {
	base := httpkit.RequireAuth(a.secret)
	return func(next http.Handler) http.Handler {
		return base(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			userID, _ := httpkit.UserIDFromContext(r.Context())

			user, err := a.resolve(r.Context(), userID)
			switch {
			case errors.Is(err, ErrSuspended):
				httpkit.Error(w, http.StatusForbidden, "account_suspended", "حساب کاربری شما غیرفعال شده است")
				return
			case err != nil:
				httpkit.Error(w, http.StatusUnauthorized, "unauthorized", "کاربر یافت نشد")
				return
			}

			ctx := context.WithValue(r.Context(), userCtxKey{}, user)
			next.ServeHTTP(w, r.WithContext(ctx))
		}))
	}
}

func (a *Authenticator) resolve(ctx context.Context, userID string) (User, error) {
	if userID == "" {
		return User{}, ErrNotFound
	}

	cacheKey := "identity:active_user:" + userID
	if a.cache != nil {
		if raw, err := a.cache.Get(ctx, cacheKey).Bytes(); err == nil {
			var cached User
			if json.Unmarshal(raw, &cached) == nil {
				if !cached.IsActive() {
					return User{}, ErrSuspended
				}
				return cached, nil
			}
		}
	}

	user, err := a.svc.EnsureActive(ctx, userID)
	if err != nil {
		return User{}, err
	}

	if a.cache != nil {
		if raw, mErr := json.Marshal(user); mErr == nil {
			// A cache write failure must not fail the request: the cache
			// is a latency optimisation, and the authoritative check has
			// already succeeded.
			_ = a.cache.Set(ctx, cacheKey, raw, activeUserCacheTTL).Err()
		}
	}
	return user, nil
}

// UserFromContext returns the authenticated user resolved by
// Authenticator.Middleware. Handlers behind that middleware can rely on
// ok being true.
func UserFromContext(ctx context.Context) (User, bool) {
	user, ok := ctx.Value(userCtxKey{}).(User)
	return user, ok
}

// InvalidateUserCache is called after any change that must be visible
// immediately — suspension, role grant — so the 30s window does not
// apply to an admin action taken deliberately.
func (a *Authenticator) InvalidateUserCache(ctx context.Context, userID string) {
	if a.cache == nil {
		return
	}
	_ = a.cache.Del(ctx, "identity:active_user:"+userID).Err()
}
