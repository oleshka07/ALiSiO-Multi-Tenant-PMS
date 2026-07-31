#!/usr/bin/env bash
#
# Prepare a FRESH Debian/Ubuntu VPS to host production and beta.
#
#   sudo ./deploy/setup-vps.sh pms.example.com admin@example.com
#
# ⚠ Only for a server that hosts nothing else. It installs nginx and Docker,
# turns the firewall on with SSH + nginx as the only open ports, and removes
# nginx's default site. On a box that already serves other projects that is
# destructive: `ufw --force enable` cuts off every port those projects listen
# on directly, and the nginx work can collide with their server blocks.
#
# On a shared host, install nginx / certbot / Docker yourself and then run
#   sudo ./deploy/add-site.sh pms.example.com admin@example.com
# which only adds this application's server blocks and certificates.
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
HERE="$(cd "$(dirname "$0")" && pwd)"

# ── Refuse to run on a host that is already serving something ───────────────
# These checks are the difference between "sets up a new server" and "takes
# four unrelated sites offline".
occupied=""

if [ -d /etc/nginx/sites-enabled ]; then
  others="$(find /etc/nginx/sites-enabled -mindepth 1 \
            ! -name default ! -name "${DOMAIN}.conf" ! -name 'alisio*' 2>/dev/null | wc -l)"
  [ "$others" -gt 0 ] && occupied="${occupied}  - nginx already serves ${others} other site(s)\n"
fi

if command -v ufw >/dev/null && ufw status 2>/dev/null | head -1 | grep -qi active; then
  occupied="${occupied}  - ufw is already enabled and configured\n"
fi

if command -v docker >/dev/null && [ "$(docker ps -q 2>/dev/null | wc -l)" -gt 0 ]; then
  occupied="${occupied}  - Docker is already running $(docker ps -q | wc -l) container(s)\n"
fi

if [ -n "$occupied" ]; then
  echo "This host is not fresh:" >&2
  printf "$occupied" >&2
  cat >&2 <<EOF

Refusing to run. This script enables a firewall that closes every port except
SSH and nginx, removes nginx's default site, and reinstalls packages — any of
which can take the other projects on this host offline.

Use the additive path instead, which touches nothing but this application:

  sudo ./deploy/add-site.sh ${DOMAIN} ${EMAIL}

If this really is a fresh host and the detection is wrong, set
ALISIO_FORCE_SETUP=1 and re-run.
EOF
  [ "${ALISIO_FORCE_SETUP:-}" = "1" ] || exit 1
  echo "ALISIO_FORCE_SETUP=1 — continuing anyway." >&2
fi

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

echo "==> default site"
rm -f /etc/nginx/sites-enabled/default

# nginx server blocks and certificates are the same work on a fresh host as on
# a shared one, so they live in one place.
"${HERE}/add-site.sh" "$DOMAIN" "$EMAIL"
