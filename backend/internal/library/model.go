package library

import "time"

// Position is per user × AudioEdition, never per book
// (04-architecture.md): switching from the calm narration to the
// dramatic one must not lose where the listener was in either.
//
// ProfileID separates a child's progress from the parent's on the same
// account — the child listens on the parent's user id, so without this
// the parent's "continue listening" fills up with bedtime stories.
type Position struct {
	ID              string
	UserID          string
	ProfileID       string
	AudioEditionID  string
	BookID          string
	PositionSeconds float64
	DurationSeconds float64
	IsFinished      bool
	DeviceUpdatedAt time.Time
	UpdatedAt       time.Time

	BookTitle    string
	BookSlug     string
	BookCoverURL string
}

// PositionUpdate is what a client sends on the 10-second debounce and on
// pause. DeviceUpdatedAt is the client's clock on purpose: it is the
// only clock that knows when the listening actually happened, which
// matters when a phone syncs hours later after being offline.
type PositionUpdate struct {
	AudioEditionID  string
	ProfileID       string
	PositionSeconds float64
	DurationSeconds float64
	IsFinished      bool
	DeviceUpdatedAt time.Time
	// SecondsListened is the increment since the last sync, not the
	// absolute position. Deriving it from position deltas server-side
	// would count a seek backwards as negative listening and a seek
	// forwards as listening that never happened.
	SecondsListened int
}

type Bookmark struct {
	ID              string
	UserID          string
	AudioEditionID  string
	BookID          string
	PositionSeconds float64
	Label           string
	Summary         string
	SummaryStatus   string
	CreatedAt       time.Time

	BookTitle    string
	BookCoverURL string
}

type Note struct {
	ID              string
	UserID          string
	AudioEditionID  string
	BookID          string
	PositionSeconds float64
	Body            string
	CreatedAt       time.Time
	UpdatedAt       time.Time

	BookTitle    string
	BookCoverURL string
}

type Highlight struct {
	ID             string
	UserID         string
	AudioEditionID string
	BookID         string
	StartSeconds   float64
	EndSeconds     float64
	Quote          string
	CreatedAt      time.Time

	BookTitle string
}

const (
	ShelfFavorites = "favorites"
	ShelfLater     = "later"
	ShelfArchived  = "archived"
)

type ShelfItem struct {
	ID        string
	UserID    string
	BookID    string
	Shelf     string
	CreatedAt time.Time

	BookTitle      string
	BookSlug       string
	BookCoverURL   string
	IsKidsFriendly bool
}

type Clip struct {
	ID             string
	UserID         string
	AudioEditionID string
	StartSeconds   float64
	EndSeconds     float64
	Status         string
	StorageKey     string
	CreatedAt      time.Time
}

type DayTotal struct {
	Date            time.Time
	SecondsListened int64
}

type BookTotal struct {
	BookID          string
	Title           string
	CoverURL        string
	SecondsListened int64
}

// Stats is the learning dashboard and, with a profile id, the weekly
// parent report. Both are computed here rather than in the client
// because a streak defined three times in three apps is three different
// streaks (04-architecture.md).
type Stats struct {
	TotalSeconds   int64
	CurrentStreak  int
	LongestStreak  int
	DailyBreakdown []DayTotal
	TopBooks       []BookTotal
}
