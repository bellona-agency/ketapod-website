-- ماژول ingest سه جدول را می‌نویسد:
--   * ingest.submissions — مال خودش
--   * public.books / public.book_documents — ورودی سرویس AI
--
-- دومی استثناست و عمدی: جدول‌های public را alembic **می‌سازد**، ولی
-- ردیف تحویل کار را ما می‌نویسیم، چون همان تراکنشی که فایل را ثبت
-- می‌کند باید کاری را هم که سرویس AI قرار است انجام دهد ثبت کند. اگر
-- این دو از هم جدا شوند، همان dual-write ای می‌شود که outbox برای حذفش
-- ساخته شد.

-- name: CreateAIBook :exec
INSERT INTO public.books (id, title, author, description, language, status, cover)
VALUES (@id, @title, sqlc.narg(author), sqlc.narg(description), @language, 'draft', sqlc.narg(cover));

-- name: CreateAIDocument :exec
INSERT INTO public.book_documents (
    id, book_id, file_name, storage_key, mime_type, size, document_type, status
) VALUES (
    @id, @book_id, @file_name, @storage_key, @mime_type, @size, @document_type, 'uploaded'
);

-- name: CreateSubmission :one
INSERT INTO ingest.submissions (
    ai_book_id, ai_document_id, catalog_book_id, title, author, description,
    pdf_file_name, pdf_storage_key, pdf_size_bytes, cover_storage_key,
    want_tts, want_assistant, created_by
) VALUES (
    @ai_book_id, @ai_document_id, sqlc.narg(catalog_book_id), @title, sqlc.narg(author), sqlc.narg(description),
    @pdf_file_name, @pdf_storage_key, @pdf_size_bytes, sqlc.narg(cover_storage_key),
    @want_tts, @want_assistant, sqlc.narg(created_by)
)
RETURNING *;

-- خواندن «ثبت + وضعیت job» در repository.go با pgx دستی نوشته شده، نه
-- اینجا. دلیلش یک محدودیت واقعی sqlc است: ستونی که از LEFT JOIN یا
-- زیرکوئری اسکالر می‌آید می‌تواند NULL باشد، ولی sqlc آن را از روی
-- تعریف ستون مبدأ NOT NULL می‌بیند و کدی می‌سازد که سر اولین ثبتِ
-- بدون job در Scan می‌شکند. تولید غلط را با دست اصلاح نمی‌کنیم چون
-- generate بعدی پاکش می‌کند.

-- name: ListJobSteps :many
SELECT step, status::text AS status, progress, attempt, error_message, started_at, completed_at
FROM public.job_steps
WHERE job_id = @job_id
ORDER BY created_at;

-- name: MarkDispatched :exec
UPDATE ingest.submissions
SET dispatch_status = 'dispatched', dispatched_at = now(), dispatch_error = NULL, updated_at = now()
WHERE id = @id;

-- name: MarkDispatchFailed :exec
UPDATE ingest.submissions
SET dispatch_status = 'failed', dispatch_error = @dispatch_error, updated_at = now()
WHERE id = @id;

-- name: MarkDispatchPending :exec
UPDATE ingest.submissions
SET dispatch_status = 'pending', dispatch_error = NULL, updated_at = now()
WHERE id = @id;

-- name: GetCoverKey :one
SELECT cover_storage_key FROM ingest.submissions WHERE id = @id;

-- خروجی صوتی سرویس AI برای یک کتاب.
--
-- ترتیب مهم است: فایل‌ها به ترتیب فصل به هم چسبانده می‌شوند و اگر ترتیب
-- عوض شود کتاب با فصل هفتم شروع می‌شود. فصل‌های سمت AI order_index دارند؛
-- فایل بدون فصل (کل کتاب در یک فایل) اول می‌آید چون در آن حالت تنها فایل است.
-- name: ListAIAudioAssets :many
SELECT
    a.id,
    a.storage_key,
    a.format,
    a.duration,
    a.status,
    a.chapter_id,
    c.title       AS chapter_title,
    c.order_index AS chapter_order
FROM public.audio_assets a
LEFT JOIN public.book_chapters c ON c.id = a.chapter_id
WHERE a.book_id = @book_id
ORDER BY c.order_index NULLS FIRST, a.created_at;

-- name: GetAIBook :one
SELECT id, title, author, description, status::text AS status
FROM public.books WHERE id = @id;

-- name: MarkAudioSynced :exec
UPDATE ingest.submissions
SET catalog_edition_id = @catalog_edition_id,
    audio_status       = 'synced',
    audio_error        = NULL,
    audio_signature    = @audio_signature,
    audio_synced_at    = now(),
    updated_at         = now()
WHERE id = @id;

-- name: MarkAudioFailed :exec
UPDATE ingest.submissions
SET audio_status = 'failed', audio_error = @audio_error, updated_at = now()
WHERE id = @id;

-- name: MarkAudioPending :exec
UPDATE ingest.submissions
SET audio_status = 'pending', audio_error = NULL, updated_at = now()
WHERE id = @id;

-- کاندیداهای همگام‌سازی صوت: تیک TTS خورده، هنوز جا نیفتاده یا شکست خورده،
-- و سرویس AI حداقل یک فایل صوتی برایش نوشته است. آخرین شرط جلوی این را
-- می‌گیرد که sweep هر دو دقیقه سراغ کتابی برود که هنوز چیزی تولید نشده.
-- name: ListAudioSyncCandidates :many
SELECT s.id
FROM ingest.submissions s
WHERE s.want_tts
  AND s.audio_status IN ('pending', 'failed')
  AND EXISTS (SELECT 1 FROM public.audio_assets a WHERE a.book_id = s.ai_book_id)
ORDER BY s.created_at
LIMIT @page_limit;
