package pm

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// issueSelect is the one shape every issue list returns. Everything the
// board draws on a card is here and nothing else is: description,
// history and attachments belong to the issue page, and a board of two
// hundred cards carrying them would be a megabyte on every refresh.
//
// The three lateral counts are index-only lookups per row. On a team
// board that is a few hundred of them; when a project outgrows that, the
// fix is a materialised count column, not a second code path.
const issueSelect = `
SELECT i.id, i.project_id, p.key, i.number, i.type, i.title,
       s.id, s.project_id, s.name, s.category, s.position, s.color, s.wip_limit,
       i.priority,
       rep.id, rep.full_name, rep.avatar_color,
       asg.id, asg.full_name, asg.avatar_color,
       i.parent_id, par_p.key, par.number,
       i.epic_id, epic_p.key, epic.number,
       i.sprint_id, i.story_points, i.original_estimate_seconds,
       i.due_at, i.rank, i.resolved_at, i.created_at, i.updated_at,
       COALESCE(wl.spent, 0), COALESCE(cm.total, 0), COALESCE(sub.total, 0)
FROM pm.issues i
JOIN pm.projects p ON p.id = i.project_id
JOIN pm.statuses s ON s.id = i.status_id
LEFT JOIN pm.members rep ON rep.id = i.reporter_id
LEFT JOIN pm.members asg ON asg.id = i.assignee_id
LEFT JOIN pm.issues par ON par.id = i.parent_id
LEFT JOIN pm.projects par_p ON par_p.id = par.project_id
LEFT JOIN pm.issues epic ON epic.id = i.epic_id
LEFT JOIN pm.projects epic_p ON epic_p.id = epic.project_id
LEFT JOIN LATERAL (SELECT COALESCE(sum(seconds), 0) AS spent FROM pm.worklogs w WHERE w.issue_id = i.id) wl ON true
LEFT JOIN LATERAL (SELECT count(*) AS total FROM pm.comments c WHERE c.issue_id = i.id) cm ON true
LEFT JOIN LATERAL (SELECT count(*) AS total FROM pm.issues x WHERE x.parent_id = i.id) sub ON true`

func scanIssue(row pgx.Row) (Issue, error) {
	var (
		i                          Issue
		repID, repName, repColor   *string
		asgID, asgName, asgColor   *string
		parKey, epicKey            *string
		parNumber, epicNumber      *int64
		spent                      int64
		commentCount, subtaskCount int64
	)

	err := row.Scan(&i.ID, &i.ProjectID, &i.ProjectKey, &i.Number, &i.Type, &i.Title,
		&i.Status.ID, &i.Status.ProjectID, &i.Status.Name, &i.Status.Category,
		&i.Status.Position, &i.Status.Color, &i.Status.WIPLimit,
		&i.Priority,
		&repID, &repName, &repColor,
		&asgID, &asgName, &asgColor,
		&i.ParentID, &parKey, &parNumber,
		&i.EpicID, &epicKey, &epicNumber,
		&i.SprintID, &i.StoryPoints, &i.EstimateSec,
		&i.DueAt, &i.Rank, &i.ResolvedAt, &i.CreatedAt, &i.UpdatedAt,
		&spent, &commentCount, &subtaskCount)
	if err != nil {
		return i, err
	}

	i.Key = fmt.Sprintf("%s-%d", i.ProjectKey, i.Number)
	i.SpentSec = int(spent)
	i.CommentCnt = int(commentCount)
	i.SubtaskCnt = int(subtaskCount)
	i.Labels = []Label{}

	if repID != nil {
		i.Reporter = &MemberRef{ID: *repID, FullName: derefString(repName), AvatarColor: derefString(repColor)}
	}
	if asgID != nil {
		i.Assignee = &MemberRef{ID: *asgID, FullName: derefString(asgName), AvatarColor: derefString(asgColor)}
	}
	if parKey != nil && parNumber != nil {
		key := fmt.Sprintf("%s-%d", *parKey, *parNumber)
		i.ParentKey = &key
	}
	if epicKey != nil && epicNumber != nil {
		key := fmt.Sprintf("%s-%d", *epicKey, *epicNumber)
		i.EpicKey = &key
	}
	return i, nil
}

// buildIssueWhere turns an IssueFilter into a WHERE clause and its
// arguments. Every clause is optional and every value is a placeholder —
// the filter is user input, and the one thing that must never happen
// here is a string concatenated into SQL.
func buildIssueWhere(f IssueFilter) (string, []any) {
	var (
		clauses []string
		args    []any
	)
	add := func(format string, values ...any) {
		positions := make([]any, len(values))
		for i, v := range values {
			args = append(args, v)
			positions[i] = len(args)
		}
		clauses = append(clauses, fmt.Sprintf(format, positions...))
	}
	addIn := func(column string, values []string) {
		if len(values) == 0 {
			return
		}
		start := len(args) + 1
		for _, v := range values {
			args = append(args, v)
		}
		clauses = append(clauses, column+" IN ("+placeholders(start, len(values))+")")
	}

	if f.ProjectID != "" {
		add("i.project_id = $%d", f.ProjectID)
	}
	addIn("i.status_id", f.StatusIDs)
	addIn("s.category", f.Categories)
	addIn("i.type", f.Types)
	addIn("i.priority", f.Priorities)
	addIn("i.assignee_id", f.AssigneeID)
	addIn("il.label_id", f.LabelIDs)

	if f.ReporterID != "" {
		add("i.reporter_id = $%d", f.ReporterID)
	}
	if f.SprintID != "" {
		add("i.sprint_id = $%d", f.SprintID)
	}
	if f.NoSprint {
		clauses = append(clauses, "i.sprint_id IS NULL")
	}
	if f.NoAssignee {
		clauses = append(clauses, "i.assignee_id IS NULL")
	}
	if f.EpicID != "" {
		add("i.epic_id = $%d", f.EpicID)
	}
	if f.ParentID != "" {
		add("i.parent_id = $%d", f.ParentID)
	}
	if f.DueBefore != nil {
		add("i.due_at IS NOT NULL AND i.due_at <= $%d", *f.DueBefore)
	}

	// Search has two arms, exactly like the catalogue's. Full-text
	// catches whole words; trigram similarity catches the misspellings
	// full-text cannot, which in Persian is most of them. An issue key
	// typed straight into the box is matched too, because that is what
	// people paste from chat.
	if q := strings.TrimSpace(f.Query); q != "" {
		start := len(args) + 1
		args = append(args, q)
		clauses = append(clauses, fmt.Sprintf(`(
			i.search_document @@ plainto_tsquery('simple', pm.normalize_fa($%[1]d))
			OR pm.normalize_fa(i.title) %% pm.normalize_fa($%[1]d)
			OR upper(p.key || '-' || i.number::text) = upper($%[1]d)
		)`, start))
	}

	if len(clauses) == 0 {
		return "", args
	}
	return " WHERE " + strings.Join(clauses, " AND "), args
}

// issueOrderBy is a closed set. The sort key arrives from the client, so
// it is mapped through this map rather than interpolated — an unknown
// value falls back to rank instead of reaching SQL.
var issueOrderBy = map[string]string{
	"rank":     "i.rank",
	"created":  "i.created_at DESC",
	"updated":  "i.updated_at DESC",
	"priority": "array_position(ARRAY['highest','high','medium','low','lowest'], i.priority), i.rank",
	"due":      "i.due_at NULLS LAST, i.rank",
	"points":   "i.story_points DESC NULLS LAST, i.rank",
	"key":      "p.key, i.number",
}

func (r *Repository) SearchIssues(ctx context.Context, f IssueFilter) ([]Issue, int64, error) {
	where, args := buildIssueWhere(f)

	// The label join only appears when labels are filtered on, because
	// it multiplies rows and would otherwise make every count wrong.
	labelJoin := ""
	distinct := ""
	if len(f.LabelIDs) > 0 {
		labelJoin = " LEFT JOIN pm.issue_labels il ON il.issue_id = i.id"
		distinct = "DISTINCT "
	}

	var total int64
	countSQL := `SELECT count(` + distinct + `i.id) FROM pm.issues i
		JOIN pm.projects p ON p.id = i.project_id
		JOIN pm.statuses s ON s.id = i.status_id` + labelJoin + where
	if err := r.db.QueryRow(ctx, countSQL, args...).Scan(&total); err != nil {
		return nil, 0, wrap("count issues", err)
	}

	order, ok := issueOrderBy[f.Sort]
	if !ok {
		order = issueOrderBy["rank"]
	}

	limit := f.Limit
	if limit <= 0 || limit > 200 {
		limit = 50
	}

	query := issueSelect + labelJoin + where +
		" ORDER BY " + order +
		fmt.Sprintf(" LIMIT $%d OFFSET $%d", len(args)+1, len(args)+2)
	args = append(args, limit, f.Offset)

	issues, err := r.queryIssues(ctx, query, args...)
	return issues, total, err
}

func (r *Repository) queryIssues(ctx context.Context, query string, args ...any) ([]Issue, error) {
	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, wrap("query issues", err)
	}
	defer rows.Close()

	var (
		out []Issue
		ids []string
	)
	for rows.Next() {
		issue, err := scanIssue(rows)
		if err != nil {
			return nil, wrap("scan issue", err)
		}
		out = append(out, issue)
		ids = append(ids, issue.ID)
	}
	if err := rows.Err(); err != nil {
		return nil, wrap("query issues", err)
	}

	// Labels come back in one extra query rather than a join, because a
	// join over a many-to-many multiplies the issue rows and every
	// aggregate above it has to be rewritten to survive it.
	if err := r.attachLabels(ctx, out, ids); err != nil {
		return nil, err
	}
	return out, nil
}

func (r *Repository) attachLabels(ctx context.Context, issues []Issue, ids []string) error {
	if len(ids) == 0 {
		return nil
	}

	rows, err := r.db.Query(ctx,
		`SELECT il.issue_id, l.id, l.project_id, l.name, l.color
		 FROM pm.issue_labels il
		 JOIN pm.labels l ON l.id = il.label_id
		 WHERE il.issue_id = ANY($1)
		 ORDER BY l.name`, ids)
	if err != nil {
		return wrap("issue labels", err)
	}
	defer rows.Close()

	byIssue := make(map[string][]Label, len(ids))
	for rows.Next() {
		var issueID string
		var l Label
		if err := rows.Scan(&issueID, &l.ID, &l.ProjectID, &l.Name, &l.Color); err != nil {
			return wrap("scan issue label", err)
		}
		byIssue[issueID] = append(byIssue[issueID], l)
	}
	if err := rows.Err(); err != nil {
		return wrap("issue labels", err)
	}

	for idx := range issues {
		if labels, ok := byIssue[issues[idx].ID]; ok {
			issues[idx].Labels = labels
		}
	}
	return nil
}

func (r *Repository) IssueByID(ctx context.Context, id string) (Issue, error) {
	issues, err := r.queryIssues(ctx, issueSelect+` WHERE i.id = $1`, id)
	if err != nil {
		return Issue{}, err
	}
	if len(issues) == 0 {
		return Issue{}, ErrNotFound
	}
	return issues[0], nil
}

// IssueByKey resolves "KET-142". The key is what people paste into chat
// and type into the search box, so it is a first-class lookup rather
// than something the client has to translate into an id first.
func (r *Repository) IssueByKey(ctx context.Context, projectKey string, number int64) (Issue, error) {
	issues, err := r.queryIssues(ctx,
		issueSelect+` WHERE upper(p.key) = upper($1) AND i.number = $2`, projectKey, number)
	if err != nil {
		return Issue{}, err
	}
	if len(issues) == 0 {
		return Issue{}, ErrNotFound
	}
	return issues[0], nil
}

// IssueDescription is fetched on its own because issueSelect leaves it
// out on purpose.
func (r *Repository) IssueDescription(ctx context.Context, id string) (string, error) {
	var body string
	err := r.db.QueryRow(ctx, `SELECT description FROM pm.issues WHERE id = $1`, id).Scan(&body)
	return body, wrap("issue description", err)
}

type NewIssue struct {
	ProjectID   string
	Number      int64
	Type        string
	Title       string
	Description string
	StatusID    string
	Priority    string
	ReporterID  string
	AssigneeID  string
	ParentID    string
	EpicID      string
	SprintID    string
	StoryPoints *float64
	EstimateSec *int
	DueAt       *time.Time
	Rank        string
}

func (r *Repository) CreateIssue(ctx context.Context, in NewIssue) (string, error) {
	var id string
	err := r.db.QueryRow(ctx,
		`INSERT INTO pm.issues (
			project_id, number, type, title, description, status_id, priority,
			reporter_id, assignee_id, parent_id, epic_id, sprint_id,
			story_points, original_estimate_seconds, due_at, rank)
		 VALUES ($1, $2, $3, $4, $5, $6, $7,
		         nullif($8,'')::uuid, nullif($9,'')::uuid, nullif($10,'')::uuid,
		         nullif($11,'')::uuid, nullif($12,'')::uuid,
		         $13, $14, $15, $16)
		 RETURNING id`,
		in.ProjectID, in.Number, in.Type, in.Title, in.Description, in.StatusID, in.Priority,
		in.ReporterID, in.AssigneeID, in.ParentID, in.EpicID, in.SprintID,
		in.StoryPoints, in.EstimateSec, in.DueAt, in.Rank).Scan(&id)
	return id, wrap("create issue", err)
}

// IssuePatch carries only the fields a request actually asked to change.
// A nil pointer means "leave it alone"; a pointer to the zero value
// means "clear it" — the distinction matters for assignee, sprint and
// due date, where "unassign" and "don't touch" are different requests.
type IssuePatch struct {
	Title       *string
	Description *string
	Type        *string
	Priority    *string
	StatusID    *string
	AssigneeID  *string
	ParentID    *string
	EpicID      *string
	SprintID    *string
	StoryPoints *float64
	EstimateSec *int
	DueAt       *time.Time
	Rank        *string

	ClearAssignee bool
	ClearSprint   bool
	ClearDue      bool
	ClearEpic     bool
	ClearParent   bool
	ClearPoints   bool
}

func (r *Repository) UpdateIssue(ctx context.Context, id string, patch IssuePatch) error {
	var (
		sets []string
		args []any
	)
	set := func(column string, value any) {
		args = append(args, value)
		sets = append(sets, fmt.Sprintf("%s = $%d", column, len(args)))
	}
	setUUID := func(column string, value string) {
		args = append(args, value)
		sets = append(sets, fmt.Sprintf("%s = nullif($%d,'')::uuid", column, len(args)))
	}

	if patch.Title != nil {
		set("title", *patch.Title)
	}
	if patch.Description != nil {
		set("description", *patch.Description)
	}
	if patch.Type != nil {
		set("type", *patch.Type)
	}
	if patch.Priority != nil {
		set("priority", *patch.Priority)
	}
	if patch.StatusID != nil {
		set("status_id", *patch.StatusID)
	}
	if patch.Rank != nil {
		set("rank", *patch.Rank)
	}

	switch {
	case patch.ClearAssignee:
		sets = append(sets, "assignee_id = NULL")
	case patch.AssigneeID != nil:
		setUUID("assignee_id", *patch.AssigneeID)
	}
	switch {
	case patch.ClearSprint:
		sets = append(sets, "sprint_id = NULL")
	case patch.SprintID != nil:
		setUUID("sprint_id", *patch.SprintID)
	}
	switch {
	case patch.ClearEpic:
		sets = append(sets, "epic_id = NULL")
	case patch.EpicID != nil:
		setUUID("epic_id", *patch.EpicID)
	}
	switch {
	case patch.ClearParent:
		sets = append(sets, "parent_id = NULL")
	case patch.ParentID != nil:
		setUUID("parent_id", *patch.ParentID)
	}
	switch {
	case patch.ClearDue:
		sets = append(sets, "due_at = NULL")
	case patch.DueAt != nil:
		set("due_at", *patch.DueAt)
	}
	switch {
	case patch.ClearPoints:
		sets = append(sets, "story_points = NULL")
	case patch.StoryPoints != nil:
		set("story_points", *patch.StoryPoints)
	}
	if patch.EstimateSec != nil {
		set("original_estimate_seconds", *patch.EstimateSec)
	}

	if len(sets) == 0 {
		return nil
	}

	sets = append(sets, "updated_at = now()")

	// resolved_at is derived, never sent by the client: it is stamped
	// the first time an issue lands in a done column and cleared when it
	// leaves one. Cycle-time reporting reads it, and a client that could
	// write it would be a client that could lie about delivery dates.
	//
	// It is recomputed only when the status is part of this patch, and
	// from the *new* status id rather than the column: inside an UPDATE,
	// referencing pm.issues.status_id yields the value the row had
	// before the statement, so a move into Done would look at the
	// column the issue is leaving.
	if patch.StatusID != nil {
		args = append(args, *patch.StatusID)
		sets = append(sets, fmt.Sprintf(`resolved_at = CASE
			WHEN (SELECT category FROM pm.statuses WHERE id = $%d) = 'done'
			THEN COALESCE(resolved_at, now())
			ELSE NULL
		 END`, len(args)))
	}

	args = append(args, id)
	query := `UPDATE pm.issues SET ` + strings.Join(sets, ", ") +
		fmt.Sprintf(" WHERE id = $%d", len(args))

	tag, err := r.db.Exec(ctx, query, args...)
	if err != nil {
		return wrap("update issue", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *Repository) DeleteIssue(ctx context.Context, id string) error {
	tag, err := r.db.Exec(ctx, `DELETE FROM pm.issues WHERE id = $1`, id)
	if err != nil {
		return wrap("delete issue", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// NeighbourRanks reads the two keys a dragged card is being dropped
// between. The client sends ids, not ranks: a client that sent ranks
// would be trusting its own possibly-stale copy of the board.
func (r *Repository) NeighbourRanks(ctx context.Context, afterID, beforeID string) (prev, next string, err error) {
	if afterID != "" {
		if err := r.db.QueryRow(ctx, `SELECT rank FROM pm.issues WHERE id = $1`, afterID).Scan(&prev); err != nil {
			return "", "", wrap("neighbour rank", err)
		}
	}
	if beforeID != "" {
		if err := r.db.QueryRow(ctx, `SELECT rank FROM pm.issues WHERE id = $1`, beforeID).Scan(&next); err != nil {
			return "", "", wrap("neighbour rank", err)
		}
	}
	return prev, next, nil
}

func (r *Repository) MaxRank(ctx context.Context, projectID string) (string, error) {
	var rank *string
	err := r.db.QueryRow(ctx,
		`SELECT max(rank) FROM pm.issues WHERE project_id = $1`, projectID).Scan(&rank)
	if err != nil {
		return "", wrap("max rank", err)
	}
	return derefString(rank), nil
}

// ── labels on issues ───────────────────────────────────────────────────

func (r *Repository) SetIssueLabels(ctx context.Context, issueID string, labelIDs []string) error {
	if _, err := r.db.Exec(ctx, `DELETE FROM pm.issue_labels WHERE issue_id = $1`, issueID); err != nil {
		return wrap("clear issue labels", err)
	}
	if len(labelIDs) == 0 {
		return nil
	}
	_, err := r.db.Exec(ctx,
		`INSERT INTO pm.issue_labels (issue_id, label_id)
		 SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`, issueID, labelIDs)
	return wrap("set issue labels", err)
}

// ── activity ───────────────────────────────────────────────────────────

type ActivityEntry struct {
	Field    string
	OldValue string
	NewValue string
	OldLabel string
	NewLabel string
}

// RecordActivity writes the history rows for one change in a single
// statement. It takes a slice because a form submit that changes five
// fields is one event to a human, and five round trips to the database
// would be five chances to write half of it.
func (r *Repository) RecordActivity(ctx context.Context, issueID, actorID string, entries []ActivityEntry) error {
	if len(entries) == 0 {
		return nil
	}

	var (
		values []string
		args   []any
	)
	args = append(args, issueID, actorID)
	for _, e := range entries {
		base := len(args)
		args = append(args, e.Field, nullIfEmpty(e.OldValue), nullIfEmpty(e.NewValue),
			nullIfEmpty(e.OldLabel), nullIfEmpty(e.NewLabel))
		values = append(values, fmt.Sprintf("($1, nullif($2,'')::uuid, $%d, $%d, $%d, $%d, $%d)",
			base+1, base+2, base+3, base+4, base+5))
	}

	_, err := r.db.Exec(ctx,
		`INSERT INTO pm.activity (issue_id, actor_id, field, old_value, new_value, old_label, new_label)
		 VALUES `+strings.Join(values, ", "), args...)
	return wrap("record activity", err)
}

func nullIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func (r *Repository) ListActivity(ctx context.Context, issueID string, limit int) ([]Activity, error) {
	rows, err := r.db.Query(ctx,
		`SELECT a.id, a.issue_id, m.id, m.full_name, m.avatar_color,
		        a.field, a.old_value, a.new_value, a.old_label, a.new_label, a.created_at
		 FROM pm.activity a
		 LEFT JOIN pm.members m ON m.id = a.actor_id
		 WHERE a.issue_id = $1
		 ORDER BY a.created_at DESC, a.id DESC
		 LIMIT $2`, issueID, limit)
	if err != nil {
		return nil, wrap("list activity", err)
	}
	defer rows.Close()

	var out []Activity
	for rows.Next() {
		var a Activity
		var id, name, color *string
		if err := rows.Scan(&a.ID, &a.IssueID, &id, &name, &color,
			&a.Field, &a.OldValue, &a.NewValue, &a.OldLabel, &a.NewLabel, &a.CreatedAt); err != nil {
			return nil, wrap("scan activity", err)
		}
		if id != nil {
			a.Actor = &MemberRef{ID: *id, FullName: derefString(name), AvatarColor: derefString(color)}
		}
		out = append(out, a)
	}
	return out, wrap("list activity", rows.Err())
}

// ── links and watchers ─────────────────────────────────────────────────

// ListIssueLinks reads both directions out of the single stored row and
// flips the wording for the inbound side, so "A blocks B" shows up on B
// as "blocked by A" without a second row that could drift.
func (r *Repository) ListIssueLinks(ctx context.Context, issueID string) ([]IssueLink, error) {
	rows, err := r.db.Query(ctx,
		`SELECT l.id, l.kind, l.source_id = $1 AS outward,
		        other.id, p.key, other.number, other.title, s.category
		 FROM pm.issue_links l
		 JOIN pm.issues other
		      ON other.id = CASE WHEN l.source_id = $1 THEN l.target_id ELSE l.source_id END
		 JOIN pm.projects p ON p.id = other.project_id
		 JOIN pm.statuses s ON s.id = other.status_id
		 WHERE l.source_id = $1 OR l.target_id = $1
		 ORDER BY l.kind, other.number`, issueID)
	if err != nil {
		return nil, wrap("list links", err)
	}
	defer rows.Close()

	var out []IssueLink
	for rows.Next() {
		var l IssueLink
		var key string
		var number int64
		if err := rows.Scan(&l.ID, &l.Kind, &l.Outward, &l.IssueID, &key, &number, &l.Title, &l.Category); err != nil {
			return nil, wrap("scan link", err)
		}
		l.IssueKey = fmt.Sprintf("%s-%d", key, number)
		out = append(out, l)
	}
	return out, wrap("list links", rows.Err())
}

func (r *Repository) CreateIssueLink(ctx context.Context, kind, sourceID, targetID, createdBy string) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO pm.issue_links (kind, source_id, target_id, created_by)
		 VALUES ($1, $2, $3, nullif($4,'')::uuid)
		 ON CONFLICT (kind, source_id, target_id) DO NOTHING`, kind, sourceID, targetID, createdBy)
	return wrap("create link", err)
}

func (r *Repository) DeleteIssueLink(ctx context.Context, id string) error {
	_, err := r.db.Exec(ctx, `DELETE FROM pm.issue_links WHERE id = $1`, id)
	return wrap("delete link", err)
}

func (r *Repository) ListWatchers(ctx context.Context, issueID string) ([]MemberRef, error) {
	rows, err := r.db.Query(ctx,
		`SELECT m.id, m.full_name, m.avatar_color
		 FROM pm.watchers w JOIN pm.members m ON m.id = w.member_id
		 WHERE w.issue_id = $1 ORDER BY m.full_name`, issueID)
	if err != nil {
		return nil, wrap("list watchers", err)
	}
	defer rows.Close()

	var out []MemberRef
	for rows.Next() {
		var m MemberRef
		if err := rows.Scan(&m.ID, &m.FullName, &m.AvatarColor); err != nil {
			return nil, wrap("scan watcher", err)
		}
		out = append(out, m)
	}
	return out, wrap("list watchers", rows.Err())
}

func (r *Repository) SetWatching(ctx context.Context, issueID, memberID string, watching bool) error {
	if !watching {
		_, err := r.db.Exec(ctx,
			`DELETE FROM pm.watchers WHERE issue_id = $1 AND member_id = $2`, issueID, memberID)
		return wrap("unwatch", err)
	}
	_, err := r.db.Exec(ctx,
		`INSERT INTO pm.watchers (issue_id, member_id) VALUES ($1, $2)
		 ON CONFLICT DO NOTHING`, issueID, memberID)
	return wrap("watch", err)
}

// WatcherIDs is the notification fan-out list: everyone watching, plus
// the assignee and reporter, who are watching implicitly whether or not
// they ever pressed the button.
func (r *Repository) WatcherIDs(ctx context.Context, issueID string) ([]string, error) {
	rows, err := r.db.Query(ctx,
		`SELECT DISTINCT member_id FROM (
		     SELECT w.member_id FROM pm.watchers w WHERE w.issue_id = $1
		     UNION
		     SELECT i.assignee_id FROM pm.issues i WHERE i.id = $1 AND i.assignee_id IS NOT NULL
		     UNION
		     SELECT i.reporter_id FROM pm.issues i WHERE i.id = $1 AND i.reporter_id IS NOT NULL
		 ) ids
		 JOIN pm.members m ON m.id = ids.member_id
		 WHERE m.status = 'active'`, issueID)
	if err != nil {
		return nil, wrap("watcher ids", err)
	}
	defer rows.Close()

	var out []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, wrap("scan watcher id", err)
		}
		out = append(out, id)
	}
	return out, wrap("watcher ids", rows.Err())
}

// AncestorIDs walks up the parent chain, so the service can refuse to
// create a cycle. Depth is capped in SQL rather than trusted to be
// small: a cycle that already exists would otherwise make this recurse
// forever.
func (r *Repository) AncestorIDs(ctx context.Context, issueID string) ([]string, error) {
	rows, err := r.db.Query(ctx,
		`WITH RECURSIVE up AS (
		     SELECT id, parent_id, 1 AS depth FROM pm.issues WHERE id = $1
		     UNION ALL
		     SELECT i.id, i.parent_id, up.depth + 1
		     FROM pm.issues i JOIN up ON i.id = up.parent_id
		     WHERE up.depth < 20
		 )
		 SELECT id FROM up`, issueID)
	if err != nil {
		return nil, wrap("ancestors", err)
	}
	defer rows.Close()

	var out []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, wrap("scan ancestor", err)
		}
		out = append(out, id)
	}
	return out, wrap("ancestors", rows.Err())
}
