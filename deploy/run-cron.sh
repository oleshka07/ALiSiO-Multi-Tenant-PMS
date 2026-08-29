#!/usr/bin/env bash
#
# Запустити плановану роботу застосунку і ГУЧНО сказати, чим вона скінчилась.
#
#   ./deploy/run-cron.sh beta /api/cron/gdpr-retention
#   ./deploy/run-cron.sh prod /api/cron/gdpr-retention
#
# Навіщо окремий скрипт, а не рядок curl у crontab. Дві причини, обидві з
# уже пережитого:
#
#   1. Секрет. Крони застосунку доводять, що вони крони, заголовком
#      `X-Cron-Secret` (див. src/core/security/cron-auth.ts). Тримати його
#      в crontab означає тримати секрет у `crontab -l` кожного, хто має
#      доступ; тут він читається з deploy/env.<env>, як і решта.
#   2. Тиша. `curl … >> log` вважає роботою будь-яку відповідь: 401, 503,
#      HTML сторінки помилки. А GDPR-ретенція саме так і провалювалась —
#      відповідала «success: true, 0 знеособлено» на кожен виклик (INC-009).
#      Тому цей скрипт дивиться не лише на HTTP-код, а й у ТІЛО відповіді:
#      `"success":false` або будь-який ненульовий `failedOrganizations` —
#      це вихід 1 і рядок у логу, який видно в `deploy/backups/backup.log`.
#
# Ходить на 127.0.0.1:APP_PORT — повз nginx навмисно: планована робота не
# має залежати від сертифіката й від того, чи дивиться назовні домен.
set -euo pipefail

ENV_NAME="${1:-}"
CRON_PATH="${2:-}"
case "$ENV_NAME" in
  prod|beta) ;;
  *) echo "usage: $0 {prod|beta} /api/cron/<name>" >&2; exit 2 ;;
esac
case "$CRON_PATH" in
  /api/*) ;;
  *) echo "usage: $0 {prod|beta} /api/cron/<name>" >&2; exit 2 ;;
esac

cd "$(dirname "$0")/.."
ENV_FILE="deploy/env.${ENV_NAME}"
[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE — запускати на сервері" >&2; exit 1; }

val() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '\r' || true; }
PORT="$(val APP_PORT)"
SECRET="$(val CRON_SECRET)"

STAMP="$(date '+%Y-%m-%d %H:%M:%S')"
say() { echo "[$STAMP] cron ${ENV_NAME} ${CRON_PATH}: $*"; }

[ -n "$PORT" ] || { say "у $ENV_FILE немає APP_PORT — не знаю, куди стукати"; exit 1; }
# Порожній секрет — це не «без пароля», це непрацездатний крон: застосунок
# відповість 503 (cron-auth: unset означає відмову, не дозвіл). Кажемо про це
# прямо, а не після години читання логів.
[ -n "$SECRET" ] || { say "CRON_SECRET у $ENV_FILE порожній — застосунок відмовить 503. Заповніть і повторіть"; exit 1; }

BODY_FILE="$(mktemp)"
trap 'rm -f "$BODY_FILE"' EXIT
CODE="$(curl -sS -o "$BODY_FILE" -w '%{http_code}' -m 300 \
  -H "X-Cron-Secret: ${SECRET}" \
  "http://127.0.0.1:${PORT}${CRON_PATH}" || echo 000)"
BODY="$(tr -d '\n' < "$BODY_FILE" | cut -c1-500)"

if [ "$CODE" != "200" ]; then
  say "HTTP ${CODE} — ${BODY:-порожня відповідь}"
  exit 1
fi

# Тіло важливіше за код: саме тут ховався мовчазний нуль.
FAILED="$(printf '%s' "$BODY" | grep -oE '"failedOrganizations"[[:space:]]*:[[:space:]]*[0-9]+' | grep -oE '[0-9]+$' || true)"
if printf '%s' "$BODY" | grep -q '"success"[[:space:]]*:[[:space:]]*false'; then
  say "відповідь каже success:false — ${BODY}"
  exit 1
fi
if [ -n "$FAILED" ] && [ "$FAILED" != "0" ]; then
  say "${FAILED} орендар(ів) не оброблено — ${BODY}"
  exit 1
fi

say "ok — ${BODY}"
