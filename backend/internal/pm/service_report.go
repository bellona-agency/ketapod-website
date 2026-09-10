package pm

import (
	"context"
	"time"
)

// Reports.
//
// Three questions, one each: is this sprint going to land (burndown),
// how much does this team actually finish in a sprint (velocity), and
// who is holding too much right now (workload). Cycle time rides along
// with velocity because it answers the follow-up — "are we getting
// faster" — from the same history.

func (s *Service) Burndown(ctx context.Context, sprintID string) (Burndown, error) {
	sprint, err := s.repo.SprintByID(ctx, sprintID)
	if err != nil {
		return Burndown{}, err
	}

	from, to := sprintWindow(sprint)
	points, err := s.repo.Burndown(ctx, sprintID, from, to)
	if err != nil {
		return Burndown{}, err
	}
	if points == nil {
		points = []BurndownPoint{}
	}
	return Burndown{Sprint: sprint, Unit: "points", Points: points}, nil
}

// sprintWindow decides which days the chart covers. A running sprint is
// drawn to today, not to its planned end: extending the line into the
// future would draw a flat tail that looks like the team stopped
// working.
func sprintWindow(sprint Sprint) (from, to time.Time) {
	from = sprint.CreatedAtOrStart()
	switch {
	case sprint.CompletedAt != nil:
		to = *sprint.CompletedAt
	case sprint.EndsAt != nil && sprint.EndsAt.Before(time.Now()):
		to = *sprint.EndsAt
	default:
		to = time.Now()
	}
	if to.Before(from) {
		to = from
	}
	// A chart of one point is a dot. Two weeks is the common sprint, and
	// anything shorter than a day still gets a start and an end.
	if to.Sub(from) < 24*time.Hour {
		to = from.Add(24 * time.Hour)
	}
	return from, to
}

// CreatedAtOrStart is the day the burndown starts from: when the sprint
// was actually started, falling back to its planned start for a sprint
// that has not begun.
func (s Sprint) CreatedAtOrStart() time.Time {
	switch {
	case s.StartedAt != nil:
		return *s.StartedAt
	case s.StartsAt != nil:
		return *s.StartsAt
	default:
		return time.Now().Add(-24 * time.Hour)
	}
}

// Velocity reports the last completed sprints. Committed comes from what
// the sprint held the moment it started, so work added mid-sprint does
// not quietly inflate the team's apparent capacity.
func (s *Service) Velocity(ctx context.Context, projectID string, limit int) ([]VelocityEntry, error) {
	sprints, err := s.repo.ListSprints(ctx, projectID, []string{SprintCompleted})
	if err != nil {
		return nil, err
	}

	if limit <= 0 || limit > 24 {
		limit = 8
	}
	if len(sprints) > limit {
		sprints = sprints[len(sprints)-limit:]
	}

	out := make([]VelocityEntry, 0, len(sprints))
	for _, sprint := range sprints {
		if sprint.StartedAt == nil || sprint.CompletedAt == nil {
			continue
		}

		committed, completed, committedCount, doneCount, carried, err :=
			s.repo.SprintTotals(ctx, sprint.ID, *sprint.StartedAt, *sprint.CompletedAt)
		if err != nil {
			return nil, err
		}

		out = append(out, VelocityEntry{
			SprintID:      sprint.ID,
			SprintName:    sprint.Name,
			Committed:     committed,
			Completed:     completed,
			IssuesDone:    doneCount,
			CommittedCnt:  committedCount,
			CarriedOverAt: carried,
			CompletedAt:   sprint.CompletedAt.Format("2006-01-02"),
		})
	}
	return out, nil
}

func (s *Service) Workload(ctx context.Context, projectID string, from, to time.Time) ([]WorkloadEntry, error) {
	entries, err := s.repo.Workload(ctx, projectID, from, to)
	if err != nil {
		return nil, err
	}
	if entries == nil {
		entries = []WorkloadEntry{}
	}
	return entries, nil
}

type CycleTime struct {
	MedianSeconds  float64 `json:"medianSeconds"`
	AverageSeconds float64 `json:"averageSeconds"`
	SampleSize     int64   `json:"sampleSize"`
	SinceDays      int     `json:"sinceDays"`
}

func (s *Service) CycleTime(ctx context.Context, projectID string, sinceDays int) (CycleTime, error) {
	if sinceDays <= 0 {
		sinceDays = 90
	}
	since := time.Now().AddDate(0, 0, -sinceDays)

	median, average, sample, err := s.repo.CycleTimeSeconds(ctx, projectID, since)
	if err != nil {
		return CycleTime{}, err
	}
	return CycleTime{MedianSeconds: median, AverageSeconds: average, SampleSize: sample, SinceDays: sinceDays}, nil
}
