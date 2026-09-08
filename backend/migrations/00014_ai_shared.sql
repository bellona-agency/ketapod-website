-- +goose Up

-- یکسان‌سازی دیتابیس با سرویس AI.
--
-- تا امروز سرویس AI روی دیتابیس جدا «ketapod-ai» کار می‌کرد و بک‌اند Go
-- روی «ketapod». نتیجه: هیچ‌کدام نمی‌توانستند وضعیت دیگری را ببینند و هر
-- اتصال بینشان یک API جدید می‌خواست. این مهاجرت جدول‌های آن سرویس را
-- **عیناً** از dump آن (revision c0936393668e) داخل همین دیتابیس و در
-- schema پیش‌فرض public می‌سازد، تا سرویس Python فقط DATABASE_URL را عوض
-- کند و مدل‌هایش (که schema نمی‌دهند و روی public می‌نشینند) دست‌نخورده
-- بمانند.
--
-- قاعده مالکیت — این را نشکن:
--   * goose مالک schemaهای ماست: catalog, identity, media, commerce,
--     library, kids, home, jobs, ingest.
--   * alembic مالک public است. تغییر بعدی جدول‌های AI باید از مهاجرت
--     alembic همکار بیاید، نه از اینجا. این فایل فقط «نقطه شروع مشترک»
--     را می‌سازد.
--
-- به همین دلیل ردیف alembic_version هم با همان revision پر می‌شود:
-- بدون آن، اولین «alembic upgrade head» دوباره همین جدول‌ها را می‌سازد و
-- با خطای duplicate می‌ایستد.

-- +goose StatementBegin
DO $$
BEGIN
    CREATE TYPE public.artifact_source AS ENUM ('ocr', 'llm', 'user', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
-- +goose StatementEnd

-- +goose StatementBegin
DO $$
BEGIN
    CREATE TYPE public.artifact_type AS ENUM ('raw_ocr', 'processed', 'canonical', 'user_correction');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
-- +goose StatementEnd

-- +goose StatementBegin
DO $$
BEGIN
    CREATE TYPE public.book_status AS ENUM ('draft', 'processing', 'ready', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
-- +goose StatementEnd

-- +goose StatementBegin
DO $$
BEGIN
    CREATE TYPE public.document_status AS ENUM ('uploaded', 'processing', 'ready', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
-- +goose StatementEnd

-- +goose StatementBegin
DO $$
BEGIN
    CREATE TYPE public.document_type AS ENUM ('pdf', 'image', 'text', 'scanned_pdf', 'text_pdf');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
-- +goose StatementEnd

-- +goose StatementBegin
DO $$
BEGIN
    CREATE TYPE public.job_status AS ENUM ('queued', 'processing', 'completed', 'failed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
-- +goose StatementEnd

-- +goose StatementBegin
DO $$
BEGIN
    CREATE TYPE public.job_step_status AS ENUM ('pending', 'processing', 'completed', 'failed', 'skipped', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
-- +goose StatementEnd

-- +goose StatementBegin
DO $$
BEGIN
    CREATE TYPE public.knowledge_status AS ENUM ('building', 'active', 'failed', 'archived');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
-- +goose StatementEnd

CREATE TABLE IF NOT EXISTS public.alembic_version (
    version_num character varying(32) NOT NULL,
    CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num)
);

CREATE TABLE IF NOT EXISTS public.books (
    id               uuid PRIMARY KEY,
    title            character varying(255) NOT NULL,
    author           character varying(255),
    description      text,
    publisher        character varying(255),
    publication_year integer,
    language         character varying(10) DEFAULT 'fa' NOT NULL,
    status           public.book_status DEFAULT 'draft' NOT NULL,
    cover            character varying(512),
    categories       character varying[],
    metadata         jsonb,
    created_at       timestamptz DEFAULT now() NOT NULL,
    updated_at       timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_books_status ON public.books USING btree (status);

CREATE TABLE IF NOT EXISTS public.book_documents (
    id            uuid PRIMARY KEY,
    book_id       uuid NOT NULL REFERENCES public.books (id) ON DELETE CASCADE,
    file_name     character varying(255) NOT NULL,
    storage_key   character varying(512) NOT NULL,
    mime_type     character varying(100) NOT NULL,
    size          integer NOT NULL,
    document_type public.document_type NOT NULL,
    status        public.document_status DEFAULT 'uploaded' NOT NULL,
    created_at    timestamptz DEFAULT now() NOT NULL,
    updated_at    timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_book_documents_book_id ON public.book_documents USING btree (book_id);

CREATE TABLE IF NOT EXISTS public.book_chapters (
    id          uuid PRIMARY KEY,
    book_id     uuid NOT NULL REFERENCES public.books (id) ON DELETE CASCADE,
    title       character varying(255) NOT NULL,
    order_index integer NOT NULL,
    created_at  timestamptz DEFAULT now() NOT NULL,
    updated_at  timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT uq_chapter_book_order UNIQUE (book_id, order_index)
);
CREATE INDEX IF NOT EXISTS ix_book_chapters_book_id ON public.book_chapters USING btree (book_id);

CREATE TABLE IF NOT EXISTS public.book_sections (
    id          uuid PRIMARY KEY,
    chapter_id  uuid NOT NULL REFERENCES public.book_chapters (id) ON DELETE CASCADE,
    title       character varying(255) NOT NULL,
    order_index integer NOT NULL,
    created_at  timestamptz DEFAULT now() NOT NULL,
    updated_at  timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT uq_section_chapter_order UNIQUE (chapter_id, order_index)
);
CREATE INDEX IF NOT EXISTS ix_book_sections_chapter_id ON public.book_sections USING btree (chapter_id);

CREATE TABLE IF NOT EXISTS public.book_chunks (
    id          uuid PRIMARY KEY,
    book_id     uuid NOT NULL REFERENCES public.books (id) ON DELETE CASCADE,
    chapter_id  uuid REFERENCES public.book_chapters (id) ON DELETE SET NULL,
    section_id  uuid REFERENCES public.book_sections (id) ON DELETE SET NULL,
    content     text NOT NULL,
    chunk_index integer NOT NULL,
    page_number integer,
    language    character varying(10) DEFAULT 'fa' NOT NULL,
    source_type character varying(50),
    created_at  timestamptz DEFAULT now() NOT NULL,
    updated_at  timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_book_chunks_book_id ON public.book_chunks USING btree (book_id);
CREATE INDEX IF NOT EXISTS ix_book_chunks_chapter_id ON public.book_chunks USING btree (chapter_id);
CREATE INDEX IF NOT EXISTS ix_book_chunks_section_id ON public.book_chunks USING btree (section_id);

CREATE TABLE IF NOT EXISTS public.jobs (
    id            uuid PRIMARY KEY,
    book_id       uuid NOT NULL REFERENCES public.books (id) ON DELETE CASCADE,
    status        public.job_status DEFAULT 'queued' NOT NULL,
    current_step  character varying(100),
    progress      integer DEFAULT 0 NOT NULL,
    started_at    timestamptz,
    completed_at  timestamptz,
    failed_at     timestamptz,
    error_message text,
    created_at    timestamptz DEFAULT now() NOT NULL,
    updated_at    timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_jobs_book_id ON public.jobs USING btree (book_id);
CREATE INDEX IF NOT EXISTS ix_jobs_status  ON public.jobs USING btree (status);

CREATE TABLE IF NOT EXISTS public.job_steps (
    id            uuid PRIMARY KEY,
    job_id        uuid NOT NULL REFERENCES public.jobs (id) ON DELETE CASCADE,
    step          character varying(100) NOT NULL,
    status        public.job_step_status DEFAULT 'pending' NOT NULL,
    progress      integer DEFAULT 0 NOT NULL,
    attempt       integer DEFAULT 1 NOT NULL,
    started_at    timestamptz,
    completed_at  timestamptz,
    error_message text,
    created_at    timestamptz DEFAULT now() NOT NULL,
    updated_at    timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_job_steps_job_id ON public.job_steps USING btree (job_id);

CREATE TABLE IF NOT EXISTS public.knowledge_versions (
    id           uuid PRIMARY KEY,
    book_id      uuid NOT NULL REFERENCES public.books (id) ON DELETE CASCADE,
    version      integer NOT NULL,
    status       public.knowledge_status DEFAULT 'building' NOT NULL,
    activated_at timestamptz,
    created_at   timestamptz DEFAULT now() NOT NULL,
    updated_at   timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT uq_knowledge_book_version UNIQUE (book_id, version)
);
CREATE INDEX IF NOT EXISTS ix_knowledge_versions_book_id ON public.knowledge_versions USING btree (book_id);

CREATE TABLE IF NOT EXISTS public.audio_assets (
    id          uuid PRIMARY KEY,
    book_id     uuid NOT NULL REFERENCES public.books (id) ON DELETE CASCADE,
    chapter_id  uuid REFERENCES public.book_chapters (id) ON DELETE SET NULL,
    section_id  uuid REFERENCES public.book_sections (id) ON DELETE SET NULL,
    storage_key character varying(512) NOT NULL,
    format      character varying(20) DEFAULT 'mp3' NOT NULL,
    duration    double precision,
    status      character varying(50) DEFAULT 'pending' NOT NULL,
    created_at  timestamptz DEFAULT now() NOT NULL,
    updated_at  timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_audio_assets_book_id ON public.audio_assets USING btree (book_id);

CREATE TABLE IF NOT EXISTS public.document_artifacts (
    id            uuid PRIMARY KEY,
    book_id       uuid NOT NULL REFERENCES public.books (id) ON DELETE CASCADE,
    document_id   uuid NOT NULL REFERENCES public.book_documents (id) ON DELETE CASCADE,
    artifact_type public.artifact_type NOT NULL,
    source        public.artifact_source NOT NULL,
    storage_key   character varying(512) NOT NULL,
    version       integer DEFAULT 1 NOT NULL,
    content_hash  character varying(64),
    metadata      jsonb,
    created_at    timestamptz DEFAULT now() NOT NULL,
    updated_at    timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT uq_artifact_document_type_version UNIQUE (document_id, artifact_type, version)
);
CREATE INDEX IF NOT EXISTS ix_document_artifacts_book_id     ON public.document_artifacts USING btree (book_id);
CREATE INDEX IF NOT EXISTS ix_document_artifacts_document_id ON public.document_artifacts USING btree (document_id);

INSERT INTO public.alembic_version (version_num) VALUES ('c0936393668e')
ON CONFLICT DO NOTHING;

-- +goose Down
DROP TABLE IF EXISTS public.document_artifacts;
DROP TABLE IF EXISTS public.audio_assets;
DROP TABLE IF EXISTS public.knowledge_versions;
DROP TABLE IF EXISTS public.job_steps;
DROP TABLE IF EXISTS public.jobs;
DROP TABLE IF EXISTS public.book_chunks;
DROP TABLE IF EXISTS public.book_sections;
DROP TABLE IF EXISTS public.book_chapters;
DROP TABLE IF EXISTS public.book_documents;
DROP TABLE IF EXISTS public.books;
DROP TABLE IF EXISTS public.alembic_version;
DROP TYPE IF EXISTS public.knowledge_status;
DROP TYPE IF EXISTS public.job_step_status;
DROP TYPE IF EXISTS public.job_status;
DROP TYPE IF EXISTS public.document_type;
DROP TYPE IF EXISTS public.document_status;
DROP TYPE IF EXISTS public.book_status;
DROP TYPE IF EXISTS public.artifact_type;
DROP TYPE IF EXISTS public.artifact_source;
