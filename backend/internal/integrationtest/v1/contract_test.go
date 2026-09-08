// Package v1 holds tests that belong to API version 1 specifically.
//
// The point of a per-version test package is that v2 gets its own,
// unchanged copy of v1's expectations. When a route changes shape
// between versions — and commerce will, once a real payment gateway
// replaces the stub — v1's tests keep asserting v1's behaviour instead
// of being edited to match the newest thing.
package v1

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	"gopkg.in/yaml.v3"

	"ketapod/internal/platform/apiversion"
)

// contract is the minimum of the OpenAPI document these tests read.
type contract struct {
	Paths map[string]map[string]struct {
		OperationID string `yaml:"operationId"`
		Tags        []string
	} `yaml:"paths"`
	Components struct {
		Schemas    map[string]any `yaml:"schemas"`
		Parameters map[string]any `yaml:"parameters"`
	} `yaml:"components"`
}

func loadContract(t *testing.T) contract {
	t.Helper()

	// Tests run from their own directory; the contract path is relative
	// to the repository root.
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", apiversion.V1.ContractPath()))
	require.NoError(t, err, "v1 contract must live at %s", apiversion.V1.ContractPath())

	var c contract
	require.NoError(t, yaml.Unmarshal(raw, &c))
	require.NotEmpty(t, c.Paths)
	return c
}

func TestV1IsMountedWhereItSaysItIs(t *testing.T) {
	require.Equal(t, "/api/v1", apiversion.V1.Prefix())
	require.Equal(t, "/api/v1/catalog/books", apiversion.V1.Path("catalog/books"))
	require.Equal(t, "/api/v1/catalog/books", apiversion.V1.Path("/catalog/books"),
		"a leading slash on the route must not double up")

	require.Equal(t, "https://api.ketapod.ir/api/v1/payments/callback",
		apiversion.V1.URL("https://api.ketapod.ir", "payments/callback"))
	require.Equal(t, "https://api.ketapod.ir/api/v1/payments/callback",
		apiversion.V1.URL("https://api.ketapod.ir/", "payments/callback"),
		"a trailing slash on the base URL must not double up")
}

func TestV1IsStillSupported(t *testing.T) {
	// v1 leaves Supported only when the clients pinned to it are gone.
	// In a market where Cafe Bazaar users update late, that is a
	// deliberate, dated decision — not a side effect of shipping v2.
	require.True(t, apiversion.IsSupported("v1"))
	require.False(t, apiversion.IsSupported("v2"), "update this test when v2 ships")
	require.False(t, apiversion.IsSupported(""))
	require.Contains(t, apiversion.Supported, apiversion.Current)
}

// Every operation needs a stable operationId, because that is the name
// the generated TypeScript and Dart clients expose. Renaming one is a
// breaking change to two clients that no compiler will catch on our
// side — so the set is pinned here.
func TestEveryOperationHasAStableID(t *testing.T) {
	c := loadContract(t)

	seen := map[string]string{}
	for path, methods := range c.Paths {
		for method, op := range methods {
			require.NotEmpty(t, op.OperationID,
				"%s %s has no operationId; generated clients would name it something arbitrary", method, path)

			if previous, dup := seen[op.OperationID]; dup {
				t.Fatalf("operationId %q is used by both %s and %s %s", op.OperationID, previous, method, path)
			}
			seen[op.OperationID] = method + " " + path

			require.NotEmpty(t, op.Tags, "%s %s has no tag; generated clients group by tag", method, path)
		}
	}
	require.Greater(t, len(seen), 50, "the contract should describe the whole surface, not a subset")
}

// Paths in the document are relative to the version prefix, which the
// server adds. A path that writes the prefix into the document itself
// would be served at /api/v1/api/v1/... — an easy mistake to make when
// copying an example from a doc.
func TestContractPathsAreVersionRelative(t *testing.T) {
	c := loadContract(t)

	for path := range c.Paths {
		require.True(t, strings.HasPrefix(path, "/"), "path %q must start with a slash", path)
		require.False(t, strings.HasPrefix(path, "/api/"),
			"path %q must be relative to the version prefix, which the server adds", path)
		require.NotContains(t, path, "//", "path %q has a doubled slash", path)
	}
}

// The endpoints that must never require authentication, because the
// caller genuinely has no token: pages Google indexes, and the payment
// callback, which arrives from the bank rather than from the app.
func TestPublicSurfaceStaysPublic(t *testing.T) {
	c := loadContract(t)

	mustExistAndBeGettable := []string{
		"/public/home/stats",
		"/public/home/demo",
		"/public/home/localization",
		"/public/home/social-proof",
		"/public/leads/options",
		"/public/subscription-plans",
		"/catalog/books",
		"/catalog/search",
		"/catalog/books/{slug}",
		"/payments/callback",
		"/media/stream/{assetId}",
	}

	for _, path := range mustExistAndBeGettable {
		methods, ok := c.Paths[path]
		require.True(t, ok, "%s disappeared from the v1 contract", path)
		require.Contains(t, methods, "get", "%s must answer GET", path)
	}
}

// The routes the landing page calls. It is already deployed and cannot
// be redeployed in step with the API, so these are frozen for v1.
func TestLandingPageContractIsFrozen(t *testing.T) {
	c := loadContract(t)

	for _, path := range []string{
		"/public/home/stats",
		"/public/home/demo",
		"/public/home/audio-items/{bookId}",
		"/public/home/localization",
		"/public/home/social-proof",
		"/public/leads/options",
		"/public/leads",
	} {
		require.Contains(t, c.Paths, path,
			"%s is used by the deployed landing page; removing it in v1 breaks a page we cannot redeploy in lockstep", path)
	}

	require.Contains(t, c.Paths["/public/leads"], "post")
}
