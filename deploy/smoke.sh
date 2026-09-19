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
# як має»: пʼять запитів, кожен ловить свій клас поломки.
#
#   /api/health → 200        база читається БЕЗ орендаря (маршрут монітора);
#                            503 тут — політика або зʼєднання, не бандл
#   логін зі сміттям → 401   запит доходить до users; 500 тут — той клас,
#                            що колись поклав /api/units на невідомий час
#   /            → 2xx/3xx   публічна поверхня (те, що бачить гість)
#   /app/login   → 200       операторський бандл серветься
#   знімок 30 МБ → 401       тіло понад серверні 25m доходить до застосунку:
#                            413 тут — шаблон nginx не застосований
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

val() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '\r' || true; }

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

# ── Стеля тіла на шляху знімків Winhotel ────────────────────────────────────
#
# Єдине місце, де стелю nginx видно ЗЗОВНІ, і єдине, яке бігає на КОЖНОМУ
# деплої. Гейта в CI для неї бути не може: у CI немає ні nginx, ні сервера.
#
# 18.09.2026 виявилось, що `location = /api/apps/winhotel-import/snapshots`
# з `client_max_body_size 200m` не діяв у жодному середовищі й ніколи не діяв:
# deploy/add-site.sh клав шаблон і сам же затирав його тимчасовим конфігом, у
# якому цього блоку немає. Агент готелю отримував 413 від nginx, і жоден гейт
# цього не бачив — конфіг сервера не лежить у репозиторії.
#
# ЧОМУ 30 МБ, а не «трохи більше за 10». Серверний блок має власні 25m, тож
# тіло на 11 МБ пройшло б і БЕЗ блоку на 200m — тобто перевірка була б зеленою
# і тоді, коли стверджувати нічого (AGENTS §26: фікстура, вироджена по осі,
# про яку твердження стверджує). 30 МБ більші за 25m і менші за 200m, тож
# відповідь розрізняє два стани, а не один.
#
#   401  доїхало до застосунку і відмовлено ПО ПРАВУ — так і має бути;
#   413  ріже nginx: шаблон не застосований (або location не той порт);
#   000  зʼєднання обірвалось — дивіться логи, це не «просто велике тіло».
#
# Токен завідомо невірний, і порядок відмов у хендлері — до першого байта на
# диску: 401 віддається ДО читання тіла, тож нічого не зберігається і жодного
# рядка в базі не зʼявляється.
#
# Чого ця перевірка НЕ доводить: стелі буфера middleware в Next (10 МБ). Вона
# і не може — маршрут відмовляє по токену раніше, ніж читає тіло, тож 401
# однаковий і з обрізаним тілом, і з цілим. Ту вісь тримає
# scripts/check-body-limits.mjs, статикою.
SNAPSHOT_PATH="/api/apps/winhotel-import/snapshots"
BIG="$(mktemp)"
trap 'rm -f "$BIG"' EXIT
head -c 31457280 /dev/zero > "$BIG"   # 30 МіБ
BIG_CODE="$(curl -s -o /dev/null -w '%{http_code}' -m 120 -X POST \
  -H 'Authorization: Bearer smoke-invalid.smoke-invalid' \
  -H 'Content-Type: application/gzip' \
  -H 'X-Winhotel-Mode: backup' \
  -H 'X-Winhotel-Sha256: 0000000000000000000000000000000000000000000000000000000000000000' \
  --data-binary "@${BIG}" "${BASE}${SNAPSHOT_PATH}" || echo 000)"
rm -f "$BIG"
trap - EXIT

case "$BASE" in
  http://127.0.0.1:*)
    # Повз nginx стелю nginx не виміряти. Слабший смоук краще за жодного, але
    # мовчати про слабкість не можна — це той самий клас, що й сам дефект.
    printf '    ~    %-32s → %s (повз nginx: стеля nginx НЕ перевірена)\n' "знімок 30 МБ" "$BIG_CODE"
    ;;
  *)
    case "$BIG_CODE" in
      401) printf '    ok   %-32s → 401 (доїхало, відмовлено по праву)\n' "знімок 30 МБ через nginx" ;;
      413)
        printf '    !!   %-32s → 413 — nginx ріже тіло\n' "знімок 30 МБ через nginx"
        echo "         шаблон deploy/nginx/alisio.conf не застосований до ${BASE}:" >&2
        echo "         блок location = ${SNAPSHOT_PATH} з client_max_body_size 200m відсутній" >&2
        FAIL=1
        ;;
      *)
        printf '    !!   %-32s → %s (чекали: 401)\n' "знімок 30 МБ через nginx" "$BIG_CODE"
        FAIL=1
        ;;
    esac
    ;;
esac

if [ "$FAIL" = 1 ]; then
  echo "!! smoke ($ENV_NAME): середовище відповідає неправильно — деплой вважається провальним" >&2
  echo "!! логи: ./deploy/logs.sh $ENV_NAME" >&2
  exit 1
fi
echo "==> smoke ($ENV_NAME): усі пʼять відповідей правильні"
