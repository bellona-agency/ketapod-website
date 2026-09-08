-- name: CreateUser :one
INSERT INTO identity.users (phone_number, full_name)
VALUES ($1, $2)
RETURNING *;

-- name: GetUserByID :one
SELECT * FROM identity.users WHERE id = $1;

-- name: GetUserByPhoneNumber :one
SELECT * FROM identity.users WHERE phone_number = $1;

-- name: SetKidsModePreference :one
UPDATE identity.users
SET kids_mode_enabled = $2, updated_at = now()
WHERE id = $1
RETURNING *;

-- name: UpdateUserProfile :one
UPDATE identity.users
SET full_name  = coalesce(sqlc.narg(full_name)::text, full_name),
    email      = coalesce(sqlc.narg(email)::text, email),
    updated_at = now()
WHERE id = sqlc.arg(id)
RETURNING *;

-- name: TouchUserLastSeen :exec
UPDATE identity.users SET last_seen_at = now() WHERE id = $1;

-- name: SetUserStatus :one
UPDATE identity.users
SET status = $2, suspended_reason = $3, updated_at = now()
WHERE id = $1
RETURNING *;

-- name: ListUserRoles :many
SELECT role FROM identity.user_roles WHERE user_id = $1 ORDER BY role;

-- name: GrantUserRole :exec
INSERT INTO identity.user_roles (user_id, role)
VALUES ($1, $2)
ON CONFLICT DO NOTHING;

-- name: RevokeUserRole :exec
DELETE FROM identity.user_roles WHERE user_id = $1 AND role = $2;
