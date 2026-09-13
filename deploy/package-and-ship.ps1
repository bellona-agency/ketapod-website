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
    [switch]$IncludeNode,
    [switch]$PackageOnly,
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$repo    = Split-Path -Parent $PSScriptRoot
$web     = Join-Path $repo 'web'
$staging = Join-Path $env:TEMP 'ketapod-pkg'
$tarball = Join-Path $env:TEMP 'ketapod-site.tar.gz'
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
Say "اتصال به ${User}@${ServerHost}:${SshPort}"
& ssh -p $SshPort -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new "${User}@${ServerHost}" 'echo ok' | Out-Null
if ($LASTEXITCODE -ne 0) {
    Fail @"
اتصال SSH برقرار نشد.

اگر رمز root دارید ولی کلید ندارید، اول کلید بسازید و بفرستید:
    ssh-keygen -t ed25519 -C ketapod -f `$env:USERPROFILE\.ssh\id_ed25519
    type `$env:USERPROFILE\.ssh\id_ed25519.pub | ssh -p $SshPort $User@$ServerHost "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"

اگر سرور فقط publickey قبول می‌کند (که این یکی می‌کند) و کلیدی ندارید،
از پنل هاست کلید عمومی را اضافه کنید یا از کنسول وب پنل استفاده کنید.
"@
}
Ok 'اتصال برقرار است'

Say 'آپلود'
& scp -P $SshPort -o StrictHostKeyChecking=accept-new $tarball "${User}@${ServerHost}:/tmp/ketapod-site.tar.gz"
if ($LASTEXITCODE -ne 0) { Fail 'آپلود شکست خورد.' }
Ok 'آپلود شد'

Say 'نصب روی سرور'
$envs = "PORT=$Port SITE_USER='$SiteUser'"
if ($Password) { $envs = "$envs SITE_PASSWORD='$Password'" }
$remote = "set -e; rm -rf /tmp/ketapod-pkg; mkdir -p /tmp/ketapod-pkg; tar -xzf /tmp/ketapod-site.tar.gz -C /tmp/ketapod-pkg; cd /tmp/ketapod-pkg; $envs bash install.sh"

& ssh -p $SshPort -o StrictHostKeyChecking=accept-new "${User}@${ServerHost}" $remote
if ($LASTEXITCODE -ne 0) { Fail 'نصب شکست خورد. خروجی بالا را ببینید.' }

Write-Host "`n  http://${ServerHost}:${Port}`n" -ForegroundColor Green
