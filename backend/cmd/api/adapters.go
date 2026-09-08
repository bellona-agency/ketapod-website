package main

import (
	"context"
	"time"

	"ketapod/internal/kids"
	"ketapod/internal/library"
)

// This file is the composition root's translation layer.
//
// Modules declare what they need from each other as narrow interfaces
// in their own package, using their own types — that is what keeps
// kids from importing library and commerce from importing catalog's
// storage. Where two such interfaces describe the same data in two
// different shapes, the adapter belongs here, in the one place that is
// allowed to know about both.

// kidsListening adapts library.Service to kids.ListeningReader.
type kidsListening struct {
	lib *library.Service
}

func (a kidsListening) SecondsListenedToday(ctx context.Context, profileID string, loc *time.Location) (int64, error) {
	return a.lib.SecondsListenedToday(ctx, profileID, loc)
}

func (a kidsListening) WeeklyTotals(ctx context.Context, parentUserID, profileID, tz string, since time.Time) (int64, []kids.DayTotal, []kids.BookTotal, error) {
	stats, err := a.lib.StatsFor(ctx, parentUserID, profileID, tz, since)
	if err != nil {
		return 0, nil, nil, err
	}

	daily := make([]kids.DayTotal, len(stats.DailyBreakdown))
	for i, d := range stats.DailyBreakdown {
		daily[i] = kids.DayTotal{Date: d.Date, SecondsListened: d.SecondsListened}
	}
	top := make([]kids.BookTotal, len(stats.TopBooks))
	for i, b := range stats.TopBooks {
		top[i] = kids.BookTotal{
			BookID: b.BookID, Title: b.Title, CoverURL: b.CoverURL,
			SecondsListened: b.SecondsListened,
		}
	}
	return stats.TotalSeconds, daily, top, nil
}
