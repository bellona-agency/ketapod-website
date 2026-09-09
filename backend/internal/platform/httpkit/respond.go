// Package httpkit holds the small pieces every HTTP handler in every
// module needs: JSON responses, a uniform error shape, request decoding,
// pagination and auth middleware. Nothing here is business logic — it's
// the thing handler.go files in each module import so they don't
// reinvent it eight times.
package httpkit

import (
	"encoding/json"
	"log/slog"
	"net/http"
)

func JSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if v == nil {
		return
	}
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Error("httpkit: encode response", slog.String("error", err.Error()))
	}
}

func NoContent(w http.ResponseWriter) {
	w.WriteHeader(http.StatusNoContent)
}

type ErrorBody struct {
	Status  string `json:"status"`
	Message string `json:"message,omitempty"`
}

func Error(w http.ResponseWriter, status int, statusCode string, message string) {
	JSON(w, status, ErrorBody{Status: statusCode, Message: message})
}

type ValidationErrorBody struct {
	Status string              `json:"status"`
	Errors map[string][]string `json:"errors"`
}

func ValidationError(w http.ResponseWriter, errors map[string][]string) {
	JSON(w, http.StatusUnprocessableEntity, ValidationErrorBody{
		Status: "validation_error",
		Errors: errors,
	})
}

func BadJSON(w http.ResponseWriter) {
	ValidationError(w, map[string][]string{"body": {"بدنه درخواست نامعتبر است"}})
}

// Paginated is the envelope every list endpoint returns. A bare array
// leaves the client with no way to know whether more pages exist, and
// retrofitting the envelope later is a breaking change across three
// generated clients.
type Paginated struct {
	Items  any   `json:"items"`
	Total  int64 `json:"total"`
	Limit  int32 `json:"limit"`
	Offset int32 `json:"offset"`
}

func Page200(w http.ResponseWriter, items any, total int64, page Page) {
	if items == nil {
		items = []any{}
	}
	JSON(w, http.StatusOK, Paginated{Items: items, Total: total, Limit: page.Limit, Offset: page.Offset})
}
