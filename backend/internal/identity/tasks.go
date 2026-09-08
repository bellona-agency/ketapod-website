package identity

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/hibiken/asynq"

	"ketapod/internal/platform/sms"
)

// TaskTypeSendOTP is the one real asynq job wired up this session: OTP
// request handlers enqueue it instead of calling sms.Sender inline, so
// a slow or flaky SMS provider never blocks the HTTP response and gets
// asynq's retry policy for free.
const TaskTypeSendOTP = "identity:send_otp"

type SendOTPPayload struct {
	PhoneNumber string `json:"phoneNumber"`
	Code        string `json:"code"`
}

func NewSendOTPTask(payload SendOTPPayload) (*asynq.Task, error) {
	data, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("identity: marshal send otp payload: %w", err)
	}
	return asynq.NewTask(TaskTypeSendOTP, data, asynq.MaxRetry(3)), nil
}

// SendOTPTaskHandler is registered in cmd/worker. It is the only place
// identity's OTP code ever reaches an SMS message body.
type SendOTPTaskHandler struct {
	Sender sms.Sender
}

func (h *SendOTPTaskHandler) ProcessTask(ctx context.Context, t *asynq.Task) error {
	var payload SendOTPPayload
	if err := json.Unmarshal(t.Payload(), &payload); err != nil {
		return fmt.Errorf("identity: unmarshal send otp payload: %w", err)
	}

	message := fmt.Sprintf("کد ورود کتاپاد: %s\nاین کد را در اختیار کسی قرار ندهید.", payload.Code)
	if err := h.Sender.Send(ctx, payload.PhoneNumber, message); err != nil {
		return fmt.Errorf("identity: send otp sms: %w", err)
	}
	return nil
}
