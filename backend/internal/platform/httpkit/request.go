package httpkit

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
)

// ErrBadJSON is what DecodeJSON returns for a malformed body, so handlers
// can tell "the client sent garbage" (422) apart from "the client sent
// valid JSON that failed a business rule" (also 422, but with field-level
// detail the frontend renders next to the input).
var ErrBadJSON = errors.New("httpkit: invalid json body")

// maxBodyBytes caps request bodies. Every endpoint in this API takes a
// small JSON document; the one place large payloads belong is a direct
// presigned upload to object storage, which never passes through here.
const maxBodyBytes = 1 << 20 // 1 MiB

func DecodeJSON(r *http.Request, dst any) error {
	decoder := json.NewDecoder(http.MaxBytesReader(nil, r.Body, maxBodyBytes))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil {
		return ErrBadJSON
	}
	return nil
}

// Page is offset pagination. Cursor pagination would be better for the
// infinite catalog feed, but every list in this API is either short
// (a user's own notes) or sorted by a mutable column (listen_count),
// where a cursor gives no correctness win and costs a lot of clarity.
type Page struct {
	Limit  int32
	Offset int32
}

const (
	defaultPageLimit = 20
	maxPageLimit     = 100
)

func PageFromRequest(r *http.Request) Page {
	limit := int32(defaultPageLimit)
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			limit = int32(min(n, maxPageLimit))
		}
	}

	var offset int32
	if raw := r.URL.Query().Get("offset"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			offset = int32(n)
		}
	}
	if raw := r.URL.Query().Get("page"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 1 {
			offset = int32(n-1) * limit
		}
	}

	return Page{Limit: limit, Offset: offset}
}

func QueryString(r *http.Request, key string) string {
	return strings.TrimSpace(r.URL.Query().Get(key))
}

// QueryBoolPtr distinguishes "the caller did not ask" (nil) from "the
// caller asked for false". Catalog filters need that difference: absent
// means no filter, false means explicitly non-kids content.
func QueryBoolPtr(r *http.Request, key string) *bool {
	raw := r.URL.Query().Get(key)
	if raw == "" {
		return nil
	}
	v, err := strconv.ParseBool(raw)
	if err != nil {
		return nil
	}
	return &v
}

func QueryStringPtr(r *http.Request, key string) *string {
	raw := QueryString(r, key)
	if raw == "" {
		return nil
	}
	return &raw
}
