package kids

import "time"

// ChildProfile is a subset of the parent User, not a row in
// identity.users (08-decisions.md). It has no wallet, no entitlements,
// no devices and no tokens: the person who consumes does not pay, and
// the person who pays does not consume.
type ChildProfile struct {
	ID           string
	ParentUserID string
	DisplayName  string
	BirthYear    int
	AgeYears     int
	AvatarKey    string
	IsActive     bool
	CreatedAt    time.Time
}

const (
	ApprovalAllowlistOnly = "allowlist_only"
	ApprovalKidsCatalog   = "kids_catalog"
)

// Controls is the parent's rule set. Every field here is enforced in Go
// on the server; none of it may be a condition in a client.
type Controls struct {
	ChildProfileID       string
	DailyLimitMinutes    int
	AllowedFromMinute    int
	AllowedToMinute      int
	MaxContentAge        int
	ApprovalMode         string
	HasExitPin           bool
	AutodownloadWifiOnly bool
	UpdatedAt            time.Time
}

// DefaultControls is what a profile gets before the parent touches
// anything. It is deliberately the restrictive end of every axis: a
// parent who never opens the settings screen should still get a safe
// default, and loosening is an explicit act.
func DefaultControls(childProfileID string, ageYears int) Controls {
	return Controls{
		ChildProfileID:    childProfileID,
		DailyLimitMinutes: 60,
		// 06:00 to 21:00. Bedtime listening is a real use case, but it
		// should be a choice the parent makes rather than the default.
		AllowedFromMinute:    6 * 60,
		AllowedToMinute:      21 * 60,
		MaxContentAge:        max(ageYears, 3),
		ApprovalMode:         ApprovalKidsCatalog,
		AutodownloadWifiOnly: true,
	}
}

type ContentApproval struct {
	ChildProfileID string
	BookID         string
	Decision       string
	BookTitle      string
	BookCoverURL   string
	DecidedAt      time.Time
}

type AllowedPrompt struct {
	ID     string
	Label  string
	Prompt string
	MinAge int
	MaxAge int
}

// WeeklyReport is the single most important parent-retention tool in the
// product (03-product-surfaces.md). It is assembled server-side so the
// web chart and the mobile summary cannot disagree about the numbers.
type WeeklyReport struct {
	ChildProfileID   string
	DisplayName      string
	From             time.Time
	To               time.Time
	TotalSeconds     int64
	DaysListened     int
	DailyBreakdown   []DayTotal
	TopBooks         []BookTotal
	LimitReachedDays int
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
