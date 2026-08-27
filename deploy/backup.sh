#!/usr/bin/env bash
#
# The daily backup — on a schedule, off this machine.
#
#   ./deploy/backup.sh prod
#   ./deploy/backup.sh beta
#
# Installed into cron by deploy/setup-backup-cron.sh (which deploy.sh runs on
# every deploy), so nobody has to remember it. It exists because the deploy-time
# dump answered a different question than people thought it did:
#
#   - it fired on DEPLOYS, not on days. A week without a deploy was a week
#     without a backup; RPO was "however long since somebody last pushed".
#   - it kept 30 COPIES, not 30 days. Eight deploys in a busy day meant the
#     whole history was shorter than four days — damage noticed on Monday but
#     written on Thursday was already unrecoverable.
#   - it lived in deploy/backups/ on the same disk, same machine, same account
#     as the database it protects. Every scenario a backup exists for — disk
#     full (August 26 was exactly that), host failure, compromise, a wrong
#     rm — destroys the backup together with the original.
#
# So: one dump per DAY per environment, kept 30 DAYS locally, and copied to an
# object store OUTSIDE this provider. The deploy-time dump stays — it is the
# ten-minutes-ago restore point for a bad deploy, a different job.
#
# ── Off-site rules ──────────────────────────────────────────────────────────
# The remote credentials are WRITE-ONLY: the server may add files and may not
# read or delete them, so a compromised server cannot erase its own history.
# Consequences, both deliberate:
#   - retention in the store is done by the STORE (lifecycle rules + object
#     versioning), never by this script;
#   - rclone runs with --no-check-dest --s3-no-head: a pure PUT, nothing that
#     needs read permission.
# Setup of the bucket, the key and the lifecycle is a one-time human step —
# docs/DEPLOY.md → «Бекапи поза сервером».
#
# Off-site not configured is a LOUD state, not an error: the local dump is
# still taken (better than nothing), the message says what is missing, and
# check-backup-age.sh starts alerting once the marker is 30h old. Silent
# success without an upload is exactly the failure this file exists to end.
set -euo pipefail

ENV_NAME="${1:-}"
case "$ENV_NAME" in
  prod|beta) ;;
  *) echo "usage: $0 {prod|beta}" >&2; exit 2 ;;
esac

cd "$(dirname "$0")/.."
ENV_FILE="deploy/env.${ENV_NAME}"
[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE" >&2; exit 1; }

val() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '\r'; }

DB_DRIVER_NOW="$(val DB_DRIVER)"
if [ "$DB_DRIVER_NOW" != "postgres" ]; then
  echo "==> $ENV_NAME is not on Postgres (DB_DRIVER='$DB_DRIVER_NOW') — nothing to dump" >&2
  exit 1
fi

PG_CONTAINER="alisio-${ENV_NAME}-postgres"
PG_SUPERUSER="$(val PG_SUPERUSER)"; PG_SUPERUSER="${PG_SUPERUSER:-alisio_admin}"
PG_DATABASE="$(val PG_DATABASE)";   PG_DATABASE="${PG_DATABASE:-alisio}"

docker inspect "$PG_CONTAINER" >/dev/null 2>&1 \
  || { echo "no postgres container ($PG_CONTAINER)" >&2; exit 1; }

mkdir -p deploy/backups

# One file per day, named by the day: a re-run overwrites today's file instead
# of multiplying it, and `find -mtime` can do retention by AGE.
DAY="$(date +%F)"
DUMP="deploy/backups/alisio-${ENV_NAME}-daily-${DAY}.sql.gz"

echo "==> $ENV_NAME: dumping ${PG_DATABASE} -> $DUMP"
docker exec -i "$PG_CONTAINER" pg_dump -U "$PG_SUPERUSER" -d "$PG_DATABASE" \
  | gzip > "$DUMP"
[ -s "$DUMP" ] || { echo "!! dump came out empty — refusing to continue" >&2; rm -f "$DUMP"; exit 1; }
echo "    $(du -h "$DUMP" | cut -f1)"

# Local retention: 30 DAYS, not 30 files.
find deploy/backups -maxdepth 1 -name "alisio-${ENV_NAME}-daily-*.sql.gz" -mtime +30 -delete

# ── Off-site ────────────────────────────────────────────────────────────────
BACKUP_REMOTE="$(val BACKUP_REMOTE)"
if [ -z "$BACKUP_REMOTE" ] || [ ! -f deploy/rclone.conf ]; then
  echo "!! off-site НЕ налаштовано: локальний дамп є, копії поза сервером НЕМАЄ." >&2
  echo "!! Потрібні deploy/rclone.conf і BACKUP_REMOTE у $ENV_FILE —" >&2
  echo "!! docs/DEPLOY.md → «Бекапи поза сервером». Диск цієї машини — єдина копія." >&2
  exit 0
fi

echo "==> uploading to ${BACKUP_REMOTE}/${ENV_NAME}/"
# rclone from its official image: nothing new to install on the host. The
# config is mounted read-only; the backups dir too — upload needs no writes.
docker run --rm \
  -v "$(pwd)/deploy/backups:/data:ro" \
  -v "$(pwd)/deploy/rclone.conf:/config/rclone/rclone.conf:ro" \
  rclone/rclone copyto --retries 3 --no-check-dest --s3-no-head \
  "/data/$(basename "$DUMP")" \
  "${BACKUP_REMOTE}/${ENV_NAME}/$(basename "$DUMP")"

# The marker is the metric: check-backup-age.sh and status.sh read this file's
# mtime as "when did an off-site copy last succeed".
date -u +%FT%TZ > "deploy/backups/.offsite-${ENV_NAME}"
echo "==> off-site ok"

# Dead-man switch (optional, recommended): ping an external monitor that
# alerts when the ping STOPS coming. Unlike any alert sent from this host, it
# also catches "cron itself is dead" — a dead cron cannot report itself.
BACKUP_PING_URL="$(val BACKUP_PING_URL)"
if [ -n "$BACKUP_PING_URL" ]; then
  curl -fsS -m 10 --retry 3 "$BACKUP_PING_URL" >/dev/null 2>&1 \
    && echo "==> ping ok" \
    || echo "!! ping failed (бекап при цьому успішний)" >&2
fi
