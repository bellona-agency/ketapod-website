package pm

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

type NewIssueInput struct {
	ProjectKey  string
	Type        string
	Title       string
	Description string
	StatusID    string
	Priority    string
	AssigneeID  string
	ParentID    string
	EpicID      string
	SprintID    string
	StoryPoints *float64
	EstimateSec *int
	DueAt       *time.Time
	LabelIDs    []string
	LabelNames  []string
}

// CreateIssue writes the issue and everything that has to be true the
// moment it exists: its number, its labels, its first history entry and
// the notification to whoever it was handed to.
//
// The first activity row records the starting status. Nothing displays
// it, and every report depends on it: reconstructing what an issue's
// status was on a given day means reading the last status change before
// that day, and an issue whose first status was never written has no
// status at all until someone happens to move it.
func (s *Service) CreateIssue(ctx context.Context, actor Member, in NewIssueInput) (Issue, error) {
	project, err := s.repo.ProjectByKey(ctx, in.ProjectKey)
	if err != nil {
		return Issue{}, err
	}
	if err := s.requireProjectWrite(ctx, actor, project.ID); err != nil {
		return Issue{}, err
	}

	in.Title = strings.TrimSpace(in.Title)
	if utf8.RuneCountInString(in.Title) < 2 {
		return Issue{}, fmt.Errorf("%w: عنوان الزامی است", ErrValidation)
	}
	if !validType(in.Type) {
		in.Type = TypeTask
	}
	if !validPriority(in.Priority) {
		in.Priority = PriorityMedium
	}

	statuses, err := s.repo.ListStatuses(ctx, project.ID)
	if err != nil {
		return Issue{}, err
	}
	if len(statuses) == 0 {
		return Issue{}, fmt.Errorf("%w: این پروژه هیچ ستونی ندارد", ErrValidation)
	}

	statusID := in.StatusID
	if statusID == "" {
		statusID = firstTodoStatus(statuses).ID
	} else if !statusBelongs(statuses, statusID) {
		return Issue{}, fmt.Errorf("%w: ستون انتخاب‌شده از این پروژه نیست", ErrValidation)
	}

	// A subtask inherits its parent's sprint. Splitting a story into
	// subtasks that sit outside the sprint is the fastest way to make a
	// burndown disagree with the board.
	if in.ParentID != "" {
		parent, err := s.repo.IssueByID(ctx, in.ParentID)
		if err != nil {
			return Issue{}, err
		}
		if parent.ProjectID != project.ID {
			return Issue{}, fmt.Errorf("%w: تسک والد از پروژه دیگری است", ErrValidation)
		}
		if in.SprintID == "" && parent.SprintID != nil {
			in.SprintID = *parent.SprintID
		}
		if in.EpicID == "" && parent.EpicID != nil {
			in.EpicID = *parent.EpicID
		}
	}

	var issueID string
	err = s.repo.InTx(ctx, func(tx *Repository) error {
		number, err := tx.NextIssueNumber(ctx, project.ID)
		if err != nil {
			return err
		}

		maxRank, err := tx.MaxRank(ctx, project.ID)
		if err != nil {
			return err
		}

		issueID, err = tx.CreateIssue(ctx, NewIssue{
			ProjectID:   project.ID,
			Number:      number,
			Type:        in.Type,
			Title:       in.Title,
			Description: in.Description,
			StatusID:    statusID,
			Priority:    in.Priority,
			ReporterID:  actor.ID,
			AssigneeID:  in.AssigneeID,
			ParentID:    in.ParentID,
			EpicID:      in.EpicID,
			SprintID:    in.SprintID,
			StoryPoints: in.StoryPoints,
			EstimateSec: in.EstimateSec,
			DueAt:       in.DueAt,
			Rank:        RankBetween(maxRank, ""),
		})
		if err != nil {
			return err
		}

		labelIDs, err := s.resolveLabels(ctx, tx, project.ID, in.LabelIDs, in.LabelNames)
		if err != nil {
			return err
		}
		if err := tx.SetIssueLabels(ctx, issueID, labelIDs); err != nil {
			return err
		}

		if err := ensureProjectMembership(ctx, tx, project.ID, in.AssigneeID); err != nil {
			return err
		}

		entries := []ActivityEntry{
			{Field: "created"},
			{Field: "status", NewValue: statusID, NewLabel: statusName(statuses, statusID)},
		}
		if in.SprintID != "" {
			entries = append(entries, ActivityEntry{Field: "sprint", NewValue: in.SprintID})
		}
		return tx.RecordActivity(ctx, issueID, actor.ID, entries)
	})
	if err != nil {
		return Issue{}, err
	}

	issue, err := s.repo.IssueByID(ctx, issueID)
	if err != nil {
		return Issue{}, err
	}

	if in.AssigneeID != "" {
		s.notify(ctx, []NewNotification{{
			MemberID: in.AssigneeID, Kind: NotifyAssigned, IssueID: issueID, ActorID: actor.ID,
			Title: issue.Key + " به شما واگذار شد",
			Body:  issue.Title,
		}})
	}
	return issue, nil
}

// IssuePatchInput is the wire shape of a partial update. Every pointer
// is "the client sent this field"; the Clear flags are "the client sent
// it as null", which for assignee, sprint and due date means something
// different from not sending it at all.
type IssuePatchInput struct {
	Title       *string
	Description *string
	Type        *string
	Priority    *string
	StatusID    *string
	AssigneeID  *string
	SprintID    *string
	EpicID      *string
	ParentID    *string
	StoryPoints *float64
	EstimateSec *int
	DueAt       *time.Time
	LabelIDs    *[]string

	ClearAssignee bool
	ClearSprint   bool
	ClearEpic     bool
	ClearParent   bool
	ClearDue      bool
	ClearPoints   bool
}

// UpdateIssue applies the patch, records what changed, and tells the
// people who care.
//
// The diff is computed against the issue as it is now rather than
// trusting the client to say what changed: two people editing the same
// issue would otherwise each write history for fields they did not
// touch, and the activity feed — which the reports read — would fill
// with changes that never happened.
func (s *Service) UpdateIssue(ctx context.Context, actor Member, issueID string, in IssuePatchInput) (Issue, error) {
	before, err := s.repo.IssueByID(ctx, issueID)
	if err != nil {
		return Issue{}, err
	}
	if err := s.requireProjectWrite(ctx, actor, before.ProjectID); err != nil {
		return Issue{}, err
	}

	statuses, err := s.repo.ListStatuses(ctx, before.ProjectID)
	if err != nil {
		return Issue{}, err
	}

	patch := IssuePatch{
		Title: in.Title, Description: in.Description, Type: in.Type,
		Priority: in.Priority, StatusID: in.StatusID,
		AssigneeID: in.AssigneeID, SprintID: in.SprintID, EpicID: in.EpicID,
		ParentID: in.ParentID, StoryPoints: in.StoryPoints, EstimateSec: in.EstimateSec,
		DueAt:         in.DueAt,
		ClearAssignee: in.ClearAssignee, ClearSprint: in.ClearSprint,
		ClearEpic: in.ClearEpic, ClearParent: in.ClearParent,
		ClearDue: in.ClearDue, ClearPoints: in.ClearPoints,
	}

	if in.StatusID != nil && !statusBelongs(statuses, *in.StatusID) {
		return Issue{}, fmt.Errorf("%w: ستون انتخاب‌شده از این پروژه نیست", ErrValidation)
	}
	if in.ParentID != nil && *in.ParentID != "" {
		if err := s.assertNoParentCycle(ctx, issueID, *in.ParentID); err != nil {
			return Issue{}, err
		}
	}

	entries := s.diffIssue(before, in, statuses)

	err = s.repo.InTx(ctx, func(tx *Repository) error {
		if err := tx.UpdateIssue(ctx, issueID, patch); err != nil {
			return err
		}
		if in.LabelIDs != nil {
			if err := tx.SetIssueLabels(ctx, issueID, *in.LabelIDs); err != nil {
				return err
			}
		}
		if in.AssigneeID != nil {
			if err := ensureProjectMembership(ctx, tx, before.ProjectID, *in.AssigneeID); err != nil {
				return err
			}
		}
		return tx.RecordActivity(ctx, issueID, actor.ID, entries)
	})
	if err != nil {
		return Issue{}, err
	}

	after, err := s.repo.IssueByID(ctx, issueID)
	if err != nil {
		return Issue{}, err
	}
	s.notifyIssueChange(ctx, actor, after, entries)
	return after, nil
}

// diffIssue turns "what the client asked for" into "what actually
// changed". A patch that sets a field to the value it already has
// produces no history row — otherwise re-saving a form would flood the
// activity feed with entries that say nothing.
func (s *Service) diffIssue(before Issue, in IssuePatchInput, statuses []Status) []ActivityEntry {
	var entries []ActivityEntry

	if in.Title != nil && *in.Title != before.Title {
		entries = append(entries, ActivityEntry{Field: "title", OldValue: before.Title, NewValue: *in.Title})
	}
	if in.Description != nil {
		entries = append(entries, ActivityEntry{Field: "description"})
	}
	if in.Type != nil && *in.Type != before.Type {
		entries = append(entries, ActivityEntry{Field: "type", OldValue: before.Type, NewValue: *in.Type})
	}
	if in.Priority != nil && *in.Priority != before.Priority {
		entries = append(entries, ActivityEntry{Field: "priority", OldValue: before.Priority, NewValue: *in.Priority})
	}
	if in.StatusID != nil && *in.StatusID != before.Status.ID {
		entries = append(entries, ActivityEntry{
			Field:    "status",
			OldValue: before.Status.ID, OldLabel: before.Status.Name,
			NewValue: *in.StatusID, NewLabel: statusName(statuses, *in.StatusID),
		})
	}

	oldAssignee := refID(before.Assignee)
	switch {
	case in.ClearAssignee && oldAssignee != "":
		entries = append(entries, ActivityEntry{Field: "assignee", OldValue: oldAssignee, OldLabel: refName(before.Assignee)})
	case in.AssigneeID != nil && *in.AssigneeID != oldAssignee:
		entries = append(entries, ActivityEntry{Field: "assignee", OldValue: oldAssignee, OldLabel: refName(before.Assignee), NewValue: *in.AssigneeID})
	}

	oldSprint := derefString(before.SprintID)
	switch {
	case in.ClearSprint && oldSprint != "":
		entries = append(entries, ActivityEntry{Field: "sprint", OldValue: oldSprint})
	case in.SprintID != nil && *in.SprintID != oldSprint:
		entries = append(entries, ActivityEntry{Field: "sprint", OldValue: oldSprint, NewValue: *in.SprintID})
	}

	oldEpic := derefString(before.EpicID)
	switch {
	case in.ClearEpic && oldEpic != "":
		entries = append(entries, ActivityEntry{Field: "epic", OldValue: oldEpic})
	case in.EpicID != nil && *in.EpicID != oldEpic:
		entries = append(entries, ActivityEntry{Field: "epic", OldValue: oldEpic, NewValue: *in.EpicID})
	}

	oldParent := derefString(before.ParentID)
	switch {
	case in.ClearParent && oldParent != "":
		entries = append(entries, ActivityEntry{Field: "parent", OldValue: oldParent})
	case in.ParentID != nil && *in.ParentID != oldParent:
		entries = append(entries, ActivityEntry{Field: "parent", OldValue: oldParent, NewValue: *in.ParentID})
	}

	switch {
	case in.ClearPoints && before.StoryPoints != nil:
		entries = append(entries, ActivityEntry{Field: "points", OldValue: formatPoints(before.StoryPoints)})
	case in.StoryPoints != nil && (before.StoryPoints == nil || *in.StoryPoints != *before.StoryPoints):
		entries = append(entries, ActivityEntry{Field: "points",
			OldValue: formatPoints(before.StoryPoints), NewValue: formatPoints(in.StoryPoints)})
	}

	switch {
	case in.ClearDue && before.DueAt != nil:
		entries = append(entries, ActivityEntry{Field: "due", OldValue: before.DueAt.Format(time.RFC3339)})
	case in.DueAt != nil && (before.DueAt == nil || !in.DueAt.Equal(*before.DueAt)):
		old := ""
		if before.DueAt != nil {
			old = before.DueAt.Format(time.RFC3339)
		}
		entries = append(entries, ActivityEntry{Field: "due", OldValue: old, NewValue: in.DueAt.Format(time.RFC3339)})
	}

	if in.LabelIDs != nil {
		entries = append(entries, ActivityEntry{Field: "labels"})
	}
	return entries
}

// MoveIssue is the drag: a new column, a new position, or both. The
// client sends the neighbours it dropped between, not a rank — a rank
// from the client is a rank from a board that may be seconds out of
// date.
func (s *Service) MoveIssue(ctx context.Context, actor Member, issueID, statusID, afterID, beforeID, sprintID string, clearSprint bool) (Issue, error) {
	before, err := s.repo.IssueByID(ctx, issueID)
	if err != nil {
		return Issue{}, err
	}
	if err := s.requireProjectWrite(ctx, actor, before.ProjectID); err != nil {
		return Issue{}, err
	}

	prev, next, err := s.repo.NeighbourRanks(ctx, afterID, beforeID)
	if err != nil {
		return Issue{}, err
	}
	rank := RankBetween(prev, next)

	var in IssuePatchInput
	if statusID != "" && statusID != before.Status.ID {
		in.StatusID = &statusID
	}
	if clearSprint {
		in.ClearSprint = true
	} else if sprintID != "" {
		in.SprintID = &sprintID
	}

	statuses, err := s.repo.ListStatuses(ctx, before.ProjectID)
	if err != nil {
		return Issue{}, err
	}
	if in.StatusID != nil && !statusBelongs(statuses, statusID) {
		return Issue{}, fmt.Errorf("%w: ستون مقصد از این پروژه نیست", ErrValidation)
	}

	entries := s.diffIssue(before, in, statuses)

	patch := IssuePatch{Rank: &rank, StatusID: in.StatusID, SprintID: in.SprintID, ClearSprint: in.ClearSprint}
	err = s.repo.InTx(ctx, func(tx *Repository) error {
		if err := tx.UpdateIssue(ctx, issueID, patch); err != nil {
			return err
		}
		return tx.RecordActivity(ctx, issueID, actor.ID, entries)
	})
	if err != nil {
		return Issue{}, err
	}

	after, err := s.repo.IssueByID(ctx, issueID)
	if err != nil {
		return Issue{}, err
	}
	s.notifyIssueChange(ctx, actor, after, entries)
	return after, nil
}

func (s *Service) SearchIssues(ctx context.Context, filter IssueFilter) ([]Issue, int64, error) {
	issues, total, err := s.repo.SearchIssues(ctx, filter)
	if err != nil {
		return nil, 0, err
	}
	if issues == nil {
		issues = []Issue{}
	}
	return issues, total, nil
}

// Issue assembles the whole issue page in one response. Six queries in
// one round trip beats six round trips: every one of these panels is
// visible the moment the page opens, so fetching them lazily would only
// move the waiting.
func (s *Service) Issue(ctx context.Context, projectKey string, number int64) (IssueDetail, error) {
	issue, err := s.repo.IssueByKey(ctx, projectKey, number)
	if err != nil {
		return IssueDetail{}, err
	}

	description, err := s.repo.IssueDescription(ctx, issue.ID)
	if err != nil {
		return IssueDetail{}, err
	}
	issue.Description = description

	detail := IssueDetail{Issue: issue}

	if detail.Comments, err = s.repo.ListComments(ctx, issue.ID); err != nil {
		return IssueDetail{}, err
	}
	if detail.Attachments, err = s.repo.ListAttachments(ctx, issue.ID); err != nil {
		return IssueDetail{}, err
	}
	if detail.Activity, err = s.repo.ListActivity(ctx, issue.ID, 100); err != nil {
		return IssueDetail{}, err
	}
	if detail.Links, err = s.repo.ListIssueLinks(ctx, issue.ID); err != nil {
		return IssueDetail{}, err
	}
	if detail.Watchers, err = s.repo.ListWatchers(ctx, issue.ID); err != nil {
		return IssueDetail{}, err
	}
	if detail.Worklogs, err = s.repo.ListWorklogs(ctx, issue.ID); err != nil {
		return IssueDetail{}, err
	}

	subtasks, _, err := s.repo.SearchIssues(ctx, IssueFilter{ParentID: issue.ID, Sort: "rank", Limit: 100})
	if err != nil {
		return IssueDetail{}, err
	}
	detail.Subtasks = subtasks

	if detail.Attachments == nil {
		detail.Attachments = []Attachment{}
	}
	if detail.Comments == nil {
		detail.Comments = []Comment{}
	}
	if detail.Activity == nil {
		detail.Activity = []Activity{}
	}
	if detail.Links == nil {
		detail.Links = []IssueLink{}
	}
	if detail.Watchers == nil {
		detail.Watchers = []MemberRef{}
	}
	if detail.Worklogs == nil {
		detail.Worklogs = []Worklog{}
	}
	if detail.Subtasks == nil {
		detail.Subtasks = []Issue{}
	}

	// The attachment URL is built here rather than stored, so moving
	// buckets never means rewriting rows.
	for i := range detail.Attachments {
		detail.Attachments[i].URL = "/api/v1/attachments/" + detail.Attachments[i].ID
	}
	return detail, nil
}

// DeleteIssue is admin-only and takes its subtasks with it. Everyone
// else closes issues; deleting one destroys the record of why it
// existed, and that is not a decision to leave on every card.
func (s *Service) DeleteIssue(ctx context.Context, actor Member, issueID string) error {
	if !actor.CanAdmin() {
		return ErrForbidden
	}
	return s.repo.DeleteIssue(ctx, issueID)
}

// ── links and watchers ─────────────────────────────────────────────────

func (s *Service) LinkIssues(ctx context.Context, actor Member, sourceID, kind, targetKey string) error {
	source, err := s.repo.IssueByID(ctx, sourceID)
	if err != nil {
		return err
	}
	if err := s.requireProjectWrite(ctx, actor, source.ProjectID); err != nil {
		return err
	}
	switch kind {
	case "blocks", "relates", "duplicates", "causes":
	default:
		return fmt.Errorf("%w: نوع پیوند نامعتبر است", ErrValidation)
	}

	target, err := s.issueByKeyString(ctx, targetKey)
	if err != nil {
		return err
	}
	if target.ID == sourceID {
		return fmt.Errorf("%w: یک ایشیو را نمی‌توان به خودش پیوند داد", ErrValidation)
	}
	return s.repo.CreateIssueLink(ctx, kind, sourceID, target.ID, actor.ID)
}

func (s *Service) UnlinkIssues(ctx context.Context, actor Member, linkID string) error {
	if !actor.CanWrite() {
		return ErrForbidden
	}
	return s.repo.DeleteIssueLink(ctx, linkID)
}

func (s *Service) SetWatching(ctx context.Context, actor Member, issueID string, watching bool) error {
	return s.repo.SetWatching(ctx, issueID, actor.ID, watching)
}

// issueByKeyString parses "KET-142" the way a person types it.
func (s *Service) issueByKeyString(ctx context.Context, key string) (Issue, error) {
	key = strings.TrimSpace(strings.ToUpper(key))
	dash := strings.LastIndex(key, "-")
	if dash <= 0 {
		return Issue{}, fmt.Errorf("%w: کلید ایشیو نامعتبر است", ErrValidation)
	}
	number, err := strconv.ParseInt(key[dash+1:], 10, 64)
	if err != nil {
		return Issue{}, fmt.Errorf("%w: کلید ایشیو نامعتبر است", ErrValidation)
	}
	return s.repo.IssueByKey(ctx, key[:dash], number)
}

// assertNoParentCycle refuses a parent that is already a descendant.
// Without it a two-issue loop makes the subtask tree infinite and the
// issue page never finishes rendering.
func (s *Service) assertNoParentCycle(ctx context.Context, issueID, parentID string) error {
	if issueID == parentID {
		return fmt.Errorf("%w: یک تسک نمی‌تواند والد خودش باشد", ErrValidation)
	}
	ancestors, err := s.repo.AncestorIDs(ctx, parentID)
	if err != nil {
		return err
	}
	for _, id := range ancestors {
		if id == issueID {
			return fmt.Errorf("%w: این تغییر یک حلقه در درخت تسک‌ها می‌سازد", ErrValidation)
		}
	}
	return nil
}

// ensureProjectMembership adds whoever was just handed the work to the
// project, if they were not on it already.
//
// Without this the tool contradicts itself: the assignee list falls back
// to the whole team when a project has no members yet, so anyone can be
// assigned anything — and then the person assigned cannot comment on
// their own issue, because commenting requires project membership.
// Being given work on a project is the definition of being on it.
func ensureProjectMembership(ctx context.Context, tx *Repository, projectID, memberID string) error {
	if memberID == "" {
		return nil
	}
	onIt, err := tx.IsProjectMember(ctx, projectID, memberID)
	if err != nil || onIt {
		return err
	}
	return tx.AddProjectMember(ctx, projectID, memberID, "member")
}

func (s *Service) resolveLabels(ctx context.Context, tx *Repository, projectID string, ids, names []string) ([]string, error) {
	out := append([]string(nil), ids...)
	for _, name := range names {
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		label, err := tx.UpsertLabel(ctx, projectID, name, avatarColorFor(name))
		if err != nil {
			return nil, err
		}
		out = append(out, label.ID)
	}
	return out, nil
}

func firstTodoStatus(statuses []Status) Status {
	for _, s := range statuses {
		if s.Category == CategoryTodo {
			return s
		}
	}
	return statuses[0]
}

func statusBelongs(statuses []Status, id string) bool {
	for _, s := range statuses {
		if s.ID == id {
			return true
		}
	}
	return false
}

func statusName(statuses []Status, id string) string {
	for _, s := range statuses {
		if s.ID == id {
			return s.Name
		}
	}
	return ""
}

func refID(ref *MemberRef) string {
	if ref == nil {
		return ""
	}
	return ref.ID
}

func refName(ref *MemberRef) string {
	if ref == nil {
		return ""
	}
	return ref.FullName
}

func formatPoints(points *float64) string {
	if points == nil {
		return ""
	}
	return strconv.FormatFloat(*points, 'f', -1, 64)
}

func validType(t string) bool {
	switch t {
	case TypeEpic, TypeStory, TypeTask, TypeBug, TypeSubtask:
		return true
	}
	return false
}

func validPriority(p string) bool {
	switch p {
	case PriorityLowest, PriorityLow, PriorityMedium, PriorityHigh, PriorityHighest:
		return true
	}
	return false
}
