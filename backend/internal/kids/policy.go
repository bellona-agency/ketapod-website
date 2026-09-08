package kids

import "time"

// Policy outcome codes. They are returned to the client so it can show
// the right screen — "ask a parent" and "time is up" are different
// conversations in a household, and a generic denial makes both worse.
const (
	AllowedReason         = "allowed"
	ReasonNotKidsContent  = "kids_content_blocked"
	ReasonParentBlocked   = "kids_content_blocked"
	ReasonNotApproved     = "kids_content_not_approved"
	ReasonDailyLimit      = "kids_daily_limit_reached"
	ReasonOutsideHours    = "kids_outside_allowed_hours"
	ReasonAgeLimit        = "kids_age_limit"
	ReasonProfileInactive = "kids_profile_inactive"
)

// PlaybackInput is everything the decision needs, gathered by the
// service. Keeping the rule itself a pure function over this struct is
// deliberate: these are the four rules 03-product-surfaces.md says must
// never break, and a rule that needs a database to test is a rule nobody
// tests.
type PlaybackInput struct {
	Controls           Controls
	ChildAgeYears      int
	ProfileActive      bool
	BookIsKidsFriendly bool
	// ExplicitDecision is "allow", "block", or "" when the parent has
	// never ruled on this title.
	ExplicitDecision string
	SecondsToday     int64
	Now              time.Time
}

// EvaluatePlayback decides whether a child may start listening.
//
// Order is the design. A parent's explicit block outranks everything,
// including their own earlier purchase — buying a book is not the same
// as approving it for a six-year-old. The daily limit and the allowed
// hours are checked last so a title that is fine in principle produces
// "come back tomorrow" rather than "you can't have this", which is the
// message that keeps a child from asking a parent to unblock content
// that was never blocked.
func EvaluatePlayback(in PlaybackInput) (allowed bool, reason string) {
	if !in.ProfileActive {
		return false, ReasonProfileInactive
	}

	if in.ExplicitDecision == "block" {
		return false, ReasonParentBlocked
	}

	if in.ExplicitDecision != "allow" {
		switch in.Controls.ApprovalMode {
		case ApprovalAllowlistOnly:
			// Nothing plays until the parent says so. The strictest
			// mode, and the one a parent of a very young child picks.
			return false, ReasonNotApproved
		default:
			if !in.BookIsKidsFriendly {
				return false, ReasonNotKidsContent
			}
		}
	}

	if in.Controls.MaxContentAge > 0 && in.ChildAgeYears > in.Controls.MaxContentAge {
		return false, ReasonAgeLimit
	}

	if in.Controls.DailyLimitMinutes > 0 &&
		in.SecondsToday >= int64(in.Controls.DailyLimitMinutes)*60 {
		return false, ReasonDailyLimit
	}

	if !WithinAllowedHours(in.Controls, in.Now) {
		return false, ReasonOutsideHours
	}

	return true, AllowedReason
}

// WithinAllowedHours handles the wrap-around case, which is the normal
// case here rather than an edge case: "bedtime story" means a window
// like 19:00–07:00, where the start minute is greater than the end
// minute and the interval crosses midnight.
func WithinAllowedHours(c Controls, now time.Time) bool {
	from, to := c.AllowedFromMinute, c.AllowedToMinute
	if from == to {
		// A zero-width window is read as "no restriction" rather than
		// "never allowed": a parent who sets both ends to the same value
		// is not trying to lock the child out entirely.
		return true
	}

	minute := now.Hour()*60 + now.Minute()
	if from < to {
		return minute >= from && minute < to
	}
	return minute >= from || minute < to
}

// RemainingSecondsToday is what the client shows as a countdown. It is
// computed here so the number on the child's screen and the number the
// server enforces cannot drift apart.
func RemainingSecondsToday(c Controls, secondsToday int64) int64 {
	if c.DailyLimitMinutes <= 0 {
		return -1 // unlimited
	}
	remaining := int64(c.DailyLimitMinutes)*60 - secondsToday
	return max(remaining, 0)
}
