// Package aigw is the AI Gateway boundary described in 04-architecture.md:
// every AI provider call in ketapod goes through this interface so a
// provider can be swapped without touching callers. The reason is
// business continuity, not architectural taste — OpenAI/Gemini/ElevenLabs
// are unreachable from an Iranian server IP, and even the fallback
// Iranian gateways route every prompt through a third party, so the
// concrete provider WILL change more than once.
//
// No concrete provider is implemented yet: the TTS pipeline and the
// choice of Iranian gateway are separate pieces of work, and the answer
// to "which gateway" depends on pricing tests that have not happened.
// NoopProvider exists so the interface is wired into DI today; every
// method returns ErrNotImplemented, and callers are written to treat
// that as a recoverable "not available" rather than a failure.
package aigw

import (
	"context"
	"errors"
)

var ErrNotImplemented = errors.New("aigw: provider not implemented")

type TextToSpeechRequest struct {
	Text     string
	VoiceID  string
	Language string
}

type TextToSpeechResult struct {
	AudioBytes []byte
	Format     string
}

type NormalizeTextRequest struct {
	Text     string
	Language string
}

type NormalizeTextResult struct {
	NormalizedText string
}

// CompletionRequest is the Ketabyar boundary: chapter summaries, smart
// bookmark summaries, quizzes. Context is passed as text because the
// source is always a transcript window from catalog — the RAG retrieval
// step belongs above this interface, not inside a provider.
type CompletionRequest struct {
	System      string
	Prompt      string
	Context     string
	MaxTokens   int
	Temperature float64
}

type CompletionResult struct {
	Text string
}

// AIProvider is intentionally narrow: only the two capabilities the
// media pipeline in 04-architecture.md names (TTS synthesis, and the
// Persian normalization/diacritization pass that decisions.md calls out
// as roughly half the AI engineering effort). Extend it as concrete
// pipeline steps get built, not speculatively now.
type AIProvider interface {
	SynthesizeSpeech(ctx context.Context, req TextToSpeechRequest) (TextToSpeechResult, error)
	NormalizeText(ctx context.Context, req NormalizeTextRequest) (NormalizeTextResult, error)
	CompleteText(ctx context.Context, req CompletionRequest) (CompletionResult, error)
}

type NoopProvider struct{}

func NewNoopProvider() *NoopProvider {
	return &NoopProvider{}
}

func (NoopProvider) SynthesizeSpeech(ctx context.Context, req TextToSpeechRequest) (TextToSpeechResult, error) {
	return TextToSpeechResult{}, ErrNotImplemented
}

func (NoopProvider) NormalizeText(ctx context.Context, req NormalizeTextRequest) (NormalizeTextResult, error) {
	return NormalizeTextResult{}, ErrNotImplemented
}

func (NoopProvider) CompleteText(ctx context.Context, req CompletionRequest) (CompletionResult, error) {
	return CompletionResult{}, ErrNotImplemented
}
