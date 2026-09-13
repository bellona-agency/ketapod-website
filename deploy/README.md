# دیپلوی سایت

سایت روی پورت **۸۰۸۰** بالا می‌آید. Gitea روی **۳۰۰۰** دست نمی‌خورد.

## یک دستور

روی ویندوز، در ریشه پروژه:

```powershell
.\deploy\package-and-ship.ps1
```

بیلد می‌کند، بسته‌بندی می‌کند، آپلود می‌کند، نصب می‌کند، و در آخر آدرس و
رمز را چاپ می‌کند. برای دیپلوی بعدی هم همین.

گزینه‌ها:

```powershell
.\deploy\package-and-ship.ps1 -Password 'رمز-دلخواه'   # وگرنه خودش می‌سازد
.\deploy\package-and-ship.ps1 -Port 8090               # پورت دیگر
.\deploy\package-and-ship.ps1 -IncludeNode             # اگر سرور اینترنت ندارد
.\deploy\package-and-ship.ps1 -PackageOnly             # فقط فایل بساز، دستی بفرست
.\deploy\package-and-ship.ps1 -SkipBuild               # بیلد قبلی را بفرست
```

## اگر SSH وصل نشد

سرور فقط `publickey` قبول می‌کند — رمز کار نمی‌کند
(`Authentications that can continue: publickey`). اگر کلید ندارید:

```powershell
ssh-keygen -t ed25519 -C ketapod -f $env:USERPROFILE\.ssh\id_ed25519
```

بعد کلید عمومی را روی سرور بگذارید — از کنسول وب پنل هاست، یا اگر جای
دیگری دسترسی دارید:

```powershell
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh -p 2222 root@87.248.153.208 "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
```

## چطور کار می‌کند

بیلد روی ویندوز انجام می‌شود، نه روی سرور. سرور فقط **Node ≥ ۲۰** لازم
دارد — نه npm، نه داکر، نه هیچ رجیستری‌ای. اگر سرور به npmjs یا Docker Hub
نرسد (که روی سرورهای ایران معمول است) این تفاوت بین «کار می‌کند» و
«نیم‌ساعت تایم‌اوت» است. پکیج فشرده حدود **۷ مگابایت** است.

اگر Node روی سرور نبود، `install.sh` از مخزن سیستم نصبش می‌کند؛ و اگر آن
هم نشد، با `-IncludeNode` خود Node هم داخل پکیج می‌رود و سرور به هیچ
اتصال بیرونی نیاز ندارد.

روی سرور یک سرویس systemd به اسم `ketapod-site` ساخته می‌شود که با کاربر
بدون‌دسترسی `ketapod` اجرا می‌شود و با `Restart=always` بالا می‌ماند.

```bash
journalctl -u ketapod-site -f      # لاگ
systemctl restart ketapod-site     # ری‌استارت
systemctl stop ketapod-site        # توقف
cat /etc/ketapod-site.env          # دیدن رمز
```

## محافظت از Gitea

پورت ۳۰۰۰ روی این سرور Gitea است — جایی که `Admin/ketapod-website` و
`Admin/ketapod-ai` روی آن هستند. سه جا جلوی خرابی گرفته شده:

- `package-and-ship.ps1` اگر `-Port 3000` بدهید اجرا نمی‌شود.
- `install.sh` اگر `PORT` برابر ۳۰۰۰ باشد اجرا نمی‌شود.
- `install.sh` قبل **و** بعد از نصب سلامت Gitea را تست می‌کند و اگر بعدش
  جواب ندهد با خطا می‌ایستد.

> **`docker-compose.yml` ریشه را روی سرور اجرا نکنید.** خط
> `${WEB_PORT:-3000}:3000` دارد و بدون تنظیم `WEB_PORT` دقیقاً روی Gitea
> می‌نشیند. آن فایل برای وقتی است که بک‌اند Go هم بیاید.

## رمز روی کل سایت

سایت پشت یک رمز است و این اختیاری نیست. دلیلش یک خط در
`web/src/app/api/v1/auth/otp/request/route.ts` است:

```ts
return Response.json({ phone: normalised, delivery: "mock", code });
//                                                          ^^^^
```

کد OTP در پاسخ API برمی‌گردد، چون درگاه پیامک وصل نیست و بدون آن دموی
قابل ورودی وجود ندارد. ولی روی یک IP عمومی یعنی **هر کسی با هر شماره‌ای
وارد هر حسابی می‌شود** — از جمله حساب‌های نمونه که کیف پول و خرید دارند.

دروازه در `web/src/proxy.ts` است و با `PREVIEW_PASSWORD` فعال می‌شود. اگر
سایت بدون رمز جواب بدهد، `install.sh` عمداً سرویس را خاموش می‌کند و خطا
می‌دهد — چون بالا بودنِ ناامن بدتر از بالا نبودن است.

وقتی کاوه‌نگار وصل شد، `PREVIEW_PASSWORD` را از `/etc/ketapod-site.env`
بردارید و ری‌استارت کنید.

## چه چیزی هنوز نیست

**TLS.** پورت ۴۴۳ بسته است و دامنه‌ای به این IP اشاره نمی‌کند، پس رمز و
کوکی نشست روی HTTP رمزنگاری‌نشده رد و بدل می‌شوند. برای دموی داخلی قابل
قبول است؛ قبل از اینکه چیز واقعی‌ای روی این آدرس برود نه.

**بک‌اند Go.** سایت روی هندلرهای mock داخل Next.js می‌چرخد. وقتی API آماده
شد، `NEXT_PUBLIC_PLATFORM_BASE_URL` را به آن اشاره دهید و دوباره بیلد
کنید — یا هر دو را پشت یک reverse proxy ببرید تا هم‌مبدأ بمانند و CORS
لازم نشود. فایل‌های داکر در همین پوشه برای همان روز هستند.
