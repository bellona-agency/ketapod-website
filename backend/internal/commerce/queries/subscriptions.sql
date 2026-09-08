-- name: ListActiveSubscriptionPlans :many
SELECT * FROM commerce.subscription_plans WHERE is_active ORDER BY sort_order;

-- name: GetSubscriptionPlanByCode :one
SELECT * FROM commerce.subscription_plans WHERE code = $1 AND is_active;

-- name: GetSubscriptionPlanByID :one
SELECT * FROM commerce.subscription_plans WHERE id = $1;

-- name: GetActiveSubscriptionForUser :one
SELECT * FROM commerce.subscriptions
WHERE user_id = $1 AND status = 'active' AND expires_at > now()
ORDER BY expires_at DESC
LIMIT 1;

-- name: CreateSubscription :one
INSERT INTO commerce.subscriptions (user_id, plan_id, expires_at, auto_renew_from_wallet)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: ExtendSubscription :one
UPDATE commerce.subscriptions
SET expires_at = expires_at + make_interval(days => $2::int), hours_consumed = 0
WHERE id = $1
RETURNING *;

-- name: CancelSubscription :one
UPDATE commerce.subscriptions
SET status = 'canceled', canceled_at = now(), auto_renew_from_wallet = false
WHERE id = $1 AND user_id = $2 AND status = 'active'
RETURNING *;

-- سقف ساعتی: Spotify پانزده ساعت در ماه می‌دهد و استوری‌تل پلن‌های
-- ۱۵/۳۰/۴۵ ساعته. «نامحدود» فقط پرمصرف‌ترین کاربران را جذب می‌کند و
-- حاشیه سود را می‌بلعد (02-business.md) — پس مصرف شمرده می‌شود.
-- name: AddSubscriptionHours :one
UPDATE commerce.subscriptions
SET hours_consumed = hours_consumed + $2
WHERE id = $1
RETURNING *;

-- ExpireDueSubscriptions عمداً بعد از تمدید اجرا می‌شود و در همان
-- handler، تا مسابقه‌ای که قبلاً بین این دو job وجود داشت ممکن نباشد.
-- name: ExpireDueSubscriptions :many
UPDATE commerce.subscriptions
SET status = 'expired'
WHERE status = 'active' AND expires_at <= now()
RETURNING *;

-- ListSubscriptionsDueForRenewal عمداً ردیف‌های **گذشته از سررسید** را هم
-- برمی‌گرداند، نه فقط آن‌هایی که تا یک ساعت آینده سررسید می‌شوند.
--
-- باگی که این حل می‌کند: نسخه قبلی فقط `status = 'active'` را می‌دید و
-- expire هم ساعتی اجرا می‌شد. اگر worker چند ساعت پایین بود — یا صرفاً
-- expire زودتر از renew اجرا می‌شد — اشتراک به 'expired' می‌رفت و
-- sweep تمدید دیگر هرگز نمی‌دیدش. کاربری که تمدید خودکار خواسته بود
-- بی‌صدا دسترسی‌اش را از دست می‌داد و هیچ‌کس خبردار نمی‌شد.
--
-- حالا پنجره جبران (grace) هم اشتراک‌های تازه‌منقضی را برمی‌گرداند، و
-- last_renewal_attempt_at جلوی ناخنک زدن ساعتی به کیف پول خالی را
-- می‌گیرد.
-- name: ListSubscriptionsDueForRenewal :many
SELECT * FROM commerce.subscriptions
WHERE auto_renew_from_wallet
  AND status IN ('active', 'expired')
  AND expires_at <= now() + make_interval(hours => sqlc.arg(lookahead_hours)::int)
  AND expires_at >  now() - make_interval(hours => sqlc.arg(grace_hours)::int)
  AND (
        last_renewal_attempt_at IS NULL
     OR last_renewal_attempt_at < now() - make_interval(hours => sqlc.arg(retry_after_hours)::int)
  )
ORDER BY expires_at;

-- name: MarkRenewalAttempt :exec
UPDATE commerce.subscriptions
SET last_renewal_attempt_at = now(),
    renewal_failures = CASE WHEN sqlc.arg(succeeded)::boolean THEN 0 ELSE renewal_failures + 1 END
WHERE id = sqlc.arg(id);

-- تمدید موفق باید اشتراکِ تازه‌منقضی را دوباره فعال کند، وگرنه کاربر
-- پول داده و همچنان دسترسی ندارد.
-- name: ReactivateSubscription :exec
UPDATE commerce.subscriptions
SET status = 'active'
WHERE id = $1 AND status = 'expired';

-- name: GetSubscriptionByID :one
SELECT * FROM commerce.subscriptions WHERE id = $1;
