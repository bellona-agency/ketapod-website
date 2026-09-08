package catalog

import "time"

type Voice struct {
	ID        string
	Name      string
	Style     string
	IsDefault bool
	IsKids    bool
}

// Book is the abstract work: title, author, publisher, reference text.
// No audio file lives here — that is what makes dialects, kids voices
// and human-vs-AI narration of the same work possible side by side
// (04-architecture.md).
type Book struct {
	ID             string
	Slug           string
	Title          string
	Subtitle       string
	Description    string
	AuthorName     string
	AuthorSlug     string
	PublisherName  string
	CategoryName   string
	CategorySlug   string
	CoverURL       string
	Language       string
	IsKidsFriendly bool
	PublishedAt    *time.Time
	ListenCount    int64
	RatingAverage  float64
	RatingCount    int
}

// Edition is an audio_edition joined with its voice: everything needed
// to price it, preview it, and decide whether a given listener may play
// it.
type Edition struct {
	AudioEditionID  string
	BookID          string
	VoiceID         string
	VoiceName       string
	VoiceStyle      string
	NarratorType    string
	Dialect         string
	Language        string
	IsKidsFriendly  bool
	PriceIRR        int64
	PreviewSeconds  int
	DurationSeconds int
	Status          string
}

// IsFree matters because the free tier is not "no price column" but
// "price zero": school access and promotional titles are priced at zero
// rather than modelled as a separate kind of thing.
func (e Edition) IsFree() bool { return e.PriceIRR == 0 }

type Chapter struct {
	ID           string
	Title        string
	SortOrder    int
	StartSeconds float64
	EndSeconds   float64
}

// TranscriptSegment is one text-to-time mapping. The same structure
// serves accessibility, SEO, word-level highlighting and Ketabyar's RAG
// context (03-product-surfaces.md) — which is why it is stored once, in
// catalog, rather than derived per consumer.
type TranscriptSegment struct {
	Text         string
	StartSeconds float64
	EndSeconds   float64
}

type Category struct {
	ID        string
	Name      string
	Slug      string
	BookCount int64
}

type Collection struct {
	ID   string
	Name string
	Slug string
}

type Author struct {
	ID   string
	Name string
	Slug string
	Bio  string
}

type BookFilter struct {
	CategorySlug *string
	AuthorSlug   *string
	Language     *string
	KidsOnly     *bool
	Sort         string
	Limit        int32
	Offset       int32
}

type LexiconEntry struct {
	Grapheme string
	Phoneme  string
	BookID   string
}

type RightsGrant struct {
	ID                  string
	BookID              string
	PublisherID         string
	Scope               string
	RevenueSharePercent float64
	StartsAt            time.Time
	ExpiresAt           *time.Time
	ContractRef         string
}
