-- name: CreateWalletLedgerEntry :one
INSERT INTO commerce.wallet_ledger (user_id, entry_type, amount_irr, reason, reference_type, reference_id)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: GetWalletBalance :one
SELECT
    COALESCE(SUM(CASE WHEN entry_type = 'credit' THEN amount_irr ELSE -amount_irr END), 0)::bigint AS balance_irr
FROM commerce.wallet_ledger
WHERE user_id = $1;

-- LockWallet قفل مشورتی سطح تراکنش روی کیف پول یک کاربر می‌گیرد.
--
-- بدون این، برداشت اتمیک نیست: دو درخواست هم‌زمان هر دو موجودی را کافی
-- می‌بینند و هر دو ردیف debit می‌سازند — کیف پول منفی می‌شود و چون دفتر
-- کل فقط‌افزودنی است، اصلاحش یعنی ثبت یک credit جبرانی و توضیح دادن به
-- کاربر. یک ستون balance با CHECK این را حل نمی‌کرد چون تصمیم صریح
-- 08-decisions.md نداشتن ستون balance است؛ قفل، همان تضمین را بدون
-- شکستن آن تصمیم می‌دهد.
--
-- hashtextextended به جای hashtext چون خروجی bigint می‌دهد و
-- pg_advisory_xact_lock نسخه تک‌آرگومانی bigint دارد.
-- name: LockWallet :exec
SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0));

-- name: ListWalletLedgerForUser :many
SELECT *, count(*) OVER () AS total_count FROM commerce.wallet_ledger
WHERE user_id = $1
ORDER BY created_at DESC
LIMIT $2 OFFSET $3;

-- name: CreatePayment :one
INSERT INTO commerce.payments (user_id, provider, amount_irr, authority)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: GetPaymentByID :one
SELECT * FROM commerce.payments WHERE id = $1;

-- name: GetPaymentByAuthority :one
SELECT * FROM commerce.payments WHERE provider = $1 AND authority = $2;

-- name: LockPaymentForSettlement :one
SELECT * FROM commerce.payments WHERE id = $1 FOR UPDATE;

-- name: MarkPaymentSucceeded :one
UPDATE commerce.payments
SET status = 'succeeded', reference_code = $2, ledger_entry_id = $3, settled_at = now()
WHERE id = $1 AND status = 'pending'
RETURNING *;

-- name: MarkPaymentFailed :one
UPDATE commerce.payments
SET status = 'failed', failure_reason = $2, settled_at = now()
WHERE id = $1 AND status = 'pending'
RETURNING *;
