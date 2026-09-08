package identity_test

import (
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"ketapod/internal/identity"
	"ketapod/internal/platform/httpkit"
)

func TestGenerateOTPCode(t *testing.T) {
	t.Run("produces the requested number of digits", func(t *testing.T) {
		for _, length := range []int{4, 5, 6, 8} {
			code, err := identity.GenerateOTPCode(length)
			require.NoError(t, err)
			require.Len(t, code, length)
			require.Equal(t, code, strings.Map(digitsOnly, code), "code must be numeric: %q", code)
		}
	})

	t.Run("does not repeat itself", func(t *testing.T) {
		// This gates account access. A predictable code is a login
		// bypass, so crypto/rand is not a stylistic choice — and a
		// generator that collides constantly would show up here.
		seen := make(map[string]struct{}, 200)
		for range 200 {
			code, err := identity.GenerateOTPCode(6)
			require.NoError(t, err)
			seen[code] = struct{}{}
		}
		require.Greater(t, len(seen), 150, "200 six-digit codes should be nearly all distinct")
	})
}

func TestHashOTPCode(t *testing.T) {
	// Codes are compared by hash so the plaintext never sits in the
	// database where a dump would expose in-flight logins.
	require.Equal(t, identity.HashOTPCode("12345"), identity.HashOTPCode("12345"))
	require.NotEqual(t, identity.HashOTPCode("12345"), identity.HashOTPCode("12346"))
	require.NotContains(t, identity.HashOTPCode("12345"), "12345")
}

func TestOpaqueRefreshToken(t *testing.T) {
	plaintext, hash, err := identity.GenerateOpaqueToken()
	require.NoError(t, err)

	require.NotEmpty(t, plaintext)
	require.NotEqual(t, plaintext, hash, "the stored value must not be the value handed to the client")
	require.Equal(t, hash, identity.HashOpaqueToken(plaintext))

	t.Run("two tokens never collide", func(t *testing.T) {
		other, _, err := identity.GenerateOpaqueToken()
		require.NoError(t, err)
		require.NotEqual(t, plaintext, other)
	})

	t.Run("the plaintext is URL-safe", func(t *testing.T) {
		// Refresh tokens travel in JSON bodies today but end up in
		// headers and query strings in clients we do not control.
		require.NotContains(t, plaintext, "+")
		require.NotContains(t, plaintext, "/")
		require.NotContains(t, plaintext, "=")
	})
}

func TestAccessTokenRoundTrip(t *testing.T) {
	const secret = "test-secret"

	token, err := identity.IssueAccessToken(secret, "user-1", identity.RoleAdmin, 15*time.Minute)
	require.NoError(t, err)

	t.Run("verifies with the right secret and carries subject and role", func(t *testing.T) {
		claims, err := httpkit.ParseAccessToken(secret, token)
		require.NoError(t, err)
		require.Equal(t, "user-1", claims.UserID)
		require.Equal(t, identity.RoleAdmin, claims.Role)
	})

	t.Run("is rejected under a different secret", func(t *testing.T) {
		_, err := httpkit.ParseAccessToken("other-secret", token)
		require.Error(t, err)
	})

	t.Run("an expired token is rejected", func(t *testing.T) {
		expired, err := identity.IssueAccessToken(secret, "user-1", identity.RoleUser, -time.Minute)
		require.NoError(t, err)
		_, err = httpkit.ParseAccessToken(secret, expired)
		require.Error(t, err)
	})

	t.Run("a token signed with 'none' is rejected", func(t *testing.T) {
		// The classic JWT forgery: strip the algorithm. ParseAccessToken
		// pins HS256 for exactly this reason.
		forged := "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0." +
			"eyJzdWIiOiJ1c2VyLTEiLCJyb2xlIjoiYWRtaW4ifQ."
		_, err := httpkit.ParseAccessToken(secret, forged)
		require.Error(t, err)
	})
}

func TestUserHasRole(t *testing.T) {
	// A publisher who also listens has role='user' plus a 'publisher'
	// row. Checking only one of the two gets the answer wrong.
	u := identity.User{Role: identity.RoleUser, Roles: []string{identity.RolePublisher}}

	require.True(t, u.HasRole(identity.RoleUser), "primary role counts")
	require.True(t, u.HasRole(identity.RolePublisher), "additive roles count")
	require.False(t, u.HasRole(identity.RoleAdmin))
}

func TestUserIsActive(t *testing.T) {
	require.True(t, identity.User{Status: identity.StatusActive}.IsActive())
	require.False(t, identity.User{Status: identity.StatusSuspended}.IsActive())
	require.False(t, identity.User{Status: identity.StatusDeleted}.IsActive())
	require.False(t, identity.User{}.IsActive(), "an unset status is not active")
}

func digitsOnly(r rune) rune {
	if r >= '0' && r <= '9' {
		return r
	}
	return -1
}
