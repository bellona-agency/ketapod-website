-- name: CreateOrder :one
INSERT INTO commerce.orders (user_id, status, subtotal_irr, discount_irr, total_irr, coupon_id, idempotency_key)
VALUES ($1, 'pending', $2, $3, $4, $5, $6)
RETURNING *;

-- name: GetOrderByID :one
SELECT * FROM commerce.orders WHERE id = $1;

-- name: GetOrderByIdempotencyKey :one
SELECT * FROM commerce.orders
WHERE user_id = $1 AND idempotency_key = $2;

-- name: MarkOrderPaid :one
UPDATE commerce.orders
SET status = 'paid', paid_at = now(), updated_at = now()
WHERE id = $1 AND status = 'pending'
RETURNING *;

-- name: MarkOrderFailed :exec
UPDATE commerce.orders
SET status = 'failed', updated_at = now()
WHERE id = $1 AND status = 'pending';

-- name: MarkOrderRefunded :exec
UPDATE commerce.orders
SET status = 'refunded', updated_at = now()
WHERE id = $1;

-- name: CreateOrderItem :one
INSERT INTO commerce.order_items (order_id, audio_edition_id, book_id, unit_price_irr, recipient_user_id, gift_message)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: ListOrderItems :many
SELECT * FROM commerce.order_items WHERE order_id = $1;

-- name: ListOrdersForUser :many
SELECT *, count(*) OVER () AS total_count FROM commerce.orders
WHERE user_id = $1
ORDER BY created_at DESC
LIMIT $2 OFFSET $3;

-- name: GetCouponByCode :one
SELECT * FROM commerce.coupons WHERE code = $1;

-- GetUsableCouponByCode evaluates the validity *window* in the database.
--
-- The window has to be judged by one clock. Comparing a Postgres-issued
-- starts_at against the API host's time.Now() rejects a perfectly valid
-- coupon whenever the two machines differ by a few seconds — which they
-- will, since they are different machines. The amount rules (subtotal
-- floor, caps, redemption limits) stay in Go where they are testable;
-- only the time comparison moves here.
-- name: GetUsableCouponByCode :one
SELECT * FROM commerce.coupons
WHERE code = $1
  AND is_active
  AND starts_at <= now()
  AND (expires_at IS NULL OR expires_at > now());

-- name: CountCouponRedemptions :one
SELECT count(*) FROM commerce.coupon_redemptions WHERE coupon_id = $1;

-- name: CountCouponRedemptionsForUser :one
SELECT count(*) FROM commerce.coupon_redemptions WHERE coupon_id = $1 AND user_id = $2;

-- name: CreateCouponRedemption :exec
INSERT INTO commerce.coupon_redemptions (coupon_id, user_id, order_id, discount_irr)
VALUES ($1, $2, $3, $4);

-- name: CreateRefund :one
INSERT INTO commerce.refunds (order_id, user_id, amount_irr, reason)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: GetRefundByID :one
SELECT * FROM commerce.refunds WHERE id = $1;

-- name: ListRefundsForOrder :many
SELECT * FROM commerce.refunds WHERE order_id = $1 ORDER BY requested_at DESC;

-- name: ResolveRefund :one
UPDATE commerce.refunds
SET status = $2, resolved_at = now(), resolved_by = $3
WHERE id = $1 AND status = 'requested'
RETURNING *;
