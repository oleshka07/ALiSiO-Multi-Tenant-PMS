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

command -v nginx >/dev/null || { echo "nginx is not installed — this script does not install it" >&2; exit 1; }
command -v certbot >/dev/null || { echo "certbot is not installed — this script does not install it" >&2; exit 1; }

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

echo "==> server blocks for ${DOMAIN} and ${BETA}"
{
  echo "$MARKER"
  sed "s/pms\.example\.com/${DOMAIN}/g" "${HERE}/nginx/alisio.conf"
} > "$CONF"
ln -sf "$CONF" "/etc/nginx/sites-enabled/${DOMAIN}.conf"

# The template references certificates that do not exist yet, so the config
# cannot be tested or reloaded until certbot has run. Serve plain HTTP first.
TMP_HTTP="$(mktemp)"
cat > "$TMP_HTTP" <<EOF
$MARKER
map \$http_upgrade \$connection_upgrade { default upgrade; '' close; }
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};
    client_max_body_size 25m;
    location / { proxy_pass http://127.0.0.1:3130; include /etc/nginx/snippets/alisio-proxy.conf; }
}
server {
    listen 80;
    listen [::]:80;
    server_name ${BETA};
    client_max_body_size 25m;
    add_header X-Robots-Tag "noindex, nofollow" always;
    location / { proxy_pass http://127.0.0.1:3131; include /etc/nginx/snippets/alisio-proxy.conf; }
}
EOF
cp "$TMP_HTTP" "$CONF"
rm -f "$TMP_HTTP"

nginx -t
systemctl reload nginx

echo "==> certificates"
# --nginx edits only the server blocks matching -d, so other sites are left
# alone. --cert-name keeps this certificate separate from any existing one.
certbot --nginx --non-interactive --agree-tos -m "$EMAIL" \
  -d "$DOMAIN" -d "$BETA" --cert-name "$DOMAIN"

nginx -t
systemctl reload nginx

cat <<EOF

Done. ${DOMAIN} -> 127.0.0.1:3130, ${BETA} -> 127.0.0.1:3131.
Nothing else on this host was changed.

Next:
  1. cp deploy/env.prod.example deploy/env.prod   and fill APP_SECRET_KEY
  2. cp deploy/env.beta.example deploy/env.beta   and fill a DIFFERENT key
  3. ./deploy/deploy.sh beta      # verify on https://${BETA}
  4. ./deploy/deploy.sh prod      # then https://${DOMAIN}
EOF
