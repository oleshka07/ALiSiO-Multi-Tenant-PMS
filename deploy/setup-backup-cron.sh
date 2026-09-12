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

# GDPR-ретенція. Вона існувала в коді відколи є гостьова реєстрація, але її
# не запускало НІЩО: два маршрути чекали виклику, якого ніхто не робив
# (INC-009). Ретенція, яку ніхто не смикає, — це не «поки що не налаштовано»,
# це зберігання персональних даних без строку. Тому розклад ставиться там
# само, де бекапи: тому що середовище живе, а не тому, що хтось згадав.
#
# 04:40 — після нічного дампа (03:40/04:10 нижче): якщо знеособлення піде не
# так, у бекапі є вчорашній стан. Раз на добу, не частіше: вікно ретенції
# міряється роками, зайві прогони нічого не змінюють.
# Стрічка бронювань з менеджера каналів. Кожні пʼять хвилин, і це не
# перестраховка: гість, який щойно забронював на Booking.com, стоїть у
# номері, якого готель ще не бачить. Вебхук у цій інтеграції — лише стук у
# двері; дані читаються зі стрічки, і саме крон робить пропущений вебхук
# несуттєвим.
#
# Порожній прохід коштує один GET на готель із модулем каналів — рядок у
# `cm_connections` з `is_enabled`. Готель без модуля не опитується взагалі:
# розкладка «пропущено / зламано / порожньо» в `pullAllConnections()`.
#
# Розсилка наявності й цін (`channels-publish`) — щохвилини: вендор просить
# збирати зміни пачками по 30–60 с і після помилки не чіпати обʼєкт хвилину;
# крон раз на хвилину і є та пауза (обмежувач один на процес, ключ —
# зʼєднання). Застрягле крон доповідає, але не червоніє — це екран оператора.
#
# Ставиться тут, поруч із бекапами, з тієї ж причини, що й ретенція: розклад
# має братися з того, що середовище живе, а не з того, що хтось згадав. Крон,
# який ніхто не смикає, — це не «поки не налаштовано», це готель, який тиждень
# не бачить своїх броней.
WANT="$(cat <<LINES
${DUMP_AT} cd ${ROOT} && ./deploy/backup.sh ${ENV_NAME} >> ${LOG} 2>&1 ${MARK}
0 9 * * * cd ${ROOT} && ./deploy/check-backup-age.sh ${ENV_NAME} >> ${LOG} 2>&1 ${MARK}
40 4 * * * cd ${ROOT} && ./deploy/run-cron.sh ${ENV_NAME} /api/cron/gdpr-retention >> ${LOG} 2>&1 ${MARK}
0 7 * * * cd ${ROOT} && ./deploy/run-cron.sh ${ENV_NAME} /api/cron/kiosk-day >> ${LOG} 2>&1 ${MARK}
*/5 * * * * cd ${ROOT} && ./deploy/run-cron.sh ${ENV_NAME} /api/cron/guest-app-holds >> ${LOG} 2>&1 ${MARK}
*/5 * * * * cd ${ROOT} && ./deploy/run-cron.sh ${ENV_NAME} /api/cron/channels-pull >> ${LOG} 2>&1 ${MARK}
* * * * * cd ${ROOT} && ./deploy/run-cron.sh ${ENV_NAME} /api/cron/channels-publish >> ${LOG} 2>&1 ${MARK}
LINES
)"
# The weekly restore drill runs once, against prod's dumps — beta's data is
# demo seed and proves nothing about a customer's recoverability. The disk
# check is also installed once, from prod: the disk is one per host, and two
# per-env alerts would just repeat each other.
if [ "$ENV_NAME" = "prod" ]; then
  WANT="${WANT}
15 4 * * 0 cd ${ROOT} && ./deploy/restore-test.sh prod >> ${LOG} 2>&1 ${MARK}
30 * * * * cd ${ROOT} && ./deploy/check-disk.sh >> ${LOG} 2>&1 ${MARK}"
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
