# دیپلوی سایت روی ۸۷.۲۴۸.۱۵۳.۲۰۸

سایت روی پورت **۸۰۸۰** بالا می‌آید. Gitea روی **۳۰۰۰** دست نمی‌خورد.

## چرا ۸۰۸۰ و نه ۳۰۰۰

پورت ۳۰۰۰ روی این سرور Gitea است — همان جایی که مخزن `Admin/ketapod-website`
و `Admin/ketapod-ai` روی آن نشسته‌اند. `docker-compose.yml` ریشه اگر بدون
`WEB_PORT` اجرا شود، `${WEB_PORT:-3000}:3000` را bind می‌کند و دقیقاً روی
Gitea می‌نشیند. به همین دلیل این پوشه compose جداگانه دارد و در آن هیچ
سرویسی پورت ۳۰۰۰ میزبان را نمی‌گیرد؛ `deploy.sh` هم قبل و بعد از دیپلوی
سلامت Gitea را چک می‌کند و اگر compose بخواهد ۳۰۰۰ را بگیرد اصلاً شروع
نمی‌کند.

## پیش‌نیاز: دسترسی SSH

الان کلید پذیرفته نمی‌شود:

```
$ ssh -p 2222 root@87.248.153.208
root@87.248.153.208: Permission denied (publickey).
```

پورت ۲۲۲۲ یک OpenSSH واقعی است (`remote software version OpenSSH_10.3`)،
نه SSH داخلی Gitea — پس افزودن کلید به `authorized_keys` کار می‌کند. فقط
`publickey` مجاز است؛ رمز قبول نمی‌شود.

**روی سرور یک بار اجرا شود:**

```bash
mkdir -p /root/.ssh && chmod 700 /root/.ssh
cat >> /root/.ssh/authorized_keys <<'EOF'
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAII6HuU6bCdKTj8p+TNZ5lX9CsApYmVkbqLYB8I7kcnUE claude-code@ketapod-web
EOF
chmod 600 /root/.ssh/authorized_keys
```

پورت ۸۰۸۰ هم باید باز شود. الان از بیرون بسته است — همه‌ی پورت‌ها جز ۳۰۰۰
و ۲۲۲۲ بسته‌اند، که یعنی فایروال دارید:

```bash
ufw allow 8080/tcp     # یا: firewall-cmd --add-port=8080/tcp --permanent && firewall-cmd --reload
```

## دیپلوی

```bash
# ۱. کد
git clone http://87.248.153.208:3000/Admin/ketapod-website.git /opt/ketapod-website
cd /opt/ketapod-website/deploy

# ۲. رمز صفحه (پایین توضیح داده شده که چرا لازم است)
docker run --rm caddy caddy hash-password --plaintext 'یک-رمز-قوی-اینجا'
# خروجی با $2a$ شروع می‌شود. در .env بگذاریدش:
cat > .env <<'EOF'
SITE_PORT=8080
SITE_USER=ketapod
SITE_PASSWORD_HASH=$2a$14$...هش-بالا...
EOF

# ۳. اجرا
chmod +x deploy.sh && ./deploy.sh
```

بعدش: `http://87.248.153.208:8080`

برای دیپلوی مجدد فقط `./deploy.sh` — کد را خودش می‌کشد.

## چرا basic auth اجباری است

این بیلد کد OTP را در پاسخ API برمی‌گرداند:

```ts
// web/src/app/api/v1/auth/otp/request/route.ts
return Response.json({
  phone: normalised,
  delivery: "mock",
  code,          // ← اینجا
});
```

عمدی بود — درگاه پیامک وصل نیست و بدون این، دموی قابل ورودی وجود ندارد.
ولی روی یک IP عمومی یعنی **هر کسی با هر شماره‌ای وارد هر حسابی می‌شود**،
از جمله حساب‌های seed که کیف پول و خرید دارند. تا وقتی کاوه‌نگار وصل نشده،
لایه‌ی basic auth تنها چیزی است که جلوی این را می‌گیرد.

`deploy.sh` اگر سایت بدون احراز هویت جواب بدهد عمداً fail می‌کند.

## آنچه این استک ندارد

- **بک‌اند Go.** سایت فعلاً روی هندلرهای mock داخل Next.js می‌چرخد. وقتی
  API آماده شد از compose ریشه بالا می‌آید و بلوک `handle /api/*` در
  `Caddyfile` باز می‌شود — چون هم‌مبدأ می‌شود، نه CORS لازم است نه rebuild.
- **TLS.** پورت ۴۴۳ بسته است و دامنه‌ای به این IP اشاره نمی‌کند. یعنی رمز
  basic auth و کوکی نشست روی HTTP رمزنگاری‌نشده رد و بدل می‌شوند. برای
  دموی داخلی قابل قبول است؛ قبل از اینکه چیزی واقعی روی این آدرس برود
  نیست. با یک دامنه، Caddy خودش گواهی Let's Encrypt می‌گیرد.
