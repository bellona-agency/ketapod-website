-- ثبت دستگاه با fingerprint: بدون ON CONFLICT، هر بار ورود روی همان
-- گوشی یک ردیف تازه می‌سازد و سقف پخش هم‌زمان بی‌معنی می‌شود.
-- name: UpsertDevice :one
INSERT INTO identity.devices (user_id, platform, push_token, app_version, device_fingerprint, name, last_active_at)
VALUES ($1, $2, $3, $4, $5, $6, now())
ON CONFLICT (user_id, device_fingerprint) WHERE device_fingerprint IS NOT NULL
DO UPDATE SET
    platform       = EXCLUDED.platform,
    push_token     = coalesce(EXCLUDED.push_token, identity.devices.push_token),
    app_version    = EXCLUDED.app_version,
    name           = coalesce(EXCLUDED.name, identity.devices.name),
    revoked_at     = NULL,
    last_active_at = now()
RETURNING *;

-- name: CreateDevice :one
INSERT INTO identity.devices (user_id, platform, push_token, app_version, last_active_at)
VALUES ($1, $2, $3, $4, now())
RETURNING *;

-- name: GetDeviceByID :one
SELECT * FROM identity.devices WHERE id = $1;

-- name: TouchDevice :exec
UPDATE identity.devices
SET last_active_at = now()
WHERE id = $1;

-- name: ListActiveDevicesForUser :many
SELECT * FROM identity.devices
WHERE user_id = $1 AND revoked_at IS NULL
ORDER BY last_active_at DESC;

-- name: CountActiveDevicesForUser :one
SELECT count(*) FROM identity.devices
WHERE user_id = $1 AND revoked_at IS NULL;

-- name: RevokeDevice :exec
UPDATE identity.devices SET revoked_at = now() WHERE id = $1 AND user_id = $2;

-- وقتی دستگاه باطل می‌شود، refresh token همان دستگاه هم باید بمیرد،
-- وگرنه «خروج از این دستگاه» فقط ظاهری است.
-- name: RevokeRefreshTokensForDevice :exec
UPDATE identity.refresh_tokens SET revoked_at = now()
WHERE device_id = $1 AND revoked_at IS NULL;

-- name: RevokeOldestActiveDevice :one
UPDATE identity.devices d SET revoked_at = now()
WHERE d.id = (
    SELECT inner_d.id FROM identity.devices inner_d
    WHERE inner_d.user_id = $1 AND inner_d.revoked_at IS NULL
    ORDER BY inner_d.last_active_at ASC
    LIMIT 1
)
RETURNING *;
