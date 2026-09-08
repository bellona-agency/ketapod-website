-- UpsertListeningPosition با محافظ last-write-wins.
--
-- شرط WHERE روی DO UPDATE عمداً آنجاست: دستگاهی که آفلاین بوده و ساعت‌ها
-- بعد سینک می‌کند نباید موقعیت جدیدتر دستگاه دیگر را عقب بکشد. مرجع
-- زمانِ دستگاه است نه سرور، چون همان دستگاه است که می‌داند کاربر واقعاً
-- کِی گوش داده (03-product-surfaces.md).
--
-- نتیجه: اگر نوشته قدیمی باشد، هیچ ردیفی برنمی‌گردد. کد Go آن را «رد شد،
-- موقعیت فعلی را بخوان» تفسیر می‌کند نه خطا.
-- name: UpsertListeningPosition :one
INSERT INTO library.listening_positions (
    user_id, profile_id, audio_edition_id, book_id,
    position_seconds, duration_seconds, is_finished, device_updated_at, updated_at
) VALUES (
    sqlc.arg(user_id), sqlc.narg(profile_id)::uuid, sqlc.arg(audio_edition_id), sqlc.arg(book_id),
    sqlc.arg(position_seconds), sqlc.arg(duration_seconds), sqlc.arg(is_finished),
    sqlc.arg(device_updated_at), now()
)
ON CONFLICT (user_id, coalesce(profile_id, '00000000-0000-0000-0000-000000000000'::uuid), audio_edition_id)
DO UPDATE SET
    position_seconds  = EXCLUDED.position_seconds,
    duration_seconds  = EXCLUDED.duration_seconds,
    is_finished       = EXCLUDED.is_finished,
    device_updated_at = EXCLUDED.device_updated_at,
    updated_at        = now()
WHERE library.listening_positions.device_updated_at <= EXCLUDED.device_updated_at
RETURNING *;

-- name: GetListeningPosition :one
SELECT * FROM library.listening_positions
WHERE user_id = sqlc.arg(user_id)
  AND audio_edition_id = sqlc.arg(audio_edition_id)
  AND coalesce(profile_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = coalesce(sqlc.narg(profile_id)::uuid, '00000000-0000-0000-0000-000000000000'::uuid);

-- «ادامه شنیدن» — در نسخه کودک بزرگ‌ترین عنصر صفحه اول است، پس باید
-- به‌ازای پروفایل جدا باشد نه به‌ازای حساب.
-- name: ListContinueListening :many
SELECT p.*, b.title, b.slug, b.cover_url, b.is_kids_friendly
FROM library.listening_positions p
JOIN catalog.books b ON b.id = p.book_id
WHERE p.user_id = sqlc.arg(user_id)
  AND NOT p.is_finished
  AND p.position_seconds > 0
  AND coalesce(p.profile_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = coalesce(sqlc.narg(profile_id)::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
ORDER BY p.updated_at DESC
LIMIT sqlc.arg(page_limit);

-- name: CreateListeningEvent :one
INSERT INTO library.listening_events (user_id, profile_id, audio_edition_id, book_id, seconds_listened, occurred_at)
VALUES (sqlc.arg(user_id), sqlc.narg(profile_id)::uuid, sqlc.arg(audio_edition_id), sqlc.arg(book_id), sqlc.arg(seconds_listened), sqlc.arg(occurred_at))
RETURNING *;

-- name: SumSecondsListenedForProfileSince :one
SELECT COALESCE(SUM(seconds_listened), 0)::bigint AS total_seconds
FROM library.listening_events
WHERE profile_id = sqlc.arg(profile_id)::uuid
  AND occurred_at >= sqlc.arg(since);

-- name: SumSecondsListenedForUserSince :one
SELECT COALESCE(SUM(seconds_listened), 0)::bigint AS total_seconds
FROM library.listening_events
WHERE user_id = $1 AND occurred_at >= $2;

-- روزهای متمایزی که کاربر گوش داده — ماده خام streak. محاسبه در بک‌اند
-- انجام می‌شود نه فرانت، وگرنه سه کلاینت سه تعریف متفاوت از «روز» پیدا
-- می‌کنند (04-architecture.md).
-- name: ListListeningDaysSince :many
SELECT DISTINCT (occurred_at AT TIME ZONE sqlc.arg(tz)::text)::date AS listened_on
FROM library.listening_events
WHERE user_id = sqlc.arg(user_id) AND occurred_at >= sqlc.arg(since)
ORDER BY listened_on DESC;

-- name: DailyListeningBreakdown :many
SELECT
    (e.occurred_at AT TIME ZONE sqlc.arg(tz)::text)::date AS listened_on,
    SUM(e.seconds_listened)::bigint AS total_seconds
FROM library.listening_events e
WHERE e.user_id = sqlc.arg(user_id)
  AND coalesce(e.profile_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = coalesce(sqlc.narg(profile_id)::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
  AND e.occurred_at >= sqlc.arg(since)
GROUP BY 1
ORDER BY 1;

-- name: TopBooksListened :many
SELECT e.book_id, b.title, b.cover_url, SUM(e.seconds_listened)::bigint AS total_seconds
FROM library.listening_events e
JOIN catalog.books b ON b.id = e.book_id
WHERE e.user_id = sqlc.arg(user_id)
  AND coalesce(e.profile_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = coalesce(sqlc.narg(profile_id)::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
  AND e.occurred_at >= sqlc.arg(since)
GROUP BY e.book_id, b.title, b.cover_url
ORDER BY total_seconds DESC
LIMIT sqlc.arg(page_limit);
