-- name: CreateEntitlement :one
INSERT INTO commerce.entitlements (user_id, book_id, audio_edition_id, origin, source_reference_id, expires_at)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- خرید دو بار همان نسخه نباید دو ردیف بسازد. ON CONFLICT روی همان
-- ایندکس جزئی یکتای مهاجرت 00008 می‌نشیند، پس دو کلیک هم‌زمان «خرید»
-- به یک entitlement می‌رسند نه دو تا.
-- name: GrantEntitlementIdempotent :one
INSERT INTO commerce.entitlements (user_id, book_id, audio_edition_id, origin, source_reference_id, expires_at)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (user_id, audio_edition_id, origin) WHERE revoked_at IS NULL AND audio_edition_id IS NOT NULL
DO UPDATE SET expires_at = EXCLUDED.expires_at
RETURNING *;

-- name: IsUserEntitledToBook :one
SELECT EXISTS (
    SELECT 1 FROM commerce.entitlements
    WHERE user_id = $1
      AND book_id = $2
      AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > now())
) AS entitled;

-- دسترسی در سطح AudioEdition سنجیده می‌شود نه فقط Book: خرید نسخه
-- «آرام» حق پخش نسخه «نمایشی» را نمی‌دهد چون قیمتشان مستقل است. اما
-- entitlement با audio_edition_id تهی (اشتراک، دسترسی سازمانی) کل کتاب
-- را پوشش می‌دهد.
-- name: IsUserEntitledToEdition :one
SELECT EXISTS (
    SELECT 1 FROM commerce.entitlements
    WHERE user_id = $1
      AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > now())
      AND (audio_edition_id = $2 OR (audio_edition_id IS NULL AND book_id = $3))
) AS entitled;

-- name: ListActiveEntitlementsForUser :many
SELECT * FROM commerce.entitlements
WHERE user_id = $1
  AND revoked_at IS NULL
  AND (expires_at IS NULL OR expires_at > now())
ORDER BY granted_at DESC;

-- name: RevokeEntitlement :exec
UPDATE commerce.entitlements
SET revoked_at = now()
WHERE id = $1;

-- name: RevokeEntitlementsForOrder :exec
UPDATE commerce.entitlements
SET revoked_at = now()
WHERE source_reference_id = $1 AND revoked_at IS NULL;
