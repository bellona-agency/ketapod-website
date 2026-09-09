-- name: UpsertLexiconEntry :one
INSERT INTO catalog.pronunciation_lexicon (book_id, grapheme, phoneme, language, created_by)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT DO NOTHING
RETURNING *;

-- ResolveLexicon کل واژه‌نامه مؤثر برای یک کتاب را می‌دهد: ورودی مخصوص
-- کتاب بر ورودی سراسری مقدم است، چون «کرم» در یک کتاب زیست‌شناسی و یک
-- کتاب اخلاق دو تلفظ متفاوت دارد.
-- name: ResolveLexicon :many
SELECT DISTINCT ON (grapheme)
    grapheme, phoneme, book_id
FROM catalog.pronunciation_lexicon
WHERE language = sqlc.arg(language)::text
  AND (book_id IS NULL OR book_id = sqlc.narg(book_id)::uuid)
ORDER BY grapheme, book_id NULLS LAST;

-- name: ListRightsGrantsForBook :many
SELECT * FROM catalog.rights_grants
WHERE book_id = $1
ORDER BY starts_at DESC;

-- HasActiveRights پاسخ به سؤال «آیا حق پخش این کتاب را داریم». اگر هیچ
-- RightsGrant ثبت نشده باشد نتیجه false است — پیش‌فرض «حق نداریم»، نه
-- «حق داریم». این تفاوت، تفاوت میان یک پرونده حقوقی و یک صف بازبینی است.
-- name: HasActiveRights :one
SELECT EXISTS (
    SELECT 1 FROM catalog.rights_grants
    WHERE book_id = $1
      AND starts_at <= now()
      AND (expires_at IS NULL OR expires_at > now())
) AS has_rights;
