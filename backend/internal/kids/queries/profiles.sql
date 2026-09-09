-- name: CreateChildProfile :one
INSERT INTO kids.child_profiles (parent_user_id, display_name, birth_year, age_years, avatar_key)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: GetChildProfileByID :one
SELECT * FROM kids.child_profiles WHERE id = $1;

-- مالکیت همیشه با parent_user_id چک می‌شود، نه فقط با id. اگر یک بار
-- فقط id چک شود، هر والدی می‌تواند پروفایل کودک والد دیگر را بخواند —
-- و این بدترین نوع نشتی داده در این محصول است.
-- name: GetChildProfileForParent :one
SELECT * FROM kids.child_profiles WHERE id = $1 AND parent_user_id = $2;

-- name: ListChildProfilesForParent :many
SELECT * FROM kids.child_profiles
WHERE parent_user_id = $1 AND is_active
ORDER BY created_at;

-- name: UpdateChildProfile :one
UPDATE kids.child_profiles
SET display_name = coalesce(sqlc.narg(display_name)::text, display_name),
    age_years    = coalesce(sqlc.narg(age_years)::int, age_years),
    birth_year   = coalesce(sqlc.narg(birth_year)::int, birth_year),
    avatar_key   = coalesce(sqlc.narg(avatar_key)::text, avatar_key),
    updated_at   = now()
WHERE id = sqlc.arg(id) AND parent_user_id = sqlc.arg(parent_user_id)
RETURNING *;

-- name: DeactivateChildProfile :exec
UPDATE kids.child_profiles SET is_active = false, updated_at = now()
WHERE id = $1 AND parent_user_id = $2;

-- name: UpsertParentalControls :one
INSERT INTO kids.parental_controls (
    child_profile_id, daily_limit_minutes, allowed_from_minute, allowed_to_minute,
    max_content_age, approval_mode, autodownload_wifi_only, updated_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, now())
ON CONFLICT (child_profile_id) DO UPDATE SET
    daily_limit_minutes    = EXCLUDED.daily_limit_minutes,
    allowed_from_minute    = EXCLUDED.allowed_from_minute,
    allowed_to_minute      = EXCLUDED.allowed_to_minute,
    max_content_age        = EXCLUDED.max_content_age,
    approval_mode          = EXCLUDED.approval_mode,
    autodownload_wifi_only = EXCLUDED.autodownload_wifi_only,
    updated_at             = now()
RETURNING *;

-- name: GetParentalControls :one
SELECT * FROM kids.parental_controls WHERE child_profile_id = $1;

-- name: SetExitPin :exec
UPDATE kids.parental_controls SET exit_pin_hash = $2, updated_at = now()
WHERE child_profile_id = $1;

-- name: UpsertContentApproval :one
INSERT INTO kids.content_approvals (child_profile_id, book_id, decision, decided_by)
VALUES ($1, $2, $3, $4)
ON CONFLICT (child_profile_id, book_id) DO UPDATE SET
    decision = EXCLUDED.decision, decided_by = EXCLUDED.decided_by, decided_at = now()
RETURNING *;

-- name: GetContentApproval :one
SELECT * FROM kids.content_approvals WHERE child_profile_id = $1 AND book_id = $2;

-- name: ListContentApprovals :many
SELECT ca.*, b.title, b.cover_url
FROM kids.content_approvals ca
JOIN catalog.books b ON b.id = ca.book_id
WHERE ca.child_profile_id = $1
ORDER BY ca.decided_at DESC;

-- name: DeleteContentApproval :exec
DELETE FROM kids.content_approvals WHERE child_profile_id = $1 AND book_id = $2;

-- name: ListAllowedPromptsForAge :many
SELECT * FROM kids.allowed_prompts
WHERE is_active AND $1::int BETWEEN min_age AND max_age
ORDER BY sort_order;

-- name: GetAllowedPromptByID :one
SELECT * FROM kids.allowed_prompts WHERE id = $1 AND is_active;
