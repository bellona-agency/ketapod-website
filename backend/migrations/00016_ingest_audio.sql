-- +goose Up

-- بستن حلقه صوت: خروجی TTS سرویس AI باید در کاتالوگ خودمان قابل پخش شود.
--
-- سرویس AI فایل‌ها را در public.audio_assets می‌نویسد (به‌ازای هر فصل یا یک
-- فایل برای کل کتاب). مدل ما یک AudioEdition دارد با یک فایل پیوسته و
-- فصل‌هایی که بازه زمانی روی همان فایل‌اند. این ستون‌ها نتیجه آن نگاشت را
-- نگه می‌دارند تا هر بار از نو ساخته نشود و شکستش قابل دیدن باشد.
ALTER TABLE ingest.submissions
    ADD COLUMN catalog_edition_id uuid REFERENCES catalog.audio_editions (id) ON DELETE SET NULL,

    -- none      = تیک TTS نخورده، کاری نیست
    -- pending   = منتظر خروجی سرویس AI
    -- synced    = نسخه صوتی در کاتالوگ ساخته شد
    -- failed    = خروجی بود ولی نگاشت نشد (دلیلش در audio_error)
    ADD COLUMN audio_status text NOT NULL DEFAULT 'none'
        CHECK (audio_status IN ('none', 'pending', 'synced', 'failed')),
    ADD COLUMN audio_error text,
    ADD COLUMN audio_synced_at timestamptz,

    -- امضای مجموعه فایل‌های صوتیِ سمت AI در آخرین همگام‌سازی موفق. اگر
    -- سرویس AI کتاب را دوباره تولید کند این امضا عوض می‌شود و sweep بعدی
    -- دوباره کار می‌کند؛ بدون آن یا هر دقیقه بی‌دلیل دوباره می‌سازیم یا
    -- تولید تازه را برای همیشه نادیده می‌گیریم.
    ADD COLUMN audio_signature text;

-- sweep فقط دنبال ردیف‌هایی می‌گردد که TTS خواسته‌اند و هنوز جا نیفتاده‌اند.
CREATE INDEX idx_submissions_audio_pending
    ON ingest.submissions (created_at)
    WHERE want_tts AND audio_status IN ('pending', 'failed');

-- +goose Down
DROP INDEX IF EXISTS ingest.idx_submissions_audio_pending;
ALTER TABLE ingest.submissions
    DROP COLUMN IF EXISTS audio_signature,
    DROP COLUMN IF EXISTS audio_synced_at,
    DROP COLUMN IF EXISTS audio_error,
    DROP COLUMN IF EXISTS audio_status,
    DROP COLUMN IF EXISTS catalog_edition_id;
