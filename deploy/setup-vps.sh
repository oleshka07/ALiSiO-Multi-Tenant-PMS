#!/usr/bin/env bash
#
# Prepare a fresh Debian/Ubuntu VPS to host production and beta.
#
#   sudo ./deploy/setup-vps.sh pms.example.com admin@example.com
#
# Idempotent — safe to re-run. Does not deploy the application; run
# deploy/deploy.sh afterwards.
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

echo "==> packages"
apt-get update -qq
# docker-compose-plugin, not the retired standalone docker-compose v1.
apt-get install -y -qq ca-certificates curl gnupg nginx certbot python3-certbot-nginx ufw

if ! command -v docker >/dev/null; then
  echo "==> docker"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker

echo "==> firewall"
# Application ports stay closed: both stacks bind to 127.0.0.1, and nginx is
# the only way in.
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

echo "==> nginx"
install -d /etc/nginx/snippets /var/www/certbot
sed "s/pms\.example\.com/${DOMAIN}/g" "${HERE}/nginx/alisio.conf" \
  > /etc/nginx/sites-available/alisio.conf
cp "${HERE}/nginx/alisio-proxy.conf" /etc/nginx/snippets/alisio-proxy.conf
ln -sf /etc/nginx/sites-available/alisio.conf /etc/nginx/sites-enabled/alisio.conf
rm -f /etc/nginx/sites-enabled/default

echo "==> certificates for ${DOMAIN} and ${BETA}"
# One certificate per host over HTTP-01. A wildcard needs a DNS-01 challenge and
# API credentials for the DNS provider — the previous script asked certbot for a
# wildcard with --standalone, which cannot work.
certbot --nginx --non-interactive --agree-tos -m "$EMAIL" -d "$DOMAIN" -d "$BETA" \
  || echo "!! certbot failed — check that both A records point at this host, then re-run" >&2

nginx -t && systemctl reload nginx

cat <<EOF

Ready. Next:
  1. cp deploy/env.prod.example deploy/env.prod   and fill APP_SECRET_KEY
  2. cp deploy/env.beta.example deploy/env.beta   and fill a DIFFERENT key
  3. ./deploy/deploy.sh beta      # verify on https://${BETA}
  4. ./deploy/deploy.sh prod      # then https://${DOMAIN}

Generate a key with:
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
EOF
