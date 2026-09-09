package integrationtest

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"ketapod/internal/catalog"
	"ketapod/internal/commerce"
	"ketapod/internal/library"
)

func newLibraryService(t *testing.T) (*library.Service, *fixtures) {
	t.Helper()
	pool := newPool(t)

	catalogSvc := catalog.NewService(catalog.NewRepository(pool))
	commerceSvc := commerce.NewService(commerce.NewRepository(pool), catalogSvc, nil,
		commerce.NewStubProvider("http://localhost/cb"))
	// No enqueuer: bookmarks must still work when the AI gateway and
	// its queue are not configured, which is the current state of the
	// world and will be again whenever a provider is swapped.
	svc := library.NewService(library.NewRepository(pool), catalogSvc, commerceSvc, catalogSvc, false)
	return svc, newFixtures(t, pool)
}

// Position sync is the hot path: every player calls it on a ten-second
// debounce and on pause. The rule that matters is last-write-wins on the
// *device* clock, because only the device knows when the listening
// actually happened — a phone that was offline may sync hours later.
func TestPositionSyncIsLastWriteWinsOnDeviceClock(t *testing.T) {
	svc, f := newLibraryService(t)
	ctx := context.Background()

	userID := f.user("09120000400")
	bookID := f.book(bookOpts{Slug: "synced", Title: "همگام"})
	editionID := f.edition(editionOpts{BookID: bookID, VoiceID: "v1", DurationSeconds: 600, WithAsset: true})

	now := time.Now()

	tablet, err := svc.SyncPosition(ctx, userID, library.PositionUpdate{
		AudioEditionID: editionID, PositionSeconds: 300, DurationSeconds: 600,
		SecondsListened: 300, DeviceUpdatedAt: now,
	})
	require.NoError(t, err)
	require.Equal(t, float64(300), tablet.PositionSeconds)

	t.Run("an older write from an offline phone does not rewind progress", func(t *testing.T) {
		current, err := svc.SyncPosition(ctx, userID, library.PositionUpdate{
			AudioEditionID: editionID, PositionSeconds: 30, DurationSeconds: 600,
			SecondsListened: 30, DeviceUpdatedAt: now.Add(-2 * time.Hour),
		})
		require.ErrorIs(t, err, library.ErrStaleWrite)
		require.Equal(t, float64(300), current.PositionSeconds,
			"the caller is handed the authoritative position to adopt")
	})

	t.Run("the stale device's listening still counts", func(t *testing.T) {
		// It really did play those seconds while offline. Only its
		// *position* lost the race.
		seconds, err := svc.SecondsListenedForEdition(ctx, userID, editionID)
		require.NoError(t, err)
		require.Greater(t, seconds, int64(0))
		require.Equal(t, 2, f.countRows("library.listening_events", "user_id = $1", userID))
	})

	t.Run("a newer write moves the position forward", func(t *testing.T) {
		updated, err := svc.SyncPosition(ctx, userID, library.PositionUpdate{
			AudioEditionID: editionID, PositionSeconds: 420, DurationSeconds: 600,
			SecondsListened: 120, DeviceUpdatedAt: now.Add(time.Minute),
		})
		require.NoError(t, err)
		require.Equal(t, float64(420), updated.PositionSeconds)
	})

	t.Run("a device clock set far in the future is clamped, not obeyed", func(t *testing.T) {
		// Otherwise one wrong clock pins the position forever and every
		// later honest write loses. A separate edition keeps this case
		// isolated from the timestamps the sub-tests above established.
		freshEdition := f.edition(editionOpts{
			BookID: bookID, VoiceID: "clock-test", DurationSeconds: 600, WithAsset: true,
		})

		_, err := svc.SyncPosition(ctx, userID, library.PositionUpdate{
			AudioEditionID: freshEdition, PositionSeconds: 500, DurationSeconds: 600,
			SecondsListened: 10, DeviceUpdatedAt: time.Now().Add(72 * time.Hour),
		})
		require.NoError(t, err)

		later, err := svc.SyncPosition(ctx, userID, library.PositionUpdate{
			AudioEditionID: freshEdition, PositionSeconds: 550, DurationSeconds: 600,
			SecondsListened: 10, DeviceUpdatedAt: time.Now(),
		})
		require.NoError(t, err, "a wrong clock must not lock out every later write")
		require.Equal(t, float64(550), later.PositionSeconds)
	})
}

// Positions are per user × AudioEdition, never per book: switching from
// the calm narration to the dramatic one must not lose either place.
func TestPositionsAreSeparatePerEdition(t *testing.T) {
	svc, f := newLibraryService(t)
	ctx := context.Background()

	userID := f.user("09120000401")
	bookID := f.book(bookOpts{Slug: "two-voices", Title: "دو صدا"})
	calm := f.edition(editionOpts{BookID: bookID, VoiceID: "calm", DurationSeconds: 600, WithAsset: true})
	dramatic := f.edition(editionOpts{BookID: bookID, VoiceID: "dramatic", DurationSeconds: 620, WithAsset: true})

	now := time.Now()
	_, err := svc.SyncPosition(ctx, userID, library.PositionUpdate{
		AudioEditionID: calm, PositionSeconds: 100, DeviceUpdatedAt: now,
	})
	require.NoError(t, err)
	_, err = svc.SyncPosition(ctx, userID, library.PositionUpdate{
		AudioEditionID: dramatic, PositionSeconds: 400, DeviceUpdatedAt: now,
	})
	require.NoError(t, err)

	calmPos, err := svc.GetPosition(ctx, userID, "", calm)
	require.NoError(t, err)
	require.Equal(t, float64(100), calmPos.PositionSeconds)

	dramaticPos, err := svc.GetPosition(ctx, userID, "", dramatic)
	require.NoError(t, err)
	require.Equal(t, float64(400), dramaticPos.PositionSeconds)
}

// A child listens on the parent's account. Without the profile split the
// parent's "continue listening" fills up with bedtime stories.
func TestChildProgressIsSeparateFromParentProgress(t *testing.T) {
	svc, f := newLibraryService(t)
	ctx := context.Background()

	parentID := f.user("09120000402")
	childID := f.childProfile(parentID, "سارا", 6)
	bookID := f.book(bookOpts{Slug: "shared-book", Title: "کتاب مشترک", IsKidsFriendly: true})
	editionID := f.edition(editionOpts{BookID: bookID, VoiceID: "v1", DurationSeconds: 600, WithAsset: true})

	now := time.Now()
	_, err := svc.SyncPosition(ctx, parentID, library.PositionUpdate{
		AudioEditionID: editionID, PositionSeconds: 500, DeviceUpdatedAt: now,
	})
	require.NoError(t, err)
	_, err = svc.SyncPosition(ctx, parentID, library.PositionUpdate{
		AudioEditionID: editionID, ProfileID: childID, PositionSeconds: 60, DeviceUpdatedAt: now,
	})
	require.NoError(t, err)

	parentPos, err := svc.GetPosition(ctx, parentID, "", editionID)
	require.NoError(t, err)
	require.Equal(t, float64(500), parentPos.PositionSeconds)

	childPos, err := svc.GetPosition(ctx, parentID, childID, editionID)
	require.NoError(t, err)
	require.Equal(t, float64(60), childPos.PositionSeconds)

	t.Run("continue listening is filtered by profile", func(t *testing.T) {
		parentItems, err := svc.ContinueListening(ctx, parentID, "", 10)
		require.NoError(t, err)
		require.Len(t, parentItems, 1)
		require.Equal(t, float64(500), parentItems[0].PositionSeconds)

		childItems, err := svc.ContinueListening(ctx, parentID, childID, 10)
		require.NoError(t, err)
		require.Len(t, childItems, 1)
		require.Equal(t, float64(60), childItems[0].PositionSeconds)
	})
}

// A single sync reporting more listening than is plausible is either a
// bug or someone inflating a streak — and the counter feeds subscription
// hour caps and parental screen-time limits, both of which have
// consequences.
func TestListeningIncrementIsCapped(t *testing.T) {
	svc, f := newLibraryService(t)
	ctx := context.Background()

	userID := f.user("09120000403")
	bookID := f.book(bookOpts{Slug: "capped", Title: "محدود"})
	editionID := f.edition(editionOpts{BookID: bookID, VoiceID: "v1", DurationSeconds: 600, WithAsset: true})

	_, err := svc.SyncPosition(ctx, userID, library.PositionUpdate{
		AudioEditionID: editionID, PositionSeconds: 100,
		SecondsListened: 99_999, DeviceUpdatedAt: time.Now(),
	})
	require.NoError(t, err)

	var recorded int
	require.NoError(t, f.pool.QueryRow(ctx,
		`SELECT seconds_listened FROM library.listening_events WHERE user_id = $1`, userID).Scan(&recorded))
	require.Equal(t, 3600, recorded, "one sync can report at most an hour")
}

func TestBookmarksNotesAndHighlights(t *testing.T) {
	svc, f := newLibraryService(t)
	ctx := context.Background()

	userID := f.user("09120000404")
	bookID := f.book(bookOpts{Slug: "annotated", Title: "یادداشت‌دار"})
	editionID := f.edition(editionOpts{BookID: bookID, VoiceID: "v1", DurationSeconds: 600, WithAsset: true})

	t.Run("a bookmark saves instantly even with no AI gateway configured", func(t *testing.T) {
		bookmark, err := svc.AddBookmark(ctx, userID, editionID, 123.5, "جای خوب")
		require.NoError(t, err)
		require.Equal(t, 123.5, bookmark.PositionSeconds)
		require.Equal(t, bookID, bookmark.BookID, "the book id is resolved from the edition")
		// The smart summary is a background job; without a queue the
		// bookmark simply has no summary rather than failing.
		require.Equal(t, "none", bookmark.SummaryStatus)
	})

	t.Run("the same position bookmarked twice updates rather than duplicating", func(t *testing.T) {
		_, err := svc.AddBookmark(ctx, userID, editionID, 123.5, "برچسب تازه")
		require.NoError(t, err)

		bookmarks, total, err := svc.ListBookmarks(ctx, userID, editionID, 20, 0)
		require.NoError(t, err)
		require.Equal(t, int64(1), total)
		require.Equal(t, "برچسب تازه", bookmarks[0].Label)
	})

	t.Run("notes require a body", func(t *testing.T) {
		_, err := svc.AddNote(ctx, userID, editionID, 10, "   ")
		require.ErrorIs(t, err, library.ErrInvalidSpan)
	})

	t.Run("a note round-trips and can be edited by its owner only", func(t *testing.T) {
		note, err := svc.AddNote(ctx, userID, editionID, 42, "نکته مهم")
		require.NoError(t, err)

		updated, err := svc.UpdateNote(ctx, userID, note.ID, "نکته اصلاح‌شده")
		require.NoError(t, err)
		require.Equal(t, "نکته اصلاح‌شده", updated.Body)

		stranger := f.user("09120000405")
		_, err = svc.UpdateNote(ctx, stranger, note.ID, "دستکاری")
		require.Error(t, err, "a stranger cannot edit someone else's note")
	})

	t.Run("a highlight needs a real span", func(t *testing.T) {
		_, err := svc.AddHighlight(ctx, userID, editionID, 100, 100, "متن")
		require.ErrorIs(t, err, library.ErrInvalidSpan)
		_, err = svc.AddHighlight(ctx, userID, editionID, 100, 90, "متن")
		require.ErrorIs(t, err, library.ErrInvalidSpan)
		_, err = svc.AddHighlight(ctx, userID, editionID, 100, 120, "  ")
		require.ErrorIs(t, err, library.ErrInvalidSpan)
	})

	t.Run("highlights feed the most-marked-quotes list", func(t *testing.T) {
		const quote = "هر کتاب یک سفر است"
		for i, u := range []string{"09120000406", "09120000407", "09120000408"} {
			reader := f.user(u)
			_, err := svc.AddHighlight(ctx, reader, editionID, float64(10*i), float64(10*i+5), quote)
			require.NoError(t, err)
		}

		quotes, err := svc.TopQuotes(ctx, bookID, 5)
		require.NoError(t, err)
		require.Equal(t, quote, quotes[0], "the most-marked quote comes first")
	})

	t.Run("a clip is bounded to two minutes", func(t *testing.T) {
		_, err := svc.RequestClip(ctx, userID, editionID, 0, 121)
		require.ErrorIs(t, err, library.ErrInvalidSpan)

		clip, err := svc.RequestClip(ctx, userID, editionID, 30, 90)
		require.NoError(t, err)
		require.Equal(t, "pending", clip.Status, "the cut happens in a worker, not inline")
	})
}

func TestShelfRoundTrip(t *testing.T) {
	svc, f := newLibraryService(t)
	ctx := context.Background()

	userID := f.user("09120000409")
	bookID := f.book(bookOpts{Slug: "shelved", Title: "در قفسه"})

	require.NoError(t, svc.SetShelf(ctx, userID, bookID, library.ShelfFavorites))
	require.NoError(t, svc.SetShelf(ctx, userID, bookID, library.ShelfFavorites), "idempotent")

	items, total, err := svc.ListShelf(ctx, userID, library.ShelfFavorites, 20, 0)
	require.NoError(t, err)
	require.Equal(t, int64(1), total)
	require.Equal(t, "در قفسه", items[0].BookTitle)

	require.ErrorIs(t, svc.SetShelf(ctx, userID, bookID, "nonsense"), library.ErrInvalidSpan)

	require.NoError(t, svc.RemoveFromShelf(ctx, userID, bookID, library.ShelfFavorites))
	_, total, err = svc.ListShelf(ctx, userID, library.ShelfFavorites, 20, 0)
	require.NoError(t, err)
	require.Equal(t, int64(0), total)
}

func TestStatsAggregateListeningHistory(t *testing.T) {
	svc, f := newLibraryService(t)
	ctx := context.Background()

	userID := f.user("09120000410")
	bookID := f.book(bookOpts{Slug: "stats-book", Title: "آمار"})
	editionID := f.edition(editionOpts{BookID: bookID, VoiceID: "v1", DurationSeconds: 600, WithAsset: true})

	// Three consecutive days ending today.
	now := time.Now()
	for i := range 3 {
		f.listeningEvent(userID, "", editionID, bookID, 600, now.AddDate(0, 0, -i))
	}

	stats, err := svc.StatsFor(ctx, userID, "", "Asia/Tehran", now.AddDate(0, 0, -30))
	require.NoError(t, err)

	require.Equal(t, int64(1800), stats.TotalSeconds)
	require.Len(t, stats.DailyBreakdown, 3)
	require.Equal(t, 3, stats.CurrentStreak)
	require.Len(t, stats.TopBooks, 1)
	require.Equal(t, "آمار", stats.TopBooks[0].Title)
}
