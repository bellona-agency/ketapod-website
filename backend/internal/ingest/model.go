// Package ingest is the content-production boundary: an editor uploads a
// PDF and a cover, ticks whether the book should be narrated (TTS) and
// whether it should join the Ketabyar assistant, and this module turns
// that into three durable facts in one transaction —
//
//	public.books + public.book_documents   the AI service's work item
//	catalog.books                          the book, in the site's list
//	jobs.outbox                            "tell the AI service about it"
//
// The AI service is a separate process (Python/alembic) that now shares
// this database, so its progress is read straight from public.jobs
// rather than mirrored here. There is exactly one copy of that truth.
package ingest

import "time"

// MaxPDFBytes caps a single upload. A scanned Persian book runs to tens
// of megabytes; 200MB is comfortably above real books and well below
// what would let one request exhaust the API's memory.
const MaxPDFBytes = 200 << 20

// MaxCoverBytes is small on purpose: a cover is a JPEG or PNG a few
// hundred kilobytes at most, and anything larger is a mistake worth
// rejecting at the door rather than storing forever.
const MaxCoverBytes = 10 << 20

// Upload is one file as it arrived from the panel. The bytes are held in
// memory because both files go to object storage immediately and the
// sizes above are bounded; streaming straight through would save memory
// but cost the ability to reject a bad file before writing it.
type Upload struct {
	FileName    string
	ContentType string
	Data        []byte
}

func (u Upload) Size() int64 { return int64(len(u.Data)) }

type SubmitInput struct {
	Title       string
	Author      string
	Description string

	PDF   Upload
	Cover *Upload

	WantTTS       bool
	WantAssistant bool

	CreatedBy string
}

// JobStep mirrors one row of public.job_steps — the AI pipeline's own
// vocabulary (document_detection, ocr, text_processing, ...). It is
// passed through rather than translated: renaming another team's steps
// in our UI makes their logs and our panel impossible to line up.
type JobStep struct {
	Step        string     `json:"step"`
	Status      string     `json:"status"`
	Progress    int        `json:"progress"`
	Attempt     int        `json:"attempt"`
	Error       string     `json:"error,omitempty"`
	StartedAt   *time.Time `json:"startedAt,omitempty"`
	CompletedAt *time.Time `json:"completedAt,omitempty"`
}

type Job struct {
	ID          string    `json:"id"`
	Status      string    `json:"status"`
	CurrentStep string    `json:"currentStep,omitempty"`
	Progress    int       `json:"progress"`
	Error       string    `json:"error,omitempty"`
	Steps       []JobStep `json:"steps,omitempty"`
}

type Submission struct {
	ID            string `json:"id"`
	AIBookID      string `json:"aiBookId"`
	AIDocumentID  string `json:"aiDocumentId"`
	CatalogBookID string `json:"catalogBookId,omitempty"`
	CatalogSlug   string `json:"catalogSlug,omitempty"`

	Title       string `json:"title"`
	Author      string `json:"author,omitempty"`
	Description string `json:"description,omitempty"`

	PDFFileName  string `json:"pdfFileName"`
	PDFSizeBytes int64  `json:"pdfSizeBytes"`
	CoverURL     string `json:"coverUrl,omitempty"`

	WantTTS       bool `json:"wantTts"`
	WantAssistant bool `json:"wantAssistant"`

	// DispatchStatus is about the handoff to the AI service, not about
	// the processing itself: "dispatched" means the request was
	// accepted, nothing more. Processing lives in Job.
	DispatchStatus string     `json:"dispatchStatus"`
	DispatchError  string     `json:"dispatchError,omitempty"`
	DispatchedAt   *time.Time `json:"dispatchedAt,omitempty"`

	// AIBookStatus is public.books.status as the AI service maintains it
	// (draft/processing/ready/failed).
	AIBookStatus string `json:"aiBookStatus,omitempty"`

	// The narration, once it exists. CatalogEditionID is the edition the
	// site plays; audio_status says where that stands, and is "none" for
	// a book uploaded without the TTS box ticked.
	CatalogEditionID string     `json:"catalogEditionId,omitempty"`
	AudioStatus      string     `json:"audioStatus"`
	AudioError       string     `json:"audioError,omitempty"`
	AudioSyncedAt    *time.Time `json:"audioSyncedAt,omitempty"`

	CreatedBy string    `json:"createdBy,omitempty"`
	CreatedAt time.Time `json:"createdAt"`

	Job *Job `json:"job,omitempty"`

	// Storage keys stay unexported: the panel gets a URL it can open,
	// not a bucket path it could ask for directly.
	pdfKey         string
	coverKey       string
	audioSignature string
}
