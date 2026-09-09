package library

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"ketapod/internal/catalog"
	"ketapod/internal/platform/outbox"
)

var (
	ErrNotFound    = errors.New("library: not found")
	ErrStaleWrite  = errors.New("library: a newer position already exists")
	ErrInvalidSpan = errors.New("library: invalid time span")
)

// maxSyncSeconds caps a single position-sync increment.
//
// A client that has been offline may sync a large backlog, but a single
// report of more listening than wall-clock time since the last sync is
// either a bug or someone inflating a streak. Capping at one hour keeps
// honest offline sessions intact while making the counter hard to game —
// and the counter feeds subscription hour caps and parental screen-time
// limits, both of which have consequences.
const maxSyncSeconds = 3600

// Repository is what Service needs from library.* tables only.
type Repository interface {
	// InTx and EnqueueTask keep a bookmark and its summarisation job on
	// the same commit; see internal/platform/outbox.
	InTx(ctx context.Context, fn func(Repository) error) error
	EnqueueTask(ctx context.Context, task outbox.Task) error

	UpsertPosition(ctx context.Context, userID, bookID string, update PositionUpdate) (Position, bool, error)
	GetPosition(ctx context.Context, userID, profileID, audioEditionID string) (Position, error)
	ListContinueListening(ctx context.Context, userID, profileID string, limit int32) ([]Position, error)

	CreateListeningEvent(ctx context.Context, userID, profileID, audioEditionID, bookID string, seconds int, occurredAt time.Time) error
	SecondsListenedForProfileSince(ctx context.Context, profileID string, since time.Time) (int64, error)
	SecondsListenedForUserSince(ctx context.Context, userID string, since time.Time) (int64, error)
	ListeningDaysSince(ctx context.Context, userID, tz string, since time.Time) ([]time.Time, error)
	DailyBreakdown(ctx context.Context, userID, profileID, tz string, since time.Time) ([]DayTotal, error)
	TopBooks(ctx context.Context, userID, profileID string, since time.Time, limit int32) ([]BookTotal, error)

	CreateBookmark(ctx context.Context, userID, audioEditionID, bookID string, positionSeconds float64, label, summaryStatus string) (Bookmark, error)
	ListBookmarks(ctx context.Context, userID, audioEditionID string, limit, offset int32) ([]Bookmark, int64, error)
	GetBookmark(ctx context.Context, bookmarkID string) (Bookmark, error)
	SetBookmarkSummary(ctx context.Context, bookmarkID, summary, status string) error
	DeleteBookmark(ctx context.Context, bookmarkID, userID string) error

	CreateNote(ctx context.Context, userID, audioEditionID, bookID string, positionSeconds float64, body string) (Note, error)
	UpdateNote(ctx context.Context, noteID, userID, body string) (Note, error)
	DeleteNote(ctx context.Context, noteID, userID string) error
	ListNotes(ctx context.Context, userID, audioEditionID string, limit, offset int32) ([]Note, int64, error)

	CreateHighlight(ctx context.Context, userID, audioEditionID, bookID string, start, end float64, quote string) (Highlight, error)
	DeleteHighlight(ctx context.Context, highlightID, userID string) error
	ListHighlights(ctx context.Context, userID, audioEditionID string, limit, offset int32) ([]Highlight, int64, error)
	TopQuotes(ctx context.Context, bookID string, limit int32) ([]string, error)

	UpsertShelfItem(ctx context.Context, userID, bookID, shelf string) error
	DeleteShelfItem(ctx context.Context, userID, bookID, shelf string) error
	ListShelf(ctx context.Context, userID, shelf string, limit, offset int32) ([]ShelfItem, int64, error)

	CreateClip(ctx context.Context, userID, audioEditionID string, start, end float64) (Clip, error)
}

// EditionReader is catalog's slice: library stores a book_id alongside
// every edition_id so "continue listening" and the shelf can join to a
// title without a second round trip, and the mapping comes from catalog.
type EditionReader interface {
	GetEdition(ctx context.Context, editionID string) (catalog.Edition, error)
}

// UsageRecorder is commerce's slice. Listening consumes subscription
// hours, and the subscription hour cap is only real if something
// decrements it at the moment the listening is reported.
type UsageRecorder interface {
	RecordSubscriptionUsage(ctx context.Context, userID string, seconds int64) error
}

// PopularityRecorder is catalog's write slice, kept separate from
// EditionReader so a test can assert on reads without stubbing writes.
type PopularityRecorder interface {
	RecordListen(ctx context.Context, bookID string, seconds int64) error
}

type Service struct {
	repo       Repository
	editions   EditionReader
	usage      UsageRecorder
	popularity PopularityRecorder
	// summaries turns the smart-bookmark feature on. With it off the
	// bookmark still saves and simply never gets a summary — the right
	// degradation for a nice-to-have that depends on an AI gateway.
	summaries bool
}

func NewService(repo Repository, editions EditionReader, usage UsageRecorder, popularity PopularityRecorder, summaries bool) *Service {
	return &Service{repo: repo, editions: editions, usage: usage, popularity: popularity, summaries: summaries}
}

// SyncPosition is the hot path: every player calls it on a 10-second
// debounce and on pause.
//
// It does three things that must not be split apart, because each one
// alone would be wrong:
//  1. writes the position with last-write-wins on the *device* clock;
//  2. appends a listening event for the increment, which feeds stats,
//     streaks, screen-time limits and subscription hours;
//  3. bumps the book's popularity counter.
//
// A stale write still records its listening: the phone that was offline
// really did play those seconds, even though its position lost.
func (s *Service) SyncPosition(ctx context.Context, userID string, update PositionUpdate) (Position, error) {
	edition, err := s.editions.GetEdition(ctx, update.AudioEditionID)
	if err != nil {
		return Position{}, fmt.Errorf("library: resolve edition: %w", err)
	}

	if update.DeviceUpdatedAt.IsZero() {
		update.DeviceUpdatedAt = time.Now()
	}
	// A device clock set far in the future would pin the position and
	// make every later, honest write lose. Clamp rather than reject:
	// wrong clocks are common and losing the sync is worse.
	if update.DeviceUpdatedAt.After(time.Now().Add(5 * time.Minute)) {
		update.DeviceUpdatedAt = time.Now()
	}
	if update.PositionSeconds < 0 {
		update.PositionSeconds = 0
	}

	position, applied, err := s.repo.UpsertPosition(ctx, userID, edition.BookID, update)
	if err != nil {
		return Position{}, fmt.Errorf("library: upsert position: %w", err)
	}

	if err := s.recordListening(ctx, userID, edition, update); err != nil {
		return Position{}, err
	}

	if !applied {
		// The client's write lost; hand back the authoritative position
		// so the player can jump to it instead of fighting the server.
		current, err := s.repo.GetPosition(ctx, userID, update.ProfileID, update.AudioEditionID)
		if err != nil {
			return Position{}, err
		}
		return current, ErrStaleWrite
	}

	return position, nil
}

func (s *Service) recordListening(ctx context.Context, userID string, edition catalog.Edition, update PositionUpdate) error {
	seconds := min(update.SecondsListened, maxSyncSeconds)
	if seconds <= 0 {
		return nil
	}

	if err := s.repo.CreateListeningEvent(ctx, userID, update.ProfileID,
		edition.AudioEditionID, edition.BookID, seconds, time.Now()); err != nil {
		return fmt.Errorf("library: record listening event: %w", err)
	}

	// Popularity and subscription accounting are best-effort relative to
	// the position write: a failure here must not make the player think
	// its sync failed and retry the whole thing.
	if s.usage != nil {
		if err := s.usage.RecordSubscriptionUsage(ctx, userID, int64(seconds)); err != nil {
			return fmt.Errorf("library: record subscription usage: %w", err)
		}
	}
	if s.popularity != nil {
		if err := s.popularity.RecordListen(ctx, edition.BookID, int64(seconds)); err != nil {
			return fmt.Errorf("library: record popularity: %w", err)
		}
	}
	return nil
}

func (s *Service) GetPosition(ctx context.Context, userID, profileID, audioEditionID string) (Position, error) {
	return s.repo.GetPosition(ctx, userID, profileID, audioEditionID)
}

func (s *Service) ContinueListening(ctx context.Context, userID, profileID string, limit int32) ([]Position, error) {
	if limit <= 0 {
		limit = 10
	}
	return s.repo.ListContinueListening(ctx, userID, profileID, limit)
}

// SecondsListenedForEdition backs the refund rule in commerce. It is
// deliberately an exported method on library rather than a query
// commerce runs itself — commerce must not read library.* tables.
func (s *Service) SecondsListenedForEdition(ctx context.Context, userID, audioEditionID string) (int64, error) {
	position, err := s.repo.GetPosition(ctx, userID, "", audioEditionID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return 0, nil
		}
		return 0, err
	}
	return int64(position.PositionSeconds), nil
}

// SecondsListenedToday is what the kids module asks before allowing more
// playback. The day boundary is computed in the caller's timezone, not
// UTC — a daily limit that resets at 3:30am local time is a support
// ticket waiting to happen.
func (s *Service) SecondsListenedToday(ctx context.Context, profileID string, loc *time.Location) (int64, error) {
	if loc == nil {
		loc = time.UTC
	}
	now := time.Now().In(loc)
	startOfDay := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)
	return s.repo.SecondsListenedForProfileSince(ctx, profileID, startOfDay)
}

// StatsFor computes the learning dashboard and the weekly parent report
// from the same data, differing only in the profile filter and window.
func (s *Service) StatsFor(ctx context.Context, userID, profileID, tz string, since time.Time) (Stats, error) {
	if tz == "" {
		tz = "Asia/Tehran"
	}

	daily, err := s.repo.DailyBreakdown(ctx, userID, profileID, tz, since)
	if err != nil {
		return Stats{}, fmt.Errorf("library: daily breakdown: %w", err)
	}

	var total int64
	for _, d := range daily {
		total += d.SecondsListened
	}

	top, err := s.repo.TopBooks(ctx, userID, profileID, since, 5)
	if err != nil {
		return Stats{}, fmt.Errorf("library: top books: %w", err)
	}

	// The streak window is intentionally wider than the report window:
	// a 7-day report should still be able to say "42-day streak".
	days, err := s.repo.ListeningDaysSince(ctx, userID, tz, time.Now().AddDate(-1, 0, 0))
	if err != nil {
		return Stats{}, fmt.Errorf("library: listening days: %w", err)
	}
	current, longest := Streaks(days, time.Now())

	return Stats{
		TotalSeconds: total, CurrentStreak: current, LongestStreak: longest,
		DailyBreakdown: daily, TopBooks: top,
	}, nil
}

// Streaks computes the current and longest run of consecutive listening
// days.
//
// The rule that matters: a streak stays alive if the user listened
// *today or yesterday*. Breaking it at midnight would punish someone who
// listens every evening but opens the app before their usual time, and
// gamification that feels unfair stops motivating.
//
// Pure function over a day list so the rule is testable without a
// database — which is the point, because this is a rule product will
// want to argue about.
func Streaks(days []time.Time, now time.Time) (current, longest int) {
	if len(days) == 0 {
		return 0, 0
	}

	normalized := make([]time.Time, 0, len(days))
	seen := make(map[string]struct{}, len(days))
	for _, d := range days {
		key := d.Format("2006-01-02")
		if _, dup := seen[key]; dup {
			continue
		}
		seen[key] = struct{}{}
		normalized = append(normalized, time.Date(d.Year(), d.Month(), d.Day(), 0, 0, 0, 0, time.UTC))
	}
	sort.Slice(normalized, func(i, j int) bool { return normalized[i].After(normalized[j]) })

	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)

	run := 1
	longest = 1
	for i := 1; i < len(normalized); i++ {
		if normalized[i-1].AddDate(0, 0, -1).Equal(normalized[i]) {
			run++
			longest = max(longest, run)
			continue
		}
		run = 1
	}

	newest := normalized[0]
	if !newest.Equal(today) && !newest.Equal(today.AddDate(0, 0, -1)) {
		return 0, longest
	}

	current = 1
	for i := 1; i < len(normalized); i++ {
		if !normalized[i-1].AddDate(0, 0, -1).Equal(normalized[i]) {
			break
		}
		current++
	}
	return current, longest
}

// ---------- annotations ----------

func (s *Service) AddBookmark(ctx context.Context, userID, audioEditionID string, positionSeconds float64, label string) (Bookmark, error) {
	edition, err := s.editions.GetEdition(ctx, audioEditionID)
	if err != nil {
		return Bookmark{}, fmt.Errorf("library: resolve edition: %w", err)
	}
	if positionSeconds < 0 {
		return Bookmark{}, ErrInvalidSpan
	}

	// The smart summary is produced by a background worker, never
	// inline: a bookmark must land the instant the user taps it, and an
	// LLM call is neither instant nor reliable
	// (03-product-surfaces.md).
	status := "none"
	if s.summaries {
		status = "pending"
	}

	// The bookmark and its summarisation job commit together. Enqueueing
	// after the commit is what used to leave a bookmark on "pending"
	// forever when the process died in between — the user sees a
	// spinner that never resolves and no retry ever fires.
	var bookmark Bookmark
	err = s.repo.InTx(ctx, func(tx Repository) error {
		var err error
		bookmark, err = tx.CreateBookmark(ctx, userID, audioEditionID, edition.BookID, positionSeconds, label, status)
		if err != nil {
			return fmt.Errorf("library: create bookmark: %w", err)
		}
		if !s.summaries {
			return nil
		}

		return tx.EnqueueTask(ctx, outbox.Task{
			Type: TaskTypeSummarizeBookmark,
			Payload: SummarizeBookmarkPayload{
				BookmarkID: bookmark.ID, AudioEditionID: audioEditionID, AtSeconds: positionSeconds,
			},
			Queue: outbox.QueueLow,
			// Re-bookmarking the same spot must not queue the summary
			// twice while the first is still waiting.
			DedupeKey: bookmark.ID,
			MaxRetry:  2,
		})
	})
	if err != nil {
		return Bookmark{}, err
	}

	return bookmark, nil
}

func (s *Service) ListBookmarks(ctx context.Context, userID, audioEditionID string, limit, offset int32) ([]Bookmark, int64, error) {
	return s.repo.ListBookmarks(ctx, userID, audioEditionID, limit, offset)
}

func (s *Service) DeleteBookmark(ctx context.Context, userID, bookmarkID string) error {
	return s.repo.DeleteBookmark(ctx, bookmarkID, userID)
}

func (s *Service) SetBookmarkSummary(ctx context.Context, bookmarkID, summary, status string) error {
	return s.repo.SetBookmarkSummary(ctx, bookmarkID, summary, status)
}

func (s *Service) AddNote(ctx context.Context, userID, audioEditionID string, positionSeconds float64, body string) (Note, error) {
	body = strings.TrimSpace(body)
	if body == "" {
		return Note{}, ErrInvalidSpan
	}
	edition, err := s.editions.GetEdition(ctx, audioEditionID)
	if err != nil {
		return Note{}, fmt.Errorf("library: resolve edition: %w", err)
	}
	return s.repo.CreateNote(ctx, userID, audioEditionID, edition.BookID, positionSeconds, body)
}

func (s *Service) UpdateNote(ctx context.Context, userID, noteID, body string) (Note, error) {
	body = strings.TrimSpace(body)
	if body == "" {
		return Note{}, ErrInvalidSpan
	}
	return s.repo.UpdateNote(ctx, noteID, userID, body)
}

func (s *Service) DeleteNote(ctx context.Context, userID, noteID string) error {
	return s.repo.DeleteNote(ctx, noteID, userID)
}

func (s *Service) ListNotes(ctx context.Context, userID, audioEditionID string, limit, offset int32) ([]Note, int64, error) {
	return s.repo.ListNotes(ctx, userID, audioEditionID, limit, offset)
}

func (s *Service) AddHighlight(ctx context.Context, userID, audioEditionID string, start, end float64, quote string) (Highlight, error) {
	if end <= start || start < 0 {
		return Highlight{}, ErrInvalidSpan
	}
	quote = strings.TrimSpace(quote)
	if quote == "" {
		return Highlight{}, ErrInvalidSpan
	}
	edition, err := s.editions.GetEdition(ctx, audioEditionID)
	if err != nil {
		return Highlight{}, fmt.Errorf("library: resolve edition: %w", err)
	}
	return s.repo.CreateHighlight(ctx, userID, audioEditionID, edition.BookID, start, end, quote)
}

func (s *Service) DeleteHighlight(ctx context.Context, userID, highlightID string) error {
	return s.repo.DeleteHighlight(ctx, highlightID, userID)
}

func (s *Service) ListHighlights(ctx context.Context, userID, audioEditionID string, limit, offset int32) ([]Highlight, int64, error) {
	return s.repo.ListHighlights(ctx, userID, audioEditionID, limit, offset)
}

func (s *Service) TopQuotes(ctx context.Context, bookID string, limit int32) ([]string, error) {
	if limit <= 0 {
		limit = 5
	}
	return s.repo.TopQuotes(ctx, bookID, limit)
}

func (s *Service) SetShelf(ctx context.Context, userID, bookID, shelf string) error {
	if !validShelf(shelf) {
		return ErrInvalidSpan
	}
	return s.repo.UpsertShelfItem(ctx, userID, bookID, shelf)
}

func (s *Service) RemoveFromShelf(ctx context.Context, userID, bookID, shelf string) error {
	if !validShelf(shelf) {
		return ErrInvalidSpan
	}
	return s.repo.DeleteShelfItem(ctx, userID, bookID, shelf)
}

func (s *Service) ListShelf(ctx context.Context, userID, shelf string, limit, offset int32) ([]ShelfItem, int64, error) {
	if !validShelf(shelf) {
		shelf = ShelfFavorites
	}
	return s.repo.ListShelf(ctx, userID, shelf, limit, offset)
}

// RequestClip records the cut. The actual ffmpeg work happens in the
// worker: clipping is server-side by decision (03-product-surfaces.md)
// because a device-side cut of a DRM-adjacent stream is both slow and
// easy to turn into a full-file export.
func (s *Service) RequestClip(ctx context.Context, userID, audioEditionID string, start, end float64) (Clip, error) {
	const maxClipSeconds = 120
	if end <= start || start < 0 || end-start > maxClipSeconds {
		return Clip{}, ErrInvalidSpan
	}
	return s.repo.CreateClip(ctx, userID, audioEditionID, start, end)
}

func validShelf(shelf string) bool {
	switch shelf {
	case ShelfFavorites, ShelfLater, ShelfArchived:
		return true
	}
	return false
}
