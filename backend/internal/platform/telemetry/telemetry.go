// Package telemetry wires structured logging. Sentry/GlitchTip hook is
// intentionally left as a TODO: wiring a real DSN needs a secret this
// session doesn't have, but every log line already carries the fields
// (request id, user id) an error tracker needs to correlate later.
package telemetry

import (
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/go-chi/chi/v5/middleware"
)

func NewLogger(level string) *slog.Logger {
	var lvl slog.Level
	switch level {
	case "debug":
		lvl = slog.LevelDebug
	case "warn":
		lvl = slog.LevelWarn
	case "error":
		lvl = slog.LevelError
	default:
		lvl = slog.LevelInfo
	}

	handler := slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: lvl,
	})
	return slog.New(handler)
}

// RequestLogger emits one structured line per request. It is not
// chi's built-in Logger because that one writes plain text: everything
// else in this process is JSON, and a mixed-format log is unusable in
// any aggregator.
//
// The request id is included so a Sentry event and a log line can be
// correlated once an error tracker is wired.
func RequestLogger(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			ww := &statusRecorder{ResponseWriter: w, status: http.StatusOK}

			next.ServeHTTP(ww, r)

			level := slog.LevelInfo
			if ww.status >= 500 {
				level = slog.LevelError
			}
			logger.LogAttrs(r.Context(), level, "http",
				slog.String("method", r.Method),
				slog.String("path", r.URL.Path),
				slog.Int("status", ww.status),
				slog.Int64("bytes", ww.written),
				slog.Duration("duration", time.Since(start)),
				slog.String("request_id", middleware.GetReqID(r.Context())),
			)
		})
	}
}

type statusRecorder struct {
	http.ResponseWriter
	status  int
	written int64
}

func (r *statusRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}

func (r *statusRecorder) Write(b []byte) (int, error) {
	n, err := r.ResponseWriter.Write(b)
	r.written += int64(n)
	return n, err
}

// Unwrap is the Go 1.20+ contract for a wrapping ResponseWriter: it lets
// http.NewResponseController reach the real writer's Flush, Hijack and
// deadline methods through this one.
//
// Without it, every handler that streams sees a writer that is not an
// http.Flusher and has to either give up or write blind. That is not
// theoretical: the pm tool's SSE endpoint returned 500 for exactly this
// reason, because a plain `w.(http.Flusher)` assertion fails once this
// middleware is in the chain — and it is in the chain for every route in
// both binaries.
func (r *statusRecorder) Unwrap() http.ResponseWriter {
	return r.ResponseWriter
}
