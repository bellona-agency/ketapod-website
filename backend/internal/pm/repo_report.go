package pm

import (
	"context"
	"time"
)

// Reports are reconstructed from pm.activity rather than read from
// nightly snapshots.
//
// A snapshot table is the usual answer and it has a failure mode this
// team cannot absorb: if the job does not run one night — a deploy, a
// restart, a container that lost its schedule — that day is missing from
// the chart forever, and nobody notices until the retrospective. The
// history is written synchronously with every change that caused it, so
// it cannot have holes; the cost is that these queries do real work
// instead of a table scan. At the volume one company's board produces,
// that trade is not close.

// sprintMembershipCTE resolves which issues belonged to a sprint and
// when, including the ones that were carried out of it at completion.
// Reading pm.issues.sprint_id alone would silently drop exactly those,
// which is how velocity charts end up flattering the team: the work that
// did not get finished is the work that leaves the sprint.
const sprintMembershipCTE = `
membership AS (
    SELECT i.id AS issue_id, COALESCE(i.story_points, 0)::float8 AS points
    FROM pm.issues i WHERE i.sprint_id = $1
    UNION
    SELECT a.issue_id, COALESCE(i.story_points, 0)::float8
    FROM pm.activity a JOIN pm.issues i ON i.id = a.issue_id
    WHERE a.field = 'sprint' AND (a.old_value = $1::text OR a.new_value = $1::text)
),
windowed AS (
    SELECT m.issue_id, m.points,
           COALESCE((
               SELECT min(a.created_at) FROM pm.activity a
               WHERE a.issue_id = m.issue_id AND a.field = 'sprint' AND a.new_value = $1::text
           ), i.created_at) AS entered_at,
           CASE WHEN i.sprint_id = $1 THEN NULL ELSE (
               SELECT max(a.created_at) FROM pm.activity a
               WHERE a.issue_id = m.issue_id AND a.field = 'sprint' AND a.old_value = $1::text
           ) END AS left_at
    FROM membership m JOIN pm.issues i ON i.id = m.issue_id
)`

// Burndown returns one row per day of the sprint. The status of every
// issue at the end of each day comes from the last status change that
// had happened by then, which is why creating an issue writes a status
// entry too — without it an issue would have no known status before its
// first transition.
func (r *Repository) Burndown(ctx context.Context, sprintID string, from, to time.Time) ([]BurndownPoint, error) {
	rows, err := r.db.Query(ctx, `
		WITH `+sprintMembershipCTE+`,
		days AS (
			SELECT generate_series(date_trunc('day', $2::timestamptz),
			                       date_trunc('day', $3::timestamptz),
			                       interval '1 day') AS day
		)
		SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
		       COALESCE(sum(w.points) FILTER (WHERE inside), 0)::float8 AS scope,
		       COALESCE(sum(w.points) FILTER (WHERE inside AND st.category = 'done'), 0)::float8 AS completed
		FROM days d
		LEFT JOIN LATERAL (
			SELECT w.issue_id, w.points,
			       (w.entered_at < d.day + interval '1 day'
			        AND (w.left_at IS NULL OR w.left_at >= d.day + interval '1 day')) AS inside
			FROM windowed w
		) w ON true
		LEFT JOIN LATERAL (
			SELECT s.category
			FROM pm.activity a JOIN pm.statuses s ON s.id = a.new_value::uuid
			WHERE a.issue_id = w.issue_id AND a.field = 'status'
			  AND a.created_at < d.day + interval '1 day'
			ORDER BY a.created_at DESC, a.id DESC
			LIMIT 1
		) st ON true
		GROUP BY d.day
		ORDER BY d.day`, sprintID, from, to)
	if err != nil {
		return nil, wrap("burndown", err)
	}
	defer rows.Close()

	var out []BurndownPoint
	for rows.Next() {
		var p BurndownPoint
		if err := rows.Scan(&p.Date, &p.Scope, &p.Completed); err != nil {
			return nil, wrap("scan burndown", err)
		}
		p.Remaining = p.Scope - p.Completed
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		return nil, wrap("burndown", err)
	}

	// The ideal line is drawn from the scope the sprint actually started
	// with, not from today's scope. Anchoring it to the current scope
	// would redraw history every time someone adds an issue, and the gap
	// between the two lines is the whole point of the chart.
	if len(out) > 0 {
		start := out[0].Scope
		last := float64(len(out) - 1)
		for i := range out {
			if last == 0 {
				out[i].Ideal = 0
				continue
			}
			out[i].Ideal = start * (1 - float64(i)/last)
		}
	}
	return out, nil
}

// SprintTotals is the single-sprint half of velocity: what the sprint
// held when it started, and what was finished by the time it closed.
func (r *Repository) SprintTotals(ctx context.Context, sprintID string, startedAt, endedAt time.Time) (committed, completed float64, committedCount, doneCount, carriedOver int64, err error) {
	err = r.db.QueryRow(ctx, `
		WITH `+sprintMembershipCTE+`,
		at_start AS (
			SELECT w.points FROM windowed w
			WHERE w.entered_at <= $2 AND (w.left_at IS NULL OR w.left_at > $2)
		),
		at_end AS (
			SELECT w.issue_id, w.points,
			       (SELECT s.category
			        FROM pm.activity a JOIN pm.statuses s ON s.id = a.new_value::uuid
			        WHERE a.issue_id = w.issue_id AND a.field = 'status' AND a.created_at <= $3
			        ORDER BY a.created_at DESC, a.id DESC LIMIT 1) AS category
			FROM windowed w
			WHERE w.entered_at <= $3 AND (w.left_at IS NULL OR w.left_at > $3 - interval '1 second')
		)
		SELECT COALESCE((SELECT sum(points) FROM at_start), 0)::float8,
		       COALESCE((SELECT sum(points) FROM at_end WHERE category = 'done'), 0)::float8,
		       (SELECT count(*) FROM at_start),
		       (SELECT count(*) FROM at_end WHERE category = 'done'),
		       (SELECT count(*) FROM at_end WHERE category IS DISTINCT FROM 'done')`,
		sprintID, startedAt, endedAt).
		Scan(&committed, &completed, &committedCount, &doneCount, &carriedOver)
	return committed, completed, committedCount, doneCount, carriedOver, wrap("sprint totals", err)
}

// Workload answers "who is holding what right now". Spent time is
// bounded by a window because a lifetime total tells you nothing about
// this week.
func (r *Repository) Workload(ctx context.Context, projectID string, spentFrom, spentTo time.Time) ([]WorkloadEntry, error) {
	rows, err := r.db.Query(ctx, `
		SELECT m.id, m.full_name, m.avatar_color,
		       count(i.id) FILTER (WHERE s.category <> 'done'),
		       COALESCE(sum(i.story_points) FILTER (WHERE s.category <> 'done'), 0)::float8,
		       count(i.id) FILTER (WHERE s.category = 'in_progress'),
		       count(i.id) FILTER (WHERE s.category <> 'done' AND i.due_at IS NOT NULL AND i.due_at < now()),
		       COALESCE(spent.seconds, 0)
		FROM pm.members m
		LEFT JOIN pm.issues i
		       ON i.assignee_id = m.id
		      AND ($1 = '' OR i.project_id = nullif($1,'')::uuid)
		LEFT JOIN pm.statuses s ON s.id = i.status_id
		LEFT JOIN LATERAL (
			SELECT COALESCE(sum(w.seconds), 0) AS seconds
			FROM pm.worklogs w
			JOIN pm.issues wi ON wi.id = w.issue_id
			WHERE w.member_id = m.id
			  AND w.started_at >= $2 AND w.started_at < $3
			  AND ($1 = '' OR wi.project_id = nullif($1,'')::uuid)
		) spent ON true
		WHERE m.status = 'active'
		GROUP BY m.id, m.full_name, m.avatar_color, spent.seconds
		ORDER BY 4 DESC, m.full_name`, projectID, spentFrom, spentTo)
	if err != nil {
		return nil, wrap("workload", err)
	}
	defer rows.Close()

	var out []WorkloadEntry
	for rows.Next() {
		var e WorkloadEntry
		if err := rows.Scan(&e.Member.ID, &e.Member.FullName, &e.Member.AvatarColor,
			&e.OpenIssues, &e.OpenPoints, &e.InProgress, &e.Overdue, &e.SpentSeconds); err != nil {
			return nil, wrap("scan workload", err)
		}
		out = append(out, e)
	}
	return out, wrap("workload", rows.Err())
}

// CycleTime is the other half of "are we getting faster": how long an
// issue takes from first entering an in-progress column to landing in a
// done one. It reads the same history the burndown does.
func (r *Repository) CycleTimeSeconds(ctx context.Context, projectID string, since time.Time) (median, average float64, sample int64, err error) {
	err = r.db.QueryRow(ctx, `
		WITH resolved AS (
			SELECT i.id,
			       (SELECT min(a.created_at)
			        FROM pm.activity a JOIN pm.statuses s ON s.id = a.new_value::uuid
			        WHERE a.issue_id = i.id AND a.field = 'status' AND s.category = 'in_progress') AS started,
			       i.resolved_at
			FROM pm.issues i
			WHERE i.project_id = $1 AND i.resolved_at IS NOT NULL AND i.resolved_at >= $2
		),
		durations AS (
			SELECT extract(epoch FROM (resolved_at - started))::float8 AS seconds
			FROM resolved WHERE started IS NOT NULL AND resolved_at > started
		)
		SELECT COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY seconds), 0)::float8,
		       COALESCE(avg(seconds), 0)::float8,
		       count(*)
		FROM durations`, projectID, since).Scan(&median, &average, &sample)
	return median, average, sample, wrap("cycle time", err)
}
