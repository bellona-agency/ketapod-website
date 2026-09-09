package ingest

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// ErrAINotConfigured means no AI service address is set. It is a
// configuration fault, not a transient one: retrying cannot fix it, so
// the dispatch job stops instead of burning its retries and the panel
// says why.
var ErrAINotConfigured = errors.New("ingest: AI_SERVICE_BASE_URL is not set")

// AIConfig addresses the AI service.
//
// The path is configurable because the contract on that side is not
// frozen yet. Everything this module needs to know about their API is
// these four fields, so aligning with them is an env change and a
// redeploy — not a code change in the middle of the ingest pipeline.
type AIConfig struct {
	BaseURL string
	// ProcessPath may contain {bookId}, which is replaced with the id of
	// the row written into public.books.
	ProcessPath string
	APIKey      string
	Timeout     time.Duration
}

// ProcessRequest is what the AI service is told. It carries the ids and
// the storage key rather than the file: both processes are on the same
// database and the same bucket now, so shipping bytes between them
// would be copying a book to hand over a book we both already hold.
type ProcessRequest struct {
	BookID     string `json:"bookId"`
	DocumentID string `json:"documentId"`
	StorageKey string `json:"storageKey"`
	FileName   string `json:"fileName"`
	MimeType   string `json:"mimeType"`

	Title    string `json:"title"`
	Author   string `json:"author,omitempty"`
	Language string `json:"language"`

	// The two checkboxes, passed straight through. The AI side decides
	// what they mean for its pipeline; we only record what was asked.
	EnableTTS       bool `json:"enableTts"`
	EnableAssistant bool `json:"enableAssistant"`
}

type AIClient struct {
	cfg  AIConfig
	http *http.Client
}

func NewAIClient(cfg AIConfig) *AIClient {
	if cfg.ProcessPath == "" {
		cfg.ProcessPath = "/api/v1/books/{bookId}/process"
	}
	if cfg.Timeout <= 0 {
		cfg.Timeout = 30 * time.Second
	}
	return &AIClient{cfg: cfg, http: &http.Client{Timeout: cfg.Timeout}}
}

func (c *AIClient) Configured() bool { return c != nil && c.cfg.BaseURL != "" }

// StartProcessing hands one book to the AI service.
//
// It is safe to call more than once for the same book: delivery from the
// outbox is at-least-once, so the AI side must treat a repeat as "you
// already have this" rather than starting a second pipeline. A 409 is
// therefore read as success, not as a failure to retry.
func (c *AIClient) StartProcessing(ctx context.Context, req ProcessRequest) error {
	if !c.Configured() {
		return ErrAINotConfigured
	}

	body, err := json.Marshal(req)
	if err != nil {
		return fmt.Errorf("ingest: marshal process request: %w", err)
	}

	path := strings.ReplaceAll(c.cfg.ProcessPath, "{bookId}", req.BookID)
	url := strings.TrimRight(c.cfg.BaseURL, "/") + "/" + strings.TrimLeft(path, "/")

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("ingest: build process request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "application/json")
	if c.cfg.APIKey != "" {
		httpReq.Header.Set("Authorization", "Bearer "+c.cfg.APIKey)
	}

	res, err := c.http.Do(httpReq)
	if err != nil {
		return fmt.Errorf("ingest: call AI service: %w", err)
	}
	defer res.Body.Close()

	if res.StatusCode < 300 || res.StatusCode == http.StatusConflict {
		_, _ = io.Copy(io.Discard, res.Body)
		return nil
	}

	// The first part of the body is worth keeping: a 422 from their
	// validation says exactly which field we got wrong, and without it
	// the panel can only report a status code.
	snippet, _ := io.ReadAll(io.LimitReader(res.Body, 400))
	return fmt.Errorf("ingest: AI service returned %d: %s", res.StatusCode, strings.TrimSpace(string(snippet)))
}
