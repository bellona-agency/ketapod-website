-- name: CreateBookmark :one
INSERT INTO library.bookmarks (user_id, audio_edition_id, book_id, position_seconds, label, summary_status)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (user_id, audio_edition_id, position_seconds)
DO UPDATE SET label = EXCLUDED.label
RETURNING *;

-- name: ListBookmarksForUser :many
SELECT bm.*, b.title, b.cover_url, count(*) OVER () AS total_count
FROM library.bookmarks bm
JOIN catalog.books b ON b.id = bm.book_id
WHERE bm.user_id = sqlc.arg(user_id)
  AND (sqlc.narg(audio_edition_id)::uuid IS NULL OR bm.audio_edition_id = sqlc.narg(audio_edition_id)::uuid)
ORDER BY bm.created_at DESC
LIMIT sqlc.arg(page_limit) OFFSET sqlc.arg(page_offset);

-- name: GetBookmarkByID :one
SELECT * FROM library.bookmarks WHERE id = $1;

-- name: DeleteBookmark :exec
DELETE FROM library.bookmarks WHERE id = $1 AND user_id = $2;

-- خلاصه هوشمند bookmark در پس‌زمینه توسط worker پر می‌شود، نه هم‌زمان با
-- کلیک (03-product-surfaces.md) — کاربر نباید منتظر یک فراخوانی LLM بماند.
-- name: SetBookmarkSummary :one
UPDATE library.bookmarks
SET summary = $2, summary_status = $3
WHERE id = $1
RETURNING *;

-- name: CreateNote :one
INSERT INTO library.notes (user_id, audio_edition_id, book_id, position_seconds, body)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: UpdateNote :one
UPDATE library.notes
SET body = $3, updated_at = now()
WHERE id = $1 AND user_id = $2
RETURNING *;

-- name: DeleteNote :exec
DELETE FROM library.notes WHERE id = $1 AND user_id = $2;

-- name: ListNotesForUser :many
SELECT n.*, b.title, b.cover_url, count(*) OVER () AS total_count
FROM library.notes n
JOIN catalog.books b ON b.id = n.book_id
WHERE n.user_id = sqlc.arg(user_id)
  AND (sqlc.narg(audio_edition_id)::uuid IS NULL OR n.audio_edition_id = sqlc.narg(audio_edition_id)::uuid)
ORDER BY n.created_at DESC
LIMIT sqlc.arg(page_limit) OFFSET sqlc.arg(page_offset);

-- name: CreateHighlight :one
INSERT INTO library.highlights (user_id, audio_edition_id, book_id, start_seconds, end_seconds, quote)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: DeleteHighlight :exec
DELETE FROM library.highlights WHERE id = $1 AND user_id = $2;

-- name: ListHighlightsForUser :many
SELECT h.*, b.title, count(*) OVER () AS total_count
FROM library.highlights h
JOIN catalog.books b ON b.id = h.book_id
WHERE h.user_id = sqlc.arg(user_id)
  AND (sqlc.narg(audio_edition_id)::uuid IS NULL OR h.audio_edition_id = sqlc.narg(audio_edition_id)::uuid)
ORDER BY h.created_at DESC
LIMIT sqlc.arg(page_limit) OFFSET sqlc.arg(page_offset);

-- «جملات پرنشان»: ورودی طرح گرافیکی اشتراکی. شمارش روی متن نقل‌شده است
-- نه روی بازه زمانی، چون کاربران دقیقاً یک بازه را انتخاب نمی‌کنند.
-- name: TopHighlightedQuotes :many
SELECT quote, book_id, count(*)::bigint AS highlight_count
FROM library.highlights
WHERE book_id = $1
GROUP BY quote, book_id
ORDER BY highlight_count DESC
LIMIT $2;

-- name: UpsertShelfItem :one
INSERT INTO library.shelf_items (user_id, book_id, shelf)
VALUES ($1, $2, $3)
ON CONFLICT (user_id, book_id, shelf) DO UPDATE SET shelf = EXCLUDED.shelf
RETURNING *;

-- name: DeleteShelfItem :exec
DELETE FROM library.shelf_items WHERE user_id = $1 AND book_id = $2 AND shelf = $3;

-- name: ListShelf :many
SELECT s.*, b.title, b.slug, b.cover_url, b.is_kids_friendly, count(*) OVER () AS total_count
FROM library.shelf_items s
JOIN catalog.books b ON b.id = s.book_id
WHERE s.user_id = sqlc.arg(user_id) AND s.shelf = sqlc.arg(shelf)
ORDER BY s.created_at DESC
LIMIT sqlc.arg(page_limit) OFFSET sqlc.arg(page_offset);

-- name: CreateClip :one
INSERT INTO library.clips (user_id, audio_edition_id, start_seconds, end_seconds)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: GetClipByID :one
SELECT * FROM library.clips WHERE id = $1;

-- name: SetClipStatus :one
UPDATE library.clips SET status = $2, storage_key = $3 WHERE id = $1 RETURNING *;

-- name: ListClipsForUser :many
SELECT * FROM library.clips WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2;
