<#
.SYNOPSIS
    تخته کارها (pmapi + pm-web) را روی ویندوز می‌سازد، بسته‌بندی می‌کند،
    به همان سرور سایت می‌فرستد و کنار Gitea و سایت نصب می‌کند.

.DESCRIPTION
    مثل package-and-ship.ps1: بیلد اینجا انجام می‌شود، نه روی سرور.
    pmapi و ابزار مهاجرت گوی هستند و برای لینوکس کراس‌کامپایل می‌شوند —
    به توولچین لینوکس روی سرور نیازی نیست. pm-web هم مثل web/ خروجی
    standalone نکست است.

    pmapi برخلاف سایت به یک آبجکت‌استور S3-سازگار نیاز دارد (پیوست‌ها) —
    محلی جایگزین ندارد. MinIO دیگر باینری آماده منتشر نمی‌کند، پس با
    همان Go که برای pmapi لازم است از سورس ساخته و همراه پکیج می‌رود؛
    سرور برای هیچ‌کدام از این سه به اینترنت نیاز ندارد.

    Postgres و Redis تنها چیزهایی‌اند که ممکن است install-pm.sh از مخزن
    سیستم بخواهد — چیزهایی که سایت لازم نداشت.

.EXAMPLE
    .\deploy\package-and-ship-pm.ps1
    .\deploy\package-and-ship-pm.ps1 -IncludeNode      # اگر سرور اینترنت ندارد
    .\deploy\package-and-ship-pm.ps1 -PackageOnly      # فقط فایل بساز، نفرست
#>
[CmdletBinding()]
param(
    [string]$ServerHost = '87.248.153.208',
    [int]$SshPort    = 2222,
    [string]$User    = 'root',
    [int]$PmApiPort  = 8090,
    [int]$PmWebPort  = 3001,
    [string[]]$KeyFile = @(),
    [switch]$IncludeNode,
    [switch]$PackageOnly,
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Continue'
$repo    = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $repo 'backend'
$pmweb   = Join-Path $repo 'pm-web'
$staging = Join-Path $env:TEMP 'ketapod-pm-pkg'
$distDir = Join-Path $repo 'dist'
$tarball = Join-Path $distDir 'ketapod-pm.tar.gz'
$NODE_VER  = 'v22.11.0'
# MinIO دیگر باینری آماده منتشر نمی‌کند (dl.min.io روی نسخه‌های اخیر ۴۱۰
# می‌دهد) — از سورس با توولچین Go همینی که برای pmapi لازم است می‌سازیمش.
# RELEASE.* تگ سمور استاندارد نیست، پس pseudo-version ماژول را پین می‌کنیم.
$MINIO_MODULE_VERSION = 'v0.0.0-20260212201848-7aac2a2c5b7c'

function Say  ($m) { Write-Host "`n> $m" -ForegroundColor Cyan }
function Ok   ($m) { Write-Host "  [ok] $m" -ForegroundColor Green }
function Fail ($m) { Write-Host "`n[x] $m" -ForegroundColor Red; exit 1 }

foreach ($p in @($PmApiPort, $PmWebPort)) {
    if ($p -eq 3000) { Fail 'پورت ۳۰۰۰ مال Gitea است.' }
    if ($p -eq 8080) { Fail 'پورت ۸۰۸۰ مال سایت است.' }
}
if ($PmApiPort -eq $PmWebPort) { Fail 'PmApiPort و PmWebPort یکی هستند.' }

# ── پیش‌نیازها ────────────────────────────────────────────────────────────
Say 'بررسی ابزارها'
foreach ($t in @('go','node','npm','tar')) {
    if (-not (Get-Command $t -ErrorAction SilentlyContinue)) { Fail "$t پیدا نشد." }
}
if (-not $PackageOnly) {
    foreach ($t in @('ssh','scp')) {
        if (-not (Get-Command $t -ErrorAction SilentlyContinue)) {
            Fail "$t پیدا نشد. در ویندوز ۱۰ به بعد: Settings > Apps > Optional features > OpenSSH Client"
        }
    }
}
Ok ('go ' + ((& go version) -replace 'go version ',''))
Ok ('node ' + (& node -v))

if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
New-Item -ItemType Directory -Path (Join-Path $staging 'bin') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $staging 'migrations') -Force | Out-Null

# ── pmapi + migrate (کراس‌کامپایل لینوکس) ───────────────────────────────────
Say 'بیلد pmapi برای لینوکس'
Push-Location $backend
try {
    $env:GOOS = 'linux'; $env:GOARCH = 'amd64'; $env:CGO_ENABLED = '0'
    & go build -o (Join-Path $staging 'bin\pmapi') ./cmd/pmapi
    if ($LASTEXITCODE -ne 0) { Fail 'بیلد pmapi شکست خورد.' }
    & go build -o (Join-Path $staging 'bin\ketapod-migrate') ./cmd/migrate
    if ($LASTEXITCODE -ne 0) { Fail 'بیلد ketapod-migrate شکست خورد.' }
} finally {
    Remove-Item Env:\GOOS, Env:\GOARCH, Env:\CGO_ENABLED -ErrorAction SilentlyContinue
    Pop-Location
}
Copy-Item (Join-Path $backend 'migrations\00017_pm.sql') (Join-Path $staging 'migrations\00017_pm.sql')
Ok 'pmapi، ketapod-migrate و مهاجرت آماده شدند'

# ── MinIO (از سورس، همیشه همراه پکیج) ───────────────────────────────────────
# محلی جایگزین برای S3 در کد نیست (EnsureBucket موقع بالا آمدن اجباری
# است). MinIO دیگر باینری آماده منتشر نمی‌کند، پس با همان Go که برای
# pmapi لازم است از سورس می‌سازیمش — به dl.min.io هیچ وابستگی‌ای نیست.
Say 'ساخت MinIO از سورس برای لینوکس (چند دقیقه، اولین بار — ماژول‌ها کش می‌شوند)'
$goPath = (& go env GOPATH).Trim()
$env:GOOS = 'linux'; $env:GOARCH = 'amd64'; $env:CGO_ENABLED = '0'
try {
    & go install "github.com/minio/minio@$MINIO_MODULE_VERSION"
    if ($LASTEXITCODE -ne 0) { Fail 'ساخت MinIO شکست خورد.' }
} finally {
    Remove-Item Env:\GOOS, Env:\GOARCH, Env:\CGO_ENABLED -ErrorAction SilentlyContinue
}
$builtMinio = Join-Path $goPath 'bin\linux_amd64\minio'
if (-not (Test-Path $builtMinio)) { Fail "minio ساخته نشد — انتظار داشتم اینجا باشد: $builtMinio" }
Copy-Item $builtMinio (Join-Path $staging 'bin\minio') -Force
Ok 'MinIO از سورس ساخته شد'

if ($IncludeNode) {
    $nodeTar = Join-Path $staging 'node-linux-x64.tar.xz'
    Say "دانلود Node $NODE_VER برای لینوکس (~۲۵ مگابایت)"
    try {
        Invoke-WebRequest -Uri "https://nodejs.org/dist/$NODE_VER/node-$NODE_VER-linux-x64.tar.xz" -OutFile $nodeTar -UseBasicParsing
        Ok 'Node همراه پکیج شد'
    } catch {
        Fail "دانلود Node نشد: $($_.Exception.Message)"
    }
}

# ── pm-web (بیلد استاندالون، مثل web/) ──────────────────────────────────────
Say 'بیلد pm-web (چند دقیقه)'
if (-not $SkipBuild) {
    Push-Location $pmweb
    try {
        if (-not (Test-Path 'node_modules')) {
            & npm install
            if ($LASTEXITCODE -ne 0) { Fail 'npm install شکست خورد.' }
        }
        # NEXT_PUBLIC_* موقع بیلد داخل باندل جاسازی می‌شود — بعداً با
        # تغییر env روی سرور عوض نمی‌شود، باید دوباره بیلد کرد.
        $env:NEXT_PUBLIC_PM_API_BASE_URL = "http://${ServerHost}:${PmApiPort}"
        & npm run build
        if ($LASTEXITCODE -ne 0) { Fail 'بیلد pm-web شکست خورد.' }
    } finally {
        Remove-Item Env:\NEXT_PUBLIC_PM_API_BASE_URL -ErrorAction SilentlyContinue
        Pop-Location
    }
    Ok 'بیلد تمام شد'
}

$standalone = Join-Path $pmweb '.next\standalone\pm-web'
if (-not (Test-Path $standalone)) {
    # standalone خروجی مسیر مونوریپو را هم می‌آورد (pm-web/.next/standalone/pm-web/…)
    # اگر ریشه‌اش فرق داشت، مستقیم زیر standalone را امتحان کن.
    $standalone = Join-Path $pmweb '.next\standalone'
}
if (-not (Test-Path (Join-Path $standalone 'server.js'))) {
    Fail "خروجی standalone نیست یا مسیرش فرق دارد — زیر $pmweb\.next\standalone را دستی چک کنید."
}

$webBundle = Join-Path $staging 'web'
New-Item -ItemType Directory -Path $webBundle -Force | Out-Null
Copy-Item (Join-Path $standalone '*') $webBundle -Recurse -Force
New-Item -ItemType Directory -Path (Join-Path $webBundle '.next\static') -Force | Out-Null
Copy-Item (Join-Path $pmweb '.next\static\*') (Join-Path $webBundle '.next\static') -Recurse -Force
if (Test-Path (Join-Path $pmweb 'public')) {
    Copy-Item (Join-Path $pmweb 'public') (Join-Path $webBundle 'public') -Recurse -Force
}
foreach ($p in @('server.js', '.next\static')) {
    if (-not (Test-Path (Join-Path $webBundle $p))) { Fail "پکیج pm-web ناقص: $p نیست." }
}
Ok ('pm-web bundle: ' + [math]::Round((Get-ChildItem $webBundle -Recurse -File | Measure-Object Length -Sum).Sum / 1MB, 1) + ' MB')

# ── اسکریپت‌ها با LF ─────────────────────────────────────────────────────
foreach ($f in @('install-pm.sh','ketapod-pmapi.service','ketapod-pmweb.service','ketapod-minio.service')) {
    $src = Join-Path $PSScriptRoot "server\$f"
    $txt = [IO.File]::ReadAllText($src) -replace "`r`n", "`n"
    [IO.File]::WriteAllText((Join-Path $staging $f), $txt, (New-Object Text.UTF8Encoding $false))
}
Ok 'اسکریپت‌ها با LF نوشته شدند'

# ── فشرده‌سازی ────────────────────────────────────────────────────────────
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
    Write-Host "دستی بفرستید:`n  scp -P $SshPort `"$tarball`" ${User}@${ServerHost}:/tmp/`n  ssh -p $SshPort ${User}@${ServerHost}`n  mkdir -p /tmp/ketapod-pm-pkg && tar -xzf /tmp/ketapod-pm.tar.gz -C /tmp/ketapod-pm-pkg && cd /tmp/ketapod-pm-pkg && PMAPI_PORT=$PmApiPort PMWEB_PORT=$PmWebPort bash install-pm.sh"
    exit 0
}

# ── ارسال (همان منطق کلید package-and-ship.ps1) ─────────────────────────────
$keys = @()
if ($KeyFile.Count -gt 0) {
    $keys = $KeyFile | Where-Object { Test-Path $_ }
} else {
    $sshDir = Join-Path $env:USERPROFILE '.ssh'
    if (Test-Path $sshDir) {
        $keys = Get-ChildItem $sshDir -File |
            Where-Object { $_.Extension -ne '.pub' -and (Test-Path "$($_.FullName).pub") } |
            ForEach-Object { $_.FullName }
    }
}

$sshOpts = @('-o','StrictHostKeyChecking=accept-new')
if ($keys.Count -gt 0) {
    foreach ($k in $keys) { $sshOpts += @('-i', $k) }
    $sshOpts += @('-o','IdentitiesOnly=yes')
    Ok ("کلیدها: " + (($keys | Split-Path -Leaf) -join ', '))
} else {
    Write-Host "  [!] هیچ کلیدی در ~/.ssh نیست" -ForegroundColor Yellow
}

Say "اتصال به ${User}@${ServerHost}:${SshPort}"
& ssh -p $SshPort @sshOpts -o ConnectTimeout=15 "${User}@${ServerHost}" 'echo ok' 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    Fail "اتصال SSH برقرار نشد. دقیقاً همان مشکلی است که package-and-ship.ps1 توضیح می‌دهد — همان کلید را نصب کنید یا با همان اسکریپت یک‌بار مسیر را باز کنید."
}
Ok 'اتصال برقرار است'

Say 'آپلود'
& scp -P $SshPort @sshOpts $tarball "${User}@${ServerHost}:/tmp/ketapod-pm.tar.gz"
if ($LASTEXITCODE -ne 0) { Fail 'آپلود شکست خورد.' }
Ok 'آپلود شد'

Say 'نصب روی سرور'
$remote = "set -e; rm -rf /tmp/ketapod-pm-pkg; mkdir -p /tmp/ketapod-pm-pkg; tar -xzf /tmp/ketapod-pm.tar.gz -C /tmp/ketapod-pm-pkg; cd /tmp/ketapod-pm-pkg; PMAPI_PORT=$PmApiPort PMWEB_PORT=$PmWebPort bash install-pm.sh"
& ssh -p $SshPort @sshOpts "${User}@${ServerHost}" $remote
if ($LASTEXITCODE -ne 0) { Fail 'نصب شکست خورد. خروجی بالا را ببینید.' }

Write-Host "`n  http://${ServerHost}:${PmWebPort}`n" -ForegroundColor Green
