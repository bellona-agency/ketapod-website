-- name: GetBookByID :one
SELECT * FROM catalog.books WHERE id = $1;

-- name: GetBookBySlug :one
SELECT * FROM catalog.books WHERE slug = $1;

-- name: GetAuthorByID :one
SELECT * FROM catalog.authors WHERE id = $1;

-- name: GetAuthorBySlug :one
SELECT * FROM catalog.authors WHERE slug = $1;

-- name: GetPublisherBySlug :one
SELECT * FROM catalog.publishers WHERE slug = $1;

-- ListBooks یک کوئری است نه پنج تا: هر فیلتر با الگوی
-- «sqlc.narg IS NULL OR شرط» اختیاری می‌شود. دلیلش N+1 نیست، این است که
-- صفحه کاتالوگ، صفحه دسته، صفحه نویسنده، صفحه کودک و نتیجه جستجو همه یک
-- شکل داده برمی‌گردانند و باید یک جا مرتب و صفحه‌بندی شوند.
--
-- kids_only فقط is_kids_friendly را چک می‌کند؛ سیاست کودکِ به‌ازای پروفایل
-- (سن، تأیید والد) در ماژول kids اعمال می‌شود نه اینجا — کاتالوگ نمی‌داند
-- کدام کودک درخواست داده.
-- name: ListBooks :many
SELECT
    b.*,
    a.name AS author_name,
    a.slug AS author_slug,
    p.name AS publisher_name,
    c.name AS category_name,
    c.slug AS category_slug,
    count(*) OVER () AS total_count
FROM catalog.books b
LEFT JOIN catalog.authors a    ON a.id = b.author_id
LEFT JOIN catalog.publishers p ON p.id = b.publisher_id
LEFT JOIN catalog.categories c ON c.id = b.category_id
WHERE b.status = 'published'
  AND (sqlc.narg(category_slug)::text IS NULL OR c.slug = sqlc.narg(category_slug)::text)
  AND (sqlc.narg(author_slug)::text   IS NULL OR a.slug = sqlc.narg(author_slug)::text)
  AND (sqlc.narg(language)::text      IS NULL OR b.language = sqlc.narg(language)::text)
  AND (sqlc.narg(kids_only)::boolean  IS NULL OR b.is_kids_friendly = sqlc.narg(kids_only)::boolean)
ORDER BY
    CASE WHEN sqlc.arg(sort)::text = 'popular' THEN b.listen_count END DESC NULLS LAST,
    CASE WHEN sqlc.arg(sort)::text = 'rating'  THEN b.rating_average END DESC NULLS LAST,
    b.published_at DESC NULLS LAST,
    b.created_at DESC
LIMIT sqlc.arg(page_limit) OFFSET sqlc.arg(page_offset);

-- SearchBooks دو سیگنال را با هم می‌گیرد: FTS برای واژه کامل و
-- similarity/trigram برای غلط املایی. املای فارسی («طهران/تهران»،
-- نیم‌فاصله، «ی» عربی و فارسی) بدون trigram نتیجه صفر می‌دهد و کاربر فکر
-- می‌کند کتاب را نداریم. تا ده هزار عنوان همین کافی است؛ عبور از آن یعنی
-- وقت Meilisearch است (08-decisions.md).
-- name: SearchBooks :many
SELECT
    b.*,
    a.name AS author_name,
    a.slug AS author_slug,
    ts_rank(b.search_document, plainto_tsquery('simple', catalog.normalize_fa(sqlc.arg(query)::text))) AS text_rank,
    similarity(catalog.normalize_fa(b.title), catalog.normalize_fa(sqlc.arg(query)::text)) AS title_similarity,
    count(*) OVER () AS total_count
FROM catalog.books b
LEFT JOIN catalog.authors a ON a.id = b.author_id
WHERE b.status = 'published'
  AND (sqlc.narg(kids_only)::boolean IS NULL OR b.is_kids_friendly = sqlc.narg(kids_only)::boolean)
  AND (
        b.search_document @@ plainto_tsquery('simple', catalog.normalize_fa(sqlc.arg(query)::text))
     -- The trigram arm catches what FTS cannot: a misspelling, or a
     -- prefix of a compound word ("قصه" against "قصه‌های"), which after
     -- normalization is a substring rather than a token match.
     OR catalog.normalize_fa(b.title) % catalog.normalize_fa(sqlc.arg(query)::text)
     OR catalog.normalize_fa(b.title) ILIKE '%' || catalog.normalize_fa(sqlc.arg(query)::text) || '%'
     OR catalog.normalize_fa(a.name)  % catalog.normalize_fa(sqlc.arg(query)::text)
  )
ORDER BY
    ts_rank(b.search_document, plainto_tsquery('simple', catalog.normalize_fa(sqlc.arg(query)::text))) DESC,
    similarity(catalog.normalize_fa(b.title), catalog.normalize_fa(sqlc.arg(query)::text)) DESC,
    b.listen_count DESC
LIMIT sqlc.arg(page_limit) OFFSET sqlc.arg(page_offset);

-- name: ListCategories :many
SELECT c.*, count(b.id) AS book_count
FROM catalog.categories c
LEFT JOIN catalog.books b ON b.category_id = c.id AND b.status = 'published'
GROUP BY c.id
ORDER BY c.name;

-- name: GetCategoryBySlug :one
SELECT * FROM catalog.categories WHERE slug = $1;

-- name: ListCollections :many
SELECT * FROM catalog.collections ORDER BY name;

-- name: ListBooksInCollection :many
SELECT b.*, a.name AS author_name, a.slug AS author_slug
FROM catalog.collection_books cb
JOIN catalog.books b ON b.id = cb.book_id AND b.status = 'published'
LEFT JOIN catalog.authors a ON a.id = b.author_id
WHERE cb.collection_id = $1
ORDER BY cb.sort_order;

-- name: IncrementListenCount :exec
UPDATE catalog.books SET listen_count = listen_count + $2 WHERE id = $1;

-- نوشتن در کاتالوگ از مسیر پنل تولید محتوا.
--
-- این کوئری‌ها اینجا هستند نه در ماژول ingest، چون قاعده معماری این است
-- که هر ماژول تنها نویسنده جدول‌های خودش باشد. ingest تراکنش خودش را
-- می‌دهد (CreateBookInTx) تا ردیف کاتالوگ، ردیف سرویس AI و job همگی با
-- هم commit شوند، ولی SQL آن همین‌جا می‌ماند.

-- name: UpsertAuthorByName :one
INSERT INTO catalog.authors (name, slug)
VALUES (@name, @slug)
ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
RETURNING *;

-- name: CreateBookIfSlugFree :one
INSERT INTO catalog.books (
    slug, title, author_id, description, cover_url, language,
    is_kids_friendly, status, published_at
) VALUES (
    @slug, @title, sqlc.narg(author_id), sqlc.narg(description), sqlc.narg(cover_url), @language,
    @is_kids_friendly, @status, now()
)
ON CONFLICT (slug) DO NOTHING
RETURNING id;

-- HasActiveRights به‌طور پیش‌فرض «حق نداریم» برمی‌گرداند، پس کتابی که از
-- پنل می‌آید بدون این ردیف برای هر بررسی مجوز نامرئی است. contract_ref
-- عمداً می‌گوید منبعش پنل داخلی است، نه قراردادی که وجود ندارد.
-- name: EnsureIngestRightsGrant :exec
INSERT INTO catalog.rights_grants (book_id, scope, revenue_share_percent, contract_ref)
SELECT @book_id, 'audio_distribution', 0, 'ADMIN-PANEL-UPLOAD'
WHERE NOT EXISTS (SELECT 1 FROM catalog.rights_grants WHERE book_id = @book_id);

-- name: SetBookCoverURL :exec
UPDATE catalog.books SET cover_url = @cover_url, updated_at = now() WHERE id = @id;

-- نسخه صوتی تولیدشده با TTS.
--
-- گوینده upsert می‌شود چون قرارداد شناسه صدا (voices.id == sources[].voiceId)
-- می‌گوید این شناسه در کل سیستم یکی است؛ دیتابیسی که seed نشده هم باید بتواند
-- اولین کتاب TTS شده را بپذیرد بدون اینکه FK بشکند.
-- name: UpsertVoice :one
INSERT INTO catalog.voices (id, name, style, is_default, is_kids, sort_order)
VALUES (@id, @name, @style, false, false, 0)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
RETURNING *;

-- name: UpsertAIEdition :one
INSERT INTO catalog.audio_editions (
    book_id, voice_id, narrator_type, language, is_kids_friendly,
    price_irr, preview_seconds, duration_seconds, status, published_at
) VALUES (
    @book_id, @voice_id, 'ai', @language, @is_kids_friendly,
    @price_irr, @preview_seconds, @duration_seconds, 'published', now()
)
ON CONFLICT (book_id, voice_id) DO UPDATE
SET duration_seconds = EXCLUDED.duration_seconds,
    status           = 'published',
    published_at     = coalesce(catalog.audio_editions.published_at, now())
RETURNING id;

-- name: DeleteChaptersForEdition :exec
DELETE FROM catalog.chapters WHERE audio_edition_id = @audio_edition_id;

-- name: CreateChapter :exec
INSERT INTO catalog.chapters (audio_edition_id, title, sort_order, start_seconds, end_seconds)
VALUES (@audio_edition_id, @title, @sort_order, @start_seconds, @end_seconds);

-- name: SetBookDescriptionIfEmpty :exec
UPDATE catalog.books
SET description = @description, updated_at = now()
WHERE id = @id AND (description IS NULL OR description = '');
