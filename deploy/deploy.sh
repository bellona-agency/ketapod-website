#!/usr/bin/env bash
#
# دیپلوی سایت روی سرور، کنار Gitea.
#
# روی خود سرور اجرا می‌شود:
#     cd /opt/ketapod-website/deploy && ./deploy.sh
#
# قابل تکرار است: هر بار که اجرا شود آخرین کد را می‌گیرد، بیلد می‌کند و
# کانتینر را عوض می‌کند. اجرای دوباره‌اش بی‌ضرر است.

set -euo pipefail
cd "$(dirname "$0")"

COMPOSE="docker compose -f docker-compose.site.yml"
SITE_PORT="${SITE_PORT:-8080}"
GITEA_PORT=3000

say() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
die() { printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# ── نگهبان‌ها ─────────────────────────────────────────────────────────────
# اینها قبل از هر تغییری اجرا می‌شوند. کل نکته‌ی این اسکریپت این است که
# نتواند به Gitea آسیب بزند، و ارزان‌ترین راهش این است که اگر چیزی مشکوک
# بود اصلاً شروع نکند.

[ "$SITE_PORT" = "$GITEA_PORT" ] && die "SITE_PORT روی $GITEA_PORT است — همان پورت Gitea. یکی دیگر انتخاب کنید."

command -v docker >/dev/null || die "docker نصب نیست."
docker compose version >/dev/null 2>&1 || die "افزونه‌ی docker compose نیست (نسخه v2 لازم است)."

[ -n "${SITE_PASSWORD_HASH:-}" ] || die "SITE_PASSWORD_HASH ست نشده. راهنما در README.md همین پوشه."

# Gitea باید همین الان بالا باشد. اگر نیست، یا اسکریپت قبلاً چیزی را خراب
# کرده یا سرور وضعیت غیرمنتظره‌ای دارد — در هر دو حالت جای ادامه‌دادن نیست.
if ! curl -fsS -o /dev/null --max-time 10 "http://localhost:$GITEA_PORT/"; then
	die "Gitea روی پورت $GITEA_PORT جواب نمی‌دهد. قبل از دیپلوی این را بررسی کنید."
fi
say "Gitea روی $GITEA_PORT سالم است."

# مطمئن شو هیچ سرویسی در این استک پورت ۳۰۰۰ را نمی‌گیرد. compose ریشه
# می‌گیرد؛ این فایل نباید بگیرد. اگر روزی کسی `ports` را به سرویس web
# اضافه کند، اینجا لو می‌رود.
if $COMPOSE config | grep -qE "^\s*-\s*\"?(0\.0\.0\.0:)?$GITEA_PORT:"; then
	die "این compose می‌خواهد پورت $GITEA_PORT را bind کند. متوقف شد."
fi

# ── کد ────────────────────────────────────────────────────────────────────
say "گرفتن آخرین کد"
git -C .. fetch --prune origin
git -C .. reset --hard origin/main
git -C .. log -1 --format='  %h  %s  (%cr)'

# ── بیلد و اجرا ───────────────────────────────────────────────────────────
# بیلد جدا از up تا اگر بیلد شکست، کانتینرِ در حال کارِ فعلی سر جایش بماند.
# `up --build` این خاصیت را ندارد.
say "بیلد ایمیج (چند دقیقه طول می‌کشد)"
$COMPOSE build

say "بالا آوردن"
$COMPOSE up -d --remove-orphans

# ── تأیید ─────────────────────────────────────────────────────────────────
say "بررسی سلامت"
for i in $(seq 1 30); do
	# 401 یعنی Caddy بالاست و basic auth کار می‌کند — همان چیزی که
	# می‌خواهیم. 200 یعنی auth دور خورده و آن مشکل است.
	code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://localhost:$SITE_PORT/" || true)
	case "$code" in
		401) say "سایت بالاست و پشت basic auth است."; break ;;
		200) die "سایت بدون احراز هویت جواب می‌دهد. Caddyfile را بررسی کنید — کد OTP در این بیلد عمومی است." ;;
	esac
	[ "$i" = 30 ] && { $COMPOSE logs --tail 40; die "سایت بعد از ۳۰ تلاش بالا نیامد."; }
	sleep 2
done

# و دوباره Gitea — این کل دلیل وجود اسکریپت است.
curl -fsS -o /dev/null --max-time 10 "http://localhost:$GITEA_PORT/" \
	|| die "Gitea بعد از دیپلوی جواب نمی‌دهد. فوراً بررسی کنید."
say "Gitea هنوز سالم است."

printf '\n\033[32m✓ سایت: http://87.248.153.208:%s\033[0m\n' "$SITE_PORT"
printf '\033[32m✓ Gitea: http://87.248.153.208:%s (دست‌نخورده)\033[0m\n\n' "$GITEA_PORT"
