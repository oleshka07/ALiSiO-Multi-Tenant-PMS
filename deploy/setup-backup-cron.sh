#!/usr/bin/env bash
#
# Put the backup schedule into cron — idempotently, from the deploy itself.
#
#   ./deploy/setup-backup-cron.sh prod
#   ./deploy/setup-backup-cron.sh beta
#
# Called by deploy.sh after a healthy start, so the schedule exists because
# the environment exists — not because somebody remembered to type crontab on
# the server. The operator does not work in the server's terminal; a scheduled
# job nobody installed protects nobody.
#
# Idempotent by marker: every line this script owns ends with
# "# alisio-backup-<env>". A re-run replaces exactly those lines and touches
# nothing else in the crontab — other projects on this shared machine keep
# their entries.
#
# What it schedules (server-local time):
#   03:10 / 03:40   daily dump + off-site upload     backup.sh prod / beta
#   09:00           freshness check + alert          check-backup-age.sh
#   04:15 Sunday    restore the newest dump, prove   restore-test.sh prod
#                   it works, print the RTO
# Night hours on purpose: pg_dump takes its snapshot without blocking writes,
# but it still reads the whole database, and 03:00 is when no reception works.
set -euo pipefail

ENV_NAME="${1:-}"
case "$ENV_NAME" in
  prod|beta) ;;
  *) echo "usage: $0 {prod|beta}" >&2; exit 2 ;;
esac

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MARK="# alisio-backup-${ENV_NAME}"
LOG="${ROOT}/deploy/backups/backup.log"

case "$ENV_NAME" in
  prod) DUMP_AT="10 3 * * *" ;;
  beta) DUMP_AT="40 3 * * *" ;;
esac

WANT="$(cat <<LINES
${DUMP_AT} cd ${ROOT} && ./deploy/backup.sh ${ENV_NAME} >> ${LOG} 2>&1 ${MARK}
0 9 * * * cd ${ROOT} && ./deploy/check-backup-age.sh ${ENV_NAME} >> ${LOG} 2>&1 ${MARK}
LINES
)"
# The weekly restore drill runs once, against prod's dumps — beta's data is
# demo seed and proves nothing about a customer's recoverability.
if [ "$ENV_NAME" = "prod" ]; then
  WANT="${WANT}
15 4 * * 0 cd ${ROOT} && ./deploy/restore-test.sh prod >> ${LOG} 2>&1 ${MARK}"
fi

CURRENT="$(crontab -l 2>/dev/null || true)"
KEPT="$(printf '%s\n' "$CURRENT" | grep -vF "$MARK" || true)"
NEW="$(printf '%s\n%s\n' "$KEPT" "$WANT" | sed '/^$/d')"

if [ "$NEW" = "$(printf '%s\n' "$CURRENT" | sed '/^$/d')" ]; then
  echo "==> backup cron ($ENV_NAME): already in place"
  exit 0
fi

printf '%s\n' "$NEW" | crontab -
echo "==> backup cron ($ENV_NAME): installed"
printf '%s\n' "$WANT" | sed 's/^/    /'
