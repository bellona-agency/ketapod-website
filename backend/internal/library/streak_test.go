package library_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"ketapod/internal/library"
)

func day(offset int, from time.Time) time.Time {
	return from.AddDate(0, 0, offset)
}

// Streaks is the rule product will want to argue about, so it is a pure
// function over a day list and gets a table rather than a database.
//
// The rule that matters: a streak survives if the user listened today
// OR yesterday. Breaking it at midnight punishes someone who listens
// every evening but opens the app earlier than usual, and gamification
// that feels unfair stops motivating.
func TestStreaks(t *testing.T) {
	now := time.Date(2026, 8, 29, 14, 0, 0, 0, time.UTC)
	today := time.Date(2026, 8, 29, 0, 0, 0, 0, time.UTC)

	tests := []struct {
		name        string
		days        []time.Time
		wantCurrent int
		wantLongest int
	}{
		{
			name:        "no listening at all",
			days:        nil,
			wantCurrent: 0,
			wantLongest: 0,
		},
		{
			name:        "listened today only",
			days:        []time.Time{today},
			wantCurrent: 1,
			wantLongest: 1,
		},
		{
			name:        "three consecutive days ending today",
			days:        []time.Time{today, day(-1, today), day(-2, today)},
			wantCurrent: 3,
			wantLongest: 3,
		},
		{
			name:        "ended yesterday: the streak is still alive",
			days:        []time.Time{day(-1, today), day(-2, today), day(-3, today)},
			wantCurrent: 3,
			wantLongest: 3,
		},
		{
			name:        "ended two days ago: the streak is broken",
			days:        []time.Time{day(-2, today), day(-3, today), day(-4, today)},
			wantCurrent: 0,
			wantLongest: 3,
		},
		{
			name: "a gap splits the run but the longest is remembered",
			days: []time.Time{
				today, day(-1, today), // current run of 2
				day(-5, today), day(-6, today), day(-7, today), day(-8, today), // older run of 4
			},
			wantCurrent: 2,
			wantLongest: 4,
		},
		{
			name:        "duplicate days count once",
			days:        []time.Time{today, today, day(-1, today), day(-1, today)},
			wantCurrent: 2,
			wantLongest: 2,
		},
		{
			name:        "unsorted input is handled",
			days:        []time.Time{day(-2, today), today, day(-1, today)},
			wantCurrent: 3,
			wantLongest: 3,
		},
		{
			name:        "a single old day leaves no current streak",
			days:        []time.Time{day(-30, today)},
			wantCurrent: 0,
			wantLongest: 1,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			current, longest := library.Streaks(tc.days, now)
			require.Equal(t, tc.wantCurrent, current, "current streak")
			require.Equal(t, tc.wantLongest, longest, "longest streak")
		})
	}
}

// A streak must not depend on what time of day the question is asked.
func TestStreaksIndependentOfTimeOfDay(t *testing.T) {
	today := time.Date(2026, 8, 29, 0, 0, 0, 0, time.UTC)
	days := []time.Time{today, day(-1, today)}

	for _, hour := range []int{0, 6, 12, 23} {
		now := time.Date(2026, 8, 29, hour, 30, 0, 0, time.UTC)
		current, _ := library.Streaks(days, now)
		require.Equal(t, 2, current, "hour %d", hour)
	}
}
