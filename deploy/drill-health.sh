#!/usr/bin/env bash
#
# Репетиція відмови бази для /api/health — інструмент ОПЕРАТОРА, не сесії.
#
#   ./deploy/drill-health.sh beta
#   ./deploy/drill-health.sh prod    # спитає підтвердження: він зупиняє базу
#
# «/api/health віддає 503, коли база лежить» — твердження, яке ніхто не
# перевіряв з моменту написання маршруту. Цей скрипт перетворює його на
# запускну репетицію: зупинити postgres середовища, спитати health (чекаємо
# 503), запустити назад, дочекатися відновлення (чекаємо 200). База лежить
# рівно стільки, скільки їй треба на stop+start — зазвичай 10–20 секунд.
#
# Це єдиний скрипт у deploy/, який СВІДОМО зупиняє сервіс. Тому:
#   - на проді він вимагає Enter після попередження;
#   - із сесії агента він не запускається взагалі — це кнопка людини
#     (AGENTS §5: разові команди на сервер не диктуються, скрипти — так,
#     але цей ще й зупиняє базу, тож рішення про момент — за оператором).
set -euo pipefail

ENV_NAME="${1:-}"
case "$ENV_NAME" in
  prod|beta) ;;
  *) echo "usage: $0 {prod|beta}" >&2; exit 2 ;;
esac

cd "$(dirname "$0")/.."
ENV_FILE="deploy/env.${ENV_NAME}"
[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE — запускати на сервері" >&2; exit 1; }

PORT="$(grep -E '^APP_PORT=' "$ENV_FILE" | head -1 | cut -d= -f2 | tr -d '\r' || true)"
[ -n "$PORT" ] || { echo "в $ENV_FILE немає APP_PORT — не знаю, де питати /api/health" >&2; exit 1; }
PGC="alisio-${ENV_NAME}-postgres"
URL="http://127.0.0.1:${PORT}/api/health"

docker inspect "$PGC" >/dev/null 2>&1 || { echo "контейнера $PGC немає — це сервер?" >&2; exit 2; }

health() { curl -s -o /dev/null -w '%{http_code}' -m 10 "$URL" || echo 000; }

BEFORE="$(health)"
echo "==> drill ($ENV_NAME): /api/health до зупинки → ${BEFORE}"
if [ "$BEFORE" != 200 ]; then
  echo "!! health вже не 200 — спершу зрозумійте це, репетиція відкладається" >&2
  exit 1
fi

if [ "$ENV_NAME" = prod ]; then
  echo "!! Це ПРОД: база зупиниться на ~10–20 секунд, запити в цей час"
  echo "!! отримають помилки. Enter — продовжити, Ctrl-C — відмовитись."
  read -r
fi

echo "==> зупиняю $PGC"
docker stop "$PGC" >/dev/null
DOWN="$(health)"
echo "    /api/health без бази → ${DOWN} (чекали 503)"

echo "==> запускаю $PGC назад"
docker start "$PGC" >/dev/null
UP=000
for i in $(seq 1 30); do
  UP="$(health)"
  [ "$UP" = 200 ] && break
  sleep 2
done
echo "    /api/health після старту → ${UP} (чекали 200)"

if [ "$DOWN" = 503 ] && [ "$UP" = 200 ]; then
  echo "==> drill ($ENV_NAME): health чесний — падіння видно, відновлення видно"
  exit 0
fi
echo "!! drill ($ENV_NAME): чекали 503→200, отримали ${DOWN}→${UP} — або health бреше, або база не піднялася: ./deploy/logs.sh $ENV_NAME" >&2
exit 1
