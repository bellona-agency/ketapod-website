-- name: ListEditionsForBook :many
SELECT
    ae.id AS audio_edition_id,
    ae.book_id,
    ae.voice_id,
    v.name AS voice_name,
    v.style AS voice_style,
    ae.is_kids_friendly,
    ae.narrator_type,
    ae.dialect,
    ae.language,
    ae.price_irr,
    ae.preview_seconds,
    ae.duration_seconds
FROM catalog.audio_editions ae
JOIN catalog.voices v ON v.id = ae.voice_id
WHERE ae.book_id = $1 AND ae.status = 'published'
ORDER BY v.sort_order;

-- name: GetEditionByID :one
SELECT
    ae.id AS audio_edition_id,
    ae.book_id,
    ae.voice_id,
    v.name AS voice_name,
    v.style AS voice_style,
    ae.is_kids_friendly,
    ae.narrator_type,
    ae.dialect,
    ae.language,
    ae.price_irr,
    ae.preview_seconds,
    ae.duration_seconds,
    ae.status
FROM catalog.audio_editions ae
JOIN catalog.voices v ON v.id = ae.voice_id
WHERE ae.id = $1;

-- name: SetEditionDuration :exec
UPDATE catalog.audio_editions SET duration_seconds = $2 WHERE id = $1;

-- name: ListChaptersForEdition :many
SELECT * FROM catalog.chapters
WHERE audio_edition_id = $1
ORDER BY sort_order;

-- name: GetTranscriptForEdition :one
SELECT * FROM catalog.transcripts WHERE audio_edition_id = $1;

-- ترنسکریپت را برش‌خورده هم لازم داریم: کتاب‌یار فقط قطعات نزدیک به
-- موقعیت فعلی را به‌عنوان context می‌خواهد، نه کل کتاب را. jsonb_array_elements
-- اینجا کار می‌کند چون content آرایه {text,startSeconds,endSeconds} است.
-- name: GetTranscriptSegmentsInRange :many
SELECT
    (segment->>'text')::text          AS text,
    (segment->>'startSeconds')::numeric AS start_seconds,
    (segment->>'endSeconds')::numeric   AS end_seconds
FROM catalog.transcripts t,
     jsonb_array_elements(t.content) AS segment
WHERE t.audio_edition_id = $1
  AND (segment->>'endSeconds')::numeric   >= sqlc.arg(from_seconds)::numeric
  AND (segment->>'startSeconds')::numeric <= sqlc.arg(to_seconds)::numeric
ORDER BY (segment->>'startSeconds')::numeric;

-- name: UpsertTranscript :one
INSERT INTO catalog.transcripts (audio_edition_id, language, content)
VALUES ($1, $2, $3)
ON CONFLICT (audio_edition_id) DO UPDATE
SET content = EXCLUDED.content, language = EXCLUDED.language
RETURNING *;
