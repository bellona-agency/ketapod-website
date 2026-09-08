-- +goose Up

-- قیمت روی Book معنی ندارد چون هر AudioEdition قیمت مستقل دارد، اما دو
-- چیز روی خود اثر لازم است: بازه پیش‌نمایش رایگان و متادیتای انتشار برای
-- مرتب‌سازی و SEO.
ALTER TABLE catalog.books
    ADD COLUMN subtitle       text,
    ADD COLUMN published_at   timestamptz,
    ADD COLUMN listen_count   bigint NOT NULL DEFAULT 0,
    ADD COLUMN rating_average numeric(3, 2) NOT NULL DEFAULT 0,
    ADD COLUMN rating_count   int NOT NULL DEFAULT 0;

-- preview_seconds تصمیم تجاری است نه فنی: «پیش‌نمایش رایگان» در
-- 03-product-surfaces.md برای هر سه سطح ● است. صفر یعنی بدون پیش‌نمایش.
ALTER TABLE catalog.audio_editions
    ADD COLUMN preview_seconds  int NOT NULL DEFAULT 60 CHECK (preview_seconds >= 0),
    ADD COLUMN duration_seconds int NOT NULL DEFAULT 0,
    ADD COLUMN published_at     timestamptz;

-- یک کتاب می‌تواند در چند دسته باشد (کودک × افسانه × محتوای بومی). ستون
-- category_id روی books به‌عنوان دسته اصلی برای breadcrumb می‌ماند.
CREATE TABLE catalog.book_categories (
    book_id     uuid NOT NULL REFERENCES catalog.books (id) ON DELETE CASCADE,
    category_id uuid NOT NULL REFERENCES catalog.categories (id) ON DELETE CASCADE,
    PRIMARY KEY (book_id, category_id)
);

CREATE TABLE catalog.collection_books (
    collection_id uuid NOT NULL REFERENCES catalog.collections (id) ON DELETE CASCADE,
    book_id       uuid NOT NULL REFERENCES catalog.books (id) ON DELETE CASCADE,
    sort_order    int NOT NULL DEFAULT 0,
    PRIMARY KEY (collection_id, book_id)
);

ALTER TABLE catalog.authors     ADD COLUMN slug text;
ALTER TABLE catalog.publishers  ADD COLUMN slug text;
UPDATE catalog.authors    SET slug = 'author-'    || left(id::text, 8) WHERE slug IS NULL;
UPDATE catalog.publishers SET slug = 'publisher-' || left(id::text, 8) WHERE slug IS NULL;
ALTER TABLE catalog.authors    ALTER COLUMN slug SET NOT NULL;
ALTER TABLE catalog.publishers ALTER COLUMN slug SET NOT NULL;
CREATE UNIQUE INDEX idx_authors_slug    ON catalog.authors (slug);
CREATE UNIQUE INDEX idx_publishers_slug ON catalog.publishers (slug);

-- جستجو: تا ده هزار عنوان Postgres FTS کافی است (08-decisions.md). ستون
-- تولیدشده به‌جای trigger چون همیشه با ردیف همگام می‌ماند و کد Go لازم
-- نیست چیزی به‌روزرسانی کند. unaccent در ستون generated قابل استفاده
-- نیست (STABLE نه IMMUTABLE)، پس simple + pg_trgm ترکیب می‌شوند: FTS
-- برای واژه کامل، trigram برای غلط املایی فارسی.
ALTER TABLE catalog.books
    ADD COLUMN search_document tsvector
    GENERATED ALWAYS AS (
        setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
        setweight(to_tsvector('simple', coalesce(subtitle, '')), 'B') ||
        setweight(to_tsvector('simple', coalesce(description, '')), 'C')
    ) STORED;

CREATE INDEX idx_books_search_document ON catalog.books USING gin (search_document);
CREATE INDEX idx_books_status_published ON catalog.books (status, published_at DESC);
CREATE INDEX idx_books_category_id ON catalog.books (category_id);

-- واژه‌نامه تلفظ: دارایی انباشتی 04-architecture.md. دامنه سراسری
-- (book_id NULL) یا مخصوص یک کتاب. خط لوله TTS هنوز ساخته نشده اما
-- جدول از حالا هست چون داده‌اش از بازبینی انسانی جمع می‌شود.
CREATE TABLE catalog.pronunciation_lexicon (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    book_id        uuid REFERENCES catalog.books (id) ON DELETE CASCADE,
    grapheme       text NOT NULL,
    phoneme        text NOT NULL,
    language       text NOT NULL DEFAULT 'fa',
    created_by     uuid REFERENCES identity.users (id) ON DELETE SET NULL,
    created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_lexicon_global_grapheme
    ON catalog.pronunciation_lexicon (grapheme, language) WHERE book_id IS NULL;
CREATE UNIQUE INDEX idx_lexicon_book_grapheme
    ON catalog.pronunciation_lexicon (book_id, grapheme, language) WHERE book_id IS NOT NULL;

-- RightsGrant: پاسخ به ناشر وقتی می‌پرسد «سوابق چیست». بدون این جدول
-- هیچ قراردادی قابل ردیابی نیست و 02-business.md آن را ریسک وجودی
-- می‌داند.
CREATE TABLE catalog.rights_grants (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    book_id         uuid NOT NULL REFERENCES catalog.books (id) ON DELETE CASCADE,
    publisher_id    uuid REFERENCES catalog.publishers (id) ON DELETE SET NULL,
    scope           text NOT NULL DEFAULT 'audio_distribution',
    revenue_share_percent numeric(5, 2) NOT NULL DEFAULT 0
        CHECK (revenue_share_percent >= 0 AND revenue_share_percent <= 100),
    starts_at       timestamptz NOT NULL DEFAULT now(),
    expires_at      timestamptz,
    contract_ref    text,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_rights_grants_book_id ON catalog.rights_grants (book_id);

-- +goose Down
DROP TABLE IF EXISTS catalog.rights_grants;
DROP TABLE IF EXISTS catalog.pronunciation_lexicon;
DROP INDEX IF EXISTS catalog.idx_books_category_id;
DROP INDEX IF EXISTS catalog.idx_books_status_published;
DROP INDEX IF EXISTS catalog.idx_books_search_document;
ALTER TABLE catalog.books DROP COLUMN IF EXISTS search_document;
DROP INDEX IF EXISTS catalog.idx_publishers_slug;
DROP INDEX IF EXISTS catalog.idx_authors_slug;
ALTER TABLE catalog.publishers DROP COLUMN IF EXISTS slug;
ALTER TABLE catalog.authors    DROP COLUMN IF EXISTS slug;
DROP TABLE IF EXISTS catalog.collection_books;
DROP TABLE IF EXISTS catalog.book_categories;
ALTER TABLE catalog.audio_editions
    DROP COLUMN IF EXISTS published_at,
    DROP COLUMN IF EXISTS duration_seconds,
    DROP COLUMN IF EXISTS preview_seconds;
ALTER TABLE catalog.books
    DROP COLUMN IF EXISTS rating_count,
    DROP COLUMN IF EXISTS rating_average,
    DROP COLUMN IF EXISTS listen_count,
    DROP COLUMN IF EXISTS published_at,
    DROP COLUMN IF EXISTS subtitle;
