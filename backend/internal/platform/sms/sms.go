// Package sms defines the outbound SMS boundary. decisions.md is explicit
// that a real provider (Kavenegar / SMS.ir, on a service line — not
// promotional, or OTP gets filtered) is a launch-week task, not a day-one
// one. StubSender logs instead of calling out, so the OTP flow is fully
// wired end-to-end today and swapping in a real Sender later touches
// nothing outside main().
package sms

import (
	"context"
	"log/slog"
)

type Sender interface {
	Send(ctx context.Context, phoneNumber, message string) error
}

type StubSender struct {
	log *slog.Logger
}

func NewStubSender(log *slog.Logger) *StubSender {
	return &StubSender{log: log}
}

func (s *StubSender) Send(ctx context.Context, phoneNumber, message string) error {
	s.log.InfoContext(ctx, "sms: stub send",
		slog.String("phone_number", phoneNumber),
		slog.String("message", message),
	)
	return nil
}
