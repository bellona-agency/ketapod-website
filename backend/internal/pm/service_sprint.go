package pm

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
)

func (s *Service) Sprints(ctx context.Context, projectID string, states []string) ([]Sprint, error) {
	if states == nil {
		states = []string{}
	}
	sprints, err := s.repo.ListSprints(ctx, projectID, states)
	if err != nil {
		return nil, err
	}
	if sprints == nil {
		sprints = []Sprint{}
	}
	return sprints, nil
}

func (s *Service) CreateSprint(ctx context.Context, actor Member, projectID, name, goal string, startsAt, endsAt *time.Time) (Sprint, error) {
	if err := s.requireProjectWrite(ctx, actor, projectID); err != nil {
		return Sprint{}, err
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return Sprint{}, fmt.Errorf("%w: نام اسپرینت الزامی است", ErrValidation)
	}
	if startsAt != nil && endsAt != nil && !endsAt.After(*startsAt) {
		return Sprint{}, fmt.Errorf("%w: پایان اسپرینت باید بعد از شروع باشد", ErrValidation)
	}
	return s.repo.CreateSprint(ctx, projectID, name, goal, startsAt, endsAt)
}

func (s *Service) UpdateSprint(ctx context.Context, actor Member, sprintID, name, goal string, startsAt, endsAt *time.Time) (Sprint, error) {
	sprint, err := s.repo.SprintByID(ctx, sprintID)
	if err != nil {
		return Sprint{}, err
	}
	if err := s.requireProjectWrite(ctx, actor, sprint.ProjectID); err != nil {
		return Sprint{}, err
	}
	if startsAt != nil && endsAt != nil && !endsAt.After(*startsAt) {
		return Sprint{}, fmt.Errorf("%w: پایان اسپرینت باید بعد از شروع باشد", ErrValidation)
	}
	return s.repo.UpdateSprint(ctx, sprintID, strings.TrimSpace(name), goal, startsAt, endsAt)
}

// StartSprint is refused when the sprint is empty. An empty sprint that
// gets started is a burndown with no line and a velocity entry of zero,
// and the usual cause is pressing Start before dragging anything in.
func (s *Service) StartSprint(ctx context.Context, actor Member, sprintID string) (Sprint, error) {
	sprint, err := s.repo.SprintByID(ctx, sprintID)
	if err != nil {
		return Sprint{}, err
	}
	if err := s.requireProjectWrite(ctx, actor, sprint.ProjectID); err != nil {
		return Sprint{}, err
	}
	if sprint.IssueCount == 0 {
		return Sprint{}, fmt.Errorf("%w: اسپرینت خالی را نمی‌توان شروع کرد", ErrValidation)
	}

	if err := s.repo.StartSprint(ctx, sprintID); err != nil {
		if errors.Is(err, ErrConflict) {
			return Sprint{}, fmt.Errorf("%w: این پروژه همین حالا یک اسپرینت فعال دارد", ErrValidation)
		}
		return Sprint{}, err
	}

	started, err := s.repo.SprintByID(ctx, sprintID)
	if err != nil {
		return Sprint{}, err
	}

	assignees, err := s.repo.SprintAssigneeIDs(ctx, sprintID)
	if err == nil {
		items := make([]NewNotification, 0, len(assignees))
		for _, id := range assignees {
			items = append(items, NewNotification{
				MemberID: id, Kind: NotifySprintStarted, ActorID: actor.ID,
				Title: "اسپرینت «" + started.Name + "» شروع شد",
				Body:  started.Goal,
			})
		}
		s.notify(ctx, items)
	}
	return started, nil
}

// CompleteSprintResult reports what happened to the work that did not
// get finished, because that is the number the retrospective argues
// about.
type CompleteSprintResult struct {
	Sprint      Sprint `json:"sprint"`
	CarriedOver int64  `json:"carriedOver"`
	MovedTo     string `json:"movedTo,omitempty"`
}

// CompleteSprint closes the sprint and moves unfinished work out of it —
// into the next sprint, or back to the backlog. The move is recorded in
// the history of every issue it touches, which is what lets velocity
// still see them as having been committed.
func (s *Service) CompleteSprint(ctx context.Context, actor Member, sprintID, moveToSprintID string) (CompleteSprintResult, error) {
	sprint, err := s.repo.SprintByID(ctx, sprintID)
	if err != nil {
		return CompleteSprintResult{}, err
	}
	if err := s.requireProjectWrite(ctx, actor, sprint.ProjectID); err != nil {
		return CompleteSprintResult{}, err
	}

	if moveToSprintID != "" {
		target, err := s.repo.SprintByID(ctx, moveToSprintID)
		if err != nil {
			return CompleteSprintResult{}, err
		}
		if target.ProjectID != sprint.ProjectID {
			return CompleteSprintResult{}, fmt.Errorf("%w: اسپرینت مقصد از پروژه دیگری است", ErrValidation)
		}
		if target.State == SprintCompleted {
			return CompleteSprintResult{}, fmt.Errorf("%w: نمی‌توان کار را به اسپرینت بسته منتقل کرد", ErrValidation)
		}
	}

	// The unfinished issues are read before the move, because after it
	// they no longer point at this sprint and there is no way to know
	// which ones they were.
	unfinished, _, err := s.repo.SearchIssues(ctx, IssueFilter{
		SprintID:   sprintID,
		Categories: []string{CategoryTodo, CategoryInProgress},
		Limit:      500,
	})
	if err != nil {
		return CompleteSprintResult{}, err
	}

	var carried int64
	err = s.repo.InTx(ctx, func(tx *Repository) error {
		moved, err := tx.CompleteSprint(ctx, sprintID, moveToSprintID)
		if err != nil {
			return err
		}
		carried = moved

		for _, issue := range unfinished {
			entry := ActivityEntry{Field: "sprint", OldValue: sprintID, OldLabel: sprint.Name}
			if moveToSprintID != "" {
				entry.NewValue = moveToSprintID
			}
			if err := tx.RecordActivity(ctx, issue.ID, actor.ID, []ActivityEntry{entry}); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		if errors.Is(err, ErrConflict) {
			return CompleteSprintResult{}, fmt.Errorf("%w: فقط اسپرینت فعال را می‌توان بست", ErrValidation)
		}
		return CompleteSprintResult{}, err
	}

	completed, err := s.repo.SprintByID(ctx, sprintID)
	if err != nil {
		return CompleteSprintResult{}, err
	}
	return CompleteSprintResult{Sprint: completed, CarriedOver: carried, MovedTo: moveToSprintID}, nil
}

func (s *Service) DeleteSprint(ctx context.Context, actor Member, sprintID string) error {
	sprint, err := s.repo.SprintByID(ctx, sprintID)
	if err != nil {
		return err
	}
	if err := s.requireProjectWrite(ctx, actor, sprint.ProjectID); err != nil {
		return err
	}
	if err := s.repo.DeleteSprint(ctx, sprintID); err != nil {
		if errors.Is(err, ErrConflict) {
			return fmt.Errorf("%w: اسپرینت فعال را نمی‌توان حذف کرد، اول ببندش", ErrValidation)
		}
		return err
	}
	return nil
}

// Backlog is the ordered list of work not in any sprint, plus the
// sprints waiting to start. One call, because the backlog screen shows
// both and dragging happens between them.
type Backlog struct {
	Project Project  `json:"project"`
	Sprints []Sprint `json:"sprints"`
	Issues  []Issue  `json:"issues"`
	Total   int64    `json:"total"`
}

func (s *Service) Backlog(ctx context.Context, projectKey string, filter IssueFilter) (Backlog, error) {
	project, err := s.Project(ctx, projectKey)
	if err != nil {
		return Backlog{}, err
	}

	sprints, err := s.Sprints(ctx, project.ID, []string{SprintActive, SprintFuture})
	if err != nil {
		return Backlog{}, err
	}

	filter.ProjectID = project.ID
	filter.NoSprint = true
	if filter.Sort == "" {
		filter.Sort = "rank"
	}
	if filter.Limit == 0 {
		filter.Limit = 200
	}

	issues, total, err := s.SearchIssues(ctx, filter)
	if err != nil {
		return Backlog{}, err
	}
	return Backlog{Project: project, Sprints: sprints, Issues: issues, Total: total}, nil
}
