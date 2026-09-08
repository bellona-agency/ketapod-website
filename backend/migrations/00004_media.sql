-- +goose Up
CREATE SCHEMA IF NOT EXISTS media;

-- یک asset اصلی قابل استریم به ازای هر AudioEdition برای این سشن. بسته‌بندی
-- دوگانه HLS/m4a و خط لوله ترنسکد در دامنه این سشن نیست؛ ستون format همین
-- الان اجازه می‌دهد بعداً چند asset به ازای هر edition اضافه شود.
CREATE TABLE media.audio_assets (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    audio_edition_id  uuid NOT NULL REFERENCES catalog.audio_editions (id) ON DELETE CASCADE,
    storage_key       text NOT NULL,
    format            text NOT NULL DEFAULT 'm4a',
    bitrate_kbps      int NOT NULL DEFAULT 48,
    duration_seconds  int NOT NULL,
    checksum          text,
    created_at        timestamptz NOT NULL DEFAULT now(),
    UNIQUE (audio_edition_id, format)
);

CREATE INDEX idx_audio_assets_audio_edition_id ON media.audio_assets (audio_edition_id);

-- اسکلت خط لوله پردازش. این سشن هیچ worker ای این جدول را پردازش نمی‌کند؛
-- صرفاً جای‌گیری ساختار برای وقتی که خط لوله TTS و ترنسکد ساخته شود.
CREATE TABLE media.transcode_jobs (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    audio_edition_id  uuid NOT NULL REFERENCES catalog.audio_editions (id) ON DELETE CASCADE,
    status            text NOT NULL DEFAULT 'pending',
    input_key         text,
    output_format     text,
    error             text,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE IF EXISTS media.transcode_jobs;
DROP TABLE IF EXISTS media.audio_assets;
DROP SCHEMA IF EXISTS media;
