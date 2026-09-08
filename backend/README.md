# کتاپاد — بک‌اند

اسکلت هسته بک‌اند Go طبق `../docs/04-architecture.md`. جزئیات معماری، مدل داده و
تصمیم‌ها آنجاست؛ این فایل فقط برای اجرا و توسعه محلی است.

## پیش‌نیاز

- Go 1.23+
- Docker + Docker Compose (یا colima روی مک)
- `sqlc`, `goose`, `oapi-codegen` (فقط برای codegen، نه برای اجرا):

```bash
go install github.com/sqlc-dev/sqlc/cmd/sqlc@latest
go install github.com/pressly/goose/v3/cmd/goose@latest
go install github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@latest
```

## اجرای محلی

```bash
cp .env.example .env
make docker-up        # postgres + redis + minio
make migrate-up
make seed
make run-api           # :8080
make run-worker        # در ترمینال جدا — پردازش OTP
```

سلامت سریع:

```bash
curl http://localhost:8080/api/v1/public/home/stats
```

## پنل تولید محتوا و سرویس AI

از مهاجرت `00014` به بعد، جدول‌های سرویس AI در schema `public` همین دیتابیس
هستند و همکار AI فقط `DATABASE_URL` را به `ketapod` می‌دهد. قاعده مالکیت،
قرارداد تحویل کار و کارهای باقی‌مانده در [`../docs/10-ai-pipeline.md`](../docs/10-ai-pipeline.md).

خلاصه اجرای محلی:

```bash
# در .env
ADMIN_API_KEY=dev-admin-key
AI_SERVICE_BASE_URL=http://localhost:8000   # آدرس سرویس همکار (9000 مال MinIO است)

make run-api      # پنل روی /api/v1/admin/ingestions
make run-worker   # تحویل کار به سرویس AI از روی outbox
```

برای تست بدون سرویس واقعی همکار، یک سرویس قلابی هست که هرچه فرستاده می‌شود را
چاپ می‌کند:

```bash
python3 scripts/fake_ai_service.py            # :8899
# و در .env:  AI_SERVICE_BASE_URL=http://127.0.0.1:8899
```

بدون `AI_SERVICE_BASE_URL` آپلود همچنان کار می‌کند — کتاب در دیتابیس و کاتالوگ
ثبت می‌شود و job با پیام روشن «آدرس سرویس AI ست نشده» متوقف می‌ماند تا با دکمه
«تلاش دوباره» در پنل دوباره فرستاده شود.

## Codegen

قرارداد `api/openapi.yaml` تنها منبع حقیقت است. بعد از هر تغییر در آن یا در
فایل‌های `internal/*/queries/*.sql`:

```bash
make generate   # sqlc generate + oapi-codegen
```

خروجی‌ها commit می‌شوند (رفتار رایج برای sqlc/oapi-codegen در مونولیت‌های
تک‌زبانه) تا `go build` بدون نیاز به نصب ابزارهای codegen کار کند.

## تست

```bash
make test-unit          # بدون Docker — قواعد خالص کسب‌وکار
make test-contract      # بدون Docker — قرارداد v1 در برابر روتر واقعی
make test-integration   # با Postgres و Redis واقعی (testcontainers)
make test               # همه
```

`test-contract` ارزان است و باید روی هر push در CI اجرا شود. روتر واقعی
را با وابستگی‌های nil می‌سازد (متدهای `Routes` فقط ثبت می‌کنند، صدا
نمی‌زنند) و مسیرهای mount شده را با `api/v1/openapi.yaml` مقایسه می‌کند.
مسیری که در Go هست و در قرارداد نیست، مسیری است که هیچ کلاینت تولیدشده‌ای
نمی‌تواند صدایش بزند؛ برعکسش متدی است که ۴۰۴ می‌گیرد. همان بار اول که
اجرا شد یک مورد واقعی پیدا کرد (`PATCH /me`).

`test-unit` هیچ کانتینری لازم ندارد: محاسبه کوپن، موتور سیاست کودک،
streak، کلمپ Range پیش‌نمایش، امضای توکن پخش و نرمال‌سازی فارسی همه
توابع خالص‌اند.

تست‌های یکپارچه همه در `internal/integrationtest` جمع شده‌اند، نه پخش بین
ماژول‌ها. دلیلش عملی است: testcontainers به‌ازای هر **باینری تست** یک
کانتینر بالا می‌آورد، پس تست پخش‌شده بین شش پکیج یعنی شش Postgres. با
یکجا بودن، کل سوئیت روی یک نمونه اجرا می‌شود و در چند ثانیه تمام می‌شود.

این تست‌ها عمداً روی دیتابیس واقعی اجرا می‌شوند. نیمی از چیزی که این
بک‌اند درست انجام می‌دهد معادل درون‌حافظه‌ای ندارد — قفل مشورتی کیف پول،
ایندکس یکتای جزئی، هدف `ON CONFLICT`، ستون تولیدشده جستجو، تطبیق trigram
و upsert مبتنی بر last-write-wins همه رفتار دیتابیس‌اند، و repository
قلابی فقط ثابت می‌کرد که خود قلابی کار می‌کند.

## نکات محیط (اگر روی مک با colima اجرا می‌کنی)

این‌ها هنگام تست واقعی این پروژه پیش آمدند — یک‌بار رفعشان کن، بعد فراموش کن:

- **پلاگین `docker compose` پیدا نمی‌شود.** Homebrew باینری را نصب می‌کند
  اما `docker` مسیرش را نمی‌داند مگر در `~/.docker/config.json`:
  ```json
  { "cliPluginsExtraDirs": ["/opt/homebrew/lib/docker/cli-plugins"] }
  ```
- **testcontainers دُاکر را پیدا نمی‌کند یا reaper شکست می‌خورد.**
  `make test` هر دو متغیر لازم را خودش ست می‌کند. دستی:
  ```bash
  export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock"
  export TESTCONTAINERS_RYUK_DISABLED=true
  ```
  راننده `Virtualization.framework` colima با bind-mount کانتینر Ryuk
  سازگار نیست؛ ناسازگاری شناخته‌شده colima است نه چیزی مختص این پروژه.
- **پورت‌های ۵۴۳۲/۶۳۷۹ از قبل توسط Postgres/Redis نصب‌شده با brew اشغالند.**
  به‌جای متوقف کردن سرویس سیستمی، پورت میزبان را در `.env` عوض کن:
  ```bash
  POSTGRES_PORT=5433
  REDIS_PORT=6380
  DATABASE_URL=postgres://ketapod:ketapod@localhost:5433/ketapod?sslmode=disable
  REDIS_ADDR=localhost:6380
  ```
  اگر این کار را نکنی اتصال محلی **بی‌سروصدا** به سرویس native می‌رود نه
  به کانتینر، و ممکن است هفته‌ها متوجه نشوی.

## ساختار

چیدمان دقیقاً طبق `../docs/04-architecture.md`:

```
cmd/        api . worker . scheduler . migrate . seed
internal/
  platform/ db . redis . storage . sms . aigw . ratelimit . httpkit
            config . telemetry . testkit . outbox . apiversion
  identity/ کاربر، OTP، توکن، دستگاه، نقش، رجیستری سرویس
  catalog/  کتاب، نویسنده، دسته، صدا، AudioEdition، فصل، ترنسکریپت،
            واژه‌نامه تلفظ، RightsGrant، جستجوی فارسی
  media/    تصمیم دسترسی پخش، URL امضاشده، سرو Range، کلمپ پیش‌نمایش
  library/  موقعیت پخش، نشانک، یادداشت، هایلایت، قفسه، کلیپ، آمار و streak
  commerce/ کیف پول (دفتر کل فقط‌افزودنی)، سفارش، کوپن، حق دسترسی،
            اشتراک سقف‌دار، بازگشت وجه، مرز درگاه پرداخت
  kids/     پروفایل کودک، کنترل والدین، موتور سیاست، گزارش هفتگی
  home/     سطح عمومی صفحه Home — آمار، دمو، بومی‌سازی، social proof، لید
  integrationtest/  تست‌های دیتابیس‌دار همه ماژول‌ها
  integrationtest/v1/  تست‌های مخصوص نسخه ۱ — قرارداد در برابر روتر
api/v1/     openapi.yaml — تنها منبع حقیقت نسخه ۱
scripts/    گر‌ساز سند خوانای API
migrations/ goose، هر ماژول یک اسکیمای Postgres جدا
```

هر ماژول فقط از طریق interface صادرشده ماژول دیگر صدا زده می‌شود، هرگز
مستقیم به جدول ماژول دیگر. جایی که دو ماژول یک داده را با دو شکل مختلف
توصیف می‌کنند، آداپتور در `cmd/api/adapters.go` می‌نشیند — تنها جایی که
اجازه دارد هر دو را بشناسد.

گراف وابستگی (در بالای `cmd/api/main.go` هم آمده):

```
catalog   <- media, library, commerce, kids, home
commerce  <- media (حق دسترسی), catalog (نشان مالکیت)
kids      <- media (وتوی پخش), identity (رجیستری سرویس)
library   <- commerce (ساعت اشتراک), catalog (محبوبیت)
```

## دو الگویی که باید بشناسی

### هیچ job ای گم نمی‌شود

کارهای پس‌زمینه **در همان تراکنشی** که داده را می‌نویسند به جدول
`jobs.outbox` می‌روند، نه با یک `Enqueue` بعد از commit. آن الگو
dual-write است: اگر پروسه بین نوشتن و صف‌کردن بمیرد — یا Redis لحظه‌ای
قطع باشد — job برای همیشه گم می‌شود. نشانک تا ابد `pending` می‌ماند و
کاربر کد ورودش را نمی‌گیرد، و هیچ retry ای هم نمی‌آید چون چیزی برای
retry ثبت نشده.

بعدش relay در `cmd/worker` ردیف‌های pending را به asynq می‌دهد. تحویل
**at-least-once** است نه exactly-once، پس **هر handler باید idempotent
باشد**. این معامله عمدی است: job تکراری قابل تحمل است، job گم‌شده نه.

سه لایه دفاعی روی هم:

| لایه | چه چیزی را می‌گیرد |
|---|---|
| outbox | مرگ پروسه یا قطعی Redis بین نوشتن داده و صف‌کردن |
| retry خود asynq | شکست موقت هنگام اجرای job |
| `outbox.AsynqErrorHandler` | jobای که retryهایش تمام شده و archive می‌شود — وگرنه بی‌صدا می‌میرد |

sweepهای زمان‌بند هم **جبران‌کننده**اند نه لحظه‌ای: `ReconcileSubscriptions`
پنجره grace دارد تا اجرای از دست رفته را جبران کند. نسخه قبلی این را
نداشت و اشتراک کاربر بی‌صدا منقضی می‌شد.

### نسخه‌بندی API

پیشوند `/api/v1` هیچ‌جای کد نوشته نمی‌شود؛ همه از
`internal/platform/apiversion` می‌آید. دو جا این URL از پروسه **بیرون**
می‌رود و روز مهاجرت باید جداگانه دیده شود: URL امضاشده پخش (کلاینت
نگهش می‌دارد) و URL بازگشت درگاه (نزد بانک ثبت می‌شود). قواعد کامل در
`../docs/api/v1.md`.

## آنچه ساخته نشده

مرحله‌های ۴ تا ۸ نقشه راه: کتاب‌یار/RAG، گیمیفیکیشن، استودیوی سازنده،
جامعه و نظرات، پورتال ناشر و پنل سازمانی. به‌علاوه خط لوله واقعی TTS و
ترنسکد (جدول `media.transcode_jobs` هنوز اسکلت است) و اتصال درگاه پرداخت
واقعی — `commerce.StubProvider` جای آن را گرفته و `cmd/api` در
`APP_ENV=production` با آن بالا نمی‌آید.
