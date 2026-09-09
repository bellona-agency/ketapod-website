package library

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/hibiken/asynq"

	"ketapod/internal/platform/aigw"
)

// TaskTypeSummarizeBookmark produces the "smart bookmark" summary.
//
// It is a background job by design: the bookmark row is written the
// instant the user taps, and the summary lands later
// (03-product-surfaces.md). Doing it inline would put an LLM round trip
// between a tap and its visual feedback, which is the difference between
// a feature that feels instant and one that feels broken.
const TaskTypeSummarizeBookmark = "library:summarize_bookmark"

type SummarizeBookmarkPayload struct {
	BookmarkID     string  `json:"bookmarkId"`
	AudioEditionID string  `json:"audioEditionId"`
	AtSeconds      float64 `json:"atSeconds"`
}

func NewSummarizeBookmarkTask(payload SummarizeBookmarkPayload) (*asynq.Task, error) {
	data, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("library: marshal summarize payload: %w", err)
	}
	return asynq.NewTask(TaskTypeSummarizeBookmark, data, asynq.MaxRetry(2)), nil
}

// TranscriptReader is catalog's slice: the window of text around the
// bookmark. The synced transcript is the source (03-product-surfaces.md
// — "one asset, four uses"), so no audio is re-processed here.
type TranscriptReader interface {
	TranscriptWindow(ctx context.Context, editionID string, fromSeconds, toSeconds float64) ([]TranscriptSegmentText, error)
}

type TranscriptSegmentText struct {
	Text string
}

type SummarizeBookmarkHandler struct {
	Svc        *Service
	Transcript TranscriptReader
	AI         aigw.AIProvider
}

func (h *SummarizeBookmarkHandler) ProcessTask(ctx context.Context, t *asynq.Task) error {
	var payload SummarizeBookmarkPayload
	if err := json.Unmarshal(t.Payload(), &payload); err != nil {
		return fmt.Errorf("library: unmarshal summarize payload: %w", err)
	}

	// A 90-second window either side: enough context for a useful
	// summary, small enough that the prompt stays cheap on a metered
	// Iranian AI gateway.
	const windowSeconds = 90
	segments, err := h.Transcript.TranscriptWindow(ctx, payload.AudioEditionID,
		payload.AtSeconds-windowSeconds, payload.AtSeconds+windowSeconds)
	if err != nil {
		return h.fail(ctx, payload.BookmarkID, err)
	}
	if len(segments) == 0 {
		// No transcript yet is a normal state for a title whose
		// pipeline has not finished, not an error to retry forever.
		return h.Svc.SetBookmarkSummary(ctx, payload.BookmarkID, "", "none")
	}

	var context string
	for _, seg := range segments {
		context += seg.Text + " "
	}

	result, err := h.AI.CompleteText(ctx, aigw.CompletionRequest{
		System:    "خلاصه‌ای کوتاه و دقیق از این بخش کتاب صوتی بنویس. حداکثر دو جمله.",
		Prompt:    "این بخش درباره چیست؟",
		Context:   context,
		MaxTokens: 120,
	})
	if err != nil {
		if errors.Is(err, aigw.ErrNotImplemented) {
			// No AI provider configured yet. Park the bookmark in a
			// terminal state instead of retrying: retrying a call that
			// cannot succeed just fills the dead-letter queue.
			return h.Svc.SetBookmarkSummary(ctx, payload.BookmarkID, "", "none")
		}
		return h.fail(ctx, payload.BookmarkID, err)
	}

	return h.Svc.SetBookmarkSummary(ctx, payload.BookmarkID, result.Text, "ready")
}

func (h *SummarizeBookmarkHandler) fail(ctx context.Context, bookmarkID string, cause error) error {
	if err := h.Svc.SetBookmarkSummary(ctx, bookmarkID, "", "failed"); err != nil {
		return err
	}
	return fmt.Errorf("library: summarize bookmark: %w", cause)
}
