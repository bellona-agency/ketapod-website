-- +goose Up
CREATE SCHEMA IF NOT EXISTS kids;

-- ChildProfile زیرمجموعه User والد است، نه رکورد مستقل در identity.users
-- (08-decisions.md). کسی که مصرف می‌کند پول نمی‌دهد و کسی که پول می‌دهد
-- مصرف نمی‌کند — پس کودک نه کیف پول دارد، نه entitlement، نه دستگاه، نه
-- توکن. فقط یک پروفایل روی حساب والد که هدر X-Profile-Id به آن اشاره
-- می‌کند.
CREATE TABLE kids.child_profiles (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_user_id uuid NOT NULL REFERENCES identity.users (id) ON DELETE CASCADE,
    display_name   text NOT NULL,
    birth_year     int CHECK (birth_year BETWEEN 1300 AND 1500),
    age_years      int NOT NULL CHECK (age_years BETWEEN 0 AND 18),
    avatar_key     text,
    is_active      boolean NOT NULL DEFAULT true,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_child_profiles_parent ON kids.child_profiles (parent_user_id);

-- کنترل والد. هر ستون اینجا یک قاعده است که بک‌اند اعمالش می‌کند، نه
-- فرانت — «اگر در فرانت باشد، روزی یکی از سه کلاینت فراموشش می‌کند»
-- (08-decisions.md).
CREATE TABLE kids.parental_controls (
    child_profile_id     uuid PRIMARY KEY REFERENCES kids.child_profiles (id) ON DELETE CASCADE,
    daily_limit_minutes  int NOT NULL DEFAULT 60 CHECK (daily_limit_minutes >= 0),
    -- بازه مجاز شنیدن به دقیقه از نیمه‌شب، به وقت محلی کاربر. قصه شب
    -- یعنی این بازه معمولاً از شب تا بامداد می‌پیچد، پس start > end
    -- حالت معتبری است و منطق Go باید هر دو را بپذیرد.
    allowed_from_minute  int NOT NULL DEFAULT 0   CHECK (allowed_from_minute BETWEEN 0 AND 1439),
    allowed_to_minute    int NOT NULL DEFAULT 1439 CHECK (allowed_to_minute BETWEEN 0 AND 1439),
    max_content_age      int NOT NULL DEFAULT 12 CHECK (max_content_age BETWEEN 0 AND 18),
    -- حالت پیش‌فرض: فقط محتوای تأییدشده. والد می‌تواند به «همه کاتالوگ
    -- کودک» بازش کند، ولی پیش‌فرض بستهٔ امن است.
    approval_mode        text NOT NULL DEFAULT 'kids_catalog'
        CHECK (approval_mode IN ('allowlist_only', 'kids_catalog')),
    -- PIN خروج از حالت کودک. هش می‌شود، هرگز متن ساده ذخیره نمی‌شود.
    exit_pin_hash        text,
    -- دانلود خودکار فقط روی وای‌فای — تنظیم والد (03-product-surfaces.md).
    autodownload_wifi_only boolean NOT NULL DEFAULT true,
    updated_at           timestamptz NOT NULL DEFAULT now()
);

-- تأیید یا رد صریح یک کتاب توسط والد. رد همیشه بر تأیید مقدم است.
CREATE TABLE kids.content_approvals (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    child_profile_id uuid NOT NULL REFERENCES kids.child_profiles (id) ON DELETE CASCADE,
    book_id          uuid NOT NULL REFERENCES catalog.books (id) ON DELETE CASCADE,
    decision         text NOT NULL CHECK (decision IN ('allow', 'block')),
    decided_by       uuid NOT NULL REFERENCES identity.users (id) ON DELETE CASCADE,
    decided_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_content_approvals_unique
    ON kids.content_approvals (child_profile_id, book_id);

-- پرسش‌های از پیش تعریف‌شده کتاب‌یار کودک. «هیچ ورودی متن آزاد به هوش
-- مصنوعی» یک تصمیم ایمنی است نه محصولی — پس فهرست مجاز در دیتابیس
-- است و سرویس کتاب‌یار فقط id می‌پذیرد، نه متن.
CREATE TABLE kids.allowed_prompts (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    label       text NOT NULL,
    prompt_text text NOT NULL,
    min_age     int NOT NULL DEFAULT 0,
    max_age     int NOT NULL DEFAULT 18,
    sort_order  int NOT NULL DEFAULT 0,
    is_active   boolean NOT NULL DEFAULT true
);

-- +goose Down
DROP TABLE IF EXISTS kids.allowed_prompts;
DROP TABLE IF EXISTS kids.content_approvals;
DROP TABLE IF EXISTS kids.parental_controls;
DROP TABLE IF EXISTS kids.child_profiles;
DROP SCHEMA IF EXISTS kids;
