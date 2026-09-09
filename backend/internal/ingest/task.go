package ingest

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"

	"github.com/hibiken/asynq"
)

// TaskTypeDispatch hands a submission to the AI service. It is written
// to the outbox inside the upload's transaction, so it cannot be lost
// between "the file is recorded" and "the AI service was told".
const TaskTypeDispatch = "ingest:dispatch"

type DispatchPayload struct {
	SubmissionID string `json:"submissionId"`
}

type DispatchHandler struct {
	Svc *Service
	Log *slog.Logger
}

func (h *DispatchHandler) ProcessTask(ctx context.Context, task *asynq.Task) error {
	var payload DispatchPayload
	if err := json.Unmarshal(task.Payload(), &payload); err != nil {
		// A payload we cannot parse will not parse on the next attempt
		// either. Retrying it forever hides the bug that produced it.
		return fmt.Errorf("%w: %v", asynq.SkipRetry, err)
	}

	err := h.Svc.Dispatch(ctx, payload.SubmissionID)
	switch {
	case err == nil:
		return nil

	case errors.Is(err, ErrAINotConfigured), errors.Is(err, ErrNotFound):
		// Neither is fixed by waiting. The failure is already recorded
		// on the submission, and the panel offers an explicit retry
		// once the operator has fixed the cause.
		if h.Log != nil {
			h.Log.WarnContext(ctx, "ingest: dispatch stopped",
				slog.String("submission_id", payload.SubmissionID),
				slog.String("error", err.Error()))
		}
		return fmt.Errorf("%w: %v", asynq.SkipRetry, err)

	default:
		// Everything else — the AI service down, a 5xx, a timeout — is
		// exactly what retries are for.
		return err
	}
}

// TaskTypeSyncAudio materialises finished narrations into the
// catalogue. It is a periodic sweep rather than a callback because the
// AI service does not know this system exists — it writes its output
// into the database both sides share and stops there. Polling a table
// we already own beats asking another team to call us back.
const TaskTypeSyncAudio = "ingest:sync-audio"

// AudioSweepBatch caps one sweep. A run that would join fifty books is
// a run that holds a worker for an hour; the next tick takes the rest.
const AudioSweepBatch = 10

type SyncAudioHandler struct {
	Svc *Service
	Log *slog.Logger
}

func (h *SyncAudioHandler) ProcessTask(ctx context.Context, _ *asynq.Task) error {
	synced, failed, err := h.Svc.SyncAudioSweep(ctx, AudioSweepBatch)
	if err != nil {
		return err
	}

	// Silence when there is nothing to do: this runs every few minutes
	// and a log line per tick would bury everything else.
	if h.Log != nil && (synced > 0 || failed > 0) {
		h.Log.InfoContext(ctx, "ingest: audio sweep",
			slog.Int("synced", synced), slog.Int("failed", failed))
	}
	return nil
}
