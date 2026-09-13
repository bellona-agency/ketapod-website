<#
.SYNOPSIS
    سایت را روی ویندوز بیلد می‌کند، بسته‌بندی می‌کند، به سرور می‌فرستد و نصب می‌کند.

.DESCRIPTION
    بیلد اینجا انجام می‌شود نه روی سرور. دلیلش این است که بیلد به npm نیاز
    دارد و سرور ممکن است به registry.npmjs.org نرسد؛ آنچه به سرور می‌رود
    خروجی standalone نکست است که node_modules لازمش را با خودش دارد. سرور
    فقط به Node نیاز دارد و به هیچ چیز دیگر.

    پورت ۳۰۰۰ روی سرور Gitea است و هیچ‌جای این مسیر به آن دست نمی‌زند —
    نه اینجا، نه install.sh که اگر PORT برابر ۳۰۰۰ باشد اجرا نمی‌شود.

.EXAMPLE
    .\deploy\package-and-ship.ps1
    .\deploy\package-and-ship.ps1 -Password 'یک-رمز-دلخواه'
    .\deploy\package-and-ship.ps1 -IncludeNode      # اگر سرور اینترنت ندارد
    .\deploy\package-and-ship.ps1 -PackageOnly      # فقط فایل بساز، نفرست
#>
[CmdletBinding()]
param(
    [string]$ServerHost = '87.248.153.208',
    [int]$SshPort  = 2222,
    [string]$User  = 'root',
    [int]$Port     = 8080,
    [string]$SiteUser = 'ketapod',
    [string]$Password,
    # این ماشین `id_ed25519` ندارد و `~/.ssh/config` هم ندارد، پس `ssh`
    # خالی هیچ‌وقت کلید ketapod_gitea را پیشنهاد نمی‌دهد و با
    # «Permission denied (publickey)» رد می‌شود حتی اگر کلید روی سرور
    # باشد. صریح پاسش می‌دهیم.
    [string]$KeyFile = "$env:USERPROFILE\.ssh\ketapod_gitea",
    [switch]$IncludeNode,
    [switch]$PackageOnly,
    [switch]$SkipBuild
)

# عمداً 'Continue' و نه 'Stop'.
#
# در PowerShell 5.1 هر خطی که یک exe بومی روی stderr بنویسد به ErrorRecord
# تبدیل می‌شود، و با EAP=Stop همان‌جا کل اسکریپت را می‌کشد — قبل از اینکه
# `if ($LASTEXITCODE -ne 0)` بعدی اجرا شود. نتیجه‌اش این بود که ssh با
# «Permission denied» می‌مرد و پیام راهنمای این اسکریپت هیچ‌وقت چاپ نمی‌شد؛
# کاربر یک stack trace می‌دید به‌جای اینکه بفهمد باید کلید را نصب کند.
#
# پس خطاها را خودمان با $LASTEXITCODE می‌گیریم — که در تمام مسیر انجام شده.
$ErrorActionPreference = 'Continue'
$repo    = Split-Path -Parent $PSScriptRoot
$web     = Join-Path $repo 'web'
$staging = Join-Path $env:TEMP 'ketapod-pkg'
# داخل مخزن و نه در TEMP: پکیج چیزی است که ممکن است لازم شود دستی
# جابه‌جا شود، به همکار داده شود، یا هفته بعد دوباره پیدا شود — و
# %TEMP% هم جای پیدا کردنش نیست هم ویندوز هر وقت خواست پاکش می‌کند.
# dist/ در .gitignore است.
$distDir = Join-Path $repo 'dist'
$tarball = Join-Path $distDir 'ketapod-site.tar.gz'
$NODE_VER = 'v22.11.0'

function Say  ($m) { Write-Host "`n> $m" -ForegroundColor Cyan }
function Ok   ($m) { Write-Host "  [ok] $m" -ForegroundColor Green }
function Fail ($m) { Write-Host "`n[x] $m" -ForegroundColor Red; exit 1 }

if ($Port -eq 3000) { Fail 'پورت ۳۰۰۰ مال Gitea است. یکی دیگر انتخاب کنید.' }

# ── پیش‌نیازها ────────────────────────────────────────────────────────────
Say 'بررسی ابزارها'
foreach ($t in @('node','npm','tar')) {
    if (-not (Get-Command $t -ErrorAction SilentlyContinue)) { Fail "$t پیدا نشد." }
}
if (-not $PackageOnly) {
    foreach ($t in @('ssh','scp')) {
        if (-not (Get-Command $t -ErrorAction SilentlyContinue)) {
            Fail "$t پیدا نشد. در ویندوز ۱۰ به بعد: Settings > Apps > Optional features > OpenSSH Client"
        }
    }
}
Ok ('node ' + (& node -v))

# ── بیلد ──────────────────────────────────────────────────────────────────
if (-not $SkipBuild) {
    Say 'بیلد سایت (چند دقیقه)'
    Push-Location $web
    try {
        & npm run build
        if ($LASTEXITCODE -ne 0) { Fail 'بیلد شکست خورد. خطاها بالا هستند.' }
    } finally { Pop-Location }
    Ok 'بیلد تمام شد'
}

$standalone = Join-Path $web '.next\standalone'
if (-not (Test-Path (Join-Path $standalone 'server.js'))) {
    Fail "خروجی standalone نیست. آیا next.config روی output:'standalone' است؟"
}

# ── بسته‌بندی ─────────────────────────────────────────────────────────────
# .next/static و public جزو ردیابی standalone نیستند و باید دستی کپی شوند.
# جاافتادنشان همان باگ کلاسیکی است که سایت بالا می‌آید ولی هر CSS ای ۴۰۴
# می‌دهد — تست شده و همین‌طور بود.
Say 'ساخت پکیج'
if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
$bundle = Join-Path $staging 'bundle'
New-Item -ItemType Directory -Path $bundle -Force | Out-Null

Copy-Item (Join-Path $standalone '*') $bundle -Recurse -Force
New-Item -ItemType Directory -Path (Join-Path $bundle '.next\static') -Force | Out-Null
Copy-Item (Join-Path $web '.next\static\*') (Join-Path $bundle '.next\static') -Recurse -Force
if (Test-Path (Join-Path $web 'public')) {
    Copy-Item (Join-Path $web 'public') (Join-Path $bundle 'public') -Recurse -Force
}
foreach ($p in @('server.js', '.next\static')) {
    if (-not (Test-Path (Join-Path $bundle $p))) { Fail "پکیج ناقص: $p نیست." }
}
Ok ('bundle: ' + [math]::Round((Get-ChildItem $bundle -Recurse -File | Measure-Object Length -Sum).Sum / 1MB, 1) + ' MB')

# اسکریپت‌ها باید LF باشند. یک install.sh با CRLF روی لینوکس با
# "bad interpreter: /usr/bin/env bash^M" می‌میرد و پیغامش هیچ سرنخی نمی‌دهد.
foreach ($f in @('install.sh','ketapod-site.service')) {
    $src = Join-Path $PSScriptRoot "server\$f"
    $txt = [IO.File]::ReadAllText($src) -replace "`r`n", "`n"
    [IO.File]::WriteAllText((Join-Path $staging $f), $txt, (New-Object Text.UTF8Encoding $false))
}
Ok 'اسکریپت‌ها با LF نوشته شدند'

if ($IncludeNode) {
    $nodeTar = Join-Path $staging 'node-linux-x64.tar.xz'
    Say "دانلود Node $NODE_VER برای لینوکس (~۲۵ مگابایت)"
    $url = "https://nodejs.org/dist/$NODE_VER/node-$NODE_VER-linux-x64.tar.xz"
    try {
        Invoke-WebRequest -Uri $url -OutFile $nodeTar -UseBasicParsing
        Ok 'Node همراه پکیج شد — سرور به اینترنت نیاز نخواهد داشت'
    } catch {
        Fail "دانلود Node نشد: $($_.Exception.Message)`nبدون -IncludeNode اجرا کنید تا سرور خودش نصب کند."
    }
}

Say 'فشرده‌سازی'
New-Item -ItemType Directory -Path $distDir -Force | Out-Null
if (Test-Path $tarball) { Remove-Item $tarball -Force }
Push-Location $staging
try {
    & tar -czf $tarball .
    if ($LASTEXITCODE -ne 0) { Fail 'tar شکست خورد.' }
} finally { Pop-Location }
Ok ('' + [math]::Round((Get-Item $tarball).Length / 1MB, 1) + ' MB → ' + $tarball)

if ($PackageOnly) {
    Write-Host "`nپکیج آماده است: $tarball" -ForegroundColor Green
    Write-Host "دستی بفرستید:`n  scp -P $SshPort `"$tarball`" ${User}@${ServerHost}:/tmp/`n  ssh -p $SshPort ${User}@${ServerHost}`n  mkdir -p /tmp/ketapod && tar -xzf /tmp/ketapod-site.tar.gz -C /tmp/ketapod && cd /tmp/ketapod && PORT=$Port bash install.sh"
    exit 0
}

# ── ارسال ─────────────────────────────────────────────────────────────────
# اگر کلید هست صریح بدهش؛ اگر نیست بگذار ssh خودش هرچه دارد پیشنهاد کند
# (ممکن است agent یا کلید پیش‌فرض داشته باشد).
$sshOpts = @('-o','StrictHostKeyChecking=accept-new')
if (Test-Path $KeyFile) {
    $sshOpts += @('-i', $KeyFile, '-o', 'IdentitiesOnly=yes')
    Ok "کلید: $KeyFile"
} else {
    Write-Host "  [!] $KeyFile نیست — از کلیدهای پیش‌فرض ssh استفاده می‌شود" -ForegroundColor Yellow
}

Say "اتصال به ${User}@${ServerHost}:${SshPort}"
# stderr به null: این فقط یک آزمایش است و شکستش را خودمان با پیام مفصل
# پایین گزارش می‌کنیم. بدون این، «Permission denied» خام ssh هم چاپ
# می‌شود و پیام راهنما را زیر نویز دفن می‌کند.
& ssh -p $SshPort @sshOpts -o ConnectTimeout=15 "${User}@${ServerHost}" 'echo ok' 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    $pub = "$KeyFile.pub"
    $pubTxt = if (Test-Path $pub) { (Get-Content $pub -Raw).Trim() } else { '(کلید عمومی پیدا نشد)' }
    Fail @"
اتصال SSH برقرار نشد — سرور کلید را نمی‌شناسد.

این سرور فقط publickey قبول می‌کند؛ رمز root کار نمی‌کند. پس کلید زیر
باید یک بار روی سرور نصب شود:

$pubTxt

راه‌ها، به ترتیب احتمال:

۱) کنسول وب پنل هاست (هدآوب). وارد کنسول شوید و این را بزنید:

     mkdir -p /root/.ssh && chmod 700 /root/.ssh
     echo '$pubTxt' >> /root/.ssh/authorized_keys
     chmod 600 /root/.ssh/authorized_keys

۲) اگر پنل بخش «SSH Keys» دارد، همان متن بالا را آنجا اضافه کنید.

۳) اگر از جای دیگری به سرور دسترسی دارید، همان دستور بند ۱.

بعدش دوباره همین اسکریپت را اجرا کنید.
"@
}
Ok 'اتصال برقرار است'

Say 'آپلود'
& scp -P $SshPort @sshOpts $tarball "${User}@${ServerHost}:/tmp/ketapod-site.tar.gz"
if ($LASTEXITCODE -ne 0) { Fail 'آپلود شکست خورد.' }
Ok 'آپلود شد'

Say 'نصب روی سرور'
$envs = "PORT=$Port SITE_USER='$SiteUser'"
if ($Password) { $envs = "$envs SITE_PASSWORD='$Password'" }
$remote = "set -e; rm -rf /tmp/ketapod-pkg; mkdir -p /tmp/ketapod-pkg; tar -xzf /tmp/ketapod-site.tar.gz -C /tmp/ketapod-pkg; cd /tmp/ketapod-pkg; $envs bash install.sh"

& ssh -p $SshPort @sshOpts "${User}@${ServerHost}" $remote
if ($LASTEXITCODE -ne 0) { Fail 'نصب شکست خورد. خروجی بالا را ببینید.' }

Write-Host "`n  http://${ServerHost}:${Port}`n" -ForegroundColor Green
