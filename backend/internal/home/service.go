package home

import (
	"context"
	"errors"
	"fmt"

	"ketapod/internal/catalog"
)

var (
	ErrDuplicatePhone = errors.New("home: duplicate phone number")
	ErrDuplicateEmail = errors.New("home: duplicate email")
)

// Repository is what Service needs from home.* tables only — never from
// catalog or media tables. Book details are always fetched through
// CatalogReader, which is how this module respects the "no direct
// access to another module's table" rule from 04-architecture.md while
// still owning the Home-surface curation (which book is the sample,
// which are recommended, in what order).
type Repository interface {
	ListStats(ctx context.Context) ([]Stat, error)

	GetDemoSample(ctx context.Context) (DemoSample, error)
	GetDemoContinueListening(ctx context.Context) (DemoContinueListening, error)
	ListDemoRecommendations(ctx context.Context) ([]DemoRecommendation, error)

	GetLocalizationContent(ctx context.Context) (LocalizationContent, error)
	ListLocalizationLanguages(ctx context.Context) ([]LocalizationLanguage, error)
	ListLocalizationTopics(ctx context.Context) ([]string, error)
	ListLocalizationSamples(ctx context.Context) ([]LocalizationSample, error)

	ListSocialProofStats(ctx context.Context) ([]SocialProofStat, error)
	ListSocialProofTestimonials(ctx context.Context) ([]Testimonial, error)
	ListSocialProofPartners(ctx context.Context) ([]Partner, error)

	CreateLead(ctx context.Context, input LeadInput) (Lead, error)
	FindLeadByPhoneNumber(ctx context.Context, phoneNumber string) (bool, error)
	FindLeadByEmail(ctx context.Context, email string) (bool, error)
}

// CatalogReader is the subset of catalog.Service this module calls to
// hydrate book references it stores only as an id.
type CatalogReader interface {
	GetBookByID(ctx context.Context, id string) (catalog.Book, error)
	ListVoices(ctx context.Context) ([]catalog.Voice, error)
	ListEditionsForBook(ctx context.Context, bookID string) ([]catalog.Edition, error)
}

// MediaReader is the subset of media.Service this module calls to turn
// an audio edition into a playable URL.
type MediaReader interface {
	StreamURL(ctx context.Context, audioEditionID string) (url string, durationSeconds int, err error)
}

type Service struct {
	repo    Repository
	catalog CatalogReader
	media   MediaReader
}

func NewService(repo Repository, catalog CatalogReader, media MediaReader) *Service {
	return &Service{repo: repo, catalog: catalog, media: media}
}

func (s *Service) GetStats(ctx context.Context) ([]Stat, error) {
	stats, err := s.repo.ListStats(ctx)
	if err != nil {
		return nil, fmt.Errorf("home: list stats: %w", err)
	}
	return stats, nil
}

type SampleBookView struct {
	BookID                 string
	Title                  string
	AuthorName             string
	CoverURL               string
	DurationSeconds        int
	CurrentProgressPercent int
	AITag                  string
}

type RecommendationView struct {
	ID       string
	BookID   string
	Title    string
	CoverURL string
	Tag      string
	Type     string
}

type ContinueListeningView struct {
	ID              string
	BookID          string
	Title           string
	CoverURL        string
	ProgressPercent int
}

type DemoView struct {
	Sample            SampleBookView
	Voices            []catalog.Voice
	Recommendations   []RecommendationView
	ContinueListening ContinueListeningView
}

// GetDemo composes the Interactive Demo section: a curated sample book
// (home.demo_sample), the full narrator voice list (catalog, product-
// wide, not book-specific), curated recommendations, and a curated
// "continue listening" card. No audio file is returned here by design —
// 07-api-contract.md keeps that in a separate call so the JSON payload
// used for the very first paint stays small.
func (s *Service) GetDemo(ctx context.Context) (DemoView, error) {
	sample, err := s.repo.GetDemoSample(ctx)
	if err != nil {
		return DemoView{}, fmt.Errorf("home: get demo sample: %w", err)
	}
	sampleBook, err := s.catalog.GetBookByID(ctx, sample.BookID)
	if err != nil {
		return DemoView{}, fmt.Errorf("home: hydrate demo sample book: %w", err)
	}

	// Duration comes from the sample's default-voice edition, since the
	// demo card shows one duration regardless of which voice is later
	// selected in the player.
	sampleDuration := 0
	if editions, err := s.catalog.ListEditionsForBook(ctx, sample.BookID); err == nil && len(editions) > 0 {
		if _, dur, err := s.media.StreamURL(ctx, editions[0].AudioEditionID); err == nil {
			sampleDuration = dur
		}
	}

	voices, err := s.catalog.ListVoices(ctx)
	if err != nil {
		return DemoView{}, fmt.Errorf("home: list voices: %w", err)
	}

	recs, err := s.repo.ListDemoRecommendations(ctx)
	if err != nil {
		return DemoView{}, fmt.Errorf("home: list demo recommendations: %w", err)
	}
	recViews := make([]RecommendationView, 0, len(recs))
	for _, rec := range recs {
		book, err := s.catalog.GetBookByID(ctx, rec.BookID)
		if err != nil {
			continue
		}
		recViews = append(recViews, RecommendationView{
			ID: rec.ID, BookID: rec.BookID, Title: book.Title, CoverURL: book.CoverURL,
			Tag: rec.Tag, Type: rec.Type,
		})
	}

	cl, err := s.repo.GetDemoContinueListening(ctx)
	if err != nil {
		return DemoView{}, fmt.Errorf("home: get demo continue listening: %w", err)
	}
	clBook, err := s.catalog.GetBookByID(ctx, cl.BookID)
	if err != nil {
		return DemoView{}, fmt.Errorf("home: hydrate continue listening book: %w", err)
	}

	return DemoView{
		Sample: SampleBookView{
			BookID: sampleBook.ID, Title: sampleBook.Title, AuthorName: sampleBook.AuthorName,
			CoverURL: sampleBook.CoverURL, DurationSeconds: sampleDuration,
			CurrentProgressPercent: 42, AITag: sample.AITag,
		},
		Voices:          voices,
		Recommendations: recViews,
		ContinueListening: ContinueListeningView{
			ID: cl.ID, BookID: clBook.ID, Title: clBook.Title, CoverURL: clBook.CoverURL,
			ProgressPercent: cl.ProgressPercent,
		},
	}, nil
}

type AudioSourceView struct {
	VoiceID           string
	VoiceName         string
	AudioURL          string
	IsKidsRecommended bool
}

type AudioItemView struct {
	BookID          string
	Title           string
	CoverURL        string
	DurationSeconds int
	Sources         []AudioSourceView
	IsKidsFriendly  bool
}

func (s *Service) GetAudioItem(ctx context.Context, bookID string) (AudioItemView, error) {
	book, err := s.catalog.GetBookByID(ctx, bookID)
	if err != nil {
		return AudioItemView{}, fmt.Errorf("home: get book %s: %w", bookID, err)
	}

	editions, err := s.catalog.ListEditionsForBook(ctx, bookID)
	if err != nil {
		return AudioItemView{}, fmt.Errorf("home: list editions for book %s: %w", bookID, err)
	}

	sources := make([]AudioSourceView, 0, len(editions))
	duration := 0
	for _, ed := range editions {
		url, dur, err := s.media.StreamURL(ctx, ed.AudioEditionID)
		if err != nil {
			continue
		}
		if duration == 0 {
			duration = dur
		}
		sources = append(sources, AudioSourceView{
			VoiceID: ed.VoiceID, VoiceName: ed.VoiceName, AudioURL: url,
			IsKidsRecommended: ed.IsKidsFriendly,
		})
	}

	return AudioItemView{
		BookID: book.ID, Title: book.Title, CoverURL: book.CoverURL,
		DurationSeconds: duration, Sources: sources, IsKidsFriendly: book.IsKidsFriendly,
	}, nil
}

type LocalizationView struct {
	Title       string
	Subtitle    string
	Languages   []LocalizationLanguage
	LocalTopics []string
	Samples     []LocalizationSample
}

func (s *Service) GetLocalization(ctx context.Context) (LocalizationView, error) {
	content, err := s.repo.GetLocalizationContent(ctx)
	if err != nil {
		return LocalizationView{}, fmt.Errorf("home: get localization content: %w", err)
	}
	languages, err := s.repo.ListLocalizationLanguages(ctx)
	if err != nil {
		return LocalizationView{}, fmt.Errorf("home: list localization languages: %w", err)
	}
	topics, err := s.repo.ListLocalizationTopics(ctx)
	if err != nil {
		return LocalizationView{}, fmt.Errorf("home: list localization topics: %w", err)
	}
	samples, err := s.repo.ListLocalizationSamples(ctx)
	if err != nil {
		return LocalizationView{}, fmt.Errorf("home: list localization samples: %w", err)
	}

	return LocalizationView{
		Title: content.Title, Subtitle: content.Subtitle,
		Languages: languages, LocalTopics: topics, Samples: samples,
	}, nil
}

type SocialProofView struct {
	Stats        []SocialProofStat
	Testimonials []Testimonial
	Partners     []Partner
}

// GetSocialProof never fabricates content — decisions.md is explicit
// that this section renders only with real data. An empty repo simply
// yields empty slices, and the frontend is contracted to hide the
// section rather than show placeholder testimonials.
func (s *Service) GetSocialProof(ctx context.Context) (SocialProofView, error) {
	stats, err := s.repo.ListSocialProofStats(ctx)
	if err != nil {
		return SocialProofView{}, fmt.Errorf("home: list social proof stats: %w", err)
	}
	testimonials, err := s.repo.ListSocialProofTestimonials(ctx)
	if err != nil {
		return SocialProofView{}, fmt.Errorf("home: list social proof testimonials: %w", err)
	}
	partners, err := s.repo.ListSocialProofPartners(ctx)
	if err != nil {
		return SocialProofView{}, fmt.Errorf("home: list social proof partners: %w", err)
	}
	return SocialProofView{Stats: stats, Testimonials: testimonials, Partners: partners}, nil
}

// CreateLead checks phone first, then email — the shipped web form
// (web/components/LeadForm.tsx) only collects phone, so phone is the
// primary de-dup key even though 07-api-contract.md's example response
// names email; see docs/08-decisions.md for the reconciliation note.
func (s *Service) CreateLead(ctx context.Context, input LeadInput) (Lead, error) {
	if input.PhoneNumber != "" {
		exists, err := s.repo.FindLeadByPhoneNumber(ctx, input.PhoneNumber)
		if err != nil {
			return Lead{}, fmt.Errorf("home: check duplicate phone: %w", err)
		}
		if exists {
			return Lead{}, ErrDuplicatePhone
		}
	}
	if input.Email != "" {
		exists, err := s.repo.FindLeadByEmail(ctx, input.Email)
		if err != nil {
			return Lead{}, fmt.Errorf("home: check duplicate email: %w", err)
		}
		if exists {
			return Lead{}, ErrDuplicateEmail
		}
	}

	lead, err := s.repo.CreateLead(ctx, input)
	if err != nil {
		return Lead{}, fmt.Errorf("home: create lead: %w", err)
	}
	return lead, nil
}
