-- +goose Up

-- سفارش و پرداخت. مدل درآمدی «کیف پول، نه اشتراک» است (02-business.md):
-- کاربر کیف پول را از درگاه شارژ می‌کند، بعد از کیف پول خرید می‌کند. پس
-- دو نوع تراکنش پولی داریم و هر دو از این جدول‌ها عبور می‌کنند.
CREATE TABLE commerce.orders (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES identity.users (id) ON DELETE CASCADE,
    status          text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'paid', 'failed', 'refunded', 'canceled')),
    subtotal_irr    bigint NOT NULL CHECK (subtotal_irr >= 0),
    discount_irr    bigint NOT NULL DEFAULT 0 CHECK (discount_irr >= 0),
    total_irr       bigint NOT NULL CHECK (total_irr >= 0),
    coupon_id       uuid,
    idempotency_key text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    paid_at         timestamptz,
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_orders_user_id ON commerce.orders (user_id, created_at DESC);

-- کلید idempotency برای جلوگیری از خرید دوتایی وقتی کاربر دکمه را دو بار
-- می‌زند یا کلاینت موبایل درخواست را retry می‌کند. در ایران با شبکه
-- ناپایدار این retry واقعاً اتفاق می‌افتد.
CREATE UNIQUE INDEX idx_orders_idempotency
    ON commerce.orders (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE commerce.order_items (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id          uuid NOT NULL REFERENCES commerce.orders (id) ON DELETE CASCADE,
    audio_edition_id  uuid NOT NULL REFERENCES catalog.audio_editions (id) ON DELETE RESTRICT,
    book_id           uuid NOT NULL REFERENCES catalog.books (id) ON DELETE RESTRICT,
    unit_price_irr    bigint NOT NULL CHECK (unit_price_irr >= 0),
    -- گیرنده متفاوت با خریدار یعنی «هدیه». همان جریان خرید، فقط
    -- entitlement به کس دیگری می‌رسد؛ 08-decisions.md دقیقاً همین را
    -- به‌عنوان دلیل جدا بودن Entitlement از تراکنش گفته.
    recipient_user_id uuid REFERENCES identity.users (id) ON DELETE SET NULL,
    gift_message      text
);

CREATE INDEX idx_order_items_order_id ON commerce.order_items (order_id);

-- شارژ کیف پول از درگاه. وضعیت جدا از orders نگه داشته می‌شود چون
-- چرخه عمرش با درگاه بانکی است نه با سبد خرید.
CREATE TABLE commerce.payments (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES identity.users (id) ON DELETE CASCADE,
    provider        text NOT NULL DEFAULT 'stub',
    amount_irr      bigint NOT NULL CHECK (amount_irr > 0),
    status          text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'succeeded', 'failed', 'canceled')),
    authority       text,
    reference_code  text,
    failure_reason  text,
    -- وقتی پرداخت موفق تایید شد، دقیقاً یک ردیف credit در دفتر کل
    -- ساخته می‌شود. این ستون تضمین می‌کند callback دوباره درگاه
    -- (که زرین‌پال واقعاً می‌فرستد) کیف پول را دو بار شارژ نکند.
    ledger_entry_id uuid,
    created_at      timestamptz NOT NULL DEFAULT now(),
    settled_at      timestamptz
);

CREATE UNIQUE INDEX idx_payments_provider_authority
    ON commerce.payments (provider, authority) WHERE authority IS NOT NULL;
CREATE INDEX idx_payments_user_id ON commerce.payments (user_id, created_at DESC);

CREATE TABLE commerce.coupons (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code               text NOT NULL UNIQUE,
    kind               text NOT NULL CHECK (kind IN ('percent', 'fixed')),
    value              bigint NOT NULL CHECK (value > 0),
    max_discount_irr   bigint,
    min_subtotal_irr   bigint NOT NULL DEFAULT 0,
    max_redemptions    int,
    per_user_limit     int NOT NULL DEFAULT 1,
    starts_at          timestamptz NOT NULL DEFAULT now(),
    expires_at         timestamptz,
    is_active          boolean NOT NULL DEFAULT true,
    created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE commerce.coupon_redemptions (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    coupon_id  uuid NOT NULL REFERENCES commerce.coupons (id) ON DELETE CASCADE,
    user_id    uuid NOT NULL REFERENCES identity.users (id) ON DELETE CASCADE,
    order_id   uuid NOT NULL REFERENCES commerce.orders (id) ON DELETE CASCADE,
    discount_irr bigint NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_coupon_redemptions_coupon_user
    ON commerce.coupon_redemptions (coupon_id, user_id);

-- اشتراک: 02-business.md می‌گوید اشتراک بعد از اثبات نگهداشت اضافه شود،
-- و اگر اضافه شد **سقف ساعتی** داشته باشد نه نامحدود. جدول از همان
-- ابتدا سقف ساعتی دارد تا کسی وسوسه «نامحدود» نشود.
CREATE TABLE commerce.subscription_plans (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code              text NOT NULL UNIQUE,
    name              text NOT NULL,
    price_irr         bigint NOT NULL CHECK (price_irr >= 0),
    period_days       int NOT NULL CHECK (period_days > 0),
    monthly_hour_cap  int NOT NULL CHECK (monthly_hour_cap > 0),
    is_active         boolean NOT NULL DEFAULT true,
    sort_order        int NOT NULL DEFAULT 0
);

CREATE TABLE commerce.subscriptions (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            uuid NOT NULL REFERENCES identity.users (id) ON DELETE CASCADE,
    plan_id            uuid NOT NULL REFERENCES commerce.subscription_plans (id) ON DELETE RESTRICT,
    status             text NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'expired', 'canceled')),
    -- تمدید خودکار در ایران عملاً کار نمی‌کند (02-business.md)، پس
    -- تمدید از کیف پول انجام می‌شود و این فقط یک تمایل کاربر است که
    -- scheduler هنگام سررسید امتحان می‌کند.
    auto_renew_from_wallet boolean NOT NULL DEFAULT false,
    started_at         timestamptz NOT NULL DEFAULT now(),
    expires_at         timestamptz NOT NULL,
    hours_consumed     numeric NOT NULL DEFAULT 0,
    canceled_at        timestamptz,
    created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_subscriptions_user_id ON commerce.subscriptions (user_id, status);
CREATE INDEX idx_subscriptions_expiry ON commerce.subscriptions (expires_at) WHERE status = 'active';

CREATE TABLE commerce.refunds (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id     uuid NOT NULL REFERENCES commerce.orders (id) ON DELETE CASCADE,
    user_id      uuid NOT NULL REFERENCES identity.users (id) ON DELETE CASCADE,
    amount_irr   bigint NOT NULL CHECK (amount_irr > 0),
    reason       text,
    status       text NOT NULL DEFAULT 'requested'
        CHECK (status IN ('requested', 'approved', 'rejected', 'settled')),
    requested_at timestamptz NOT NULL DEFAULT now(),
    resolved_at  timestamptz,
    resolved_by  uuid REFERENCES identity.users (id) ON DELETE SET NULL
);

CREATE INDEX idx_refunds_order_id ON commerce.refunds (order_id);

ALTER TABLE commerce.orders
    ADD CONSTRAINT fk_orders_coupon FOREIGN KEY (coupon_id)
    REFERENCES commerce.coupons (id) ON DELETE SET NULL;

ALTER TABLE commerce.payments
    ADD CONSTRAINT fk_payments_ledger_entry FOREIGN KEY (ledger_entry_id)
    REFERENCES commerce.wallet_ledger (id) ON DELETE SET NULL;

-- entitlement تکراری بی‌معنی است: یک کاربر یک بار به یک نسخه صوتی حق
-- دسترسی می‌گیرد. بدون این ایندکس، دو کلیک هم‌زمان «خرید» دو ردیف
-- می‌سازد و بازگشت وجه از کدام‌شان معلوم نیست.
CREATE UNIQUE INDEX idx_entitlements_unique_active
    ON commerce.entitlements (user_id, audio_edition_id, origin)
    WHERE revoked_at IS NULL AND audio_edition_id IS NOT NULL;

-- +goose Down
DROP INDEX IF EXISTS commerce.idx_entitlements_unique_active;
ALTER TABLE commerce.payments DROP CONSTRAINT IF EXISTS fk_payments_ledger_entry;
ALTER TABLE commerce.orders DROP CONSTRAINT IF EXISTS fk_orders_coupon;
DROP TABLE IF EXISTS commerce.refunds;
DROP TABLE IF EXISTS commerce.subscriptions;
DROP TABLE IF EXISTS commerce.subscription_plans;
DROP TABLE IF EXISTS commerce.coupon_redemptions;
DROP TABLE IF EXISTS commerce.coupons;
DROP TABLE IF EXISTS commerce.payments;
DROP TABLE IF EXISTS commerce.order_items;
DROP TABLE IF EXISTS commerce.orders;
