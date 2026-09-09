package commerce

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
)

var ErrPaymentVerificationFailed = errors.New("commerce: payment verification failed")

// PaymentProvider is the gateway boundary. The concrete provider is
// unknown at build time and will change: the company-registration →
// bank-account → eNamad → gateway chain is the longest lead time in the
// whole plan (02-business.md) and is not finished, so nothing above this
// interface may assume Zarinpal's shape specifically.
//
// The two-step start/verify flow is not an abstraction for its own sake:
// every Iranian gateway works this way — redirect the user with an
// authority token, then verify server-side on the callback, because the
// callback itself is not trustworthy evidence of payment.
type PaymentProvider interface {
	Name() string
	// Start registers a payment and returns the authority plus the URL
	// to send the user to.
	Start(ctx context.Context, req StartPaymentRequest) (StartPaymentResult, error)
	// Verify confirms server-side that the authority was really paid.
	// It must be safe to call more than once: gateways retry callbacks.
	Verify(ctx context.Context, authority string, amountIRR int64) (VerifyPaymentResult, error)
}

type StartPaymentRequest struct {
	AmountIRR   int64
	Description string
	CallbackURL string
	UserID      string
	Mobile      string
}

type StartPaymentResult struct {
	Authority   string
	RedirectURL string
}

type VerifyPaymentResult struct {
	Succeeded     bool
	ReferenceCode string
	FailureReason string
}

// StubProvider stands in until a real gateway exists. It succeeds
// deterministically so the whole purchase path — top-up, ledger credit,
// order, entitlement — is exercisable end to end today, including in
// integration tests, without a merchant account.
//
// It is intentionally *not* wired in production: cmd/api refuses to
// start with the stub when APP_ENV=production.
type StubProvider struct {
	callbackBase string
}

func NewStubProvider(callbackBase string) *StubProvider {
	return &StubProvider{callbackBase: callbackBase}
}

func (p *StubProvider) Name() string { return "stub" }

func (p *StubProvider) Start(ctx context.Context, req StartPaymentRequest) (StartPaymentResult, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return StartPaymentResult{}, fmt.Errorf("commerce: stub authority: %w", err)
	}
	authority := "STUB-" + hex.EncodeToString(buf)
	return StartPaymentResult{
		Authority:   authority,
		RedirectURL: fmt.Sprintf("%s?authority=%s&status=OK", req.CallbackURL, authority),
	}, nil
}

func (p *StubProvider) Verify(ctx context.Context, authority string, amountIRR int64) (VerifyPaymentResult, error) {
	if authority == "" {
		return VerifyPaymentResult{}, ErrPaymentVerificationFailed
	}
	return VerifyPaymentResult{Succeeded: true, ReferenceCode: "REF-" + authority}, nil
}
