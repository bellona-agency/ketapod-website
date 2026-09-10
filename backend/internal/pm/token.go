package pm

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/redis/go-redis/v9"

	"ketapod/internal/platform/httpkit"
)

// activeMemberCacheTTL bounds how long a disabled teammate keeps
// working with a token that was valid when it was issued. Same trade as
// identity's: without a cache every request costs an extra query, and
// without a limit a revoked account survives until its access token
// expires. Disabling a member clears the entry explicitly, so this
// window only applies to changes made straight in the database.
const activeMemberCacheTTL = 30 * time.Second

// opaqueTokenBytes is the size of refresh and invite tokens. 32 bytes
// of crypto/rand is 256 bits of entropy — these are bearer secrets that
// are never rate-limited by a password check, so they have to be
// unguessable on their own.
const opaqueTokenBytes = 32

var (
	ErrUnauthorized = errors.New("pm: unauthorized")
	ErrDisabled     = errors.New("pm: member disabled")
)

// newOpaqueToken returns the secret to hand out and the hash to store.
// The plaintext never reaches the database, so a dump of pm.sessions or
// pm.invites cannot be replayed.
func newOpaqueToken() (token, hash string, err error) {
	buf := make([]byte, opaqueTokenBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", "", fmt.Errorf("pm: read random: %w", err)
	}
	token = base64.RawURLEncoding.EncodeToString(buf)
	return token, hashToken(token), nil
}

// hashToken is SHA-256, not argon2: these tokens are already 256 bits of
// uniform randomness, so there is no dictionary to slow down, and the
// hash sits on the hot path of every refresh.
func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// issueAccessToken mints the short-lived JWT. The claim shape is
// httpkit.AccessClaims so the shared middleware parses it unchanged —
// the subject is a pm.members id rather than an identity.users id, and
// the signing secret is different, which is what keeps a token from one
// service from being accepted by the other.
func issueAccessToken(secret, memberID, role string, ttl time.Duration) (string, time.Time, error) {
	expires := time.Now().Add(ttl)
	claims := httpkit.AccessClaims{
		UserID: memberID,
		Role:   role,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   memberID,
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			ExpiresAt: jwt.NewNumericDate(expires),
			Issuer:    "ketapod-pm",
		},
	}
	signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(secret))
	if err != nil {
		return "", time.Time{}, fmt.Errorf("pm: sign access token: %w", err)
	}
	return signed, expires, nil
}

// Authenticator turns a bearer token into the Member behind it, and
// rejects anyone whose account stopped being active since the token was
// signed.
type Authenticator struct {
	svc    *Service
	secret string
	cache  *redis.Client
}

func NewAuthenticator(svc *Service, secret string, cache *redis.Client) *Authenticator {
	return &Authenticator{svc: svc, secret: secret, cache: cache}
}

type memberCtxKey struct{}

func (a *Authenticator) Middleware() func(http.Handler) http.Handler {
	base := httpkit.RequireAuth(a.secret)
	return func(next http.Handler) http.Handler {
		return base(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			memberID, _ := httpkit.UserIDFromContext(r.Context())

			member, err := a.resolve(r.Context(), memberID)
			switch {
			case errors.Is(err, ErrDisabled):
				httpkit.Error(w, http.StatusForbidden, "account_disabled", "حساب شما غیرفعال شده است")
				return
			case err != nil:
				httpkit.Error(w, http.StatusUnauthorized, "unauthorized", "نشست معتبر نیست")
				return
			}

			ctx := context.WithValue(r.Context(), memberCtxKey{}, member)
			next.ServeHTTP(w, r.WithContext(ctx))
		}))
	}
}

// RequireWrite rejects viewers. It runs inside Middleware, so the member
// is already in context.
func RequireWrite(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		member, ok := MemberFromContext(r.Context())
		if !ok || !member.CanWrite() {
			httpkit.Error(w, http.StatusForbidden, "forbidden", "دسترسی فقط‌خواندنی دارید")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// RequireAdmin gates member management and project creation.
func RequireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		member, ok := MemberFromContext(r.Context())
		if !ok || !member.CanAdmin() {
			httpkit.Error(w, http.StatusForbidden, "forbidden", "این کار نیاز به دسترسی مدیر دارد")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (a *Authenticator) resolve(ctx context.Context, memberID string) (Member, error) {
	if memberID == "" {
		return Member{}, ErrUnauthorized
	}

	cacheKey := "pm:active_member:" + memberID
	if a.cache != nil {
		if raw, err := a.cache.Get(ctx, cacheKey).Bytes(); err == nil {
			var cached Member
			if json.Unmarshal(raw, &cached) == nil {
				if cached.Status != StatusActive {
					return Member{}, ErrDisabled
				}
				return cached, nil
			}
		}
	}

	member, err := a.svc.EnsureActive(ctx, memberID)
	if err != nil {
		return Member{}, err
	}

	if a.cache != nil {
		if raw, mErr := json.Marshal(member); mErr == nil {
			// A cache write failure is not a request failure: the
			// authoritative check already passed.
			_ = a.cache.Set(ctx, cacheKey, raw, activeMemberCacheTTL).Err()
		}
	}
	return member, nil
}

// InvalidateMemberCache is called whenever a change must be visible
// now rather than within the cache window — disabling an account,
// changing a role, a password reset that should log other sessions out.
func (a *Authenticator) InvalidateMemberCache(ctx context.Context, memberID string) {
	if a.cache == nil {
		return
	}
	_ = a.cache.Del(ctx, "pm:active_member:"+memberID).Err()
}

// MemberFromContext returns the authenticated member. Handlers behind
// Authenticator.Middleware can rely on ok being true.
func MemberFromContext(ctx context.Context) (Member, bool) {
	member, ok := ctx.Value(memberCtxKey{}).(Member)
	return member, ok
}
