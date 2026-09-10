-- +goose Up
CREATE SCHEMA IF NOT EXISTS pm;

-- ابزار مدیریت پروژه داخلی تیم. کل دامنه‌اش در اسکیمای pm است و هیچ
-- جدولی بیرون از این اسکیما را نمی‌خواند: کاربر این ابزار «عضو تیم» است،
-- نه «کاربر کتاپاد»، و همان قاعده مرزبندی ماژول‌ها در 04-architecture.md
-- اینجا هم برقرار است. سرویسش باینری جداست (cmd/pmapi) تا افتادن ابزار
-- داخلی هیچ ربطی به API مشتری‌ها نداشته باشد و برعکس.

-- +goose StatementBegin
-- کپی عمدی از catalog.normalize_fa.
--
-- تابع اصلی در اسکیمای catalog است و همان‌جا هم باید بماند. اگر ستون
-- تولیدشده pm.issues.search_document به آن ارجاع بدهد، این ماژول به
-- ماژول دیگری وابسته می‌شود — و بدتر: `goose down` روی مهاجرت ۰۰۰۱۲
-- دیگر اجرا نمی‌شود چون یک ستون STORED به تابعش چسبیده. pm باید بتواند
-- روزی به دیتابیس خودش کوچ کند بدون اینکه چیزی از catalog با خود ببرد،
-- پس پانزده خط تکرار در برابر یک وابستگی سخت، معامله ارزانی است.
CREATE OR REPLACE FUNCTION pm.normalize_fa(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
AS $$
    SELECT regexp_replace(
        translate(
            input,
            'يىكﮎﮏﮐﮑ' || '٠١٢٣٤٥٦٧٨٩' || '۰۱۲۳۴۵۶۷۸۹' || E'‌‎‏',
            'یییککک'   || '0123456789'  || '0123456789'  || '   '
        ),
        '[ً-ْ]', '', 'g'
    );
$$;
-- +goose StatementEnd


-- ── هویت تیمی ──────────────────────────────────────────────────────────
--
-- عمداً از identity.users جداست. عضو تیم لازم نیست کاربر اپ کتاپاد باشد،
-- و ورود با پیامک OTP برای ابزاری که هر روز صبح باز می‌شود هم هزینه دارد
-- هم آزاردهنده است. اینجا ایمیل و رمز است، دعوت‌محور: هیچ‌کس خودش ثبت‌نام
-- نمی‌کند.
CREATE TABLE pm.members (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email         text NOT NULL,
    full_name     text NOT NULL DEFAULT '',

    -- تا وقتی دعوت پذیرفته نشده NULL است. یعنی «حساب هست، رمز ندارد» یک
    -- وضعیت معتبر است و نه داده ناقص.
    password_hash text,

    -- رنگ آواتار از روی ایمیل ساخته می‌شود ولی ذخیره می‌شود تا اگر کسی
    -- ایمیلش عوض شد، آواتارش در بردی که تیم به آن عادت کرده نپرد.
    avatar_color  text NOT NULL DEFAULT '#2FB8AE',

    -- نقش سراسری. نقش داخل پروژه جدا و در pm.project_members است.
    role          text NOT NULL DEFAULT 'member'
        CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
    status        text NOT NULL DEFAULT 'invited'
        CHECK (status IN ('invited', 'active', 'disabled')),

    timezone      text NOT NULL DEFAULT 'Asia/Tehran',
    last_seen_at  timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ایمیل بدون حساسیت به حروف بزرگ و کوچک یکتاست. citext نصب نمی‌کنیم چون
-- یک ایندکس تابعی همان کار را بدون افزونه اضافه انجام می‌دهد.
CREATE UNIQUE INDEX idx_pm_members_email ON pm.members (lower(email));
CREATE INDEX idx_pm_members_active ON pm.members (full_name) WHERE status = 'active';


CREATE TABLE pm.invites (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email       text NOT NULL,
    role        text NOT NULL DEFAULT 'member'
        CHECK (role IN ('owner', 'admin', 'member', 'viewer')),

    -- فقط هش. توکن خام یک بار در لینک دعوت بیرون می‌رود و دیگر هیچ‌جا
    -- نیست؛ نشت دیتابیس نباید به معنی نشت لینک‌های دعوت باز باشد.
    token_hash  text NOT NULL UNIQUE,

    member_id   uuid NOT NULL REFERENCES pm.members (id) ON DELETE CASCADE,
    invited_by  uuid REFERENCES pm.members (id) ON DELETE SET NULL,

    expires_at  timestamptz NOT NULL,
    accepted_at timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pm_invites_member ON pm.invites (member_id, created_at DESC);


-- نشست‌ها. access token کوتاه‌عمر JWT است و در دیتابیس نیست؛ اینجا فقط
-- refresh token مبهم نگه داشته می‌شود تا «خروج از همه دستگاه‌ها» و ابطال
-- دستی یک نشست ممکن باشد — همان الگوی identity، با جدول خودش.
CREATE TABLE pm.sessions (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id    uuid NOT NULL REFERENCES pm.members (id) ON DELETE CASCADE,
    token_hash   text NOT NULL UNIQUE,
    user_agent   text NOT NULL DEFAULT '',
    ip           text NOT NULL DEFAULT '',
    expires_at   timestamptz NOT NULL,
    revoked_at   timestamptz,
    last_used_at timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pm_sessions_member ON pm.sessions (member_id) WHERE revoked_at IS NULL;


-- ── پروژه ──────────────────────────────────────────────────────────────
CREATE TABLE pm.projects (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- کلید کوتاه پروژه: KET، AI، WEB. کلید ایشیو از این و شماره ساخته
    -- می‌شود (KET-142) و همان چیزی است که آدم‌ها در گفتگو می‌گویند.
    key            text NOT NULL,
    name           text NOT NULL,
    description    text NOT NULL DEFAULT '',
    color          text NOT NULL DEFAULT '#2FB8AE',
    lead_member_id uuid REFERENCES pm.members (id) ON DELETE SET NULL,

    -- آخرین شماره مصرف‌شده. زیر قفل ردیف در همان تراکنش ساخت ایشیو
    -- افزایش پیدا می‌کند، نه با sequence: هر پروژه شماره‌گذاری مستقل و
    -- بدون حفره می‌خواهد، و sequence در rollback حفره می‌سازد.
    issue_counter  bigint NOT NULL DEFAULT 0,

    archived_at    timestamptz,
    created_by     uuid REFERENCES pm.members (id) ON DELETE SET NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_pm_projects_key ON pm.projects (upper(key));


CREATE TABLE pm.project_members (
    project_id uuid NOT NULL REFERENCES pm.projects (id) ON DELETE CASCADE,
    member_id  uuid NOT NULL REFERENCES pm.members (id) ON DELETE CASCADE,
    role       text NOT NULL DEFAULT 'member'
        CHECK (role IN ('lead', 'member', 'viewer')),
    added_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, member_id)
);

CREATE INDEX idx_pm_project_members_member ON pm.project_members (member_id);


-- وضعیت‌ها ستون‌های برد هم هستند. یک جدول، نه دو تا: هر بار که این دو
-- جدا نگه داشته شوند، یک وضعیت پیدا می‌شود که هیچ ستونی ندارد و
-- ایشیوهایش از برد غیب می‌شوند.
CREATE TABLE pm.statuses (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES pm.projects (id) ON DELETE CASCADE,
    name       text NOT NULL,

    -- دسته همان چیزی است که گزارش‌ها به آن نیاز دارند. «انجام‌شده» یک
    -- نام نیست، یک معناست: برن‌داون و ولاسیتی از category می‌خوانند تا
    -- تیمی که ستونش را «تحویل شد» صدا می‌زند گزارش خالی نگیرد.
    category   text NOT NULL CHECK (category IN ('todo', 'in_progress', 'done')),
    position   int  NOT NULL,
    color      text NOT NULL DEFAULT '#6B8285',

    -- سقف WIP کانبان. NULL یعنی بی‌سقف.
    wip_limit  int CHECK (wip_limit IS NULL OR wip_limit > 0),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_pm_statuses_name ON pm.statuses (project_id, lower(name));
CREATE INDEX idx_pm_statuses_order ON pm.statuses (project_id, position);


CREATE TABLE pm.labels (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES pm.projects (id) ON DELETE CASCADE,
    name       text NOT NULL,
    color      text NOT NULL DEFAULT '#2FB8AE',
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_pm_labels_name ON pm.labels (project_id, lower(name));


CREATE TABLE pm.sprints (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id   uuid NOT NULL REFERENCES pm.projects (id) ON DELETE CASCADE,
    name         text NOT NULL,
    goal         text NOT NULL DEFAULT '',
    state        text NOT NULL DEFAULT 'future'
        CHECK (state IN ('future', 'active', 'completed')),

    starts_at    timestamptz,
    ends_at      timestamptz,
    started_at   timestamptz,
    completed_at timestamptz,

    position     int NOT NULL DEFAULT 0,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

-- یک اسپرینت فعال به‌ازای هر پروژه. این قاعده در دیتابیس است نه در سرویس،
-- چون دو درخواست هم‌زمان «شروع اسپرینت» در لایه Go هر دو چک را رد می‌کنند.
CREATE UNIQUE INDEX idx_pm_sprints_one_active
    ON pm.sprints (project_id) WHERE state = 'active';
CREATE INDEX idx_pm_sprints_project ON pm.sprints (project_id, position, created_at);


CREATE TABLE pm.issues (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  uuid NOT NULL REFERENCES pm.projects (id) ON DELETE CASCADE,
    number      bigint NOT NULL,

    type        text NOT NULL DEFAULT 'task'
        CHECK (type IN ('epic', 'story', 'task', 'bug', 'subtask')),
    title       text NOT NULL,
    description text NOT NULL DEFAULT '',

    -- بدون ON DELETE: حذف وضعیتی که ایشیو دارد باید شکست بخورد. سرویس
    -- اول ایشیوها را جابه‌جا می‌کند و بعد وضعیت را حذف؛ اگر یادش برود،
    -- دیتابیس جلویش را می‌گیرد به‌جای اینکه ایشیوها بی‌ستون شوند.
    status_id   uuid NOT NULL REFERENCES pm.statuses (id),

    priority    text NOT NULL DEFAULT 'medium'
        CHECK (priority IN ('lowest', 'low', 'medium', 'high', 'highest')),

    reporter_id uuid REFERENCES pm.members (id) ON DELETE SET NULL,
    assignee_id uuid REFERENCES pm.members (id) ON DELETE SET NULL,

    -- parent برای زیرتسک، epic برای گروه‌بندی سطح بالا. دو ستون جدا چون
    -- یک زیرتسکِ یک استوریِ داخل یک اپیک هر دو را هم‌زمان دارد.
    parent_id   uuid REFERENCES pm.issues (id) ON DELETE SET NULL,
    epic_id     uuid REFERENCES pm.issues (id) ON DELETE SET NULL,
    sprint_id   uuid REFERENCES pm.sprints (id) ON DELETE SET NULL,

    story_points              numeric(5,1) CHECK (story_points IS NULL OR story_points >= 0),
    original_estimate_seconds int CHECK (original_estimate_seconds IS NULL OR original_estimate_seconds >= 0),

    due_at      timestamptz,

    -- ترتیب دستی در برد و بک‌لاگ. رشته است نه عدد: جابه‌جا کردن یک کارت
    -- باید یک UPDATE روی یک ردیف باشد، نه شماره‌گذاری دوباره کل ستون.
    rank        text NOT NULL,

    resolved_at timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),

    search_document tsvector
        GENERATED ALWAYS AS (
            setweight(to_tsvector('simple', pm.normalize_fa(coalesce(title, ''))), 'A') ||
            setweight(to_tsvector('simple', pm.normalize_fa(coalesce(description, ''))), 'B')
        ) STORED,

    -- یک ایشیو نمی‌تواند والد خودش باشد. ارزان‌ترین جای گرفتن این خطا
    -- همین‌جاست؛ حلقه‌های بلندتر را سرویس می‌گیرد.
    CONSTRAINT pm_issues_no_self_parent CHECK (parent_id IS NULL OR parent_id <> id),
    CONSTRAINT pm_issues_no_self_epic   CHECK (epic_id   IS NULL OR epic_id   <> id)
);

CREATE UNIQUE INDEX idx_pm_issues_number ON pm.issues (project_id, number);
CREATE INDEX idx_pm_issues_board   ON pm.issues (project_id, status_id, rank);
CREATE INDEX idx_pm_issues_sprint  ON pm.issues (sprint_id, rank) WHERE sprint_id IS NOT NULL;
CREATE INDEX idx_pm_issues_backlog ON pm.issues (project_id, rank) WHERE sprint_id IS NULL;
CREATE INDEX idx_pm_issues_assignee ON pm.issues (assignee_id, updated_at DESC) WHERE assignee_id IS NOT NULL;
CREATE INDEX idx_pm_issues_parent  ON pm.issues (parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX idx_pm_issues_epic    ON pm.issues (epic_id) WHERE epic_id IS NOT NULL;
CREATE INDEX idx_pm_issues_search  ON pm.issues USING gin (search_document);
CREATE INDEX idx_pm_issues_title_trgm
    ON pm.issues USING gin (pm.normalize_fa(title) gin_trgm_ops);


CREATE TABLE pm.issue_labels (
    issue_id uuid NOT NULL REFERENCES pm.issues (id) ON DELETE CASCADE,
    label_id uuid NOT NULL REFERENCES pm.labels (id) ON DELETE CASCADE,
    PRIMARY KEY (issue_id, label_id)
);

CREATE INDEX idx_pm_issue_labels_label ON pm.issue_labels (label_id);


-- پیوند بین ایشیوها. یک ردیف به‌ازای هر جهت ذخیره نمی‌شود: ردیف
-- (blocks, A, B) خودش یعنی B توسط A بلاک شده، و کوئری هر دو سمت را
-- می‌خواند. دو ردیف یعنی دو حقیقت که می‌توانند از هم جدا بیفتند.
CREATE TABLE pm.issue_links (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kind       text NOT NULL CHECK (kind IN ('blocks', 'relates', 'duplicates', 'causes')),
    source_id  uuid NOT NULL REFERENCES pm.issues (id) ON DELETE CASCADE,
    target_id  uuid NOT NULL REFERENCES pm.issues (id) ON DELETE CASCADE,
    created_by uuid REFERENCES pm.members (id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pm_issue_links_distinct CHECK (source_id <> target_id)
);

CREATE UNIQUE INDEX idx_pm_issue_links_unique ON pm.issue_links (kind, source_id, target_id);
CREATE INDEX idx_pm_issue_links_target ON pm.issue_links (target_id);


CREATE TABLE pm.watchers (
    issue_id   uuid NOT NULL REFERENCES pm.issues (id) ON DELETE CASCADE,
    member_id  uuid NOT NULL REFERENCES pm.members (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (issue_id, member_id)
);

CREATE INDEX idx_pm_watchers_member ON pm.watchers (member_id);


CREATE TABLE pm.comments (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    issue_id   uuid NOT NULL REFERENCES pm.issues (id) ON DELETE CASCADE,
    author_id  uuid REFERENCES pm.members (id) ON DELETE SET NULL,
    body       text NOT NULL,
    edited_at  timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pm_comments_issue ON pm.comments (issue_id, created_at);


-- پیوست روی همان MinIO که بقیه پروژه استفاده می‌کند، با پیشوند کلید
-- جدا. comment_id اختیاری است: پیوست یا به خود ایشیو است یا به یک کامنت.
CREATE TABLE pm.attachments (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    issue_id     uuid NOT NULL REFERENCES pm.issues (id) ON DELETE CASCADE,
    comment_id   uuid REFERENCES pm.comments (id) ON DELETE CASCADE,
    file_name    text NOT NULL,
    storage_key  text NOT NULL,
    mime_type    text NOT NULL DEFAULT 'application/octet-stream',
    size_bytes   bigint NOT NULL,
    uploaded_by  uuid REFERENCES pm.members (id) ON DELETE SET NULL,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pm_attachments_issue ON pm.attachments (issue_id, created_at);


-- تاریخچه تغییرات. این جدول فقط «کی چه کرد» نیست: منبع محاسبه برن‌داون
-- هم هست. برای هر روز اسپرینت، مانده از روی همین ردیف‌ها بازسازی می‌شود
-- به‌جای اینکه یک snapshot شبانه بنویسیم — snapshot اگر یک شب اجرا نشود
-- نمودار برای همیشه سوراخ می‌ماند، ولی تاریخچه همیشه هست.
CREATE TABLE pm.activity (
    id         bigserial PRIMARY KEY,
    issue_id   uuid NOT NULL REFERENCES pm.issues (id) ON DELETE CASCADE,
    actor_id   uuid REFERENCES pm.members (id) ON DELETE SET NULL,
    field      text NOT NULL,
    old_value  text,
    new_value  text,

    -- برای فیلدهایی که مقدارشان شناسه است (وضعیت، اسپرینت، اساین)، متن
    -- خوانا هم ذخیره می‌شود تا تاریخچه بعد از حذف آن رکورد هم معنا داشته
    -- باشد. «وضعیت از ... به ...» نباید بعد از تغییر نام ستون گنگ شود.
    old_label  text,
    new_label  text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pm_activity_issue ON pm.activity (issue_id, created_at DESC);
CREATE INDEX idx_pm_activity_status_time
    ON pm.activity (created_at) WHERE field = 'status';
CREATE INDEX idx_pm_activity_actor ON pm.activity (actor_id, created_at DESC);


CREATE TABLE pm.worklogs (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    issue_id     uuid NOT NULL REFERENCES pm.issues (id) ON DELETE CASCADE,
    member_id    uuid NOT NULL REFERENCES pm.members (id) ON DELETE CASCADE,
    seconds      int  NOT NULL CHECK (seconds > 0),
    note         text NOT NULL DEFAULT '',

    -- زمانی که کار انجام شده، نه زمانی که ثبت شده. کسی که جمعه کارش را
    -- شنبه ثبت می‌کند نباید گزارش هفته را جابه‌جا کند.
    started_at   timestamptz NOT NULL DEFAULT now(),
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pm_worklogs_issue ON pm.worklogs (issue_id, started_at DESC);
CREATE INDEX idx_pm_worklogs_member ON pm.worklogs (member_id, started_at DESC);


CREATE TABLE pm.notifications (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id  uuid NOT NULL REFERENCES pm.members (id) ON DELETE CASCADE,
    kind       text NOT NULL
        CHECK (kind IN ('assigned', 'mentioned', 'commented', 'status_changed', 'sprint_started', 'due_soon')),
    issue_id   uuid REFERENCES pm.issues (id) ON DELETE CASCADE,
    actor_id   uuid REFERENCES pm.members (id) ON DELETE SET NULL,
    title      text NOT NULL,
    body       text NOT NULL DEFAULT '',
    read_at    timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pm_notifications_unread
    ON pm.notifications (member_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX idx_pm_notifications_member
    ON pm.notifications (member_id, created_at DESC);

-- +goose Down
DROP TABLE IF EXISTS pm.notifications;
DROP TABLE IF EXISTS pm.worklogs;
DROP TABLE IF EXISTS pm.activity;
DROP TABLE IF EXISTS pm.attachments;
DROP TABLE IF EXISTS pm.comments;
DROP TABLE IF EXISTS pm.watchers;
DROP TABLE IF EXISTS pm.issue_links;
DROP TABLE IF EXISTS pm.issue_labels;
DROP TABLE IF EXISTS pm.issues;
DROP TABLE IF EXISTS pm.sprints;
DROP TABLE IF EXISTS pm.labels;
DROP TABLE IF EXISTS pm.statuses;
DROP TABLE IF EXISTS pm.project_members;
DROP TABLE IF EXISTS pm.projects;
DROP TABLE IF EXISTS pm.sessions;
DROP TABLE IF EXISTS pm.invites;
DROP TABLE IF EXISTS pm.members;
DROP FUNCTION IF EXISTS pm.normalize_fa(text);
DROP SCHEMA IF EXISTS pm;
