# کتاپاد

پلتفرم کتاب صوتی هوشمند فارسی — بک‌اند Go، وب Next.js، و سرویس هوش مصنوعی
همکار که روی **همان دیتابیس** کار می‌کند.

```
backend/   هسته Go — API، worker، scheduler، مهاجرت‌ها، و pmapi
web/       وب عمومی Next.js + پنل تولید محتوا
pm-web/    تخته کارها — ابزار داخلی مدیریت پروژه تیم
design/    بوم طراحی
```

> `docs/` در این مخزن نیست. مخزن عمومی است و آن پوشه اقتصاد واحد، تحلیل رقبا
> و دفتر ریسک را دارد، پس بیرون نگه داشته شده. ارجاع‌های `docs/…` در همین
> فایل و در READMEهای `backend/` و `web/` برای کسی است که چک‌اوت کامل دارد.

## بالا آوردن کل پروژه

```bash
cp .env.example .env
docker compose --profile app up -d --build
```

| سرویس | آدرس |
|---|---|
| وب | http://localhost:3000 |
| پنل تولید محتوا | http://localhost:3000/admin/books |
| API | http://localhost:8080/api/v1 |
| کنسول MinIO | http://localhost:9001 |

ابزار داخلی مدیریت پروژه پروفایل خودش را دارد، چون محصول نیست و افتادنش
هیچ ربطی به API مشتری‌ها ندارد:

```bash
docker compose --profile pm up -d --build
```

| سرویس | آدرس |
|---|---|
| تخته کارها | http://localhost:3001 |
| API تخته کارها | http://localhost:8090/api/v1 |

اولین بار که بازش می‌کنی، فرم ورود به‌جای رمز، ساختن حساب مالک را
می‌پرسد؛ بعد از آن ورود فقط با دعوت است. هویتش مستقل از حساب کاربری سایت
است (schema جدای `pm`، JWT با کلید جدا).

داده نمونه (کتاب‌ها، گوینده‌ها، کلیپ‌های صوتی):

```bash
docker compose --profile seed up seed
```

مهاجرت‌ها خودشان قبل از بالا آمدن API اجرا می‌شوند؛ `api` و `worker` منتظر
تمام‌شدن موفق `migrate` می‌مانند.

## توسعه محلی بدون داکر

`docker compose up -d` بدون profile فقط زیرساخت (Postgres، Redis، MinIO) را
بالا می‌آورد و Go و Next را روی ماشین خودت اجرا می‌کنی:

```bash
cd backend && cp .env.example .env && make migrate-up && make seed
make run-api      # :8080
make run-worker   # در ترمینال جدا
make run-scheduler
```

```bash
cd web && cp .env.example .env.local && npm install && npm run dev   # :3000
```

تخته کارها:

```bash
cd backend && go run ./cmd/pmapi                                     # :8090
cd pm-web && npm install && npm run dev                              # :3001
```

## دیتابیس مشترک با سرویس AI

از مهاجرت `00014` جدول‌های سرویس AI در schema `public` همین دیتابیس‌اند؛ آن
سرویس فقط `DATABASE_URL` را به `ketapod` می‌دهد. قاعده مالکیت: goose مالک
schemaهای ما (از جمله `pm`)، alembic مالک `public`.

مسیر کامل یک کتاب: آپلود در پنل → ذخیره در دیتابیس و object storage → تحویل به
سرویس AI → OCR و پردازش متن و خلاصه → TTS → ساخت خودکار AudioEdition در
کاتالوگ → قابل پخش در سایت.

## تست

```bash
cd backend && make test-unit && make test-contract
```

```bash
cd web && npx tsc --noEmit && npx eslint . && npm run build
cd pm-web && npx tsc --noEmit && npx eslint . && npm run build
```
