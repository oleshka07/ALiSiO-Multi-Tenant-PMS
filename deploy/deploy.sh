#!/usr/bin/env bash
#
# Deploy one environment.
#
#   ./deploy/deploy.sh beta      # from the beta branch
#   ./deploy/deploy.sh prod      # from main
#
# Backs the database up first: the flow is beta -> verify -> prod, and the
# whole point of that flow is that a bad prod deploy can be undone.
set -euo pipefail

ENV_NAME="${1:-}"
case "$ENV_NAME" in
  prod) BRANCH=main ;;
  beta) BRANCH=beta ;;
  *) echo "usage: $0 {prod|beta}" >&2; exit 2 ;;
esac

cd "$(dirname "$0")/.."
ENV_FILE="deploy/env.${ENV_NAME}"
PROJECT="alisio-${ENV_NAME}"

[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE — copy ${ENV_FILE}.example and fill it in" >&2; exit 1; }

# A blank APP_SECRET_KEY means integration credentials cannot be decrypted, and
# the failure surfaces later as "Telegram stopped working" rather than here.
if ! grep -qE '^APP_SECRET_KEY=[0-9a-fA-F]{64}$' "$ENV_FILE"; then
  echo "APP_SECRET_KEY in $ENV_FILE must be 64 hex chars" >&2
  echo '  node -e "console.log(require('"'"'crypto'"'"').randomBytes(32).toString('"'"'hex'"'"'))"' >&2
  exit 1
fi

echo "==> $ENV_NAME: fetching $BRANCH"
git fetch --quiet origin "$BRANCH"
git checkout --quiet "$BRANCH"
git reset --hard --quiet "origin/$BRANCH"
echo "    $(git rev-parse --short HEAD) $(git log -1 --pretty=%s)"

# ── Backup ───────────────────────────────────────────────────────────────────
VOLUME="${PROJECT}_app-data"
if docker volume inspect "$VOLUME" >/dev/null 2>&1; then
  mkdir -p deploy/backups
  STAMP="$(date +%Y%m%d-%H%M%S)"
  ARCHIVE="alisio-${ENV_NAME}-${STAMP}.tar.gz"
  echo "==> backing up $VOLUME -> deploy/backups/$ARCHIVE"
  docker run --rm \
    -v "${VOLUME}:/data:ro" \
    -v "$(pwd)/deploy/backups:/backup" \
    alpine tar czf "/backup/${ARCHIVE}" -C /data .
  # Keep a month of daily deploys; older copies belong in off-site storage.
  ls -1t deploy/backups/alisio-${ENV_NAME}-*.tar.gz 2>/dev/null | tail -n +31 | xargs -r rm --
else
  echo "==> no existing data volume ($VOLUME) — first deploy"
fi

echo "==> building and starting"
docker compose --env-file "$ENV_FILE" -p "$PROJECT" -f deploy/docker-compose.yml up -d --build

# ── Verify ───────────────────────────────────────────────────────────────────
PORT="$(grep -E '^APP_PORT=' "$ENV_FILE" | cut -d= -f2)"
# Health means "answers a request that opens the database", not "serves a
# page". GET /login renders from the bundle alone: when a deploy shipped a
# build that could not load better-sqlite3, this loop said "beta is up" while
# every data route returned 500. A login POST with junk credentials has to
# reach the users table, so only a real 401 proves the database is readable.
echo "==> waiting for health on 127.0.0.1:${PORT}"
HEALTH_URL="http://127.0.0.1:${PORT}/api/auth/login"
for i in $(seq 1 45); do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$HEALTH_URL"     -H 'Content-Type: application/json'     -d '{"email":"deploy-health@example.invalid","password":"x"}' || true)"
  case "$CODE" in
    401|400)
      echo "==> $ENV_NAME is up: $(git rev-parse --short HEAD) (db reachable, health $CODE)"
      exit 0
      ;;
    500|502|503)
      # The server is answering but something behind it is broken — report the
      # reason instead of retrying until the timeout hides it.
      echo "!! $ENV_NAME answers $CODE on a database-backed route" >&2
      break
      ;;
  esac
  sleep 2
done

echo "!! $ENV_NAME did not become healthy in 90s" >&2
docker compose --env-file "$ENV_FILE" -p "$PROJECT" -f deploy/docker-compose.yml logs --tail 60 app >&2
exit 1
