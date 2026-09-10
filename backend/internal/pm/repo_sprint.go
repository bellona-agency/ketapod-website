package pm

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

// Sprint rows always carry their totals. A sprint without "12 of 30
// points done" on it is a name and two dates, and the client would have
// to fetch every issue to draw the one number people look at.
const sprintSelect = `
SELECT sp.id, sp.project_id, sp.name, sp.goal, sp.state,
       sp.starts_at, sp.ends_at, sp.started_at, sp.completed_at,
       COALESCE(agg.total, 0), COALESCE(agg.done, 0),
       COALESCE(agg.points, 0), COALESCE(agg.done_points, 0)
FROM pm.sprints sp
LEFT JOIN LATERAL (
    SELECT count(*) AS total,
           count(*) FILTER (WHERE s.category = 'done') AS done,
           COALESCE(sum(i.story_points), 0) AS points,
           COALESCE(sum(i.story_points) FILTER (WHERE s.category = 'done'), 0) AS done_points
    FROM pm.issues i JOIN pm.statuses s ON s.id = i.status_id
    WHERE i.sprint_id = sp.id
) agg ON true`

func scanSprint(row pgx.Row) (Sprint, error) {
	var s Sprint
	err := row.Scan(&s.ID, &s.ProjectID, &s.Name, &s.Goal, &s.State,
		&s.StartsAt, &s.EndsAt, &s.StartedAt, &s.CompletedAt,
		&s.IssueCount, &s.DoneCount, &s.Points, &s.DonePoints)
	return s, err
}

func (r *Repository) ListSprints(ctx context.Context, projectID string, states []string) ([]Sprint, error) {
	rows, err := r.db.Query(ctx, sprintSelect+`
		WHERE sp.project_id = $1
		  AND (cardinality($2::text[]) = 0 OR sp.state = ANY($2))
		ORDER BY array_position(ARRAY['active','future','completed'], sp.state),
		         sp.position, sp.starts_at NULLS LAST, sp.created_at`,
		projectID, states)
	if err != nil {
		return nil, wrap("list sprints", err)
	}
	defer rows.Close()

	var out []Sprint
	for rows.Next() {
		s, err := scanSprint(rows)
		if err != nil {
			return nil, wrap("scan sprint", err)
		}
		out = append(out, s)
	}
	return out, wrap("list sprints", rows.Err())
}

func (r *Repository) SprintByID(ctx context.Context, id string) (Sprint, error) {
	s, err := scanSprint(r.db.QueryRow(ctx, sprintSelect+` WHERE sp.id = $1`, id))
	return s, wrap("sprint by id", err)
}

// ActiveSprint returns the one running sprint, if there is one. The
// "only one" part is a partial unique index in the schema, not a check
// here — two people pressing Start at the same second would both pass a
// check written in Go.
func (r *Repository) ActiveSprint(ctx context.Context, projectID string) (*Sprint, error) {
	s, err := scanSprint(r.db.QueryRow(ctx, sprintSelect+
		` WHERE sp.project_id = $1 AND sp.state = 'active'`, projectID))
	switch {
	case err == pgx.ErrNoRows:
		return nil, nil
	case err != nil:
		return nil, wrap("active sprint", err)
	}
	return &s, nil
}

// The write and the read-back are two statements on purpose. Postgres
// runs a data-modifying CTE against the same snapshot as the rest of the
// statement, so a `WITH created AS (INSERT ...) SELECT ... FROM
// pm.sprints` cannot see the row it just inserted and returns nothing.
func (r *Repository) CreateSprint(ctx context.Context, projectID, name, goal string, startsAt, endsAt *time.Time) (Sprint, error) {
	var id string
	err := r.db.QueryRow(ctx,
		`INSERT INTO pm.sprints (project_id, name, goal, starts_at, ends_at, position)
		 VALUES ($1, $2, $3, $4, $5,
		         COALESCE((SELECT max(position) + 1 FROM pm.sprints WHERE project_id = $1), 0))
		 RETURNING id`, projectID, name, goal, startsAt, endsAt).Scan(&id)
	if err != nil {
		return Sprint{}, wrap("create sprint", err)
	}
	return r.SprintByID(ctx, id)
}

func (r *Repository) UpdateSprint(ctx context.Context, id, name, goal string, startsAt, endsAt *time.Time) (Sprint, error) {
	tag, err := r.db.Exec(ctx,
		`UPDATE pm.sprints SET name = $2, goal = $3, starts_at = $4, ends_at = $5, updated_at = now()
		 WHERE id = $1`, id, name, goal, startsAt, endsAt)
	if err != nil {
		return Sprint{}, wrap("update sprint", err)
	}
	if tag.RowsAffected() == 0 {
		return Sprint{}, ErrNotFound
	}
	return r.SprintByID(ctx, id)
}

// StartSprint flips the state and stamps the real start time. It relies
// on idx_pm_sprints_one_active to reject a second active sprint, which
// surfaces here as ErrConflict.
func (r *Repository) StartSprint(ctx context.Context, id string) error {
	tag, err := r.db.Exec(ctx,
		`UPDATE pm.sprints
		 SET state = 'active', started_at = now(),
		     starts_at = COALESCE(starts_at, now()), updated_at = now()
		 WHERE id = $1 AND state = 'future'`, id)
	if err != nil {
		return wrap("start sprint", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrConflict
	}
	return nil
}

// CompleteSprint closes a sprint and moves whatever did not get done.
// Unfinished work goes to moveTo (the next sprint) or back to the
// backlog when moveTo is empty. Leaving it in the closed sprint is the
// one option not offered: it would make every velocity number a lie.
func (r *Repository) CompleteSprint(ctx context.Context, id, moveTo string) (int64, error) {
	tag, err := r.db.Exec(ctx,
		`UPDATE pm.sprints SET state = 'completed', completed_at = now(), updated_at = now()
		 WHERE id = $1 AND state = 'active'`, id)
	if err != nil {
		return 0, wrap("complete sprint", err)
	}
	if tag.RowsAffected() == 0 {
		return 0, ErrConflict
	}

	moved, err := r.db.Exec(ctx,
		`UPDATE pm.issues i
		 SET sprint_id = nullif($2,'')::uuid, updated_at = now()
		 FROM pm.statuses s
		 WHERE s.id = i.status_id AND i.sprint_id = $1 AND s.category <> 'done'`, id, moveTo)
	if err != nil {
		return 0, wrap("carry over issues", err)
	}
	return moved.RowsAffected(), nil
}

func (r *Repository) DeleteSprint(ctx context.Context, id string) error {
	// Issues survive their sprint: the FK is ON DELETE SET NULL, so
	// deleting a sprint returns its work to the backlog rather than
	// taking it with it.
	tag, err := r.db.Exec(ctx, `DELETE FROM pm.sprints WHERE id = $1 AND state <> 'active'`, id)
	if err != nil {
		return wrap("delete sprint", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrConflict
	}
	return nil
}

// SprintIssueIDs is the fan-out list for "sprint started" notifications.
func (r *Repository) SprintAssigneeIDs(ctx context.Context, sprintID string) ([]string, error) {
	rows, err := r.db.Query(ctx,
		`SELECT DISTINCT i.assignee_id FROM pm.issues i
		 JOIN pm.members m ON m.id = i.assignee_id
		 WHERE i.sprint_id = $1 AND m.status = 'active'`, sprintID)
	if err != nil {
		return nil, wrap("sprint assignees", err)
	}
	defer rows.Close()

	var out []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, wrap("scan sprint assignee", err)
		}
		out = append(out, id)
	}
	return out, wrap("sprint assignees", rows.Err())
}
