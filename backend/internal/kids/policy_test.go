package kids_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"ketapod/internal/kids"
)

func baseControls() kids.Controls {
	return kids.Controls{
		DailyLimitMinutes: 60,
		AllowedFromMinute: 6 * 60,
		AllowedToMinute:   21 * 60,
		MaxContentAge:     12,
		ApprovalMode:      kids.ApprovalKidsCatalog,
	}
}

func at(hour, minute int) time.Time {
	return time.Date(2026, 8, 29, hour, minute, 0, 0, time.UTC)
}

// These are the four rules 03-product-surfaces.md says must never break.
// They live in the backend so no client can forget one; this table is
// what proves they hold.
func TestEvaluatePlayback(t *testing.T) {
	tests := []struct {
		name       string
		mutate     func(*kids.PlaybackInput)
		wantAllow  bool
		wantReason string
	}{
		{
			name:       "kids-friendly title inside limits plays",
			mutate:     func(in *kids.PlaybackInput) {},
			wantAllow:  true,
			wantReason: kids.AllowedReason,
		},
		{
			name:       "a non-kids title is blocked by default",
			mutate:     func(in *kids.PlaybackInput) { in.BookIsKidsFriendly = false },
			wantAllow:  false,
			wantReason: kids.ReasonNotKidsContent,
		},
		{
			name: "a parent's explicit allow overrides the kids-catalog check",
			mutate: func(in *kids.PlaybackInput) {
				in.BookIsKidsFriendly = false
				in.ExplicitDecision = "allow"
			},
			wantAllow:  true,
			wantReason: kids.AllowedReason,
		},
		{
			name: "an explicit block beats everything, including a kids title",
			mutate: func(in *kids.PlaybackInput) {
				in.BookIsKidsFriendly = true
				in.ExplicitDecision = "block"
			},
			wantAllow:  false,
			wantReason: kids.ReasonParentBlocked,
		},
		{
			name: "allowlist mode denies anything not explicitly approved",
			mutate: func(in *kids.PlaybackInput) {
				in.Controls.ApprovalMode = kids.ApprovalAllowlistOnly
				in.BookIsKidsFriendly = true
			},
			wantAllow:  false,
			wantReason: kids.ReasonNotApproved,
		},
		{
			name: "allowlist mode allows an approved title",
			mutate: func(in *kids.PlaybackInput) {
				in.Controls.ApprovalMode = kids.ApprovalAllowlistOnly
				in.ExplicitDecision = "allow"
			},
			wantAllow:  true,
			wantReason: kids.AllowedReason,
		},
		{
			name:       "the daily limit stops playback once reached",
			mutate:     func(in *kids.PlaybackInput) { in.SecondsToday = 60 * 60 },
			wantAllow:  false,
			wantReason: kids.ReasonDailyLimit,
		},
		{
			name:       "one second under the limit still plays",
			mutate:     func(in *kids.PlaybackInput) { in.SecondsToday = 60*60 - 1 },
			wantAllow:  true,
			wantReason: kids.AllowedReason,
		},
		{
			name:       "a zero daily limit means unlimited, not blocked",
			mutate:     func(in *kids.PlaybackInput) { in.Controls.DailyLimitMinutes = 0; in.SecondsToday = 99999 },
			wantAllow:  true,
			wantReason: kids.AllowedReason,
		},
		{
			name:       "outside the allowed hours nothing plays",
			mutate:     func(in *kids.PlaybackInput) { in.Now = at(23, 0) },
			wantAllow:  false,
			wantReason: kids.ReasonOutsideHours,
		},
		{
			name:       "a deactivated profile plays nothing",
			mutate:     func(in *kids.PlaybackInput) { in.ProfileActive = false },
			wantAllow:  false,
			wantReason: kids.ReasonProfileInactive,
		},
		{
			name: "a child older than the content ceiling is refused",
			mutate: func(in *kids.PlaybackInput) {
				in.ChildAgeYears = 14
				in.Controls.MaxContentAge = 10
			},
			wantAllow:  false,
			wantReason: kids.ReasonAgeLimit,
		},
		{
			name: "an explicit block outranks the daily limit message",
			mutate: func(in *kids.PlaybackInput) {
				in.ExplicitDecision = "block"
				in.SecondsToday = 99999
			},
			wantAllow:  false,
			wantReason: kids.ReasonParentBlocked,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			in := kids.PlaybackInput{
				Controls:           baseControls(),
				ChildAgeYears:      6,
				ProfileActive:      true,
				BookIsKidsFriendly: true,
				SecondsToday:       0,
				Now:                at(10, 0),
			}
			tc.mutate(&in)

			allowed, reason := kids.EvaluatePlayback(in)
			require.Equal(t, tc.wantAllow, allowed)
			require.Equal(t, tc.wantReason, reason)
		})
	}
}

// The bedtime-story window is the normal case, not an edge case: it
// crosses midnight, so the naive "from <= now < to" comparison is wrong
// for the single most-used feature in the kids app.
func TestWithinAllowedHoursWrapsMidnight(t *testing.T) {
	night := kids.Controls{AllowedFromMinute: 19 * 60, AllowedToMinute: 7 * 60}

	require.True(t, kids.WithinAllowedHours(night, at(20, 0)), "evening is inside the window")
	require.True(t, kids.WithinAllowedHours(night, at(23, 59)), "just before midnight is inside")
	require.True(t, kids.WithinAllowedHours(night, at(0, 30)), "after midnight is still the same night")
	require.True(t, kids.WithinAllowedHours(night, at(6, 59)), "the last minute before the end is inside")
	require.False(t, kids.WithinAllowedHours(night, at(7, 0)), "the end minute is exclusive")
	require.False(t, kids.WithinAllowedHours(night, at(12, 0)), "midday is outside a night window")

	day := kids.Controls{AllowedFromMinute: 6 * 60, AllowedToMinute: 21 * 60}
	require.True(t, kids.WithinAllowedHours(day, at(12, 0)))
	require.False(t, kids.WithinAllowedHours(day, at(5, 59)))
	require.False(t, kids.WithinAllowedHours(day, at(21, 0)))

	// A parent who sets both ends the same is not trying to lock the
	// child out for all eternity.
	always := kids.Controls{AllowedFromMinute: 0, AllowedToMinute: 0}
	require.True(t, kids.WithinAllowedHours(always, at(3, 0)))
}

func TestRemainingSecondsToday(t *testing.T) {
	c := kids.Controls{DailyLimitMinutes: 60}
	require.Equal(t, int64(3600), kids.RemainingSecondsToday(c, 0))
	require.Equal(t, int64(600), kids.RemainingSecondsToday(c, 3000))
	require.Equal(t, int64(0), kids.RemainingSecondsToday(c, 3600))
	require.Equal(t, int64(0), kids.RemainingSecondsToday(c, 9999), "never reports a negative countdown")
	require.Equal(t, int64(-1), kids.RemainingSecondsToday(kids.Controls{}, 500), "no limit is reported as -1, not 0")
}

func TestDefaultControlsAreRestrictive(t *testing.T) {
	// A parent who never opens the settings screen must still get a safe
	// default. If this test starts failing because a default was
	// loosened, that should be a deliberate product decision.
	c := kids.DefaultControls("profile-1", 6)

	require.Equal(t, 60, c.DailyLimitMinutes, "there is always a daily limit")
	require.Equal(t, kids.ApprovalKidsCatalog, c.ApprovalMode)
	require.True(t, c.AutodownloadWifiOnly, "never burn a parent's mobile data by default")
	require.False(t, kids.WithinAllowedHours(c, at(2, 0)), "the middle of the night is not allowed by default")
}
