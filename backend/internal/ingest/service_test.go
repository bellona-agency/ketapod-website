package ingest

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"ketapod/internal/catalog"
)

func TestValidateRejectsAFileThatIsNotAPDF(t *testing.T) {
	// The browser's declared content type is caller-controlled; only the
	// magic number says what the file actually is. A JPEG accepted here
	// fails hours later inside the OCR pipeline, where nobody can tell
	// what went wrong.
	err := validate(SubmitInput{
		Title: "کتاب",
		PDF:   Upload{FileName: "book.pdf", ContentType: "application/pdf", Data: []byte("\xff\xd8\xff not a pdf")},
	})

	var invalid *ValidationError
	require.ErrorAs(t, err, &invalid)
	require.Contains(t, invalid.Fields, "pdf")
}

func TestValidateAcceptsARealPDF(t *testing.T) {
	require.NoError(t, validate(SubmitInput{
		Title: "کتاب",
		PDF:   Upload{FileName: "book.pdf", Data: []byte("%PDF-1.7\n...")},
	}))
}

func TestValidateRequiresATitle(t *testing.T) {
	err := validate(SubmitInput{
		Title: " ",
		PDF:   Upload{FileName: "book.pdf", Data: []byte("%PDF-1.7")},
	})

	var invalid *ValidationError
	require.ErrorAs(t, err, &invalid)
	require.Contains(t, invalid.Fields, "title")
}

func TestSafeFileNameCannotEscapeItsPrefix(t *testing.T) {
	// The name arrives from the uploader. Without this, a crafted name
	// writes outside books/{id}/original/ — into another book's folder,
	// or over an object the media pipeline is serving.
	require.Equal(t, "passwd", safeFileName("../../etc/passwd", "book.pdf"))
	require.Equal(t, "book.pdf", safeFileName("../..", "book.pdf"))
	require.Equal(t, "book.pdf", safeFileName("", "book.pdf"))
	require.Equal(t, "my-book.pdf", safeFileName("my book.pdf", "book.pdf"))
}

func TestSlugifyKeepsPersian(t *testing.T) {
	require.Equal(t, "بوف-کور", catalog.Slugify("بوف کور"))
	require.Equal(t, "کتاب-صوتی", catalog.Slugify("  کتاب   صوتی  "))
	require.Equal(t, "clean-code", catalog.Slugify("Clean Code!"))
	require.Equal(t, "", catalog.Slugify("!!!"))
}

func TestStartProcessingBuildsTheAddressAndPassesTheCheckboxes(t *testing.T) {
	var gotPath, gotAuth, gotBody string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("Authorization")
		buf := make([]byte, r.ContentLength)
		_, _ = r.Body.Read(buf)
		gotBody = string(buf)
		w.WriteHeader(http.StatusAccepted)
	}))
	defer server.Close()

	client := NewAIClient(AIConfig{BaseURL: server.URL, APIKey: "secret"})
	err := client.StartProcessing(context.Background(), ProcessRequest{
		BookID: "book-1", EnableTTS: true, EnableAssistant: false,
	})

	require.NoError(t, err)
	require.Equal(t, "/api/v1/books/book-1/process", gotPath)
	require.Equal(t, "Bearer secret", gotAuth)
	require.Contains(t, gotBody, `"enableTts":true`)
	require.Contains(t, gotBody, `"enableAssistant":false`)
}

func TestStartProcessingTreatsConflictAsAlreadyAccepted(t *testing.T) {
	// Outbox delivery is at-least-once, so the same book can be handed
	// over twice. "You already have this" is the AI service agreeing
	// with us, not a failure worth retrying.
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusConflict)
	}))
	defer server.Close()

	err := NewAIClient(AIConfig{BaseURL: server.URL}).
		StartProcessing(context.Background(), ProcessRequest{BookID: "book-1"})
	require.NoError(t, err)
}

func TestStartProcessingKeepsTheServersExplanation(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnprocessableEntity)
		_, _ = w.Write([]byte(`{"detail":"storage_key not found"}`))
	}))
	defer server.Close()

	err := NewAIClient(AIConfig{BaseURL: server.URL}).
		StartProcessing(context.Background(), ProcessRequest{BookID: "book-1"})

	require.Error(t, err)
	require.Contains(t, err.Error(), "storage_key not found")
}

func TestStartProcessingWithoutAnAddressIsAConfigurationFault(t *testing.T) {
	err := NewAIClient(AIConfig{}).StartProcessing(context.Background(), ProcessRequest{BookID: "b"})
	require.ErrorIs(t, err, ErrAINotConfigured)
}

func TestProcessPathIsConfigurable(t *testing.T) {
	// The AI service's contract is not frozen. Matching a change on that
	// side has to be an env var, not a redeploy of this pipeline.
	var gotPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	client := NewAIClient(AIConfig{
		BaseURL:     server.URL + "/",
		ProcessPath: "ingest/{bookId}",
	})
	require.NoError(t, client.StartProcessing(context.Background(), ProcessRequest{BookID: "abc"}))
	require.Equal(t, "/ingest/abc", gotPath)
	require.False(t, strings.Contains(gotPath, "//"))
}

func TestChaptersAreLaidEndToEnd(t *testing.T) {
	// The player draws its chapter bar from these ranges against one
	// continuous file, so a gap or an overlap is visible immediately as
	// a broken strip — and a listener who taps chapter two lands in the
	// middle of chapter one.
	chapters := chaptersFrom([]aiAudioPart{
		{Duration: 12.5, ChapterTitle: "فصل اول"},
		{Duration: 7.5, ChapterTitle: "فصل دوم"},
		{Duration: 10, ChapterTitle: "فصل سوم"},
	})

	require.Len(t, chapters, 3)
	require.Equal(t, 0.0, chapters[0].StartSeconds)
	require.Equal(t, 12.5, chapters[0].EndSeconds)
	require.Equal(t, 12.5, chapters[1].StartSeconds)
	require.Equal(t, 20.0, chapters[1].EndSeconds)
	require.Equal(t, 20.0, chapters[2].StartSeconds)
	require.Equal(t, 30.0, chapters[2].EndSeconds)
}

func TestASingleUntitledFileGetsNoChapterBar(t *testing.T) {
	require.Nil(t, chaptersFrom([]aiAudioPart{{Duration: 600}}))
}

func TestUnfinishedAudioIsNotUsed(t *testing.T) {
	// Joining a file the TTS pipeline is still writing produces a book
	// that cuts off mid-sentence, and the signature check would then
	// treat that truncated version as done.
	ready := readyParts([]aiAudioPart{
		{StorageKey: "a.mp3", Status: "ready"},
		{StorageKey: "b.mp3", Status: "processing"},
		{StorageKey: "c.mp3", Status: "failed"},
		{StorageKey: "", Status: "ready"},
		{StorageKey: "d.mp3", Status: "completed"},
	})

	require.Len(t, ready, 2)
	require.Equal(t, "a.mp3", ready[0].StorageKey)
	require.Equal(t, "d.mp3", ready[1].StorageKey)
}

func TestSignatureChangesWhenNarrationIsRegenerated(t *testing.T) {
	original := []aiAudioPart{{StorageKey: "a.mp3", Duration: 10}}
	sameKeyNewAudio := []aiAudioPart{{StorageKey: "a.mp3", Duration: 12}}
	newKey := []aiAudioPart{{StorageKey: "b.mp3", Duration: 10}}

	require.Equal(t, partsSignature(original), partsSignature(original))
	require.NotEqual(t, partsSignature(original), partsSignature(sameKeyNewAudio),
		"a re-narration that overwrites the same key must still be picked up")
	require.NotEqual(t, partsSignature(original), partsSignature(newKey))
}

func TestAudioContentTypeIsWhatTheBrowserNeeds(t *testing.T) {
	// The stream handler passes the stored content type straight to the
	// browser; octet-stream makes <audio> refuse to play a valid file.
	require.Equal(t, "audio/mpeg", audioContentType("mp3"))
	require.Equal(t, "audio/mp4", audioContentType("M4A"))
	require.Equal(t, "application/octet-stream", audioContentType("weird"))
}
