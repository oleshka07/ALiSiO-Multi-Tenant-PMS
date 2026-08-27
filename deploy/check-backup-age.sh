#!/usr/bin/env bash
#
# Is the newest backup fresh — and did the off-site copy actually go out?
#
#   ./deploy/check-backup-age.sh prod
#
# Runs daily from cron (setup-backup-cron.sh). Threshold 30 hours: a daily
# backup that is 30h old has missed a run — caught within a day instead of
# discovered half a year later at the worst possible moment. "Бекап тихо
# зламався" is the highest-cost silent failure this project has.
#
# Two ages, two different failures:
#   newest local dump      the dump step itself stopped working
#   .offsite-<env> marker  dumps happen but never leave the machine —
#                          which is the state a disk failure turns into
#                          "every hotel's data is gone"
#
# Where the alert goes: Telegram, if TG_ALERT_BOT_TOKEN / TG_ALERT_CHAT_ID are
# set in the env file. Always also stderr + exit 1, so cron's own mail/log has
# it. Note the honest limit: an alert sent FROM this host cannot report a dead
# cron on this host — that is what BACKUP_PING_URL (dead-man switch) in
# backup.sh is for. Use both.
set -euo pipefail

ENV_NAME="${1:-}"
case "$ENV_NAME" in
  prod|beta) ;;
  *) echo "usage: $0 {prod|beta}" >&2; exit 2 ;;
esac

cd "$(dirname "$0")/.."
ENV_FILE="deploy/env.${ENV_NAME}"
MAX_AGE_H="${MAX_AGE_H:-30}"

val() { [ -f "$ENV_FILE" ] && grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '\r' || true; }

age_h() { # hours since file's mtime; empty if the file does not exist
  [ -e "$1" ] && echo $(( ( $(date +%s) - $(stat -c %Y "$1") ) / 3600 )) || true
}

PROBLEMS=()

NEWEST="$(ls -1t deploy/backups/alisio-${ENV_NAME}-*.sql.gz 2>/dev/null | head -1 || true)"
if [ -z "$NEWEST" ]; then
  PROBLEMS+=("немає ЖОДНОГО дампа $ENV_NAME у deploy/backups/")
else
  A="$(age_h "$NEWEST")"
  if [ "$A" -gt "$MAX_AGE_H" ]; then
    PROBLEMS+=("найсвіжіший дамп $ENV_NAME — ${A} год тому (поріг ${MAX_AGE_H}): розклад дампів не працює")
  else
    echo "==> дамп: $(basename "$NEWEST"), ${A} год тому — ок"
  fi
fi

MARKER="deploy/backups/.offsite-${ENV_NAME}"
A="$(age_h "$MARKER")"
if [ -z "$A" ]; then
  PROBLEMS+=("off-site копія $ENV_NAME не робилася ЖОДНОГО разу — диск цієї машини є єдиною копією даних готелів (docs/DEPLOY.md → «Бекапи поза сервером»)")
elif [ "$A" -gt "$MAX_AGE_H" ]; then
  PROBLEMS+=("остання off-site копія $ENV_NAME — ${A} год тому (поріг ${MAX_AGE_H}): заливка в сховище зламалась")
else
  echo "==> off-site: ${A} год тому — ок"
fi

[ ${#PROBLEMS[@]} -eq 0 ] && exit 0

MSG="⚠️ ALiSiO бекапи (${ENV_NAME}):"
for p in "${PROBLEMS[@]}"; do
  echo "!! $p" >&2
  MSG="${MSG}
• ${p}"
done

TOKEN="$(val TG_ALERT_BOT_TOKEN)"
CHAT="$(val TG_ALERT_CHAT_ID)"
if [ -n "$TOKEN" ] && [ -n "$CHAT" ]; then
  curl -fsS -m 10 "https://api.telegram.org/bot${TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${CHAT}" \
    --data-urlencode "text=${MSG}" >/dev/null \
    && echo "==> алерт надіслано в Telegram" \
    || echo "!! не вдалося надіслати Telegram-алерт" >&2
else
  echo "!! TG_ALERT_BOT_TOKEN/TG_ALERT_CHAT_ID не задані в $ENV_FILE — алерт лишився тільки в цьому лозі" >&2
fi

exit 1
