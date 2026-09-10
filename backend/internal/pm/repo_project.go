package pm

import (
	"context"
	"strings"

	"github.com/jackc/pgx/v5"
)

// ── projects ───────────────────────────────────────────────────────────

// The counts hanging off every project row are what turn the project
// list into something worth looking at rather than a list of names. They
// are lateral sub-selects instead of a group-by chain because a project
// with no issues must still appear, and each one is a single index scan.
const projectSelect = `
SELECT p.id, p.key, p.name, p.description, p.color,
       l.id, l.full_name, l.avatar_color,
       p.archived_at, p.created_at,
       COALESCE(c.total, 0), COALESCE(c.open, 0), COALESCE(mc.total, 0)
FROM pm.projects p
LEFT JOIN pm.members l ON l.id = p.lead_member_id
LEFT JOIN LATERAL (
    SELECT count(*) AS total,
           count(*) FILTER (WHERE s.category <> 'done') AS open
    FROM pm.issues i JOIN pm.statuses s ON s.id = i.status_id
    WHERE i.project_id = p.id
) c ON true
LEFT JOIN LATERAL (
    SELECT count(*) AS total FROM pm.project_members pmm WHERE pmm.project_id = p.id
) mc ON true`

func scanProject(row pgx.Row) (Project, error) {
	var p Project
	var leadID, leadName, leadColor *string
	err := row.Scan(&p.ID, &p.Key, &p.Name, &p.Description, &p.Color,
		&leadID, &leadName, &leadColor,
		&p.ArchivedAt, &p.CreatedAt, &p.IssueCount, &p.OpenCount, &p.MemberCount)
	if err != nil {
		return p, err
	}
	if leadID != nil {
		p.Lead = &MemberRef{ID: *leadID, FullName: derefString(leadName), AvatarColor: derefString(leadColor)}
	}
	return p, nil
}

func derefString(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// ListProjects returns projects the member may see. An admin sees every
// project; everyone else sees the ones they are a member of, which is
// what makes "my projects" the default view rather than a filter people
// have to remember to apply.
func (r *Repository) ListProjects(ctx context.Context, memberID string, all, includeArchived bool) ([]Project, error) {
	rows, err := r.db.Query(ctx, projectSelect+`
		WHERE ($3 OR p.archived_at IS NULL)
		  AND ($2 OR EXISTS (
		        SELECT 1 FROM pm.project_members pmm
		        WHERE pmm.project_id = p.id AND pmm.member_id = $1))
		ORDER BY p.archived_at IS NOT NULL, p.name`, memberID, all, includeArchived)
	if err != nil {
		return nil, wrap("list projects", err)
	}
	defer rows.Close()

	var out []Project
	for rows.Next() {
		p, err := scanProject(rows)
		if err != nil {
			return nil, wrap("scan project", err)
		}
		out = append(out, p)
	}
	return out, wrap("list projects", rows.Err())
}

// ProjectByKey looks up by the short key people actually type. The key
// is matched case-insensitively to match the unique index, so "ket" and
// "KET" reach the same project.
func (r *Repository) ProjectByKey(ctx context.Context, key string) (Project, error) {
	p, err := scanProject(r.db.QueryRow(ctx, projectSelect+` WHERE upper(p.key) = upper($1)`, key))
	return p, wrap("project by key", err)
}

func (r *Repository) ProjectByID(ctx context.Context, id string) (Project, error) {
	p, err := scanProject(r.db.QueryRow(ctx, projectSelect+` WHERE p.id = $1`, id))
	return p, wrap("project by id", err)
}

func (r *Repository) CreateProject(ctx context.Context, key, name, description, color, leadID, createdBy string) (string, error) {
	var id string
	err := r.db.QueryRow(ctx,
		`INSERT INTO pm.projects (key, name, description, color, lead_member_id, created_by)
		 VALUES ($1, $2, $3, $4, nullif($5, '')::uuid, nullif($6, '')::uuid)
		 RETURNING id`, strings.ToUpper(key), name, description, color, leadID, createdBy).Scan(&id)
	return id, wrap("create project", err)
}

func (r *Repository) UpdateProject(ctx context.Context, id, name, description, color, leadID string) error {
	_, err := r.db.Exec(ctx,
		`UPDATE pm.projects
		 SET name = $2, description = $3, color = $4,
		     lead_member_id = nullif($5, '')::uuid, updated_at = now()
		 WHERE id = $1`, id, name, description, color, leadID)
	return wrap("update project", err)
}

func (r *Repository) SetProjectArchived(ctx context.Context, id string, archived bool) error {
	_, err := r.db.Exec(ctx,
		`UPDATE pm.projects
		 SET archived_at = CASE WHEN $2 THEN now() ELSE NULL END, updated_at = now()
		 WHERE id = $1`, id, archived)
	return wrap("archive project", err)
}

// NextIssueNumber bumps the per-project counter under the row lock that
// UPDATE ... RETURNING already takes. A sequence would be faster and
// wrong: a rolled-back transaction would burn a number, and a project
// whose issue numbers have holes makes people think an issue was
// deleted.
func (r *Repository) NextIssueNumber(ctx context.Context, projectID string) (int64, error) {
	var n int64
	err := r.db.QueryRow(ctx,
		`UPDATE pm.projects SET issue_counter = issue_counter + 1
		 WHERE id = $1 RETURNING issue_counter`, projectID).Scan(&n)
	return n, wrap("next issue number", err)
}

// ── project membership ─────────────────────────────────────────────────

func (r *Repository) ListProjectMembers(ctx context.Context, projectID string) ([]ProjectMember, error) {
	rows, err := r.db.Query(ctx,
		`SELECT m.id, m.full_name, m.avatar_color, pmm.role, m.email
		 FROM pm.project_members pmm
		 JOIN pm.members m ON m.id = pmm.member_id
		 WHERE pmm.project_id = $1 AND m.status <> 'disabled'
		 ORDER BY pmm.role = 'lead' DESC, m.full_name`, projectID)
	if err != nil {
		return nil, wrap("list project members", err)
	}
	defer rows.Close()

	var out []ProjectMember
	for rows.Next() {
		var pm ProjectMember
		if err := rows.Scan(&pm.Member.ID, &pm.Member.FullName, &pm.Member.AvatarColor, &pm.Role, &pm.Email); err != nil {
			return nil, wrap("scan project member", err)
		}
		out = append(out, pm)
	}
	return out, wrap("list project members", rows.Err())
}

func (r *Repository) AddProjectMember(ctx context.Context, projectID, memberID, role string) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO pm.project_members (project_id, member_id, role)
		 VALUES ($1, $2, $3)
		 ON CONFLICT (project_id, member_id) DO UPDATE SET role = EXCLUDED.role`,
		projectID, memberID, role)
	return wrap("add project member", err)
}

func (r *Repository) RemoveProjectMember(ctx context.Context, projectID, memberID string) error {
	_, err := r.db.Exec(ctx,
		`DELETE FROM pm.project_members WHERE project_id = $1 AND member_id = $2`, projectID, memberID)
	return wrap("remove project member", err)
}

func (r *Repository) IsProjectMember(ctx context.Context, projectID, memberID string) (bool, error) {
	var ok bool
	err := r.db.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM pm.project_members WHERE project_id = $1 AND member_id = $2)`,
		projectID, memberID).Scan(&ok)
	return ok, wrap("is project member", err)
}

// ── statuses ───────────────────────────────────────────────────────────

func (r *Repository) ListStatuses(ctx context.Context, projectID string) ([]Status, error) {
	rows, err := r.db.Query(ctx,
		`SELECT id, project_id, name, category, position, color, wip_limit
		 FROM pm.statuses WHERE project_id = $1 ORDER BY position, created_at`, projectID)
	if err != nil {
		return nil, wrap("list statuses", err)
	}
	defer rows.Close()

	var out []Status
	for rows.Next() {
		var s Status
		if err := rows.Scan(&s.ID, &s.ProjectID, &s.Name, &s.Category, &s.Position, &s.Color, &s.WIPLimit); err != nil {
			return nil, wrap("scan status", err)
		}
		out = append(out, s)
	}
	return out, wrap("list statuses", rows.Err())
}

func (r *Repository) CreateStatus(ctx context.Context, projectID, name, category, color string, position int, wipLimit *int) (Status, error) {
	var s Status
	err := r.db.QueryRow(ctx,
		`INSERT INTO pm.statuses (project_id, name, category, color, position, wip_limit)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 RETURNING id, project_id, name, category, position, color, wip_limit`,
		projectID, name, category, color, position, wipLimit).
		Scan(&s.ID, &s.ProjectID, &s.Name, &s.Category, &s.Position, &s.Color, &s.WIPLimit)
	return s, wrap("create status", err)
}

func (r *Repository) UpdateStatus(ctx context.Context, id, name, category, color string, position int, wipLimit *int) (Status, error) {
	var s Status
	err := r.db.QueryRow(ctx,
		`UPDATE pm.statuses SET name = $2, category = $3, color = $4, position = $5, wip_limit = $6
		 WHERE id = $1
		 RETURNING id, project_id, name, category, position, color, wip_limit`,
		id, name, category, color, position, wipLimit).
		Scan(&s.ID, &s.ProjectID, &s.Name, &s.Category, &s.Position, &s.Color, &s.WIPLimit)
	return s, wrap("update status", err)
}

func (r *Repository) StatusByID(ctx context.Context, id string) (Status, error) {
	var s Status
	err := r.db.QueryRow(ctx,
		`SELECT id, project_id, name, category, position, color, wip_limit
		 FROM pm.statuses WHERE id = $1`, id).
		Scan(&s.ID, &s.ProjectID, &s.Name, &s.Category, &s.Position, &s.Color, &s.WIPLimit)
	return s, wrap("status by id", err)
}

// MoveIssuesToStatus empties a column before it is deleted. The foreign
// key would otherwise refuse the delete — deliberately, see the schema.
func (r *Repository) MoveIssuesToStatus(ctx context.Context, fromID, toID string) (int64, error) {
	tag, err := r.db.Exec(ctx,
		`UPDATE pm.issues SET status_id = $2, updated_at = now() WHERE status_id = $1`, fromID, toID)
	if err != nil {
		return 0, wrap("move issues", err)
	}
	return tag.RowsAffected(), nil
}

func (r *Repository) DeleteStatus(ctx context.Context, id string) error {
	tag, err := r.db.Exec(ctx, `DELETE FROM pm.statuses WHERE id = $1`, id)
	if err != nil {
		return wrap("delete status", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *Repository) CountStatuses(ctx context.Context, projectID string) (int64, error) {
	var n int64
	err := r.db.QueryRow(ctx, `SELECT count(*) FROM pm.statuses WHERE project_id = $1`, projectID).Scan(&n)
	return n, wrap("count statuses", err)
}

// ── labels ─────────────────────────────────────────────────────────────

func (r *Repository) ListLabels(ctx context.Context, projectID string) ([]Label, error) {
	rows, err := r.db.Query(ctx,
		`SELECT id, project_id, name, color FROM pm.labels
		 WHERE project_id = $1 ORDER BY name`, projectID)
	if err != nil {
		return nil, wrap("list labels", err)
	}
	defer rows.Close()

	var out []Label
	for rows.Next() {
		var l Label
		if err := rows.Scan(&l.ID, &l.ProjectID, &l.Name, &l.Color); err != nil {
			return nil, wrap("scan label", err)
		}
		out = append(out, l)
	}
	return out, wrap("list labels", rows.Err())
}

// UpsertLabel lets the issue composer create a label by typing it. The
// alternative — a separate "manage labels" screen people have to visit
// first — is how label vocabularies stay empty.
func (r *Repository) UpsertLabel(ctx context.Context, projectID, name, color string) (Label, error) {
	var l Label
	err := r.db.QueryRow(ctx,
		`INSERT INTO pm.labels (project_id, name, color) VALUES ($1, $2, $3)
		 ON CONFLICT (project_id, lower(name)) DO UPDATE SET name = EXCLUDED.name
		 RETURNING id, project_id, name, color`, projectID, name, color).
		Scan(&l.ID, &l.ProjectID, &l.Name, &l.Color)
	return l, wrap("upsert label", err)
}

func (r *Repository) DeleteLabel(ctx context.Context, id string) error {
	_, err := r.db.Exec(ctx, `DELETE FROM pm.labels WHERE id = $1`, id)
	return wrap("delete label", err)
}
