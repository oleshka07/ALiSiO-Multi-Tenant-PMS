#!/usr/bin/env bash
#
# One screen answering "is this environment alive, and what exactly is running".
#
#   ./deploy/status.sh prod
#   ./deploy/status.sh beta
#
# Read-only by design: it inspects and asks, never restarts, never writes.
# Health here means the same thing deploy.sh means by it — a POST that has to
# reach the users table — because GET /login renders from the bundle alone and
# once said "up" while every data route returned 500.
set -euo pipefail

ENV_NAME="${1:-}"
case "$ENV_NAME" in
  prod|beta) ;;
  *) echo "usage: $0 {prod|beta}" >&2; exit 2 ;;
esac

cd "$(dirname "$0")/.."
ENV_FILE="deploy/env.${ENV_NAME}"

echo "==> containers"
FOUND="$(docker ps -a --filter "name=alisio-${ENV_NAME}-" --format '{{.Names}}\t{{.Status}}\t{{.Image}}')"
if [ -n "$FOUND" ]; then
  printf '%s\n' "$FOUND" | sed 's/^/    /'
else
  echo "    none — $ENV_NAME is not deployed on this machine"
fi

echo "==> health (POST /api/auth/login has to reach the users table)"
if [ -f "$ENV_FILE" ]; then
  PORT="$(grep -E '^APP_PORT=' "$ENV_FILE" | cut -d= -f2 | tr -d '\r' || true)"
  CODE="$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:${PORT}/api/auth/login" \
    -H 'Content-Type: application/json' \
    -d '{"email":"status@example.invalid","password":"x"}' || true)"
  case "$CODE" in
    401|400) echo "    up on :${PORT} — db reachable (health $CODE)" ;;
    000)     echo "    !! nothing answers on :${PORT} — ./deploy/logs.sh $ENV_NAME" ;;
    *)       echo "    !! answers $CODE on a database-backed route — ./deploy/logs.sh $ENV_NAME" ;;
  esac
else
  echo "    ($ENV_FILE missing — run this on the server)"
fi

echo "==> working copy (what a deploy would run from)"
git log -1 --pretty='    %h %s' 2>/dev/null || echo "    (not a git checkout)"

echo "==> migrations"
./deploy/migrate.sh "$ENV_NAME" --list 2>&1 | sed 's/^/    /' || true

echo "==> backups (freshest first; .sql.gz is the live database, .tar.gz is old SQLite)"
# shellcheck disable=SC2012
ls -lht deploy/backups/alisio-${ENV_NAME}-*.sql.gz 2>/dev/null | head -3 | sed 's/^/    /' \
  || echo "    no dumps yet — deploy.sh makes one before every deploy"

echo "==> off-site copy (a backup on this disk dies with this disk)"
OFFSITE_MARKER="deploy/backups/.offsite-${ENV_NAME}"
if [ -e "$OFFSITE_MARKER" ]; then
  OFFSITE_AGE_H=$(( ( $(date +%s) - $(stat -c %Y "$OFFSITE_MARKER") ) / 3600 ))
  if [ "$OFFSITE_AGE_H" -le 30 ]; then
    echo "    last upload ${OFFSITE_AGE_H}h ago — ok"
  else
    echo "    !! last upload ${OFFSITE_AGE_H}h ago (threshold 30) — see deploy/backups/backup.log"
  fi
else
  echo "    !! never — this disk is the only copy (docs/DEPLOY.md → «Бекапи поза сервером»)"
fi

echo "==> disk (the August 26 incident was this line reaching 100%)"
df -h / | tail -1 | sed 's/^/    /'
