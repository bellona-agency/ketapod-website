-- +goose Up
CREATE SCHEMA IF NOT EXISTS commerce;

-- دفتر کل فقط‌افزودنی. موجودی از SUM محاسبه می‌شود، هیچ ستون balance
-- وجود ندارد. لازم برای حسابرسی، بازگشت وجه و تقسیم درآمد.
CREATE TABLE commerce.wallet_ledger (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES identity.users (id) ON DELETE CASCADE,
    entry_type      text NOT NULL CHECK (entry_type IN ('credit', 'debit')),
    amount_irr      bigint NOT NULL CHECK (amount_irr > 0),
    reason          text NOT NULL,
    reference_type  text,
    reference_id    uuid,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_wallet_ledger_user_id ON commerce.wallet_ledger (user_id);

-- Entitlement جدا از تراکنش خرید است، با منشأ و انقضا. هدیه، کد تخفیف،
-- دسترسی سازمانی و اشتراک همه از این یک جدول عبور می‌کنند.
CREATE TABLE commerce.entitlements (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             uuid NOT NULL REFERENCES identity.users (id) ON DELETE CASCADE,
    book_id             uuid REFERENCES catalog.books (id) ON DELETE CASCADE,
    audio_edition_id    uuid REFERENCES catalog.audio_editions (id) ON DELETE CASCADE,
    origin              text NOT NULL CHECK (origin IN ('purchase', 'gift', 'subscription', 'org')),
    source_reference_id uuid,
    granted_at          timestamptz NOT NULL DEFAULT now(),
    expires_at          timestamptz,
    revoked_at          timestamptz
);

CREATE INDEX idx_entitlements_user_id ON commerce.entitlements (user_id);

-- +goose Down
DROP TABLE IF EXISTS commerce.entitlements;
DROP TABLE IF EXISTS commerce.wallet_ledger;
DROP SCHEMA IF EXISTS commerce;
