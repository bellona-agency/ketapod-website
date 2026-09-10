package pm

import (
	"context"
	"fmt"
	"strings"
	"time"
)

// ── comments ───────────────────────────────────────────────────────────

func (r *Repository) ListComments(ctx context.Context, issueID string) ([]Comment, error) {
	rows, err := r.db.Query(ctx,
		`SELECT c.id, c.issue_id, m.id, m.full_name, m.avatar_color,
		        c.body, c.edited_at, c.created_at
		 FROM pm.comments c
		 LEFT JOIN pm.members m ON m.id = c.author_id
		 WHERE c.issue_id = $1
		 ORDER BY c.created_at`, issueID)
	if err != nil {
		return nil, wrap("list comments", err)
	}
	defer rows.Close()

	var out []Comment
	for rows.Next() {
		var c Comment
		var id, name, color *string
		if err := rows.Scan(&c.ID, &c.IssueID, &id, &name, &color, &c.Body, &c.EditedAt, &c.CreatedAt); err != nil {
			return nil, wrap("scan comment", err)
		}
		if id != nil {
			c.Author = &MemberRef{ID: *id, FullName: derefString(name), AvatarColor: derefString(color)}
		}
		out = append(out, c)
	}
	return out, wrap("list comments", rows.Err())
}

func (r *Repository) CreateComment(ctx context.Context, issueID, authorID, body string) (Comment, error) {
	var c Comment
	var id, name, color *string
	err := r.db.QueryRow(ctx, `
		WITH created AS (
			INSERT INTO pm.comments (issue_id, author_id, body)
			VALUES ($1, nullif($2,'')::uuid, $3)
			RETURNING id, issue_id, author_id, body, edited_at, created_at
		)
		SELECT created.id, created.issue_id, m.id, m.full_name, m.avatar_color,
		       created.body, created.edited_at, created.created_at
		FROM created LEFT JOIN pm.members m ON m.id = created.author_id`,
		issueID, authorID, body).
		Scan(&c.ID, &c.IssueID, &id, &name, &color, &c.Body, &c.EditedAt, &c.CreatedAt)
	if err != nil {
		return c, wrap("create comment", err)
	}
	if id != nil {
		c.Author = &MemberRef{ID: *id, FullName: derefString(name), AvatarColor: derefString(color)}
	}
	return c, nil
}

// UpdateComment only touches a comment its own author wrote. The author
// check is in the WHERE clause rather than a read-then-write in the
// service, so there is no window between the two.
func (r *Repository) UpdateComment(ctx context.Context, id, authorID, body string) error {
	tag, err := r.db.Exec(ctx,
		`UPDATE pm.comments SET body = $3, edited_at = now()
		 WHERE id = $1 AND author_id = $2`, id, authorID, body)
	if err != nil {
		return wrap("update comment", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteComment lets an admin remove anyone's comment and everyone else
// only their own; the caller passes allowAny.
func (r *Repository) DeleteComment(ctx context.Context, id, authorID string, allowAny bool) error {
	tag, err := r.db.Exec(ctx,
		`DELETE FROM pm.comments WHERE id = $1 AND ($3 OR author_id = $2)`, id, authorID, allowAny)
	if err != nil {
		return wrap("delete comment", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *Repository) CommentIssueID(ctx context.Context, id string) (string, error) {
	var issueID string
	err := r.db.QueryRow(ctx, `SELECT issue_id FROM pm.comments WHERE id = $1`, id).Scan(&issueID)
	return issueID, wrap("comment issue", err)
}

// ── attachments ────────────────────────────────────────────────────────

func (r *Repository) ListAttachments(ctx context.Context, issueID string) ([]Attachment, error) {
	rows, err := r.db.Query(ctx,
		`SELECT id, issue_id, comment_id, file_name, storage_key, mime_type, size_bytes,
		        uploaded_by::text, created_at
		 FROM pm.attachments WHERE issue_id = $1 ORDER BY created_at`, issueID)
	if err != nil {
		return nil, wrap("list attachments", err)
	}
	defer rows.Close()

	var out []Attachment
	for rows.Next() {
		var a Attachment
		var key string
		if err := rows.Scan(&a.ID, &a.IssueID, &a.CommentID, &a.FileName, &key,
			&a.MimeType, &a.SizeBytes, &a.UploadedBy, &a.CreatedAt); err != nil {
			return nil, wrap("scan attachment", err)
		}
		out = append(out, a)
	}
	return out, wrap("list attachments", rows.Err())
}

func (r *Repository) CreateAttachment(ctx context.Context, issueID, commentID, fileName, storageKey, mimeType string, size int64, uploadedBy string) (Attachment, error) {
	var a Attachment
	var key string
	err := r.db.QueryRow(ctx,
		`INSERT INTO pm.attachments (issue_id, comment_id, file_name, storage_key, mime_type, size_bytes, uploaded_by)
		 VALUES ($1, nullif($2,'')::uuid, $3, $4, $5, $6, nullif($7,'')::uuid)
		 RETURNING id, issue_id, comment_id, file_name, storage_key, mime_type, size_bytes,
		           uploaded_by::text, created_at`,
		issueID, commentID, fileName, storageKey, mimeType, size, uploadedBy).
		Scan(&a.ID, &a.IssueID, &a.CommentID, &a.FileName, &key,
			&a.MimeType, &a.SizeBytes, &a.UploadedBy, &a.CreatedAt)
	return a, wrap("create attachment", err)
}

// AttachmentStorageKey is read on the download path, which is the only
// place the object-store key is needed. It never travels to the client:
// the client gets an id and asks this service for the bytes, so the
// bucket layout stays an implementation detail.
func (r *Repository) AttachmentStorageKey(ctx context.Context, id string) (key, fileName, mimeType string, err error) {
	err = r.db.QueryRow(ctx,
		`SELECT storage_key, file_name, mime_type FROM pm.attachments WHERE id = $1`, id).
		Scan(&key, &fileName, &mimeType)
	return key, fileName, mimeType, wrap("attachment key", err)
}

func (r *Repository) DeleteAttachment(ctx context.Context, id string) (string, error) {
	var key string
	err := r.db.QueryRow(ctx,
		`DELETE FROM pm.attachments WHERE id = $1 RETURNING storage_key`, id).Scan(&key)
	return key, wrap("delete attachment", err)
}

// ── worklogs ───────────────────────────────────────────────────────────

func (r *Repository) ListWorklogs(ctx context.Context, issueID string) ([]Worklog, error) {
	rows, err := r.db.Query(ctx,
		`SELECT w.id, w.issue_id, m.id, m.full_name, m.avatar_color,
		        w.seconds, w.note, w.started_at, w.created_at
		 FROM pm.worklogs w JOIN pm.members m ON m.id = w.member_id
		 WHERE w.issue_id = $1 ORDER BY w.started_at DESC`, issueID)
	if err != nil {
		return nil, wrap("list worklogs", err)
	}
	defer rows.Close()

	var out []Worklog
	for rows.Next() {
		var w Worklog
		if err := rows.Scan(&w.ID, &w.IssueID, &w.Member.ID, &w.Member.FullName, &w.Member.AvatarColor,
			&w.Seconds, &w.Note, &w.StartedAt, &w.CreatedAt); err != nil {
			return nil, wrap("scan worklog", err)
		}
		out = append(out, w)
	}
	return out, wrap("list worklogs", rows.Err())
}

func (r *Repository) CreateWorklog(ctx context.Context, issueID, memberID string, seconds int, note string, startedAt time.Time) (Worklog, error) {
	var w Worklog
	err := r.db.QueryRow(ctx, `
		WITH created AS (
			INSERT INTO pm.worklogs (issue_id, member_id, seconds, note, started_at)
			VALUES ($1, $2, $3, $4, $5)
			RETURNING id, issue_id, member_id, seconds, note, started_at, created_at
		)
		SELECT created.id, created.issue_id, m.id, m.full_name, m.avatar_color,
		       created.seconds, created.note, created.started_at, created.created_at
		FROM created JOIN pm.members m ON m.id = created.member_id`,
		issueID, memberID, seconds, note, startedAt).
		Scan(&w.ID, &w.IssueID, &w.Member.ID, &w.Member.FullName, &w.Member.AvatarColor,
			&w.Seconds, &w.Note, &w.StartedAt, &w.CreatedAt)
	return w, wrap("create worklog", err)
}

func (r *Repository) DeleteWorklog(ctx context.Context, id, memberID string, allowAny bool) error {
	tag, err := r.db.Exec(ctx,
		`DELETE FROM pm.worklogs WHERE id = $1 AND ($3 OR member_id = $2)`, id, memberID, allowAny)
	if err != nil {
		return wrap("delete worklog", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// MyWorklogs backs the timesheet: one person, one date range, across
// every project they touched.
func (r *Repository) MyWorklogs(ctx context.Context, memberID string, from, to time.Time) ([]Worklog, error) {
	rows, err := r.db.Query(ctx,
		`SELECT w.id, w.issue_id, p.key || '-' || i.number,
		        m.id, m.full_name, m.avatar_color,
		        w.seconds, w.note, w.started_at, w.created_at
		 FROM pm.worklogs w
		 JOIN pm.members m ON m.id = w.member_id
		 JOIN pm.issues i ON i.id = w.issue_id
		 JOIN pm.projects p ON p.id = i.project_id
		 WHERE w.member_id = $1 AND w.started_at >= $2 AND w.started_at < $3
		 ORDER BY w.started_at DESC`, memberID, from, to)
	if err != nil {
		return nil, wrap("my worklogs", err)
	}
	defer rows.Close()

	var out []Worklog
	for rows.Next() {
		var w Worklog
		if err := rows.Scan(&w.ID, &w.IssueID, &w.IssueKey,
			&w.Member.ID, &w.Member.FullName, &w.Member.AvatarColor,
			&w.Seconds, &w.Note, &w.StartedAt, &w.CreatedAt); err != nil {
			return nil, wrap("scan worklog", err)
		}
		out = append(out, w)
	}
	return out, wrap("my worklogs", rows.Err())
}

// ── notifications ──────────────────────────────────────────────────────

type NewNotification struct {
	MemberID string
	Kind     string
	IssueID  string
	ActorID  string
	Title    string
	Body     string
}

// CreateNotifications writes the whole fan-out in one statement. A
// comment on a busy issue notifies everyone watching it, and doing that
// one INSERT at a time turns a comment into a dozen round trips.
//
// A member is never notified about their own action: the actor is
// filtered out here rather than at every call site, because the call
// site that forgets is the one that makes the bell useless.
func (r *Repository) CreateNotifications(ctx context.Context, items []NewNotification) error {
	if len(items) == 0 {
		return nil
	}

	var (
		values []string
		args   []any
	)
	for _, n := range items {
		if n.MemberID == "" || n.MemberID == n.ActorID {
			continue
		}
		base := len(args)
		args = append(args, n.MemberID, n.Kind, nullIfEmpty(n.IssueID), nullIfEmpty(n.ActorID), n.Title, n.Body)
		values = append(values, fmt.Sprintf("($%d, $%d, $%d::uuid, $%d::uuid, $%d, $%d)",
			base+1, base+2, base+3, base+4, base+5, base+6))
	}
	if len(values) == 0 {
		return nil
	}

	_, err := r.db.Exec(ctx,
		`INSERT INTO pm.notifications (member_id, kind, issue_id, actor_id, title, body)
		 VALUES `+strings.Join(values, ", "), args...)
	return wrap("create notifications", err)
}

func (r *Repository) ListNotifications(ctx context.Context, memberID string, unreadOnly bool, limit int32) ([]Notification, int64, error) {
	var unread int64
	if err := r.db.QueryRow(ctx,
		`SELECT count(*) FROM pm.notifications WHERE member_id = $1 AND read_at IS NULL`, memberID).
		Scan(&unread); err != nil {
		return nil, 0, wrap("count notifications", err)
	}

	rows, err := r.db.Query(ctx,
		`SELECT n.id, n.kind, n.issue_id, p.key || '-' || i.number,
		        a.id, a.full_name, a.avatar_color,
		        n.title, n.body, n.read_at, n.created_at
		 FROM pm.notifications n
		 LEFT JOIN pm.issues i ON i.id = n.issue_id
		 LEFT JOIN pm.projects p ON p.id = i.project_id
		 LEFT JOIN pm.members a ON a.id = n.actor_id
		 WHERE n.member_id = $1 AND ($2 = false OR n.read_at IS NULL)
		 ORDER BY n.created_at DESC
		 LIMIT $3`, memberID, unreadOnly, limit)
	if err != nil {
		return nil, 0, wrap("list notifications", err)
	}
	defer rows.Close()

	var out []Notification
	for rows.Next() {
		var n Notification
		var actorID, actorName, actorColor *string
		if err := rows.Scan(&n.ID, &n.Kind, &n.IssueID, &n.IssueKey,
			&actorID, &actorName, &actorColor,
			&n.Title, &n.Body, &n.ReadAt, &n.CreatedAt); err != nil {
			return nil, 0, wrap("scan notification", err)
		}
		if actorID != nil {
			n.Actor = &MemberRef{ID: *actorID, FullName: derefString(actorName), AvatarColor: derefString(actorColor)}
		}
		out = append(out, n)
	}
	return out, unread, wrap("list notifications", rows.Err())
}

func (r *Repository) MarkNotificationsRead(ctx context.Context, memberID string, ids []string) error {
	if len(ids) == 0 {
		_, err := r.db.Exec(ctx,
			`UPDATE pm.notifications SET read_at = now()
			 WHERE member_id = $1 AND read_at IS NULL`, memberID)
		return wrap("mark all read", err)
	}
	_, err := r.db.Exec(ctx,
		`UPDATE pm.notifications SET read_at = now()
		 WHERE member_id = $1 AND read_at IS NULL AND id = ANY($2::uuid[])`, memberID, ids)
	return wrap("mark read", err)
}

// UnreadCount is what the SSE stream polls. It is deliberately the
// cheapest query in the module — a count over a partial index — because
// every open tab runs it every few seconds.
func (r *Repository) UnreadCount(ctx context.Context, memberID string) (int64, error) {
	var n int64
	err := r.db.QueryRow(ctx,
		`SELECT count(*) FROM pm.notifications WHERE member_id = $1 AND read_at IS NULL`, memberID).Scan(&n)
	return n, wrap("unread count", err)
}
