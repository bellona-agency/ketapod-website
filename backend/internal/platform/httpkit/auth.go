package httpkit

import (
	"context"
	"crypto/subtle"
	"net/http"
	"strings"

	"github.com/golang-jwt/jwt/v5"
)

type ctxKey int

const (
	ctxKeyUserID ctxKey = iota
	ctxKeyRole
	ctxKeyProfileID
)

// HeaderProfileID is the super-app shell's active-profile header from
// 03-product-surfaces.md. The shell sends it on every request so the
// backend can enforce kids policy independently — "if it lives in the
// frontend, one of the three clients forgets it one day"
// (08-decisions.md). Nothing downstream may trust it blindly: it names
// a profile, it does not prove ownership, so kids.Service always
// re-checks the profile belongs to the authenticated parent.
const HeaderProfileID = "X-Profile-Id"

type AccessClaims struct {
	UserID string `json:"sub"`
	Role   string `json:"role"`
	jwt.RegisteredClaims
}

// ParseAccessToken is the single place a JWT is verified. RequireAuth
// wraps it for the mandatory case; OptionalAuth for endpoints that serve
// both anonymous and signed-in callers (the book page, a preview
// stream), where a missing token is a valid state rather than an error.
func ParseAccessToken(secret, token string) (*AccessClaims, error) {
	claims := &AccessClaims{}
	parsed, err := jwt.ParseWithClaims(token, claims, func(t *jwt.Token) (any, error) {
		return []byte(secret), nil
	}, jwt.WithValidMethods([]string{"HS256"}))
	if err != nil {
		return nil, err
	}
	if !parsed.Valid {
		return nil, jwt.ErrTokenInvalidClaims
	}
	return claims, nil
}

func bearerToken(r *http.Request) (string, bool) {
	header := r.Header.Get("Authorization")
	token, ok := strings.CutPrefix(header, "Bearer ")
	if !ok || token == "" {
		return "", false
	}
	return token, true
}

// RequireAuth parses a Bearer access token, verifies it against secret,
// and stashes the subject/role in the request context. Modules that need
// the caller's identity read it back with UserIDFromContext — this is
// the only place a JWT gets parsed, so token format changes touch one
// file, not every handler.
func RequireAuth(secret string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token, ok := bearerToken(r)
			if !ok {
				Error(w, http.StatusUnauthorized, "unauthorized", "توکن احراز هویت یافت نشد")
				return
			}

			claims, err := ParseAccessToken(secret, token)
			if err != nil {
				Error(w, http.StatusUnauthorized, "unauthorized", "توکن نامعتبر یا منقضی‌شده است")
				return
			}

			next.ServeHTTP(w, r.WithContext(withIdentity(r.Context(), claims, r)))
		})
	}
}

// OptionalAuth attaches identity when a valid token is present and
// silently continues when it is not. An invalid token is also treated as
// anonymous rather than rejected: these endpoints have a meaningful
// anonymous behaviour (preview, public catalog), and failing the whole
// request because a stale token sat in localStorage would break the
// page for a visitor who never asked to be signed in.
func OptionalAuth(secret string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token, ok := bearerToken(r)
			if !ok {
				next.ServeHTTP(w, r.WithContext(withProfile(r.Context(), r)))
				return
			}
			claims, err := ParseAccessToken(secret, token)
			if err != nil {
				next.ServeHTTP(w, r.WithContext(withProfile(r.Context(), r)))
				return
			}
			next.ServeHTTP(w, r.WithContext(withIdentity(r.Context(), claims, r)))
		})
	}
}

// RequireRole gates a route on the caller's primary role. It runs after
// RequireAuth and expects the role claim to already be in context.
func RequireRole(roles ...string) func(http.Handler) http.Handler {
	allowed := make(map[string]struct{}, len(roles))
	for _, role := range roles {
		allowed[role] = struct{}{}
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			role, _ := RoleFromContext(r.Context())
			if _, ok := allowed[role]; !ok {
				Error(w, http.StatusForbidden, "forbidden", "دسترسی لازم را ندارید")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func withIdentity(ctx context.Context, claims *AccessClaims, r *http.Request) context.Context {
	ctx = context.WithValue(ctx, ctxKeyUserID, claims.UserID)
	ctx = context.WithValue(ctx, ctxKeyRole, claims.Role)
	return withProfile(ctx, r)
}

func withProfile(ctx context.Context, r *http.Request) context.Context {
	if profileID := r.Header.Get(HeaderProfileID); profileID != "" {
		ctx = context.WithValue(ctx, ctxKeyProfileID, profileID)
	}
	return ctx
}

func UserIDFromContext(ctx context.Context) (string, bool) {
	v, ok := ctx.Value(ctxKeyUserID).(string)
	return v, ok && v != ""
}

func RoleFromContext(ctx context.Context) (string, bool) {
	v, ok := ctx.Value(ctxKeyRole).(string)
	return v, ok
}

// ProfileIDFromContext returns the active child profile id, if the
// client declared one. An empty string means "the account holder is
// listening", which is a different policy path, not a missing value.
func ProfileIDFromContext(ctx context.Context) string {
	v, _ := ctx.Value(ctxKeyProfileID).(string)
	return v
}

// WithUserID is for tests and for internal callers that already know the
// identity (a worker acting on a user's behalf) and would otherwise have
// to fabricate an HTTP request to build the context.
func WithUserID(ctx context.Context, userID string) context.Context {
	return context.WithValue(ctx, ctxKeyUserID, userID)
}

func WithProfileID(ctx context.Context, profileID string) context.Context {
	return context.WithValue(ctx, ctxKeyProfileID, profileID)
}

// AdminKeyOr admits a request that carries the shared admin key, and
// otherwise falls through to the JWT chain.
//
// The key exists for the internal content-production panel: the people
// who upload books are two or three teammates on a tool that is not
// public, and putting them through OTP login plus a manual role grant
// before they can test the AI pipeline buys no security we do not
// already have from not exposing the panel. The JWT path stays wired,
// so an admin account works the same way it does everywhere else, and
// an empty key disables the header path entirely — which is what
// production should run with.
func AdminKeyOr(key string, fallback ...func(http.Handler) http.Handler) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		chained := next
		// Applied in reverse so the first middleware in the list is the
		// outermost, matching how chi.Use reads.
		for i := len(fallback) - 1; i >= 0; i-- {
			chained = fallback[i](chained)
		}

		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if key != "" && subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Admin-Key")), []byte(key)) == 1 {
				next.ServeHTTP(w, r)
				return
			}
			chained.ServeHTTP(w, r)
		})
	}
}
