-- +goose Up
CREATE SCHEMA IF NOT EXISTS catalog;

CREATE TABLE catalog.authors (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL,
    bio         text,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE catalog.publishers (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE catalog.categories (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name       text NOT NULL,
    slug       text NOT NULL UNIQUE,
    parent_id  uuid REFERENCES catalog.categories (id) ON DELETE SET NULL
);

CREATE TABLE catalog.collections (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL,
    slug        text NOT NULL UNIQUE,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- قرارداد شناسه صدا: voices.id باید دقیقاً همان مقداری باشد که در
-- media.audio_assets / پاسخ sources[].voiceId برمی‌گردد. کد پایدار و
-- خوانا (voice_narrator_fa_01) نه uuid، چون در چند سطح از سیستم و در
-- پاسخ‌های عمومی API به همین شکل ارجاع داده می‌شود.
CREATE TABLE catalog.voices (
    id          text PRIMARY KEY,
    name        text NOT NULL,
    style       text NOT NULL,
    is_default  boolean NOT NULL DEFAULT false,
    is_kids     boolean NOT NULL DEFAULT false,
    sort_order  int NOT NULL DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- Book اثر انتزاعی است: عنوان، نویسنده، ناشر، متن مرجع. هیچ فایل صوتی اینجا نیست.
CREATE TABLE catalog.books (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug              text NOT NULL UNIQUE,
    title             text NOT NULL,
    author_id         uuid REFERENCES catalog.authors (id) ON DELETE SET NULL,
    publisher_id      uuid REFERENCES catalog.publishers (id) ON DELETE SET NULL,
    category_id       uuid REFERENCES catalog.categories (id) ON DELETE SET NULL,
    description       text,
    cover_url         text,
    language          text NOT NULL DEFAULT 'fa',
    is_kids_friendly  boolean NOT NULL DEFAULT false,
    status            text NOT NULL DEFAULT 'published',
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_books_title_trgm ON catalog.books USING gin (title gin_trgm_ops);

-- هر کتاب چند AudioEdition: گویش، صدای کودک، نسخه انسانی/AI، قیمت مستقل.
CREATE TABLE catalog.audio_editions (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    book_id           uuid NOT NULL REFERENCES catalog.books (id) ON DELETE CASCADE,
    voice_id          text NOT NULL REFERENCES catalog.voices (id),
    narrator_type     text NOT NULL DEFAULT 'ai' CHECK (narrator_type IN ('human', 'ai')),
    dialect           text,
    language          text NOT NULL DEFAULT 'fa',
    is_kids_friendly  boolean NOT NULL DEFAULT false,
    price_irr         bigint NOT NULL DEFAULT 0,
    status            text NOT NULL DEFAULT 'published',
    created_at        timestamptz NOT NULL DEFAULT now(),
    UNIQUE (book_id, voice_id)
);

CREATE INDEX idx_audio_editions_book_id ON catalog.audio_editions (book_id);

CREATE TABLE catalog.chapters (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    audio_edition_id  uuid NOT NULL REFERENCES catalog.audio_editions (id) ON DELETE CASCADE,
    title             text NOT NULL,
    sort_order        int NOT NULL DEFAULT 0,
    start_seconds     numeric NOT NULL,
    end_seconds       numeric NOT NULL
);

CREATE INDEX idx_chapters_audio_edition_id ON catalog.chapters (audio_edition_id);

-- Transcript از روز اول موجودیت درجه‌یک است: دسترس‌پذیری، SEO، همگام‌سازی
-- متن و صوت، منبع RAG کتاب‌یار. یک ترنسکریپت به ازای هر AudioEdition؛
-- content آرایه‌ای jsonb از قطعات {text, startSeconds, endSeconds} است.
CREATE TABLE catalog.transcripts (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    audio_edition_id  uuid NOT NULL UNIQUE REFERENCES catalog.audio_editions (id) ON DELETE CASCADE,
    language          text NOT NULL DEFAULT 'fa',
    content           jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at        timestamptz NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE IF EXISTS catalog.transcripts;
DROP TABLE IF EXISTS catalog.chapters;
DROP TABLE IF EXISTS catalog.audio_editions;
DROP TABLE IF EXISTS catalog.books;
DROP TABLE IF EXISTS catalog.voices;
DROP TABLE IF EXISTS catalog.collections;
DROP TABLE IF EXISTS catalog.categories;
DROP TABLE IF EXISTS catalog.publishers;
DROP TABLE IF EXISTS catalog.authors;
DROP SCHEMA IF EXISTS catalog;
