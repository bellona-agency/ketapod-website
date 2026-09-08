-- +goose Up
CREATE SCHEMA IF NOT EXISTS ingest;

-- پنل تولید محتوا: هر بار که ادمین یک PDF + کاور آپلود می‌کند، یک ردیف
-- اینجا ساخته می‌شود و همان تراکنش سه چیز دیگر را هم می‌نویسد:
--   * public.books + public.book_documents  → ورودی سرویس AI
--   * catalog.books                          → همان کتاب در سایت
--   * jobs.outbox                            → تحویل به سرویس AI
--
-- این جدول «حلقه وصل» است: بدون آن هیچ‌جا نوشته نمی‌شود که کتاب شماره
-- فلان در کاتالوگ همان کتابی است که سرویس AI دارد پردازشش می‌کند، و
-- وضعیت پردازش قابل نمایش نیست.
--
-- ai_book_id عمداً FK ندارد. جدول‌های public را alembic می‌سازد و
-- می‌تواند drop/recreate کند؛ یک FK از schema ما به آن‌ها یعنی مهاجرت
-- همکار روی دیتابیس مشترک شکست می‌خورد. ایندکس یکتا همان تضمین عملی را
-- بدون آن گره می‌دهد.
CREATE TABLE ingest.submissions (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    ai_book_id        uuid NOT NULL,
    ai_document_id    uuid NOT NULL,
    catalog_book_id   uuid REFERENCES catalog.books (id) ON DELETE SET NULL,

    title             text NOT NULL,
    author            text,
    description       text,

    pdf_file_name     text NOT NULL,
    pdf_storage_key   text NOT NULL,
    pdf_size_bytes    bigint NOT NULL,
    cover_storage_key text,

    -- دو چک‌باکس پنل. اینها به سرویس AI فرستاده می‌شوند و همین‌جا هم
    -- می‌مانند تا وقتی job دوباره dispatch می‌شود مقدارشان از دست نرود.
    want_tts          boolean NOT NULL DEFAULT false,
    want_assistant    boolean NOT NULL DEFAULT false,

    -- وضعیت تحویل به سرویس AI، نه وضعیت پردازش. پردازش در public.jobs
    -- است و از همان‌جا خوانده می‌شود — دو کپی از یک حقیقت نمی‌سازیم.
    dispatch_status   text NOT NULL DEFAULT 'pending'
        CHECK (dispatch_status IN ('pending', 'dispatched', 'failed')),
    dispatch_error    text,
    dispatched_at     timestamptz,

    created_by        text,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_submissions_ai_book_id ON ingest.submissions (ai_book_id);
CREATE INDEX idx_submissions_created_at ON ingest.submissions (created_at DESC);

-- +goose Down
DROP TABLE IF EXISTS ingest.submissions;
DROP SCHEMA IF EXISTS ingest;
