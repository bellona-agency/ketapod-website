// Package apiversion is the single definition of which API versions
// exist and where they are mounted.
//
// Before this, "/api/v1" was a string literal in five places, two of
// which are worse than they look: media builds it into signed playback
// URLs that clients hold for minutes, and commerce builds it into the
// payment callback URL that is registered with the gateway. Those escape
// the process. On the day v2 ships, a grep-and-replace would silently
// break tokens already in flight and a callback the bank has on file.
//
// Keeping the version in one place makes the blast radius visible, and
// makes "which paths belong to which version" a question with an answer.
package apiversion

import "strings"

// Version is an API major version. Breaking changes get a new one;
// additive changes do not.
type Version string

const (
	V1 Version = "v1"

	// Current is what new clients should target and what the contract
	// in api/<Current>/openapi.yaml describes.
	Current = V1
)

// Supported lists every version the server still answers, oldest first.
// A version stays here until the clients pinned to it are gone — in a
// market where Cafe Bazaar users update late, that is longer than it
// would be elsewhere.
var Supported = []Version{V1}

// Prefix is the URL prefix a version is mounted under, e.g. "/api/v1".
func (v Version) Prefix() string { return "/api/" + string(v) }

// Path builds a fully-qualified path within a version. Callers pass the
// route as it appears in the contract, with or without a leading slash.
func (v Version) Path(route string) string {
	return v.Prefix() + "/" + strings.TrimPrefix(route, "/")
}

// URL builds an absolute URL for a route, for the places that genuinely
// need one: playback URLs the browser fetches from another origin, and
// the payment callback the bank redirects to.
func (v Version) URL(baseURL, route string) string {
	return strings.TrimRight(baseURL, "/") + v.Path(route)
}

// IsSupported reports whether a version string names a version this
// server still serves.
func IsSupported(raw string) bool {
	for _, v := range Supported {
		if string(v) == raw {
			return true
		}
	}
	return false
}

// ContractPath is where a version's OpenAPI document lives, relative to
// the repository root. Tests use it to compare the routes the router
// actually mounts against the contract.
func (v Version) ContractPath() string {
	return "api/" + string(v) + "/openapi.yaml"
}
