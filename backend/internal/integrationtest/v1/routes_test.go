package v1

import (
	"net/http"
	"sort"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/require"

	"ketapod/internal/catalog"
	"ketapod/internal/commerce"
	"ketapod/internal/home"
	"ketapod/internal/identity"
	"ketapod/internal/ingest"
	"ketapod/internal/kids"
	"ketapod/internal/library"
	"ketapod/internal/media"
	"ketapod/internal/platform/apiversion"
)

// mountedRoutes builds the real router and lists what it serves.
//
// The handlers are constructed with nil dependencies on purpose: Routes
// only registers method values, it never calls them, so this needs no
// database and runs in milliseconds. That matters — a contract check
// nobody runs because it is slow is a contract check that does not
// exist.
func mountedRoutes(t *testing.T) map[string]map[string]bool {
	t.Helper()

	passthrough := func(next http.Handler) http.Handler { return next }

	router := chi.NewRouter()
	router.Route(apiversion.V1.Prefix(), func(api chi.Router) {
		identity.NewHandler(nil, nil, nil).Routes(api, passthrough)
		home.NewHandler(nil, nil, nil).Routes(api)
		catalog.NewHandler(nil, nil, nil, nil).Routes(api, passthrough)
		media.NewHandler(nil, nil).Routes(api, passthrough)
		library.NewHandler(nil, nil).Routes(api, passthrough)
		commerce.NewHandler(nil, "", nil).Routes(api, passthrough, passthrough)
		kids.NewHandler(nil, nil).Routes(api, passthrough)
		ingest.NewHandler(nil, nil).Routes(api, passthrough)
	})

	routes := map[string]map[string]bool{}
	err := chi.Walk(router, func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		// chi reports the mounted path; strip the version prefix so it
		// lines up with the contract, which is version-relative.
		route = strings.TrimSuffix(route, "/")
		route = strings.TrimPrefix(route, apiversion.V1.Prefix())
		if route == "" {
			return nil
		}
		if routes[route] == nil {
			routes[route] = map[string]bool{}
		}
		routes[route][strings.ToLower(method)] = true
		return nil
	})
	require.NoError(t, err)
	return routes
}

// This is the test that catches the drift a versioned API is most likely
// to suffer: a handler added, changed or removed without the contract
// following it. The contract is the single source of truth and three
// clients are generated from it, so a route that exists only in Go is a
// route no client can call — and a route that exists only in the
// contract is a generated client method that 404s.
func TestRouterAndContractAgree(t *testing.T) {
	contract := loadContract(t)
	mounted := mountedRoutes(t)

	t.Run("every mounted route is described in the contract", func(t *testing.T) {
		var missing []string
		for route, methods := range mounted {
			described, ok := contract.Paths[route]
			if !ok {
				for method := range methods {
					missing = append(missing, strings.ToUpper(method)+" "+route)
				}
				continue
			}
			for method := range methods {
				if _, ok := described[method]; !ok {
					missing = append(missing, strings.ToUpper(method)+" "+route)
				}
			}
		}
		sort.Strings(missing)
		require.Empty(t, missing,
			"these routes are served but undocumented; add them to %s", apiversion.V1.ContractPath())
	})

	t.Run("every documented route is actually served", func(t *testing.T) {
		var unserved []string
		for route, methods := range contract.Paths {
			served, ok := mounted[route]
			if !ok {
				for method := range methods {
					unserved = append(unserved, strings.ToUpper(method)+" "+route)
				}
				continue
			}
			for method := range methods {
				if !served[method] {
					unserved = append(unserved, strings.ToUpper(method)+" "+route)
				}
			}
		}
		sort.Strings(unserved)
		require.Empty(t, unserved,
			"these routes are documented but not served; generated clients would call them and get 404")
	})
}

// A route under /me/ that forgets its auth middleware is a data leak, so
// the shape is asserted rather than trusted to review.
func TestAuthenticatedRoutesAreGroupedUnderMe(t *testing.T) {
	mounted := mountedRoutes(t)

	for route := range mounted {
		switch {
		case strings.HasPrefix(route, "/public/"),
			strings.HasPrefix(route, "/catalog/"),
			strings.HasPrefix(route, "/media/"),
			strings.HasPrefix(route, "/auth/"),
			strings.HasPrefix(route, "/payments/"),
			strings.HasPrefix(route, "/me/"),
			strings.HasPrefix(route, "/admin/"),
			route == "/me":
		default:
			t.Errorf("route %q sits outside every known prefix; decide deliberately whether it is public", route)
		}
	}
}
