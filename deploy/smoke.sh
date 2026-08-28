#!/usr/bin/env bash
#
# Дим по живому середовищу — машинна версія «перевірити на беті».
#
#   ./deploy/smoke.sh beta
#   ./deploy/smoke.sh prod
#
# Викликається з deploy.sh ПІСЛЯ health-check, і його провал — провал
# деплою. Health-check відповідає на «чи піднявся контейнер і чи читається
# база»; цей скрипт — на «чи середовище відповідає ГОСТЮ і ОПЕРАТОРУ так,
# як має»: чотири запити, кожен ловить свій клас поломки.
#
#   /api/health → 200        база читається БЕЗ орендаря (маршрут монітора);
#                            503 тут — політика або зʼєднання, не бандл
#   логін зі сміттям → 401   запит доходить до users; 500 тут — той клас,
#                            що колись поклав /api/units на невідомий час
#   /            → 2xx/3xx   публічна поверхня (те, що бачить гість)
#   /app/login   → 200       операторський бандл серветься
#
# База запитів — APP_URL із deploy/env.<env>: через nginx і сертифікат,
# тобто тим самим шляхом, яким ходять люди. Якщо APP_URL порожній або
# лишився example-заглушкою — йдемо на 127.0.0.1:APP_PORT повз nginx і
# кажемо про це вголос: слабший смоук краще за жодного, але мовчати про
# слабкість не можна.
set -euo pipefail

ENV_NAME="${1:-}"
case "$ENV_NAME" in
  prod|beta) ;;
  *) echo "usage: $0 {prod|beta}" >&2; exit 2 ;;
esac

cd "$(dirname "$0")/.."
ENV_FILE="deploy/env.${ENV_NAME}"
[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE — запускати на сервері" >&2; exit 1; }

val() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '\r'; }

BASE="$(val APP_URL)"
case "$BASE" in
  ""|*example.com*)
    PORT="$(val APP_PORT)"
    BASE="http://127.0.0.1:${PORT}"
    echo "==> smoke ($ENV_NAME): APP_URL не задано — йду повз nginx на ${BASE}"
    ;;
  *)
    BASE="${BASE%/}"
    echo "==> smoke ($ENV_NAME): ${BASE}"
    ;;
esac

FAIL=0
probe() { # назва очікувані_коди метод шлях [json-тіло]
  local name="$1" want="$2" method="$3" path="$4" json="${5:-}"
  local args=(-s -o /dev/null -w '%{http_code}' -m 15 -X "$method")
  if [ -n "$json" ]; then
    args+=(-H 'Content-Type: application/json' -d "$json")
  fi
  local code
  code="$(curl "${args[@]}" "${BASE}${path}" || echo 000)"
  case " $want " in
    *" $code "*) printf '    ok   %-32s → %s\n' "$name" "$code" ;;
    *)
      printf '    !!   %-32s → %s (чекали: %s)\n' "$name" "$code" "$want"
      FAIL=1
      ;;
  esac
}

probe "/api/health (база без орендаря)" "200"                 GET  /api/health
probe "логін зі сміттям (шлях до users)" "401 400"            POST /api/auth/login '{"email":"smoke@example.invalid","password":"x"}'
probe "публічна головна"                 "200 301 302 307 308" GET  /
probe "/app/login (операторський бандл)" "200"                GET  /app/login

if [ "$FAIL" = 1 ]; then
  echo "!! smoke ($ENV_NAME): середовище відповідає неправильно — деплой вважається провальним" >&2
  echo "!! логи: ./deploy/logs.sh $ENV_NAME" >&2
  exit 1
fi
echo "==> smoke ($ENV_NAME): усі чотири відповіді правильні"
