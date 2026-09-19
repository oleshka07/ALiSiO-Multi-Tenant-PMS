#!/usr/bin/env bash
#
# Put ALiSiO behind an existing nginx. Nothing else on the host is touched.
#
#   sudo ./deploy/add-site.sh pms.example.com admin@example.com
#
# This is the script to run on a server that already hosts other things. It
# only ever:
#   - writes /etc/nginx/snippets/alisio-proxy.conf
#   - writes /etc/nginx/sites-available/<domain>.conf and enables it
#   - asks certbot for certificates for <domain> and beta.<domain>
#
# It does not install packages, does not touch the firewall, does not remove
# the default site, and does not modify any other server block. Re-running it
# is safe.
set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"
if [ -z "$DOMAIN" ] || [ -z "$EMAIL" ]; then
  echo "usage: $0 <domain> <email>" >&2
  echo "  e.g. $0 pms.example.com admin@example.com" >&2
  exit 2
fi
BETA="beta.${DOMAIN}"
HERE="$(cd "$(dirname "$0")" && pwd)"
CONF="/etc/nginx/sites-available/${DOMAIN}.conf"
# Одна лінія сертифіката на обидва імені: `certbot --cert-name "$DOMAIN"`
# нижче, і саме цю теку називає шаблон в обох серверних блоках.
CERT_DIR="/etc/letsencrypt/live/${DOMAIN}"

command -v nginx >/dev/null || { echo "nginx is not installed — this script does not install it" >&2; exit 1; }
command -v certbot >/dev/null || { echo "certbot is not installed — this script does not install it" >&2; exit 1; }

# Шаблон перевіряється ТУТ, а не в момент запису. `render_template > "$CONF"`
# спершу обнуляє файл і лише потім запускає sed: відсутній шаблон лишив би на
# сервері порожній конфіг сайта, і наступне перезавантаження nginx — чиє
# завгодно — поклало б домен. Дешевше не дійти до цього місця.
TEMPLATE="${HERE}/nginx/alisio.conf"
[ -s "$TEMPLATE" ] || { echo "не знайдено шаблон $TEMPLATE — запускати з клону репозиторію" >&2; exit 1; }

# Refuse to overwrite a server block that some other tool put there. If the
# file exists and does not carry our marker, the operator decides.
MARKER="# managed by alisio deploy/add-site.sh"
if [ -f "$CONF" ] && ! grep -qF "$MARKER" "$CONF"; then
  echo "$CONF exists and was not written by this script." >&2
  echo "Move it aside or merge by hand; refusing to overwrite." >&2
  exit 1
fi

# Both hostnames must already point here, or certbot's HTTP-01 challenge fails
# and leaves a server block referencing certificates that do not exist —
# which makes `nginx -t` fail and takes every other site on the box down with
# it on the next reload.
for host in "$DOMAIN" "$BETA"; do
  ip="$(getent hosts "$host" | awk '{print $1; exit}')" || true
  if [ -z "${ip:-}" ]; then
    echo "$host does not resolve. Add the DNS A record first." >&2
    exit 1
  fi
done

echo "==> nginx snippet"
install -d /etc/nginx/snippets /var/www/certbot
cp "${HERE}/nginx/alisio-proxy.conf" /etc/nginx/snippets/alisio-proxy.conf

ln -sf "$CONF" "/etc/nginx/sites-enabled/${DOMAIN}.conf"

# ── Шаблон — це те, що зрештою стоїть на сервері ────────────────────────────
#
# Досі було навпаки, і мовчки. Скрипт клав сюди повний deploy/nginx/alisio.conf,
# а через шістнадцять рядків перезаписував його ТИМЧАСОВИМ HTTP-конфігом — бо
# шаблон посилається на сертифікати, яких ще немає. Далі `certbot --nginx`
# дописував TLS у ТИМЧАСОВИЙ, і на цьому все закінчувалось: шаблон не
# повертався ніколи, ні при першому запуску, ні при повторному.
#
# Ціна вимірялась 18.09.2026 на живому готелі. У шаблоні є
# `location = /api/apps/winhotel-import/snapshots` з `client_max_body_size
# 200m` і коментарем «gzip на ~80 МБ» — автор угадав до мегабайта (вимір дав
# 81 738 КБ). Цей блок не діяв у ЖОДНОМУ середовищі й ніколи не діяв: агент
# готелю отримував 413 від nginx, а не відповідь застосунку.
#
# Порядок нижче обраний так, щоб пережити повторний запуск: тимчасовий конфіг
# існує рівно доти, доки certbot не має що встановлювати, а ОСТАННЄ, що
# скрипт робить завжди, — кладе шаблон і перезавантажує nginx. Тобто скільки
# б разів його не запустили, на диску лишається шаблон, а не сліди
# проміжного стану.

# Повний шаблон із підставленим доменом. Одна лінія сертифіката на обидва
# імені — `--cert-name "$DOMAIN"` нижче, і саме її називає шаблон.
render_template() {
  echo "$MARKER"
  sed "s/pms\.example\.com/${DOMAIN}/g" "$TEMPLATE"
}

# Покласти шаблон і перезавантажити — але лише якщо nginx його прийняв.
#
# Перевірка не косметична: `nginx -t` над конфігом, який посилається на
# неіснуючий сертифікат, падає, і наступне перезавантаження кладе КОЖЕН
# інший сайт на цьому хості. Тому при провалі ми повертаємо те, що працювало
# (конфіг, який залишив certbot), і виходимо з помилкою, так і не
# перезавантаживши nginx зі зламаним файлом.
install_template() {
  local backup=''
  if [ -f "$CONF" ]; then
    backup="$(mktemp)"
    cp "$CONF" "$backup"
  fi
  render_template > "$CONF"
  if ! nginx -t; then
    echo "!! шаблон nginx/alisio.conf не проходить nginx -t для ${DOMAIN}" >&2
    if [ -n "$backup" ]; then
      cp "$backup" "$CONF"
      rm -f "$backup"
      echo "!! повернуто попередній конфіг; nginx не перезавантажувався" >&2
    else
      rm -f "$CONF" "/etc/nginx/sites-enabled/${DOMAIN}.conf"
      echo "!! конфіг прибрано; nginx не перезавантажувався" >&2
    fi
    echo "!! найчастіша причина: certbot назвав лінію сертифіката інакше," >&2
    echo "!! ніж ${CERT_DIR} — подивіться certbot certificates" >&2
    exit 1
  fi
  if [ -n "$backup" ]; then rm -f "$backup"; fi
  systemctl reload nginx
}

if [ -s "${CERT_DIR}/fullchain.pem" ]; then
  # Сертифікат уже є — шаблон можна класти одразу, і його треба класти ДО
  # certbot: `ln -sf` вище вже створив посилання в sites-enabled, і якщо
  # `$CONF` при цьому не існує (його прибрали руками), nginx спотикається об
  # биту вʼязь — а `nginx -t` усередині certbot падає разом із ним. Далі
  # install_template виконається ще раз, після certbot: він ідемпотентний.
  echo "==> certificate for ${DOMAIN} is already there — template goes up as is"
  install_template
else
  echo "==> temporary HTTP server blocks for ${DOMAIN} and ${BETA}"
  # Живе рівно до відповіді certbot: шаблон вимагає сертифікатів, яких ще
  # немає, а certbot --nginx вимагає конфіга, який nginx приймає. Нижче він
  # буде замінений шаблоном беззастережно.
  TMP_HTTP="$(mktemp)"
  cat > "$TMP_HTTP" <<EOF
$MARKER
map \$http_upgrade \$connection_upgrade { default upgrade; '' close; }
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};
    client_max_body_size 25m;
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { proxy_pass http://127.0.0.1:3130; include /etc/nginx/snippets/alisio-proxy.conf; }
}
server {
    listen 80;
    listen [::]:80;
    server_name ${BETA};
    client_max_body_size 25m;
    add_header X-Robots-Tag "noindex, nofollow" always;
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { proxy_pass http://127.0.0.1:3131; include /etc/nginx/snippets/alisio-proxy.conf; }
}
EOF
  cp "$TMP_HTTP" "$CONF"
  rm -f "$TMP_HTTP"

  nginx -t
  systemctl reload nginx
fi

echo "==> certificates"
# --nginx edits only the server blocks matching -d, so other sites are left
# alone. --cert-name keeps this certificate separate from any existing one.
certbot --nginx --non-interactive --agree-tos -m "$EMAIL" \
  -d "$DOMAIN" -d "$BETA" --cert-name "$DOMAIN"

echo "==> server blocks for ${DOMAIN} and ${BETA} (deploy/nginx/alisio.conf)"
# Останній крок, і він же той самий при повторному запуску: усе, що certbot
# дописав у файл, замінюється шаблоном, який лежить у репозиторії. Що стоїть
# на сервері — видно в git, а не лише на сервері.
install_template

cat <<EOF

Done. ${DOMAIN} -> 127.0.0.1:3130, ${BETA} -> 127.0.0.1:3131.
Nothing else on this host was changed.

Next:
  1. cp deploy/env.prod.example deploy/env.prod   and fill APP_SECRET_KEY
  2. cp deploy/env.beta.example deploy/env.beta   and fill a DIFFERENT key
  3. ./deploy/deploy.sh beta      # verify on https://${BETA}
  4. ./deploy/deploy.sh prod      # then https://${DOMAIN}
EOF
