-- +goose Up
CREATE SCHEMA IF NOT EXISTS home;

-- KPIهای Trust Strip. اعداد بازاریابی‌اند نه شمارش زنده کاتالوگ، پس جدول
-- پیکربندی جدا دارند نه کوئری COUNT روی catalog.
CREATE TABLE home.stats (
    key            text PRIMARY KEY,
    label          text NOT NULL,
    value          bigint NOT NULL,
    display_value  text NOT NULL,
    sort_order     int NOT NULL DEFAULT 0
);

-- انتخاب دموی صفحه Home. ارجاع به catalog.books فقط با foreign key؛
-- ماژول home هرگز مستقیم به جدول دیگری غیر از خودش نمی‌نویسد/نمی‌خواند
-- جز از طریق join روی همین کلید.
CREATE TABLE home.demo_sample (
    id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    book_id  uuid NOT NULL UNIQUE REFERENCES catalog.books (id) ON DELETE CASCADE,
    ai_tag   text NOT NULL DEFAULT 'پیشنهاد هوشمند'
);

CREATE TABLE home.demo_continue_listening (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    book_id           uuid NOT NULL UNIQUE REFERENCES catalog.books (id) ON DELETE CASCADE,
    progress_percent  int NOT NULL DEFAULT 0
);

CREATE TABLE home.demo_recommendations (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    book_id     uuid NOT NULL REFERENCES catalog.books (id) ON DELETE CASCADE,
    tag         text NOT NULL,
    type        text NOT NULL CHECK (type IN ('ai', 'kids', 'local')),
    sort_order  int NOT NULL DEFAULT 0
);

CREATE TABLE home.localization_content (
    id        boolean PRIMARY KEY DEFAULT true CHECK (id),
    title     text NOT NULL,
    subtitle  text NOT NULL
);

CREATE TABLE home.localization_languages (
    code        text PRIMARY KEY,
    label       text NOT NULL,
    sort_order  int NOT NULL DEFAULT 0
);

CREATE TABLE home.localization_topics (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    topic       text NOT NULL,
    sort_order  int NOT NULL DEFAULT 0
);

CREATE TABLE home.localization_samples (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title          text NOT NULL,
    cover_url      text,
    language_code  text NOT NULL REFERENCES home.localization_languages (code),
    sort_order     int NOT NULL DEFAULT 0
);

CREATE TABLE home.social_proof_stats (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    label       text NOT NULL,
    value       text NOT NULL,
    sort_order  int NOT NULL DEFAULT 0
);

CREATE TABLE home.social_proof_testimonials (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL,
    role        text NOT NULL,
    message     text NOT NULL,
    avatar_url  text,
    sort_order  int NOT NULL DEFAULT 0
);

CREATE TABLE home.social_proof_partners (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL,
    logo_url    text,
    sort_order  int NOT NULL DEFAULT 0
);

-- لید بازدیدکننده. فرم واقعی در web/components/LeadForm.tsx فقط
-- fullName + phoneNumber + userType + interestTags + consent می‌فرستد؛
-- email و ageRange در 08-decisions.md به‌صراحت از فرم حذف شده‌اند، پس
-- تشخیص تکراری روی phone_number است نه email.
CREATE TABLE home.leads (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name      text NOT NULL,
    phone_number   text,
    email          text,
    user_type      text NOT NULL,
    interest_tags  text[] NOT NULL DEFAULT '{}',
    consent        boolean NOT NULL,
    source         text,
    landing_path   text,
    referrer       text,
    utm_source     text,
    utm_medium     text,
    utm_campaign   text,
    created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_leads_phone_number ON home.leads (phone_number) WHERE phone_number IS NOT NULL;
CREATE UNIQUE INDEX idx_leads_email ON home.leads (email) WHERE email IS NOT NULL;

-- +goose Down
DROP TABLE IF EXISTS home.leads;
DROP TABLE IF EXISTS home.social_proof_partners;
DROP TABLE IF EXISTS home.social_proof_testimonials;
DROP TABLE IF EXISTS home.social_proof_stats;
DROP TABLE IF EXISTS home.localization_samples;
DROP TABLE IF EXISTS home.localization_topics;
DROP TABLE IF EXISTS home.localization_languages;
DROP TABLE IF EXISTS home.localization_content;
DROP TABLE IF EXISTS home.demo_recommendations;
DROP TABLE IF EXISTS home.demo_continue_listening;
DROP TABLE IF EXISTS home.demo_sample;
DROP TABLE IF EXISTS home.stats;
DROP SCHEMA IF EXISTS home;
