#!/usr/bin/env bash
#
# نصب سایت روی سرور. با bundle در همین پوشه اجرا می‌شود.
#
# چیزی از اینترنت نمی‌کشد مگر اینکه Node روی سرور نباشد. نه npm، نه داکر،
# نه رجیستری — چون سایت از قبل روی ویندوز بیلد شده و اینجا فقط اجرا
# می‌شود. برای سروری که ممکن است به npmjs یا Docker Hub نرسد، این تفاوت
# بین «کار می‌کند» و «نیم‌ساعت جنگیدن با تایم‌اوت» است.

set -euo pipefail
cd "$(dirname "$0")"

APP_DIR=/opt/ketapod-site
ENV_FILE=/etc/ketapod-site.env
SERVICE=ketapod-site
PORT="${PORT:-8080}"
GITEA_PORT=3000

say()  { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "با root اجرا کنید (یا sudo)."
[ -d bundle ] || die "پوشه bundle نیست. کل پکیج را کپی کرده‌اید؟"
[ "$PORT" = "$GITEA_PORT" ] && die "PORT روی $GITEA_PORT است — پورت Gitea. یکی دیگر بگذارید."

# ── Gitea قبل از هر کاری ──────────────────────────────────────────────────
# اگر همین الان خراب است، نباید تغییری بدهیم و بعد فکر کنیم کار ما بوده.
if curl -fsS -o /dev/null --max-time 10 "http://127.0.0.1:$GITEA_PORT/" 2>/dev/null; then
	ok "Gitea روی $GITEA_PORT سالم است"
	GITEA_WAS_UP=1
else
	printf '  \033[33m!\033[0m Gitea روی %s جواب نداد — شاید پشت آدرس دیگری است. ادامه می‌دهم ولی این اسکریپت هیچ‌وقت آن پورت را نمی‌گیرد.\n' "$GITEA_PORT"
	GITEA_WAS_UP=0
fi

# ── Node ──────────────────────────────────────────────────────────────────
# نسخه ۲۰ حداقل است چون بیلد standalone نکست به APIهای آن تکیه دارد.
find_node() {
	for c in /usr/local/bin/node /usr/bin/node "$(command -v node 2>/dev/null || true)" /opt/node/bin/node; do
		[ -n "$c" ] && [ -x "$c" ] || continue
		v=$("$c" -v 2>/dev/null | sed 's/^v//;s/\..*//') || continue
		[ "${v:-0}" -ge 20 ] 2>/dev/null && { echo "$c"; return 0; }
	done
	return 1
}

say "پیدا کردن Node"
if NODE_BIN=$(find_node); then
	ok "Node موجود: $NODE_BIN ($("$NODE_BIN" -v))"
elif [ -f node-linux-x64.tar.xz ]; then
	# مسیر آفلاین: تاربال کنار پکیج گذاشته شده.
	ok "نصب Node از تاربال همراه پکیج"
	rm -rf /opt/node && mkdir -p /opt/node
	tar -xJf node-linux-x64.tar.xz -C /opt/node --strip-components=1
	NODE_BIN=/opt/node/bin/node
	ok "$("$NODE_BIN" -v)"
else
	say "Node نیست — تلاش برای نصب از مخزن سیستم"
	if command -v apt-get >/dev/null; then
		apt-get update -qq && apt-get install -y -qq nodejs || true
	elif command -v dnf >/dev/null; then
		dnf install -y -q nodejs || true
	elif command -v yum >/dev/null; then
		yum install -y -q nodejs || true
	fi
	NODE_BIN=$(find_node) || die "Node نسخه ۲۰ یا بالاتر نصب نشد.
سرور احتمالاً به مخزن دسترسی ندارد. روی ویندوز این را اجرا کنید و دوباره بفرستید:
    .\\deploy\\package-and-ship.ps1 -IncludeNode"
	ok "$NODE_BIN ($("$NODE_BIN" -v))"
fi

# ── رمز ───────────────────────────────────────────────────────────────────
# در فایل env می‌ماند، نه در یونیت systemd: یونیت را هر کسی می‌تواند با
# `systemctl cat` ببیند، ولی این فایل 600 و مال root است.
say "رمز صفحه"
if [ -f "$ENV_FILE" ] && grep -q '^PREVIEW_PASSWORD=' "$ENV_FILE"; then
	ok "رمز قبلی حفظ شد ($ENV_FILE)"
	PASS=$(grep '^PREVIEW_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)
else
	PASS="${SITE_PASSWORD:-$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 16)}"
	umask 077
	cat > "$ENV_FILE" <<EOF
# رمز ورود به نسخه پیش‌نمایش. با systemctl restart $SERVICE اعمال می‌شود.
PREVIEW_USER=${SITE_USER:-ketapod}
PREVIEW_PASSWORD=$PASS
PORT=$PORT
HOSTNAME=0.0.0.0
NODE_ENV=production
EOF
	chmod 600 "$ENV_FILE"
	ok "رمز ساخته شد"
fi

# ── فایل‌ها ───────────────────────────────────────────────────────────────
# نصب کنار هم، بعد جابه‌جایی اتمیک: اگر کپی وسط کار بمیرد، نسخه‌ی در حال
# سرویس دست‌نخورده می‌ماند.
say "نصب فایل‌ها در $APP_DIR"
id ketapod >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin ketapod
rm -rf "$APP_DIR.new"
mkdir -p "$APP_DIR.new"
cp -a bundle/. "$APP_DIR.new/"
[ -f "$APP_DIR.new/server.js" ] || die "bundle ناقص است — server.js نیست."
[ -d "$APP_DIR.new/.next/static" ] || die "bundle ناقص است — .next/static نیست (سایت بدون CSS بالا می‌آمد)."
rm -rf "$APP_DIR.old"
[ -d "$APP_DIR" ] && mv "$APP_DIR" "$APP_DIR.old"
mv "$APP_DIR.new" "$APP_DIR"
chown -R ketapod:ketapod "$APP_DIR"
ok "$(du -sh "$APP_DIR" | cut -f1)"

# ── سرویس ─────────────────────────────────────────────────────────────────
say "ثبت سرویس systemd"
sed "s|__NODE__|$NODE_BIN|g; s|__DIR__|$APP_DIR|g; s|__ENV__|$ENV_FILE|g" \
	ketapod-site.service > "/etc/systemd/system/$SERVICE.service"
systemctl daemon-reload
systemctl enable --now "$SERVICE" >/dev/null 2>&1 || systemctl enable "$SERVICE" >/dev/null 2>&1
systemctl restart "$SERVICE"

# ── فایروال ───────────────────────────────────────────────────────────────
if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q active; then
	ufw allow "$PORT"/tcp >/dev/null 2>&1 && ok "ufw: پورت $PORT باز شد"
elif command -v firewall-cmd >/dev/null && firewall-cmd --state >/dev/null 2>&1; then
	firewall-cmd --add-port="$PORT"/tcp --permanent >/dev/null 2>&1
	firewall-cmd --reload >/dev/null 2>&1 && ok "firewalld: پورت $PORT باز شد"
fi

# ── تأیید ─────────────────────────────────────────────────────────────────
say "بررسی"
for i in $(seq 1 30); do
	code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:$PORT/" || true)
	case "$code" in
		# ۴۰۱ یعنی سرویس بالاست *و* دروازه‌ی رمز کار می‌کند. ۲۰۰ یعنی سایت
		# باز است — و چون این بیلد کد OTP را برمی‌گرداند، آن یک نشتِ
		# احراز هویت است نه یک موفقیت.
		401) ok "سایت بالاست و پشت رمز است"; break ;;
		200) systemctl stop "$SERVICE"; die "سایت بدون رمز جواب داد. سرویس خاموش شد. $ENV_FILE را بررسی کنید." ;;
	esac
	[ "$i" = 30 ] && { journalctl -u "$SERVICE" -n 30 --no-pager; die "سایت بالا نیامد."; }
	sleep 2
done

if [ "$GITEA_WAS_UP" = 1 ]; then
	curl -fsS -o /dev/null --max-time 10 "http://127.0.0.1:$GITEA_PORT/" \
		|| die "Gitea دیگر جواب نمی‌دهد. فوراً بررسی کنید."
	ok "Gitea هنوز سالم است"
fi

rm -rf "$APP_DIR.old"

IP=$(hostname -I 2>/dev/null | awk '{print $1}')
cat <<EOF

  ────────────────────────────────────────────────
   سایت بالاست

   آدرس    http://${IP:-87.248.153.208}:$PORT
   کاربر   ${SITE_USER:-ketapod}
   رمز     $PASS

   Gitea روی $GITEA_PORT دست‌نخورده است.
  ────────────────────────────────────────────────

  لاگ:      journalctl -u $SERVICE -f
  ری‌استارت: systemctl restart $SERVICE
  توقف:     systemctl stop $SERVICE

EOF
