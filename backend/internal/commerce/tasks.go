package commerce

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/hibiken/asynq"
)

// TaskTypeReconcileSubscriptions is one job, not two.
//
// It used to be a renew job and an expire job on separate hourly
// schedules, and they raced: whichever ran first decided whether a due
// subscription was renewed or expired, and once expired the renewal
// sweep could never see it again. A user who had asked for auto-renewal
// lost access silently. Ordering the two steps inside a single handler
// removes the race instead of hoping the scheduler is kind.
const TaskTypeReconcileSubscriptions = "commerce:reconcile_subscriptions"

type SubscriptionMaintenanceHandler struct {
	Svc    *Service
	Window RenewalWindow
	Log    *slog.Logger
}

func (h *SubscriptionMaintenanceHandler) ProcessTask(ctx context.Context, t *asynq.Task) error {
	if t.Type() != TaskTypeReconcileSubscriptions {
		return fmt.Errorf("commerce: unknown task type %q", t.Type())
	}

	window := h.Window
	if window.LookaheadHours == 0 && window.GraceHours == 0 {
		window = DefaultRenewalWindow
	}

	result, err := h.Svc.ReconcileSubscriptions(ctx, window)
	if err != nil {
		return fmt.Errorf("commerce: reconcile subscriptions: %w", err)
	}

	attrs := []slog.Attr{
		slog.Int("renewed", result.Renewed),
		slog.Int("insufficient_funds", result.InsufficientFunds),
		slog.Int("failed", result.Failed),
		slog.Int("expired", result.Expired),
	}

	// An empty wallet is expected and logged at info. A genuine failure
	// is not, and has to be loud enough to notice — otherwise "renewals
	// stopped working" is discovered by a user, not by us.
	if result.Failed > 0 {
		attrs = append(attrs, slog.String("last_error", result.LastError.Error()))
		h.Log.LogAttrs(ctx, slog.LevelError, "commerce: subscription reconcile had failures", attrs...)
		return nil
	}

	h.Log.LogAttrs(ctx, slog.LevelInfo, "commerce: subscriptions reconciled", attrs...)
	return nil
}
