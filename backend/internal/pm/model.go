// Package pm is the team's internal project-management tool: projects,
// issues, boards, sprints, collaboration and reports.
//
// It is a module like any other in 04-architecture.md — handler ->
// service -> repo, one schema it alone owns — with two deliberate
// differences.
//
// First, it has its own binary (cmd/pmapi) rather than routes on the
// customer API. An internal tool and a customer-facing API have opposite
// failure budgets: a bad deploy of the board must not be able to stop
// audio playback, and a traffic spike on the catalogue must not slow the
// tool the team uses to fix it. They share the platform layer and the
// database, nothing else.
//
// Second, its identity is its own. pm.members is not identity.users: a
// teammate is not necessarily a Ketapod listener, and putting the people
// who run the company through SMS OTP every morning costs money per
// login for no security we do not already get from the tool not being
// public.
//
// Data access here is hand-written pgx rather than sqlc, which is the
// one place this module departs from the house style. Most of its read
// paths — the board, the backlog, issue search, every report — are
// filters the user composes at runtime, which sqlc cannot express; the
// alternative was splitting one module's data access across two
// mechanisms, which is worse than picking one. See 08-decisions.md.
package pm

import "time"

// Global roles. A member's role inside one project is separate and
// lives in pm.project_members — being an admin of the tool and being
// the lead of a project are different powers.
const (
	RoleOwner  = "owner"
	RoleAdmin  = "admin"
	RoleMember = "member"
	RoleViewer = "viewer"
)

const (
	StatusInvited  = "invited"
	StatusActive   = "active"
	StatusDisabled = "disabled"
)

// Status categories. Reports read these, never the status name: a team
// that renames "Done" to "تحویل شد" must not get an empty burndown.
const (
	CategoryTodo       = "todo"
	CategoryInProgress = "in_progress"
	CategoryDone       = "done"
)

const (
	TypeEpic    = "epic"
	TypeStory   = "story"
	TypeTask    = "task"
	TypeBug     = "bug"
	TypeSubtask = "subtask"
)

const (
	PriorityLowest  = "lowest"
	PriorityLow     = "low"
	PriorityMedium  = "medium"
	PriorityHigh    = "high"
	PriorityHighest = "highest"
)

const (
	SprintFuture    = "future"
	SprintActive    = "active"
	SprintCompleted = "completed"
)

const (
	NotifyAssigned      = "assigned"
	NotifyMentioned     = "mentioned"
	NotifyCommented     = "commented"
	NotifyStatusChanged = "status_changed"
	NotifySprintStarted = "sprint_started"
	NotifyDueSoon       = "due_soon"
)

type Member struct {
	ID          string     `json:"id"`
	Email       string     `json:"email"`
	FullName    string     `json:"fullName"`
	AvatarColor string     `json:"avatarColor"`
	Role        string     `json:"role"`
	Status      string     `json:"status"`
	Timezone    string     `json:"timezone"`
	LastSeenAt  *time.Time `json:"lastSeenAt,omitempty"`
	CreatedAt   time.Time  `json:"createdAt"`
}

// MemberRef is the shape every issue, comment and activity row embeds.
// The full Member carries an email, and an email is the one field on a
// teammate that has no business being in the payload of a board the
// whole team polls every few seconds.
type MemberRef struct {
	ID          string `json:"id"`
	FullName    string `json:"fullName"`
	AvatarColor string `json:"avatarColor"`
}

// CanAdmin reports whether the member may manage other members,
// projects and global settings.
func (m Member) CanAdmin() bool { return m.Role == RoleOwner || m.Role == RoleAdmin }

// CanWrite reports whether the member may change anything at all. A
// viewer reads the board and reports and nothing else.
func (m Member) CanWrite() bool { return m.Role != RoleViewer }

type Project struct {
	ID           string     `json:"id"`
	Key          string     `json:"key"`
	Name         string     `json:"name"`
	Description  string     `json:"description"`
	Color        string     `json:"color"`
	Lead         *MemberRef `json:"lead,omitempty"`
	ArchivedAt   *time.Time `json:"archivedAt,omitempty"`
	CreatedAt    time.Time  `json:"createdAt"`
	IssueCount   int64      `json:"issueCount"`
	OpenCount    int64      `json:"openCount"`
	MemberCount  int64      `json:"memberCount"`
	ActiveSprint *Sprint    `json:"activeSprint,omitempty"`
}

type ProjectMember struct {
	Member MemberRef `json:"member"`
	Role   string    `json:"role"`
	Email  string    `json:"email"`
}

type Status struct {
	ID        string `json:"id"`
	ProjectID string `json:"projectId"`
	Name      string `json:"name"`
	Category  string `json:"category"`
	Position  int    `json:"position"`
	Color     string `json:"color"`
	WIPLimit  *int   `json:"wipLimit,omitempty"`
}

type Label struct {
	ID        string `json:"id"`
	ProjectID string `json:"projectId"`
	Name      string `json:"name"`
	Color     string `json:"color"`
}

type Sprint struct {
	ID          string     `json:"id"`
	ProjectID   string     `json:"projectId"`
	Name        string     `json:"name"`
	Goal        string     `json:"goal"`
	State       string     `json:"state"`
	StartsAt    *time.Time `json:"startsAt,omitempty"`
	EndsAt      *time.Time `json:"endsAt,omitempty"`
	StartedAt   *time.Time `json:"startedAt,omitempty"`
	CompletedAt *time.Time `json:"completedAt,omitempty"`
	IssueCount  int64      `json:"issueCount"`
	DoneCount   int64      `json:"doneCount"`
	Points      float64    `json:"points"`
	DonePoints  float64    `json:"donePoints"`
}

type Issue struct {
	ID          string     `json:"id"`
	Key         string     `json:"key"`
	ProjectID   string     `json:"projectId"`
	ProjectKey  string     `json:"projectKey"`
	Number      int64      `json:"number"`
	Type        string     `json:"type"`
	Title       string     `json:"title"`
	Description string     `json:"description,omitempty"`
	Status      Status     `json:"status"`
	Priority    string     `json:"priority"`
	Reporter    *MemberRef `json:"reporter,omitempty"`
	Assignee    *MemberRef `json:"assignee,omitempty"`
	ParentID    *string    `json:"parentId,omitempty"`
	ParentKey   *string    `json:"parentKey,omitempty"`
	EpicID      *string    `json:"epicId,omitempty"`
	EpicKey     *string    `json:"epicKey,omitempty"`
	SprintID    *string    `json:"sprintId,omitempty"`
	StoryPoints *float64   `json:"storyPoints,omitempty"`
	EstimateSec *int       `json:"estimateSeconds,omitempty"`
	SpentSec    int        `json:"spentSeconds"`
	DueAt       *time.Time `json:"dueAt,omitempty"`
	Rank        string     `json:"-"`
	Labels      []Label    `json:"labels"`
	CommentCnt  int        `json:"commentCount"`
	SubtaskCnt  int        `json:"subtaskCount"`
	ResolvedAt  *time.Time `json:"resolvedAt,omitempty"`
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
}

// IssueDetail is what the issue page needs and the board deliberately
// does not: descriptions, history and attachments are large, and a board
// of two hundred cards that carried them would be a megabyte per poll.
type IssueDetail struct {
	Issue
	Comments    []Comment    `json:"comments"`
	Attachments []Attachment `json:"attachments"`
	Activity    []Activity   `json:"activity"`
	Links       []IssueLink  `json:"links"`
	Subtasks    []Issue      `json:"subtasks"`
	Watchers    []MemberRef  `json:"watchers"`
	Worklogs    []Worklog    `json:"worklogs"`
}

type Comment struct {
	ID        string     `json:"id"`
	IssueID   string     `json:"issueId"`
	Author    *MemberRef `json:"author,omitempty"`
	Body      string     `json:"body"`
	EditedAt  *time.Time `json:"editedAt,omitempty"`
	CreatedAt time.Time  `json:"createdAt"`
}

type Attachment struct {
	ID         string    `json:"id"`
	IssueID    string    `json:"issueId"`
	CommentID  *string   `json:"commentId,omitempty"`
	FileName   string    `json:"fileName"`
	MimeType   string    `json:"mimeType"`
	SizeBytes  int64     `json:"sizeBytes"`
	URL        string    `json:"url"`
	UploadedBy *string   `json:"uploadedBy,omitempty"`
	CreatedAt  time.Time `json:"createdAt"`
}

type Activity struct {
	ID        int64      `json:"id"`
	IssueID   string     `json:"issueId"`
	Actor     *MemberRef `json:"actor,omitempty"`
	Field     string     `json:"field"`
	OldValue  *string    `json:"oldValue,omitempty"`
	NewValue  *string    `json:"newValue,omitempty"`
	OldLabel  *string    `json:"oldLabel,omitempty"`
	NewLabel  *string    `json:"newLabel,omitempty"`
	CreatedAt time.Time  `json:"createdAt"`
}

type IssueLink struct {
	ID       string `json:"id"`
	Kind     string `json:"kind"`
	Outward  bool   `json:"outward"`
	IssueID  string `json:"issueId"`
	IssueKey string `json:"issueKey"`
	Title    string `json:"title"`
	Category string `json:"category"`
}

type Worklog struct {
	ID        string    `json:"id"`
	IssueID   string    `json:"issueId"`
	IssueKey  string    `json:"issueKey,omitempty"`
	Member    MemberRef `json:"member"`
	Seconds   int       `json:"seconds"`
	Note      string    `json:"note"`
	StartedAt time.Time `json:"startedAt"`
	CreatedAt time.Time `json:"createdAt"`
}

type Notification struct {
	ID        string     `json:"id"`
	Kind      string     `json:"kind"`
	IssueID   *string    `json:"issueId,omitempty"`
	IssueKey  *string    `json:"issueKey,omitempty"`
	Actor     *MemberRef `json:"actor,omitempty"`
	Title     string     `json:"title"`
	Body      string     `json:"body"`
	ReadAt    *time.Time `json:"readAt,omitempty"`
	CreatedAt time.Time  `json:"createdAt"`
}

// BoardColumn is one status plus the cards currently in it. The WIP
// limit travels with the column rather than being looked up separately,
// so the client can colour an over-limit column without a second call.
type BoardColumn struct {
	Status Status  `json:"status"`
	Issues []Issue `json:"issues"`
	Points float64 `json:"points"`
}

type Board struct {
	Project Project       `json:"project"`
	Sprint  *Sprint       `json:"sprint,omitempty"`
	Columns []BoardColumn `json:"columns"`
}

// BurndownPoint is one day of a sprint. Ideal is the straight line from
// the sprint's starting scope to zero; Remaining is what was actually
// left at the end of that day; Scope tracks scope creep, which is the
// number that explains most missed sprints and which a two-line chart
// hides.
type BurndownPoint struct {
	Date      string  `json:"date"`
	Remaining float64 `json:"remaining"`
	Ideal     float64 `json:"ideal"`
	Scope     float64 `json:"scope"`
	Completed float64 `json:"completed"`
}

type Burndown struct {
	Sprint Sprint          `json:"sprint"`
	Unit   string          `json:"unit"`
	Points []BurndownPoint `json:"points"`
}

type VelocityEntry struct {
	SprintID      string  `json:"sprintId"`
	SprintName    string  `json:"sprintName"`
	Committed     float64 `json:"committed"`
	Completed     float64 `json:"completed"`
	IssuesDone    int64   `json:"issuesDone"`
	CompletedAt   string  `json:"completedAt"`
	CommittedCnt  int64   `json:"committedCount"`
	CarriedOverAt int64   `json:"carriedOver"`
}

type WorkloadEntry struct {
	Member       MemberRef `json:"member"`
	OpenIssues   int64     `json:"openIssues"`
	OpenPoints   float64   `json:"openPoints"`
	InProgress   int64     `json:"inProgress"`
	Overdue      int64     `json:"overdue"`
	SpentSeconds int64     `json:"spentSeconds"`
}

// IssueFilter is the composed query behind the backlog, the board and
// search. Every field is optional; empty means "do not filter on this".
type IssueFilter struct {
	ProjectID  string
	Query      string
	StatusIDs  []string
	Categories []string
	Types      []string
	Priorities []string
	AssigneeID []string
	ReporterID string
	LabelIDs   []string
	SprintID   string
	EpicID     string
	ParentID   string
	NoSprint   bool
	NoAssignee bool
	DueBefore  *time.Time
	Sort       string
	Limit      int32
	Offset     int32
}
