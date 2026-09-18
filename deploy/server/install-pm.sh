#!/usr/bin/env bash
#
# نصب تخته کارها (pmapi + pm-web) روی همین سرور، کنار Gitea و سایت.
#
# مثل install.sh چیزی از اینترنت نمی‌کشد: pmapi و ابزار مهاجرت روی ویندوز
# کراس‌کامپایل شده‌اند، pm-web هم مثل سایت standalone بیلد شده. تنها چیزی
# که این اسکریپت ممکن است از مخزن سیستم بخواهد Postgres و Redis است —
# چیزهایی که سایت لازم نداشت ولی این ابزار دارد.
#
# سه سرویس تازه اضافه می‌شوند (ketapod-pmapi، ketapod-pmweb،
# ketapod-minio) و هیچ‌کدام پورت ۳۰۰۰ (Gitea) یا ۸۰۸۰ (سایت) را لمس
# نمی‌کنند.

set -euo pipefail
cd "$(dirname "$0")"

PMAPI_PORT="${PMAPI_PORT:-8090}"
PMWEB_PORT="${PMWEB_PORT:-3001}"
GITEA_PORT=3000
SITE_PORT=8080

API_DIR=/opt/ketapod-pm-api
WEB_DIR=/opt/ketapod-pm-web
MINIO_DIR=/opt/ketapod-pm-minio
MINIO_DATA=/var/lib/ketapod-pm-minio
API_ENV=/etc/ketapod-pmapi.env
WEB_ENV=/etc/ketapod-pmweb.env
MINIO_ENV=/etc/ketapod-pm-minio.env
SVC_USER=ketapod-pm

say()  { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "با root اجرا کنید (یا sudo)."
[ -d bundle ] || die "پوشه bundle نیست. کل پکیج را کپی کرده‌اید؟"
for p in "$PMAPI_PORT" "$PMWEB_PORT"; do
	[ "$p" = "$GITEA_PORT" ] && die "پورت $p مال Gitea است."
	[ "$p" = "$SITE_PORT" ]  && die "پورت $p مال سایت است."
done
[ "$PMAPI_PORT" = "$PMWEB_PORT" ] && die "PMAPI_PORT و PMWEB_PORT یکی هستند."

# یک راز را در یک فایل env نگه می‌دارد: اگر از قبل هست همان را برمی‌گرداند
# (اجرای دوباره رمزها را عوض نمی‌کند)، وگرنه تازه می‌سازد.
persisted() {
	local file=$1 key=$2 len=${3:-32}
	if [ -f "$file" ] && grep -q "^${key}=" "$file" 2>/dev/null; then
		grep "^${key}=" "$file" | head -1 | cut -d= -f2-
	else
		tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$len"
	fi
}

# ── سلامت قبلی ────────────────────────────────────────────────────────────
# اگر همین الان چیزی خراب است، نباید تغییری بدهیم و بعد فکر کنیم کار ما بود.
say "بررسی سرویس‌های موجود"
if curl -fsS -o /dev/null --max-time 10 "http://127.0.0.1:$GITEA_PORT/" 2>/dev/null; then
	ok "Gitea روی $GITEA_PORT سالم است"; GITEA_WAS_UP=1
else
	warn "Gitea روی $GITEA_PORT جواب نداد — این اسکریپت هیچ‌وقت آن پورت را نمی‌گیرد."; GITEA_WAS_UP=0
fi
if curl -fsS -o /dev/null --max-time 10 "http://127.0.0.1:$SITE_PORT/" 2>/dev/null; then
	ok "سایت روی $SITE_PORT سالم است"; SITE_WAS_UP=1
else
	warn "سایت روی $SITE_PORT جواب نداد (شاید هنوز دیپلوی نشده) — کاری بهش نداریم."; SITE_WAS_UP=0
fi

# ── Postgres ──────────────────────────────────────────────────────────────
say "Postgres"
if command -v psql >/dev/null && systemctl is-active --quiet postgresql 2>/dev/null; then
	ok "از قبل نصب و روشن است"
else
	if command -v apt-get >/dev/null; then
		apt-get update -qq && apt-get install -y -qq postgresql postgresql-contrib
	elif command -v dnf >/dev/null; then
		dnf install -y -q postgresql-server postgresql-contrib
		[ -d /var/lib/pgsql/data ] || postgresql-setup --initdb
	elif command -v yum >/dev/null; then
		yum install -y -q postgresql-server postgresql-contrib
		[ -d /var/lib/pgsql/data ] || postgresql-setup initdb
	else
		die "مدیر پکیج شناخته‌شده‌ای نیست. Postgres را دستی نصب کنید و دوباره اجرا کنید."
	fi
	systemctl enable --now postgresql || systemctl enable --now postgresql.service
	command -v psql >/dev/null || die "Postgres نصب شد ولی psql پیدا نشد — دستی بررسی کنید."
fi
ok "$(psql --version)"

# از سودو استفاده نمی‌کنیم — چون خودمان root هستیم، su کافی است و به
# نصب‌بودن پکیج sudo وابسته نیست.
pg() { su -s /bin/sh -c "$1" postgres; }

DB_PASS=$(persisted "$API_ENV" PM_DB_PASSWORD)
say "دیتابیس و کاربر اختصاصی pm"
pg "psql -v ON_ERROR_STOP=1 -q" <<SQL
DO \$\$
BEGIN
   IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ketapod_pm') THEN
      CREATE ROLE ketapod_pm LOGIN PASSWORD '$DB_PASS';
   ELSE
      ALTER ROLE ketapod_pm WITH PASSWORD '$DB_PASS';
   END IF;
END
\$\$;
SQL
if [ "$(pg "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='ketapod_pm'\"")" != "1" ]; then
	pg "psql -q -c \"CREATE DATABASE ketapod_pm OWNER ketapod_pm\""
	ok "دیتابیس ketapod_pm ساخته شد"
else
	ok "دیتابیس ketapod_pm از قبل هست"
fi
DATABASE_URL="postgres://ketapod_pm:${DB_PASS}@127.0.0.1:5432/ketapod_pm?sslmode=disable"

# ── Redis ─────────────────────────────────────────────────────────────────
say "Redis"
if command -v redis-cli >/dev/null && (systemctl is-active --quiet redis-server 2>/dev/null || systemctl is-active --quiet redis 2>/dev/null); then
	ok "از قبل نصب و روشن است"
else
	if command -v apt-get >/dev/null; then
		apt-get update -qq && apt-get install -y -qq redis-server
		systemctl enable --now redis-server
	elif command -v dnf >/dev/null; then
		dnf install -y -q redis && systemctl enable --now redis
	elif command -v yum >/dev/null; then
		yum install -y -q redis && systemctl enable --now redis
	else
		die "مدیر پکیج شناخته‌شده‌ای نیست. Redis را دستی نصب کنید و دوباره اجرا کنید."
	fi
fi
redis-cli ping >/dev/null 2>&1 || die "Redis نصب شد ولی جواب پینگ نمی‌دهد."
ok "Redis آماده است"

# ── کاربر سرویس ───────────────────────────────────────────────────────────
id "$SVC_USER" >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin "$SVC_USER"

# ── MinIO (از bundle، نه از اینترنت سرور) ───────────────────────────────────
say "MinIO (فقط روی لوکال‌هاست، pmapi تنها مصرف‌کننده‌اش است)"
[ -f bundle/bin/minio ] || die "bundle/bin/minio نیست — پکیج ناقص است."
mkdir -p "$MINIO_DIR" "$MINIO_DATA"
install -m 755 bundle/bin/minio "$MINIO_DIR/minio"
chown -R "$SVC_USER:$SVC_USER" "$MINIO_DIR" "$MINIO_DATA"

MINIO_USER=$(persisted "$MINIO_ENV" MINIO_ROOT_USER 20)
MINIO_PASS=$(persisted "$MINIO_ENV" MINIO_ROOT_PASSWORD 32)
umask 077
cat > "$MINIO_ENV" <<EOF
MINIO_ROOT_USER=$MINIO_USER
MINIO_ROOT_PASSWORD=$MINIO_PASS
MINIO_BROWSER=off
EOF
chmod 600 "$MINIO_ENV"

sed "s|__DIR__|$MINIO_DIR|g; s|__DATADIR__|$MINIO_DATA|g; s|__ENV__|$MINIO_ENV|g" \
	ketapod-minio.service > /etc/systemd/system/ketapod-minio.service
systemctl daemon-reload
systemctl enable --now ketapod-minio
for i in $(seq 1 15); do
	curl -fsS -o /dev/null --max-time 3 http://127.0.0.1:9000/minio/health/live 2>/dev/null && { ok "MinIO بالاست"; break; }
	[ "$i" = 15 ] && { journalctl -u ketapod-minio -n 30 --no-pager; die "MinIO بالا نیامد."; }
	sleep 1
done

# ── مهاجرت ────────────────────────────────────────────────────────────────
say "مهاجرت schema pm"
[ -f bundle/bin/ketapod-migrate ] || die "bundle/bin/ketapod-migrate نیست."
[ -f bundle/migrations/00017_pm.sql ] || die "bundle/migrations/00017_pm.sql نیست."
chmod +x bundle/bin/ketapod-migrate
( cd bundle && DATABASE_URL="$DATABASE_URL" ./bin/ketapod-migrate up )
ok "schema pm آماده است"

# ── Node (برای pm-web؛ ممکن است سایت از قبل نصبش کرده باشد) ────────────────
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
elif [ -f bundle/node-linux-x64.tar.xz ]; then
	ok "نصب Node از تاربال همراه پکیج"
	rm -rf /opt/node && mkdir -p /opt/node
	tar -xJf bundle/node-linux-x64.tar.xz -C /opt/node --strip-components=1
	NODE_BIN=/opt/node/bin/node
else
	say "Node نیست — تلاش برای نصب از مخزن سیستم"
	if command -v apt-get >/dev/null; then apt-get update -qq && apt-get install -y -qq nodejs || true
	elif command -v dnf >/dev/null; then dnf install -y -q nodejs || true
	elif command -v yum >/dev/null; then yum install -y -q nodejs || true
	fi
	NODE_BIN=$(find_node) || die "Node ۲۰+ نصب نشد. روی ویندوز با -IncludeNode دوباره بسته‌بندی کنید."
fi
ok "$NODE_BIN ($("$NODE_BIN" -v))"

# ── pmapi ─────────────────────────────────────────────────────────────────
say "نصب pmapi در $API_DIR"
[ -f bundle/bin/pmapi ] || die "bundle/bin/pmapi نیست."
rm -rf "$API_DIR.new" && mkdir -p "$API_DIR.new"
install -m 755 bundle/bin/pmapi "$API_DIR.new/pmapi"
rm -rf "$API_DIR.old"; [ -d "$API_DIR" ] && mv "$API_DIR" "$API_DIR.old"
mv "$API_DIR.new" "$API_DIR"
chown -R "$SVC_USER:$SVC_USER" "$API_DIR"

IP=$(hostname -I 2>/dev/null | awk '{print $1}')
IP="${IP:-87.248.153.208}"
JWT_SECRET=$(persisted "$API_ENV" PM_JWT_SECRET 48)
cat > "$API_ENV" <<EOF
APP_ENV=development
PM_HTTP_PORT=$PMAPI_PORT
DATABASE_URL=$DATABASE_URL
REDIS_ADDR=127.0.0.1:6379
PM_REDIS_DB=1
S3_ENDPOINT=127.0.0.1:9000
S3_REGION=us-east-1
S3_BUCKET=ketapod-media
S3_ACCESS_KEY=$MINIO_USER
S3_SECRET_KEY=$MINIO_PASS
S3_USE_SSL=false
PM_JWT_SECRET=$JWT_SECRET
PM_DB_PASSWORD=$DB_PASS
PM_APP_BASE_URL=http://${IP}:${PMWEB_PORT}
PM_CORS_ALLOWED_ORIGINS=http://${IP}:${PMWEB_PORT}
LOG_LEVEL=info
EOF
chmod 600 "$API_ENV"

sed "s|__DIR__|$API_DIR|g; s|__ENV__|$API_ENV|g" ketapod-pmapi.service > /etc/systemd/system/ketapod-pmapi.service
systemctl daemon-reload
systemctl enable --now ketapod-pmapi >/dev/null 2>&1 || systemctl enable --now ketapod-pmapi.service
systemctl restart ketapod-pmapi

say "بررسی pmapi"
for i in $(seq 1 30); do
	code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:$PMAPI_PORT/health" || true)
	[ "$code" = "200" ] && { ok "pmapi بالاست"; break; }
	[ "$i" = 30 ] && { journalctl -u ketapod-pmapi -n 40 --no-pager; die "pmapi بالا نیامد."; }
	sleep 2
done
rm -rf "$API_DIR.old"

# ── pm-web ────────────────────────────────────────────────────────────────
say "نصب pm-web در $WEB_DIR"
[ -f bundle/web/server.js ] || die "bundle/web/server.js نیست."
[ -d bundle/web/.next/static ] || die "bundle/web/.next/static نیست."
rm -rf "$WEB_DIR.new" && mkdir -p "$WEB_DIR.new"
cp -a bundle/web/. "$WEB_DIR.new/"
rm -rf "$WEB_DIR.old"; [ -d "$WEB_DIR" ] && mv "$WEB_DIR" "$WEB_DIR.old"
mv "$WEB_DIR.new" "$WEB_DIR"
chown -R "$SVC_USER:$SVC_USER" "$WEB_DIR"

cat > "$WEB_ENV" <<EOF
PORT=$PMWEB_PORT
HOSTNAME=0.0.0.0
NODE_ENV=production
EOF
chmod 600 "$WEB_ENV"

sed "s|__NODE__|$NODE_BIN|g; s|__DIR__|$WEB_DIR|g; s|__ENV__|$WEB_ENV|g" ketapod-pmweb.service > /etc/systemd/system/ketapod-pmweb.service
systemctl daemon-reload
systemctl enable --now ketapod-pmweb >/dev/null 2>&1 || systemctl enable --now ketapod-pmweb.service
systemctl restart ketapod-pmweb

say "بررسی pm-web"
for i in $(seq 1 30); do
	code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:$PMWEB_PORT/login" || true)
	case "$code" in 200|307|308) ok "pm-web بالاست"; break ;; esac
	[ "$i" = 30 ] && { journalctl -u ketapod-pmweb -n 40 --no-pager; die "pm-web بالا نیامد."; }
	sleep 2
done
rm -rf "$WEB_DIR.old"

# ── فایروال ───────────────────────────────────────────────────────────────
# فقط pmapi و pm-web؛ MinIO عمداً باز نمی‌شود.
for p in "$PMAPI_PORT" "$PMWEB_PORT"; do
	if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q active; then
		ufw allow "$p"/tcp >/dev/null 2>&1
	elif command -v firewall-cmd >/dev/null && firewall-cmd --state >/dev/null 2>&1; then
		firewall-cmd --add-port="$p"/tcp --permanent >/dev/null 2>&1
	fi
done
command -v firewall-cmd >/dev/null && firewall-cmd --state >/dev/null 2>&1 && firewall-cmd --reload >/dev/null 2>&1
ok "فایروال: $PMAPI_PORT و $PMWEB_PORT باز شدند (اگر فایروالی فعال بود)"

# ── همسایه‌ها هنوز سالم‌اند؟ ─────────────────────────────────────────────
if [ "$GITEA_WAS_UP" = 1 ]; then
	curl -fsS -o /dev/null --max-time 10 "http://127.0.0.1:$GITEA_PORT/" || die "Gitea دیگر جواب نمی‌دهد. فوراً بررسی کنید."
	ok "Gitea هنوز سالم است"
fi
if [ "$SITE_WAS_UP" = 1 ]; then
	curl -fsS -o /dev/null --max-time 10 "http://127.0.0.1:$SITE_PORT/" || die "سایت دیگر جواب نمی‌دهد. فوراً بررسی کنید."
	ok "سایت هنوز سالم است"
fi

cat <<EOF

  ────────────────────────────────────────────────
   تخته کارها بالاست

   وب       http://${IP}:${PMWEB_PORT}
   API      http://${IP}:${PMAPI_PORT}/api/v1

   اولین بار که وب را باز می‌کنی، فرم ورود به‌جای رمز، ساختن حساب
   مالک را می‌پرسد.

   ایمیل خروجی وصل نیست؛ لینک دعوت در لاگ pmapi چاپ می‌شود:
   journalctl -u ketapod-pmapi -f | grep invite

   Gitea ($GITEA_PORT) و سایت ($SITE_PORT) دست‌نخورده‌اند.
  ────────────────────────────────────────────────

  لاگ:       journalctl -u ketapod-pmapi -f   /   -u ketapod-pmweb -f
  ری‌استارت:  systemctl restart ketapod-pmapi ketapod-pmweb
  توقف:      systemctl stop ketapod-pmapi ketapod-pmweb ketapod-minio
  رمزها:     cat $API_ENV   (فقط root می‌خواند)

EOF
