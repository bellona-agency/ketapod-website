-- +goose Up

-- تشخیص استفاده مجدد از refresh token. چرخش توکن به‌تنهایی کافی نیست:
-- اگر مهاجم توکن دزدیده و یک بار استفاده کند، توکن قربانی باطل می‌شود
-- ولی مهاجم زنجیره تازه‌ای در دست دارد. راه استاندارد این است که کل
-- «خانواده» توکن با اولین استفاده مجدد از یک توکن باطل‌شده کشته شود.
ALTER TABLE identity.refresh_tokens
    ADD COLUMN family_id      uuid,
    ADD COLUMN replaced_by_id uuid REFERENCES identity.refresh_tokens (id) ON DELETE SET NULL,
    ADD COLUMN used_at        timestamptz;

UPDATE identity.refresh_tokens SET family_id = id WHERE family_id IS NULL;
ALTER TABLE identity.refresh_tokens ALTER COLUMN family_id SET NOT NULL;

CREATE INDEX idx_refresh_tokens_family ON identity.refresh_tokens (family_id);

-- سقف پخش هم‌زمان از روی جدول devices اعمال می‌شود (04-architecture.md).
-- بدون یک شناسه پایدار از سمت دستگاه، هر بار ورود یک ردیف جدید می‌سازد
-- و سقف هیچ‌وقت معنی پیدا نمی‌کند.
ALTER TABLE identity.devices
    ADD COLUMN device_fingerprint text,
    ADD COLUMN revoked_at         timestamptz,
    ADD COLUMN name               text;

CREATE UNIQUE INDEX idx_devices_user_fingerprint
    ON identity.devices (user_id, device_fingerprint) WHERE device_fingerprint IS NOT NULL;

-- status روی users از قبل بود ولی هیچ‌جا چک نمی‌شد. CHECK اضافه می‌شود
-- تا مقدار بی‌معنی وارد نشود، و ستون‌های حذف نرم و مسدودسازی که
-- پنل مدریشن لازم دارد.
ALTER TABLE identity.users
    ADD CONSTRAINT chk_users_status CHECK (status IN ('active', 'suspended', 'deleted')),
    ADD COLUMN suspended_reason text,
    ADD COLUMN deleted_at       timestamptz,
    ADD COLUMN last_seen_at     timestamptz;

-- نقش کاربر روی مسیرهای استودیو، ناشر، سازمان و ادمین اثر دارد. یک
-- کاربر می‌تواند هم‌زمان چند نقش داشته باشد (ناشری که خودش هم گوش
-- می‌دهد)، پس ستون تکی role کافی نیست. ستون role به‌عنوان نقش اصلی
-- می‌ماند و این جدول نقش‌های افزوده را نگه می‌دارد.
CREATE TABLE identity.user_roles (
    user_id    uuid NOT NULL REFERENCES identity.users (id) ON DELETE CASCADE,
    role       text NOT NULL CHECK (role IN ('user', 'creator', 'publisher', 'org_admin', 'admin')),
    granted_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, role)
);

-- +goose Down
DROP TABLE IF EXISTS identity.user_roles;
ALTER TABLE identity.users
    DROP CONSTRAINT IF EXISTS chk_users_status,
    DROP COLUMN IF EXISTS last_seen_at,
    DROP COLUMN IF EXISTS deleted_at,
    DROP COLUMN IF EXISTS suspended_reason;
DROP INDEX IF EXISTS identity.idx_devices_user_fingerprint;
ALTER TABLE identity.devices
    DROP COLUMN IF EXISTS name,
    DROP COLUMN IF EXISTS revoked_at,
    DROP COLUMN IF EXISTS device_fingerprint;
DROP INDEX IF EXISTS identity.idx_refresh_tokens_family;
ALTER TABLE identity.refresh_tokens
    DROP COLUMN IF EXISTS used_at,
    DROP COLUMN IF EXISTS replaced_by_id,
    DROP COLUMN IF EXISTS family_id;
