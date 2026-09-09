-- +goose Up
CREATE SCHEMA IF NOT EXISTS jobs;

-- Transactional outbox.
--
-- مسئله‌ای که حل می‌کند: تا امروز هر job اول در دیتابیس نوشته می‌شد و
-- بعد — بیرون از تراکنش — به صف می‌رفت. اگر پروسه بین این دو می‌مرد یا
-- Redis لحظه‌ای در دسترس نبود، job برای همیشه گم می‌شد: نشانک تا ابد
-- در وضعیت pending می‌ماند و کاربر کد ورودش را نمی‌گرفت. این همان
-- dual-write است و تنها راه درستش نوشتن job در **همان تراکنشی** است که
-- داده را می‌نویسد.
--
-- بعدش یک relay ردیف‌های pending را به asynq می‌دهد. تحویل at-least-once
-- است نه exactly-once — پس هر handler باید idempotent باشد. این معامله
-- عمدی است: job تکراری قابل تحمل است، job گم‌شده نه.
CREATE TABLE jobs.outbox (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    task_type     text NOT NULL,
    payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
    queue         text NOT NULL DEFAULT 'default',
    max_retry     int  NOT NULL DEFAULT 3,

    -- تأخیر برای jobهایی که نباید فوری اجرا شوند. relay ردیف‌های آینده
    -- را نادیده می‌گیرد، پس زمان‌بندی هم از همین‌جا در می‌آید.
    available_at  timestamptz NOT NULL DEFAULT now(),

    -- کلید یکتاسازی منطقی. «خلاصه این نشانک» یک بار باید صف شود حتی اگر
    -- کاربر دوباره روی همان ثانیه نشانک بزند.
    dedupe_key    text,

    status        text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'dispatched', 'failed')),
    attempts      int  NOT NULL DEFAULT 0,
    last_error    text,

    created_at    timestamptz NOT NULL DEFAULT now(),
    dispatched_at timestamptz
);

-- relay فقط ردیف‌های آماده را می‌خواند؛ ایندکس دقیقاً همان شکل کوئری را
-- دارد تا جدولی که بیشتر وقت‌ها خالی است اسکن نشود.
CREATE INDEX idx_outbox_ready
    ON jobs.outbox (available_at, created_at) WHERE status = 'pending';

CREATE UNIQUE INDEX idx_outbox_dedupe
    ON jobs.outbox (task_type, dedupe_key) WHERE dedupe_key IS NOT NULL AND status = 'pending';

CREATE INDEX idx_outbox_failed ON jobs.outbox (created_at DESC) WHERE status = 'failed';

-- تمدید اشتراک نباید هر ساعت به کیف پول خالی یک کاربر ناخنک بزند و لاگ
-- را پر کند. زمان آخرین تلاش ذخیره می‌شود تا sweep بعدی ردش کند.
ALTER TABLE commerce.subscriptions
    ADD COLUMN last_renewal_attempt_at timestamptz,
    ADD COLUMN renewal_failures int NOT NULL DEFAULT 0;

-- +goose Down
ALTER TABLE commerce.subscriptions
    DROP COLUMN IF EXISTS renewal_failures,
    DROP COLUMN IF EXISTS last_renewal_attempt_at;
DROP TABLE IF EXISTS jobs.outbox;
DROP SCHEMA IF EXISTS jobs;
