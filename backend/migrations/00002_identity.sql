-- +goose Up
CREATE SCHEMA IF NOT EXISTS identity;

CREATE TABLE identity.users (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    phone_number       text NOT NULL UNIQUE,
    full_name          text,
    email              text,
    role               text NOT NULL DEFAULT 'user',
    status             text NOT NULL DEFAULT 'active',
    kids_mode_enabled  boolean NOT NULL DEFAULT false,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);

-- ChildProfile زیرمجموعه User والد است، نه رکورد مستقل در users. جدول
-- identity.child_profiles در ماژول kids (خارج از دامنه این سشن) با
-- parent_user_id به identity.users(id) اضافه می‌شود. هیچ ستونی برای آن
-- روی users باز نمی‌شود.

CREATE TABLE identity.otp_codes (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    phone_number  text NOT NULL,
    code_hash     text NOT NULL,
    purpose       text NOT NULL DEFAULT 'login',
    attempt_count int NOT NULL DEFAULT 0,
    max_attempts  int NOT NULL DEFAULT 5,
    expires_at    timestamptz NOT NULL,
    consumed_at   timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_otp_codes_phone_active
    ON identity.otp_codes (phone_number, created_at DESC);

CREATE TABLE identity.devices (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES identity.users (id) ON DELETE CASCADE,
    platform        text NOT NULL DEFAULT 'web',
    push_token      text,
    app_version     text,
    last_active_at  timestamptz NOT NULL DEFAULT now(),
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_devices_user_id ON identity.devices (user_id);

CREATE TABLE identity.refresh_tokens (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES identity.users (id) ON DELETE CASCADE,
    device_id   uuid REFERENCES identity.devices (id) ON DELETE SET NULL,
    token_hash  text NOT NULL UNIQUE,
    expires_at  timestamptz NOT NULL,
    revoked_at  timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_refresh_tokens_user_id ON identity.refresh_tokens (user_id);

-- +goose Down
DROP TABLE IF EXISTS identity.refresh_tokens;
DROP TABLE IF EXISTS identity.devices;
DROP TABLE IF EXISTS identity.otp_codes;
DROP TABLE IF EXISTS identity.users;
DROP SCHEMA IF EXISTS identity;
