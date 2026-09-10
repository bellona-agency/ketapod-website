package pm

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"
)

// A project key is what people type and say out loud, so it is ASCII,
// short and upper-case even though the rest of the tool is Persian:
// "KET-142" survives being pasted into a terminal, a commit message and
// a branch name, and «کتاپاد-۱۴۲» does not.
var projectKeyPattern = regexp.MustCompile(`^[A-Z][A-Z0-9]{1,9}$`)

// defaultStatuses is the board a new project starts with. Four columns,
// because three has nowhere to put work that is waiting on someone else
// and five is a board nobody keeps up to date.
var defaultStatuses = []struct {
	Name     string
	Category string
	Color    string
}{
	{"برای انجام", CategoryTodo, "#6B8285"},
	{"در حال انجام", CategoryInProgress, "#2FB8AE"},
	{"بازبینی", CategoryInProgress, "#E0A94A"},
	{"انجام شد", CategoryDone, "#3FA96B"},
}

func (s *Service) ListProjects(ctx context.Context, actor Member, includeArchived bool) ([]Project, error) {
	projects, err := s.repo.ListProjects(ctx, actor.ID, actor.CanAdmin(), includeArchived)
	if err != nil {
		return nil, err
	}
	if projects == nil {
		projects = []Project{}
	}

	// The active sprint is what the project card is actually for: it
	// answers "what is this team doing this week" without opening the
	// project.
	for i := range projects {
		sprint, err := s.repo.ActiveSprint(ctx, projects[i].ID)
		if err != nil {
			return nil, err
		}
		projects[i].ActiveSprint = sprint
	}
	return projects, nil
}

func (s *Service) Project(ctx context.Context, key string) (Project, error) {
	project, err := s.repo.ProjectByKey(ctx, key)
	if err != nil {
		return Project{}, err
	}
	sprint, err := s.repo.ActiveSprint(ctx, project.ID)
	if err != nil {
		return Project{}, err
	}
	project.ActiveSprint = sprint
	return project, nil
}

type NewProject struct {
	Key         string
	Name        string
	Description string
	Color       string
	LeadID      string
}

// CreateProject writes the project, its default board and its first
// members in one transaction. A project that exists with no columns is
// a project whose first issue cannot be created, and that is exactly the
// state a partial failure here would leave behind.
func (s *Service) CreateProject(ctx context.Context, actor Member, in NewProject) (Project, error) {
	in.Key = strings.ToUpper(strings.TrimSpace(in.Key))
	in.Name = strings.TrimSpace(in.Name)

	if !projectKeyPattern.MatchString(in.Key) {
		return Project{}, fmt.Errorf("%w: کلید پروژه باید ۲ تا ۱۰ حرف لاتین بزرگ باشد", ErrValidation)
	}
	if utf8.RuneCountInString(in.Name) < 2 {
		return Project{}, fmt.Errorf("%w: نام پروژه الزامی است", ErrValidation)
	}
	if in.Color == "" {
		in.Color = "#2FB8AE"
	}

	var projectID string
	err := s.repo.InTx(ctx, func(tx *Repository) error {
		id, err := tx.CreateProject(ctx, in.Key, in.Name, in.Description, in.Color, in.LeadID, actor.ID)
		if err != nil {
			return err
		}
		projectID = id

		for i, st := range defaultStatuses {
			if _, err := tx.CreateStatus(ctx, id, st.Name, st.Category, st.Color, i, nil); err != nil {
				return err
			}
		}

		if err := tx.AddProjectMember(ctx, id, actor.ID, "lead"); err != nil {
			return err
		}
		if in.LeadID != "" && in.LeadID != actor.ID {
			if err := tx.AddProjectMember(ctx, id, in.LeadID, "lead"); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return Project{}, err
	}

	return s.repo.ProjectByID(ctx, projectID)
}

func (s *Service) UpdateProject(ctx context.Context, actor Member, projectID string, in NewProject) (Project, error) {
	if err := s.requireProjectWrite(ctx, actor, projectID); err != nil {
		return Project{}, err
	}
	if utf8.RuneCountInString(strings.TrimSpace(in.Name)) < 2 {
		return Project{}, fmt.Errorf("%w: نام پروژه الزامی است", ErrValidation)
	}
	if err := s.repo.UpdateProject(ctx, projectID, strings.TrimSpace(in.Name), in.Description, in.Color, in.LeadID); err != nil {
		return Project{}, err
	}
	if in.LeadID != "" {
		if err := s.repo.AddProjectMember(ctx, projectID, in.LeadID, "lead"); err != nil {
			return Project{}, err
		}
	}
	return s.repo.ProjectByID(ctx, projectID)
}

// SetProjectArchived hides a project without deleting anything. There is
// no delete: a project's issues are the record of what the team did, and
// a button that erases it will eventually be pressed.
func (s *Service) SetProjectArchived(ctx context.Context, actor Member, projectID string, archived bool) error {
	if !actor.CanAdmin() {
		return ErrForbidden
	}
	return s.repo.SetProjectArchived(ctx, projectID, archived)
}

func (s *Service) ProjectMembers(ctx context.Context, projectID string) ([]ProjectMember, error) {
	members, err := s.repo.ListProjectMembers(ctx, projectID)
	if err != nil {
		return nil, err
	}
	if members == nil {
		members = []ProjectMember{}
	}
	return members, nil
}

func (s *Service) AddProjectMember(ctx context.Context, actor Member, projectID, memberID, role string) error {
	if err := s.requireProjectWrite(ctx, actor, projectID); err != nil {
		return err
	}
	switch role {
	case "lead", "member", "viewer":
	default:
		return fmt.Errorf("%w: نقش نامعتبر", ErrValidation)
	}
	return s.repo.AddProjectMember(ctx, projectID, memberID, role)
}

func (s *Service) RemoveProjectMember(ctx context.Context, actor Member, projectID, memberID string) error {
	if err := s.requireProjectWrite(ctx, actor, projectID); err != nil {
		return err
	}
	return s.repo.RemoveProjectMember(ctx, projectID, memberID)
}

// ── statuses ───────────────────────────────────────────────────────────

func (s *Service) Statuses(ctx context.Context, projectID string) ([]Status, error) {
	statuses, err := s.repo.ListStatuses(ctx, projectID)
	if err != nil {
		return nil, err
	}
	if statuses == nil {
		statuses = []Status{}
	}
	return statuses, nil
}

func (s *Service) CreateStatus(ctx context.Context, actor Member, projectID, name, category, color string, wipLimit *int) (Status, error) {
	if err := s.requireProjectWrite(ctx, actor, projectID); err != nil {
		return Status{}, err
	}
	if !validCategory(category) {
		return Status{}, fmt.Errorf("%w: دسته وضعیت نامعتبر است", ErrValidation)
	}
	if strings.TrimSpace(name) == "" {
		return Status{}, fmt.Errorf("%w: نام ستون الزامی است", ErrValidation)
	}

	existing, err := s.repo.ListStatuses(ctx, projectID)
	if err != nil {
		return Status{}, err
	}
	if color == "" {
		color = "#6B8285"
	}
	return s.repo.CreateStatus(ctx, projectID, strings.TrimSpace(name), category, color, len(existing), wipLimit)
}

func (s *Service) UpdateStatus(ctx context.Context, actor Member, statusID, name, category, color string, position int, wipLimit *int) (Status, error) {
	status, err := s.repo.StatusByID(ctx, statusID)
	if err != nil {
		return Status{}, err
	}
	if err := s.requireProjectWrite(ctx, actor, status.ProjectID); err != nil {
		return Status{}, err
	}
	if !validCategory(category) {
		return Status{}, fmt.Errorf("%w: دسته وضعیت نامعتبر است", ErrValidation)
	}
	return s.repo.UpdateStatus(ctx, statusID, strings.TrimSpace(name), category, color, position, wipLimit)
}

// DeleteStatus refuses to leave issues without a column. The caller has
// to say where the work goes, and the move plus the delete are one
// transaction so a failure cannot strand them between columns.
func (s *Service) DeleteStatus(ctx context.Context, actor Member, statusID, moveToID string) error {
	status, err := s.repo.StatusByID(ctx, statusID)
	if err != nil {
		return err
	}
	if err := s.requireProjectWrite(ctx, actor, status.ProjectID); err != nil {
		return err
	}

	count, err := s.repo.CountStatuses(ctx, status.ProjectID)
	if err != nil {
		return err
	}
	if count <= 1 {
		return fmt.Errorf("%w: آخرین ستون برد را نمی‌توان حذف کرد", ErrValidation)
	}

	return s.repo.InTx(ctx, func(tx *Repository) error {
		if moveToID != "" {
			target, err := tx.StatusByID(ctx, moveToID)
			if err != nil {
				return err
			}
			if target.ProjectID != status.ProjectID {
				return fmt.Errorf("%w: ستون مقصد از پروژه دیگری است", ErrValidation)
			}
			if _, err := tx.MoveIssuesToStatus(ctx, statusID, moveToID); err != nil {
				return err
			}
		}
		return tx.DeleteStatus(ctx, statusID)
	})
}

func (s *Service) ReorderStatuses(ctx context.Context, actor Member, projectID string, orderedIDs []string) ([]Status, error) {
	if err := s.requireProjectWrite(ctx, actor, projectID); err != nil {
		return nil, err
	}

	err := s.repo.InTx(ctx, func(tx *Repository) error {
		for i, id := range orderedIDs {
			status, err := tx.StatusByID(ctx, id)
			if err != nil {
				return err
			}
			if status.ProjectID != projectID {
				return ErrForbidden
			}
			if _, err := tx.UpdateStatus(ctx, id, status.Name, status.Category, status.Color, i, status.WIPLimit); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.Statuses(ctx, projectID)
}

// ── labels ─────────────────────────────────────────────────────────────

func (s *Service) Labels(ctx context.Context, projectID string) ([]Label, error) {
	labels, err := s.repo.ListLabels(ctx, projectID)
	if err != nil {
		return nil, err
	}
	if labels == nil {
		labels = []Label{}
	}
	return labels, nil
}

func (s *Service) UpsertLabel(ctx context.Context, actor Member, projectID, name, color string) (Label, error) {
	if err := s.requireProjectWrite(ctx, actor, projectID); err != nil {
		return Label{}, err
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return Label{}, fmt.Errorf("%w: نام برچسب الزامی است", ErrValidation)
	}
	if color == "" {
		color = avatarColorFor(name)
	}
	return s.repo.UpsertLabel(ctx, projectID, name, color)
}

func (s *Service) DeleteLabel(ctx context.Context, actor Member, projectID, labelID string) error {
	if err := s.requireProjectWrite(ctx, actor, projectID); err != nil {
		return err
	}
	return s.repo.DeleteLabel(ctx, labelID)
}

// ── board ──────────────────────────────────────────────────────────────

// Board returns the columns with their cards. sprintID selects which
// slice of work is on the board: the active sprint by default, a named
// sprint when asked, or everything not yet in a sprint for a team
// running kanban rather than scrum.
func (s *Service) Board(ctx context.Context, projectKey, sprintID string, filter IssueFilter) (Board, error) {
	project, err := s.Project(ctx, projectKey)
	if err != nil {
		return Board{}, err
	}

	board := Board{Project: project, Columns: []BoardColumn{}}

	switch sprintID {
	case "backlog":
		filter.NoSprint = true
	case "":
		if project.ActiveSprint != nil {
			board.Sprint = project.ActiveSprint
			filter.SprintID = project.ActiveSprint.ID
		}
	default:
		sprint, err := s.repo.SprintByID(ctx, sprintID)
		if err != nil {
			return Board{}, err
		}
		board.Sprint = &sprint
		filter.SprintID = sprintID
	}

	statuses, err := s.repo.ListStatuses(ctx, project.ID)
	if err != nil {
		return Board{}, err
	}

	filter.ProjectID = project.ID
	filter.Sort = "rank"
	filter.Limit = 500
	issues, _, err := s.repo.SearchIssues(ctx, filter)
	if err != nil {
		return Board{}, err
	}

	// One query for the whole board, then bucketed here. A query per
	// column would be four to six round trips that each have to repeat
	// the same filter, and they would not see a consistent snapshot of
	// the board — a card dragged mid-load could appear twice or not at
	// all.
	byStatus := make(map[string][]Issue, len(statuses))
	points := make(map[string]float64, len(statuses))
	for _, issue := range issues {
		byStatus[issue.Status.ID] = append(byStatus[issue.Status.ID], issue)
		if issue.StoryPoints != nil {
			points[issue.Status.ID] += *issue.StoryPoints
		}
	}

	for _, status := range statuses {
		column := BoardColumn{Status: status, Issues: byStatus[status.ID], Points: points[status.ID]}
		if column.Issues == nil {
			column.Issues = []Issue{}
		}
		board.Columns = append(board.Columns, column)
	}
	return board, nil
}

// requireProjectWrite is the one place project-level permission is
// decided. An admin can touch any project; everyone else has to be on
// it, and a viewer never writes anywhere.
func (s *Service) requireProjectWrite(ctx context.Context, actor Member, projectID string) error {
	if !actor.CanWrite() {
		return ErrForbidden
	}
	if actor.CanAdmin() {
		return nil
	}
	ok, err := s.repo.IsProjectMember(ctx, projectID, actor.ID)
	if err != nil {
		return err
	}
	if !ok {
		return ErrForbidden
	}
	return nil
}

func validCategory(category string) bool {
	switch category {
	case CategoryTodo, CategoryInProgress, CategoryDone:
		return true
	}
	return false
}
