-- name: CreateRefreshToken :one
INSERT INTO identity.refresh_tokens (user_id, device_id, token_hash, expires_at, family_id)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: GetRefreshTokenByHash :one
SELECT * FROM identity.refresh_tokens WHERE token_hash = $1;

-- name: GetActiveRefreshTokenByHash :one
SELECT * FROM identity.refresh_tokens
WHERE token_hash = $1
  AND revoked_at IS NULL
  AND expires_at > now();

-- name: MarkRefreshTokenUsed :exec
UPDATE identity.refresh_tokens
SET used_at = now(), revoked_at = now(), replaced_by_id = sqlc.narg(replaced_by_id)::uuid
WHERE id = sqlc.arg(id);

-- name: RevokeRefreshToken :exec
UPDATE identity.refresh_tokens
SET revoked_at = now()
WHERE id = $1;

-- name: RevokeRefreshTokenByHash :exec
UPDATE identity.refresh_tokens
SET revoked_at = now()
WHERE token_hash = $1;

-- کشتن کل خانواده توکن. وقتی یک توکن باطل‌شده دوباره استفاده می‌شود یعنی
-- یا کاربر یا مهاجم نسخه‌ای دارد که نباید داشته باشد؛ در آن حالت هیچ‌کدام
-- نباید ادامه دهند.
-- name: RevokeRefreshTokenFamily :exec
UPDATE identity.refresh_tokens
SET revoked_at = now()
WHERE family_id = $1 AND revoked_at IS NULL;

-- name: RevokeAllRefreshTokensForUser :exec
UPDATE identity.refresh_tokens
SET revoked_at = now()
WHERE user_id = $1 AND revoked_at IS NULL;
