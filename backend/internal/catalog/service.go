package catalog

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

var (
	ErrNotFound      = errors.New("catalog: not found")
	ErrQueryTooShort = errors.New("catalog: search query too short")
)

// minSearchQueryLength stops a one-character query from trigram-scanning
// the whole table and returning everything. Two runes is the shortest
// meaningful Persian query ("شب").
const minSearchQueryLength = 2

// Repository is what Service needs from storage. repo.go implements it
// against sqlc-generated code.
type Repository interface {
	GetBookByID(ctx context.Context, id string) (Book, error)
	GetBookBySlug(ctx context.Context, slug string) (Book, error)
	ListBooks(ctx context.Context, filter BookFilter) ([]Book, int64, error)
	SearchBooks(ctx context.Context, query string, kidsOnly *bool, limit, offset int32) ([]Book, int64, error)

	ListVoices(ctx context.Context) ([]Voice, error)
	ListEditionsForBook(ctx context.Context, bookID string) ([]Edition, error)
	GetEditionByID(ctx context.Context, editionID string) (Edition, error)
	SetEditionDuration(ctx context.Context, editionID string, seconds int) error

	ListChapters(ctx context.Context, editionID string) ([]Chapter, error)
	GetTranscriptSegments(ctx context.Context, editionID string, fromSeconds, toSeconds float64) ([]TranscriptSegment, error)
	UpsertTranscript(ctx context.Context, editionID, language string, contentJSON []byte) error

	ListCategories(ctx context.Context) ([]Category, error)
	GetAuthorBySlug(ctx context.Context, slug string) (Author, error)

	ResolveLexicon(ctx context.Context, bookID, language string) ([]LexiconEntry, error)
	HasActiveRights(ctx context.Context, bookID string) (bool, error)
	IncrementListenCount(ctx context.Context, bookID string, by int64) error
}

// Service is the only way another module (home, media, commerce,
// library, kids) reads catalog data — never a direct query against
// catalog.* tables. This is the enforcement point for the "modules talk
// through interfaces, never through each other's tables" rule from
// 04-architecture.md.
type Service struct {
	repo Repository
}

func NewService(repo Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) GetBookByID(ctx context.Context, id string) (Book, error) {
	book, err := s.repo.GetBookByID(ctx, id)
	if err != nil {
		return Book{}, fmt.Errorf("catalog: get book %s: %w", id, err)
	}
	return book, nil
}

func (s *Service) GetBookBySlug(ctx context.Context, slug string) (Book, error) {
	book, err := s.repo.GetBookBySlug(ctx, slug)
	if err != nil {
		return Book{}, fmt.Errorf("catalog: get book %s: %w", slug, err)
	}
	return book, nil
}

func (s *Service) ListBooks(ctx context.Context, filter BookFilter) ([]Book, int64, error) {
	books, total, err := s.repo.ListBooks(ctx, filter)
	if err != nil {
		return nil, 0, fmt.Errorf("catalog: list books: %w", err)
	}
	return books, total, nil
}

// Search normalizes the query before it reaches Postgres. Persian text
// entered on three different keyboards produces three different byte
// sequences for the same word — Arabic ی/ك against Persian ی/ک, and a
// zero-width non-joiner that a phone keyboard inserts and a desktop one
// does not. Without this pass, "کتابهای" and "کتاب‌های" are different
// strings to both the FTS index and the trigram index, and the user
// concludes we don't have the book.
func (s *Service) Search(ctx context.Context, rawQuery string, kidsOnly *bool, limit, offset int32) ([]Book, int64, error) {
	query := NormalizePersian(rawQuery)
	if len([]rune(query)) < minSearchQueryLength {
		return nil, 0, ErrQueryTooShort
	}

	books, total, err := s.repo.SearchBooks(ctx, query, kidsOnly, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("catalog: search books: %w", err)
	}
	return books, total, nil
}

// NormalizePersian folds the character variants that make Persian search
// fail. It is deliberately in catalog and not in a shared util package:
// the TTS pipeline will need a much heavier normalizer (diacritics,
// numbers, dates — roughly half the AI engineering effort per
// 04-architecture.md), and the two must not be conflated. This one only
// has to make two spellings of the same query collide.
func NormalizePersian(s string) string {
	replacer := strings.NewReplacer(
		"ي", "ی", // Arabic yeh  -> Persian yeh
		"ى", "ی", // alef maksura -> Persian yeh
		"ك", "ک", // Arabic kaf  -> Persian kaf
		"‌", " ", // ZWNJ (نیم‌فاصله) -> space
		"‏", "", // RTL mark
		"‎", "", // LTR mark
		"٠", "0", "١", "1", "٢", "2", "٣", "3", "٤", "4",
		"٥", "5", "٦", "6", "٧", "7", "٨", "8", "٩", "9",
		"۰", "0", "۱", "1", "۲", "2", "۳", "3", "۴", "4",
		"۵", "5", "۶", "6", "۷", "7", "۸", "8", "۹", "9",
	)
	out := replacer.Replace(s)
	// Strip Arabic harakat: a user rarely types them, the catalog rarely
	// stores them, and when either does the two must still match.
	out = strings.Map(func(r rune) rune {
		if r >= 0x064B && r <= 0x0652 {
			return -1
		}
		return r
	}, out)
	return strings.Join(strings.Fields(out), " ")
}

// ListVoices returns the full narrator persona catalog, not the subset
// available for any one book. Callers filter against ListEditionsForBook
// to know which voices are actually selectable for a given item.
func (s *Service) ListVoices(ctx context.Context) ([]Voice, error) {
	voices, err := s.repo.ListVoices(ctx)
	if err != nil {
		return nil, fmt.Errorf("catalog: list voices: %w", err)
	}
	return voices, nil
}

func (s *Service) ListEditionsForBook(ctx context.Context, bookID string) ([]Edition, error) {
	editions, err := s.repo.ListEditionsForBook(ctx, bookID)
	if err != nil {
		return nil, fmt.Errorf("catalog: list editions for book %s: %w", bookID, err)
	}
	return editions, nil
}

func (s *Service) GetEdition(ctx context.Context, editionID string) (Edition, error) {
	edition, err := s.repo.GetEditionByID(ctx, editionID)
	if err != nil {
		return Edition{}, fmt.Errorf("catalog: get edition %s: %w", editionID, err)
	}
	return edition, nil
}

func (s *Service) ListChapters(ctx context.Context, editionID string) ([]Chapter, error) {
	chapters, err := s.repo.ListChapters(ctx, editionID)
	if err != nil {
		return nil, fmt.Errorf("catalog: list chapters: %w", err)
	}
	return chapters, nil
}

// TranscriptWindow returns the segments overlapping a time range. The
// window, not the whole transcript, is the unit every consumer wants:
// Ketabyar needs context around the current position, the player needs
// the sentences on screen, and SEO rendering pages a chapter at a time.
func (s *Service) TranscriptWindow(ctx context.Context, editionID string, fromSeconds, toSeconds float64) ([]TranscriptSegment, error) {
	if toSeconds < fromSeconds {
		fromSeconds, toSeconds = toSeconds, fromSeconds
	}
	segments, err := s.repo.GetTranscriptSegments(ctx, editionID, fromSeconds, toSeconds)
	if err != nil {
		return nil, fmt.Errorf("catalog: transcript window: %w", err)
	}
	return segments, nil
}

func (s *Service) SaveTranscript(ctx context.Context, editionID, language string, segments []TranscriptSegment) error {
	payload := make([]map[string]any, len(segments))
	for i, seg := range segments {
		payload[i] = map[string]any{
			"text": seg.Text, "startSeconds": seg.StartSeconds, "endSeconds": seg.EndSeconds,
		}
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("catalog: encode transcript: %w", err)
	}
	if err := s.repo.UpsertTranscript(ctx, editionID, language, encoded); err != nil {
		return fmt.Errorf("catalog: save transcript: %w", err)
	}
	return nil
}

func (s *Service) ListCategories(ctx context.Context) ([]Category, error) {
	categories, err := s.repo.ListCategories(ctx)
	if err != nil {
		return nil, fmt.Errorf("catalog: list categories: %w", err)
	}
	return categories, nil
}

func (s *Service) GetAuthorBySlug(ctx context.Context, slug string) (Author, error) {
	author, err := s.repo.GetAuthorBySlug(ctx, slug)
	if err != nil {
		return Author{}, fmt.Errorf("catalog: get author %s: %w", slug, err)
	}
	return author, nil
}

// ResolveLexicon returns the effective pronunciation dictionary for one
// book: book-specific entries win over global ones, because the same
// grapheme legitimately has different readings in different works.
func (s *Service) ResolveLexicon(ctx context.Context, bookID, language string) (map[string]string, error) {
	if language == "" {
		language = "fa"
	}
	entries, err := s.repo.ResolveLexicon(ctx, bookID, language)
	if err != nil {
		return nil, fmt.Errorf("catalog: resolve lexicon: %w", err)
	}
	out := make(map[string]string, len(entries))
	for _, e := range entries {
		out[e.Grapheme] = e.Phoneme
	}
	return out, nil
}

// HasActiveRights answers "may we distribute this at all". It defaults
// to false when no grant exists — the safe answer for a platform whose
// existential risk is publishers refusing to license
// (02-business.md), not the convenient one.
func (s *Service) HasActiveRights(ctx context.Context, bookID string) (bool, error) {
	ok, err := s.repo.HasActiveRights(ctx, bookID)
	if err != nil {
		return false, fmt.Errorf("catalog: check rights: %w", err)
	}
	return ok, nil
}

func (s *Service) RecordListen(ctx context.Context, bookID string, seconds int64) error {
	if seconds <= 0 {
		return nil
	}
	if err := s.repo.IncrementListenCount(ctx, bookID, seconds); err != nil {
		return fmt.Errorf("catalog: increment listen count: %w", err)
	}
	return nil
}
