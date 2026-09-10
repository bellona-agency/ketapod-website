package pm

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrNotFound = errors.New("pm: not found")
	ErrConflict = errors.New("pm: conflict")
)

// dbtx is the shared surface of *pgxpool.Pool and pgx.Tx, so every
// query method works identically inside and outside a transaction.
type dbtx interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

type Repository struct {
	pool *pgxpool.Pool
	db   dbtx
}

func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool, db: pool}
}

// InTx runs fn against a repository bound to a single transaction.
// Creating an issue is the reason it exists: the project's counter, the
// issue row, its labels and its first activity entry are one fact, and a
// half-written one leaves a project whose next issue reuses a number.
func (r *Repository) InTx(ctx context.Context, fn func(*Repository) error) error {
	if r.pool == nil {
		// Already inside a transaction: nesting would need savepoints,
		// and every caller here wants "join the current transaction".
		return fn(r)
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("pm: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if err := fn(&Repository{db: tx}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// isUniqueViolation maps Postgres 23505 onto ErrConflict, so the service
// layer can tell "someone took that project key" from "the database is
// down" without parsing strings.
func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

func wrap(op string, err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, pgx.ErrNoRows):
		return ErrNotFound
	case isUniqueViolation(err):
		return fmt.Errorf("%w: %s", ErrConflict, op)
	default:
		return fmt.Errorf("pm: %s: %w", op, err)
	}
}

// ── members ────────────────────────────────────────────────────────────

// The column list is unaliased on purpose: it is used both in SELECTs
// (where pm.members is the only table) and in INSERT/UPDATE ... RETURNING,
// where an alias is not in scope.
const memberColumns = `id, email, full_name, avatar_color, role,
	status, timezone, last_seen_at, created_at`

func scanMember(row pgx.Row) (Member, error) {
	var m Member
	err := row.Scan(&m.ID, &m.Email, &m.FullName, &m.AvatarColor, &m.Role,
		&m.Status, &m.Timezone, &m.LastSeenAt, &m.CreatedAt)
	return m, err
}

func (r *Repository) MemberByID(ctx context.Context, id string) (Member, error) {
	row := r.db.QueryRow(ctx, `SELECT `+memberColumns+` FROM pm.members m WHERE m.id = $1`, id)
	m, err := scanMember(row)
	return m, wrap("member by id", err)
}

func (r *Repository) MemberByEmail(ctx context.Context, email string) (Member, string, error) {
	row := r.db.QueryRow(ctx,
		`SELECT `+memberColumns+`, COALESCE(password_hash, '')
		 FROM pm.members m WHERE lower(m.email) = lower($1)`, email)

	var m Member
	var hash string
	err := row.Scan(&m.ID, &m.Email, &m.FullName, &m.AvatarColor, &m.Role,
		&m.Status, &m.Timezone, &m.LastSeenAt, &m.CreatedAt, &hash)
	return m, hash, wrap("member by email", err)
}

func (r *Repository) ListMembers(ctx context.Context, includeDisabled bool) ([]Member, error) {
	rows, err := r.db.Query(ctx,
		`SELECT `+memberColumns+`
		 FROM pm.members m
		 WHERE $1 OR m.status <> 'disabled'
		 ORDER BY m.status = 'active' DESC, m.full_name, m.email`, includeDisabled)
	if err != nil {
		return nil, wrap("list members", err)
	}
	defer rows.Close()

	var out []Member
	for rows.Next() {
		m, err := scanMember(rows)
		if err != nil {
			return nil, wrap("scan member", err)
		}
		out = append(out, m)
	}
	return out, wrap("list members", rows.Err())
}

func (r *Repository) CreateMember(ctx context.Context, email, fullName, role, avatarColor string) (Member, error) {
	row := r.db.QueryRow(ctx,
		`INSERT INTO pm.members (email, full_name, role, avatar_color)
		 VALUES ($1, $2, $3, $4)
		 RETURNING `+memberColumns, email, fullName, role, avatarColor)
	m, err := scanMember(row)
	return m, wrap("create member", err)
}

// CountMembers drives the bootstrap rule: the first account to exist is
// the owner, and after that nobody can create an account without an
// invite.
func (r *Repository) CountMembers(ctx context.Context) (int64, error) {
	var n int64
	err := r.db.QueryRow(ctx, `SELECT count(*) FROM pm.members`).Scan(&n)
	return n, wrap("count members", err)
}

func (r *Repository) UpdateMemberProfile(ctx context.Context, id, fullName, timezone, avatarColor string) (Member, error) {
	row := r.db.QueryRow(ctx,
		`UPDATE pm.members m
		 SET full_name = $2, timezone = $3, avatar_color = $4, updated_at = now()
		 WHERE m.id = $1
		 RETURNING `+memberColumns, id, fullName, timezone, avatarColor)
	m, err := scanMember(row)
	return m, wrap("update member", err)
}

func (r *Repository) UpdateMemberAccess(ctx context.Context, id, role, status string) (Member, error) {
	row := r.db.QueryRow(ctx,
		`UPDATE pm.members m
		 SET role = $2, status = $3, updated_at = now()
		 WHERE m.id = $1
		 RETURNING `+memberColumns, id, role, status)
	m, err := scanMember(row)
	return m, wrap("update member access", err)
}

func (r *Repository) SetPassword(ctx context.Context, id, hash string) error {
	_, err := r.db.Exec(ctx,
		`UPDATE pm.members
		 SET password_hash = $2, status = CASE WHEN status = 'invited' THEN 'active' ELSE status END,
		     updated_at = now()
		 WHERE id = $1`, id, hash)
	return wrap("set password", err)
}

func (r *Repository) TouchMember(ctx context.Context, id string) {
	// Best effort: last_seen_at is a nicety, and failing a request
	// because a heartbeat write lost a race would be absurd.
	_, _ = r.db.Exec(ctx, `UPDATE pm.members SET last_seen_at = now() WHERE id = $1`, id)
}

// CountOwners exists to stop the last owner from demoting or disabling
// themselves — an instance with no owner cannot invite anyone again.
func (r *Repository) CountOwners(ctx context.Context, excludingID string) (int64, error) {
	var n int64
	err := r.db.QueryRow(ctx,
		`SELECT count(*) FROM pm.members
		 WHERE role = 'owner' AND status = 'active' AND id <> $1`, excludingID).Scan(&n)
	return n, wrap("count owners", err)
}

// ── invites ────────────────────────────────────────────────────────────

func (r *Repository) CreateInvite(ctx context.Context, memberID, email, role, tokenHash, invitedBy string, expiresAt time.Time) error {
	var by *string
	if invitedBy != "" {
		by = &invitedBy
	}
	_, err := r.db.Exec(ctx,
		`INSERT INTO pm.invites (member_id, email, role, token_hash, invited_by, expires_at)
		 VALUES ($1, $2, $3, $4, $5, $6)`, memberID, email, role, tokenHash, by, expiresAt)
	return wrap("create invite", err)
}

type invite struct {
	ID        string
	MemberID  string
	Email     string
	Role      string
	ExpiresAt time.Time
}

func (r *Repository) InviteByTokenHash(ctx context.Context, tokenHash string) (invite, error) {
	var in invite
	err := r.db.QueryRow(ctx,
		`SELECT id, member_id, email, role, expires_at
		 FROM pm.invites
		 WHERE token_hash = $1 AND accepted_at IS NULL`, tokenHash).
		Scan(&in.ID, &in.MemberID, &in.Email, &in.Role, &in.ExpiresAt)
	return in, wrap("invite by token", err)
}

func (r *Repository) MarkInviteAccepted(ctx context.Context, id string) error {
	_, err := r.db.Exec(ctx, `UPDATE pm.invites SET accepted_at = now() WHERE id = $1`, id)
	return wrap("accept invite", err)
}

// RevokeOpenInvites is called before issuing a new invite to the same
// address, so re-inviting someone silently kills the old link instead
// of leaving two working ones.
func (r *Repository) RevokeOpenInvites(ctx context.Context, memberID string) error {
	_, err := r.db.Exec(ctx,
		`UPDATE pm.invites SET expires_at = now()
		 WHERE member_id = $1 AND accepted_at IS NULL AND expires_at > now()`, memberID)
	return wrap("revoke invites", err)
}

// ── sessions ───────────────────────────────────────────────────────────

func (r *Repository) CreateSession(ctx context.Context, memberID, tokenHash, userAgent, ip string, expiresAt time.Time) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO pm.sessions (member_id, token_hash, user_agent, ip, expires_at)
		 VALUES ($1, $2, $3, $4, $5)`, memberID, tokenHash, userAgent, ip, expiresAt)
	return wrap("create session", err)
}

// RotateSession consumes a refresh token and issues the next one in a
// single statement. Doing it in two — verify, then update — lets two
// tabs refreshing at the same moment both succeed and leaves one of
// them holding a token that has already been replaced.
func (r *Repository) RotateSession(ctx context.Context, oldHash, newHash string, expiresAt time.Time) (string, error) {
	var memberID string
	err := r.db.QueryRow(ctx,
		`UPDATE pm.sessions
		 SET token_hash = $2, expires_at = $3, last_used_at = now()
		 WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()
		 RETURNING member_id`, oldHash, newHash, expiresAt).Scan(&memberID)
	return memberID, wrap("rotate session", err)
}

func (r *Repository) RevokeSession(ctx context.Context, tokenHash string) error {
	_, err := r.db.Exec(ctx,
		`UPDATE pm.sessions SET revoked_at = now()
		 WHERE token_hash = $1 AND revoked_at IS NULL`, tokenHash)
	return wrap("revoke session", err)
}

func (r *Repository) RevokeAllSessions(ctx context.Context, memberID string) error {
	_, err := r.db.Exec(ctx,
		`UPDATE pm.sessions SET revoked_at = now()
		 WHERE member_id = $1 AND revoked_at IS NULL`, memberID)
	return wrap("revoke sessions", err)
}

// PurgeExpiredSessions keeps the table from growing without bound. It is
// called from the login path rather than a cron: the table is small, the
// delete is indexed, and one fewer moving part is worth more here than
// shaving a millisecond off a login that already spends 40ms in argon2.
func (r *Repository) PurgeExpiredSessions(ctx context.Context) {
	_, _ = r.db.Exec(ctx,
		`DELETE FROM pm.sessions
		 WHERE expires_at < now() - interval '30 days'
		    OR (revoked_at IS NOT NULL AND revoked_at < now() - interval '30 days')`)
}

// placeholders builds "$n, $n+1, ..." for an IN clause, and reports the
// next free position. Hand-written pgx means dynamic lists are built
// here rather than generated, so this is the one place that arithmetic
// happens.
func placeholders(start, n int) string {
	parts := make([]string, n)
	for i := range n {
		parts[i] = fmt.Sprintf("$%d", start+i)
	}
	return strings.Join(parts, ", ")
}
