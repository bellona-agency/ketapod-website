-- +goose Up
CREATE SCHEMA IF NOT EXISTS library;

-- ListeningPosition به ازای کاربر × AudioEdition است، نه به ازای کتاب
-- (04-architecture.md). با تعویض صدا موقعیت گم نمی‌شود.
--
-- profile_id ستون nullable است و به kids.child_profiles اشاره می‌کند:
-- کودک روی حساب والد گوش می‌دهد، پس موقعیتش نباید با موقعیت والد قاطی
-- شود. NULL یعنی خود کاربر بزرگسال.
CREATE TABLE library.listening_positions (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES identity.users (id) ON DELETE CASCADE,
    profile_id        uuid,
    audio_edition_id  uuid NOT NULL REFERENCES catalog.audio_editions (id) ON DELETE CASCADE,
    book_id           uuid NOT NULL REFERENCES catalog.books (id) ON DELETE CASCADE,
    position_seconds  numeric NOT NULL DEFAULT 0 CHECK (position_seconds >= 0),
    duration_seconds  numeric NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
    is_finished       boolean NOT NULL DEFAULT false,
    -- last-write-wins بر پایه زمان دستگاه (03-product-surfaces.md). زمان
    -- سرور برای این کار کافی نیست چون دستگاه آفلاین ممکن است ساعت‌ها
    -- بعد سینک کند و نوشته قدیمی‌اش نباید نوشته جدیدتر را پاک کند.
    device_updated_at timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_positions_user_profile_edition
    ON library.listening_positions (user_id, coalesce(profile_id, '00000000-0000-0000-0000-000000000000'::uuid), audio_edition_id);
CREATE INDEX idx_positions_user_recent
    ON library.listening_positions (user_id, updated_at DESC);

-- کلید یکتای Bookmark: کاربر × نسخه صوتی × زمان (03-product-surfaces.md).
-- summary توسط worker در پس‌زمینه پر می‌شود، نه هم‌زمان با کلیک — پس
-- nullable است و ستون summary_status چرخه‌اش را نگه می‌دارد.
CREATE TABLE library.bookmarks (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES identity.users (id) ON DELETE CASCADE,
    audio_edition_id  uuid NOT NULL REFERENCES catalog.audio_editions (id) ON DELETE CASCADE,
    book_id           uuid NOT NULL REFERENCES catalog.books (id) ON DELETE CASCADE,
    position_seconds  numeric NOT NULL CHECK (position_seconds >= 0),
    label             text,
    summary           text,
    summary_status    text NOT NULL DEFAULT 'none'
        CHECK (summary_status IN ('none', 'pending', 'ready', 'failed')),
    created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_bookmarks_unique
    ON library.bookmarks (user_id, audio_edition_id, position_seconds);
CREATE INDEX idx_bookmarks_user ON library.bookmarks (user_id, created_at DESC);

CREATE TABLE library.notes (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES identity.users (id) ON DELETE CASCADE,
    audio_edition_id  uuid NOT NULL REFERENCES catalog.audio_editions (id) ON DELETE CASCADE,
    book_id           uuid NOT NULL REFERENCES catalog.books (id) ON DELETE CASCADE,
    position_seconds  numeric NOT NULL DEFAULT 0 CHECK (position_seconds >= 0),
    body              text NOT NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_notes_user ON library.notes (user_id, created_at DESC);

-- هایلایت روی بازه‌ای از ترنسکریپت. شمارش هایلایت ورودی «جملات پرنشان»
-- برای طرح گرافیکی است (03-product-surfaces.md بخش ۶).
CREATE TABLE library.highlights (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES identity.users (id) ON DELETE CASCADE,
    audio_edition_id  uuid NOT NULL REFERENCES catalog.audio_editions (id) ON DELETE CASCADE,
    book_id           uuid NOT NULL REFERENCES catalog.books (id) ON DELETE CASCADE,
    start_seconds     numeric NOT NULL CHECK (start_seconds >= 0),
    end_seconds       numeric NOT NULL CHECK (end_seconds >= 0),
    quote             text NOT NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    CHECK (end_seconds >= start_seconds)
);

CREATE INDEX idx_highlights_edition ON library.highlights (audio_edition_id);
CREATE INDEX idx_highlights_user ON library.highlights (user_id, created_at DESC);

-- قفسه شخصی. «کتابخانه من» فقط عناوین خریداری‌شده نیست: علاقه‌مندی و
-- «بعداً گوش می‌دهم» هم همین‌جاست، جدا از Entitlement.
CREATE TABLE library.shelf_items (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES identity.users (id) ON DELETE CASCADE,
    book_id     uuid NOT NULL REFERENCES catalog.books (id) ON DELETE CASCADE,
    shelf       text NOT NULL DEFAULT 'favorites'
        CHECK (shelf IN ('favorites', 'later', 'archived')),
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_shelf_items_unique ON library.shelf_items (user_id, book_id, shelf);

-- کلیپ صوتی: برش سمت سرور، نه روی دستگاه (03-product-surfaces.md). این
-- جدول سفارش برش را نگه می‌دارد؛ worker ffmpeg آن را پردازش می‌کند.
CREATE TABLE library.clips (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES identity.users (id) ON DELETE CASCADE,
    audio_edition_id  uuid NOT NULL REFERENCES catalog.audio_editions (id) ON DELETE CASCADE,
    start_seconds     numeric NOT NULL CHECK (start_seconds >= 0),
    end_seconds       numeric NOT NULL CHECK (end_seconds > 0),
    status            text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'ready', 'failed')),
    storage_key       text,
    created_at        timestamptz NOT NULL DEFAULT now(),
    CHECK (end_seconds > start_seconds)
);

CREATE INDEX idx_clips_user ON library.clips (user_id, created_at DESC);

-- رویداد شنیدن: ماده خام آمار مطالعه، streak، سقف ساعتی اشتراک و
-- گزارش هفتگی والد. ریز نگه داشته می‌شود چون هر پنج مصرف‌کننده
-- بالادست به بازه‌های واقعی نیاز دارند نه یک شمارنده.
CREATE TABLE library.listening_events (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES identity.users (id) ON DELETE CASCADE,
    profile_id        uuid,
    audio_edition_id  uuid NOT NULL REFERENCES catalog.audio_editions (id) ON DELETE CASCADE,
    book_id           uuid NOT NULL REFERENCES catalog.books (id) ON DELETE CASCADE,
    seconds_listened  int NOT NULL CHECK (seconds_listened > 0),
    occurred_at       timestamptz NOT NULL DEFAULT now(),
    created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_listening_events_user_time
    ON library.listening_events (user_id, occurred_at DESC);
CREATE INDEX idx_listening_events_profile_time
    ON library.listening_events (profile_id, occurred_at DESC) WHERE profile_id IS NOT NULL;

-- +goose Down
DROP TABLE IF EXISTS library.listening_events;
DROP TABLE IF EXISTS library.clips;
DROP TABLE IF EXISTS library.shelf_items;
DROP TABLE IF EXISTS library.highlights;
DROP TABLE IF EXISTS library.notes;
DROP TABLE IF EXISTS library.bookmarks;
DROP TABLE IF EXISTS library.listening_positions;
DROP SCHEMA IF EXISTS library;
