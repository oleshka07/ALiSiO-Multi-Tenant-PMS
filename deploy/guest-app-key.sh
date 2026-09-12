#!/usr/bin/env bash
#
# Ключ гостьового застосунку — адреса, куди веде QR на склі.
#
#   ./deploy/guest-app-key.sh beta            # що є: обʼєкти і їхні адреси
#   ./deploy/guest-app-key.sh beta <slug|id>  # видати ключ цьому обʼєкту
#   ./deploy/guest-app-key.sh beta <slug|id> --rotate
#
# ГОЛОВНИЙ шлях — екран «Застосунки» в адмінці: там орендар приходить із
# сесії, і видача ключа це кнопка на картці. Цей скрипт — запасний, для
# оператора біля сервера, коли до адмінки не дістатись.
#
# ── Чому тут psql суперкористувача, а не `node` у контейнері ─────────────
#
# Перша редакція кликала `node scripts/issue-guest-app-key.mjs`, і той читав
# `properties` сам. Це не працювало: у контейнері застосунок ходить у базу
# роллю `alisio_app`, а на Postgres читання тенантної таблиці без орендаря
# віддає НУЛЬ РЯДКІВ — мовчки. Оператор бачив порожній перелік і робив
# висновок, що застосунків немає (AGENTS §7).
#
# Тому читання й запис — тим самим способом, що в `list-tenants.sh`:
# суперкористувач із `SET row_security = off`. Від `node` лишився рівно
# вигляд ключа (`--new`): алфавіт і довжина живуть в одному місці.
set -euo pipefail

ENV_NAME="${1:-}"
case "$ENV_NAME" in
  prod|beta) ;;
  *) echo "usage: $0 {prod|beta} [<slug|id>] [--rotate]" >&2; exit 2 ;;
esac
shift

cd "$(dirname "$0")/.."
ENV_FILE="deploy/env.${ENV_NAME}"
APPC="alisio-${ENV_NAME}-app"
PGC="alisio-${ENV_NAME}-postgres"
[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE — запускати на сервері" >&2; exit 1; }
docker inspect "$PGC" >/dev/null 2>&1 || { echo "контейнера $PGC немає" >&2; exit 2; }

val() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '\r' || true; }
PG_SUPERUSER="$(val PG_SUPERUSER)"; PG_SUPERUSER="${PG_SUPERUSER:-alisio_admin}"
PG_DATABASE="$(val PG_DATABASE)";   PG_DATABASE="${PG_DATABASE:-alisio}"
BASE_URL="$(val APP_BASE_URL)"
[ -n "$BASE_URL" ] || BASE_URL="https://${ENV_NAME}.alisio.rozum.one"

echo "==> guest-app-key: $ENV_NAME"

psql_q() { docker exec -i "$PGC" psql -U "$PG_SUPERUSER" -d "$PG_DATABASE" -v ON_ERROR_STOP=1 -t -A -F '|' "$@"; }

# Без обʼєкта — перелік. Саме перелік, а не відмова: найчастіше питання тут
# «а яка адреса в цього готелю», і відповідь не має вимагати згадувати slug.
if [ $# -eq 0 ]; then
  echo
  psql_q -c "SET row_security = off" -c "
    SELECT o.name, p.name, p.slug, p.id, COALESCE(p.guest_app_key, ''),
           COALESCE((SELECT CASE WHEN f.enabled THEN 'on' ELSE 'off' END
                       FROM organization_features f
                      WHERE f.organization_id = o.id AND f.feature = 'guest_app'), 'off')
      FROM properties p JOIN organizations o ON o.id = p.organization_id
     ORDER BY o.name, p.name" \
  | while IFS='|' read -r org prop slug pid key feat; do
      [ -n "${prop:-}" ] || continue
      echo "  $org / $prop"
      echo "    slug: $slug    id: $pid"
      if [ -n "$key" ]; then echo "    ${BASE_URL}/stay/${key}"; else echo "    — ключа немає"; fi
      # Вимкнений застосунок віддає 404 навіть із виписаним ключем — тому
      # стан вимикача стоїть поруч з адресою, а не десь на іншому екрані.
      [ "$feat" = "on" ] || echo "    ! застосунок вимкнено — сторінка відповідає 404"
      echo
    done
  echo "Видати ключ:  $0 $ENV_NAME <slug|id>"
  exit 0
fi

TARGET="$1"; shift
ROTATE=""
if [ "${1:-}" = "--rotate" ]; then ROTATE="1"; fi

# Обʼєкт шукається за slug АБО id, і рівно один. Порожньо — відмова, а не
# «візьму перший»: перший-ліпший тут означав би наліпку на чужих дверях.
FOUND="$(psql_q -c "SET row_security = off" -c "
  SELECT p.id, p.organization_id, COALESCE(p.guest_app_key, '')
    FROM properties p
   WHERE p.slug = '${TARGET//\'/\'\'}' OR p.id = '${TARGET//\'/\'\'}'" | head -1 || true)"
[ -n "$FOUND" ] || { echo "Обʼєкта «$TARGET» немає. Подивитись усі: $0 $ENV_NAME" >&2; exit 1; }
PROP_ID="${FOUND%%|*}"; REST="${FOUND#*|}"; ORG_ID="${REST%%|*}"; OLD_KEY="${REST#*|}"

if [ -n "$OLD_KEY" ] && [ -z "$ROTATE" ]; then
  echo "У обʼєкта вже є ключ:"
  echo "  ${BASE_URL}/stay/${OLD_KEY}"
  echo
  echo "Замінити (і зробити всі надруковані QR непрацюючими): $0 $ENV_NAME $TARGET --rotate"
  exit 0
fi

# Підтвердження лише на заміну: видача ключа обʼєкту, який його не має,
# нічого не ламає, а заміна вбиває надруковані наліпки. Набрати треба саме
# slug — Enter не досить, бо команди, вставлені блоком, відповіли б самі за
# себе (той самий довід, що в apply-db-limits.sh).
if [ -n "$ROTATE" ]; then
  echo "УВАГА: заміна ключа зробить УСІ надруковані QR цього обʼєкта непрацюючими."
  printf 'Наберіть «%s», щоб підтвердити: ' "$TARGET"
  read -r CONFIRM
  [ "$CONFIRM" = "$TARGET" ] || { echo "не підтверджено — нічого не змінено"; exit 1; }
fi

# Вигляд ключа — з коду застосунку, щоб алфавіт і довжина жили в одному місці.
NEW_KEY="$(docker exec "$APPC" node scripts/issue-guest-app-key.mjs --new | tr -d '\r\n')"
[ -n "$NEW_KEY" ] || { echo "не вдалося згенерувати ключ" >&2; exit 1; }

psql_q -c "SET row_security = off" \
       -c "UPDATE properties SET guest_app_key = '${NEW_KEY}' WHERE id = '${PROP_ID//\'/\'\'}'" >/dev/null

# Читаємо НАЗАД окремим запитом: `UPDATE` без помилки не доводить, що рядок
# змінився.
BACK="$(psql_q -c "SET row_security = off" -c "SELECT COALESCE(guest_app_key,'') FROM properties WHERE id = '${PROP_ID//\'/\'\'}'" | head -1)"
[ "$BACK" = "$NEW_KEY" ] || { echo "ключ не записався — рядок лишився без змін" >&2; exit 1; }

echo "${TARGET}${ROTATE:+ — ключ замінено}"
echo "  ${BASE_URL}/stay/${NEW_KEY}"

# Вимикач: без нього сторінка відповідає 404 навіть із ключем.
FEAT="$(psql_q -c "SET row_security = off" -c "
  SELECT COALESCE((SELECT CASE WHEN enabled THEN 'on' ELSE 'off' END
                     FROM organization_features
                    WHERE organization_id = '${ORG_ID//\'/\'\'}' AND feature = 'guest_app'), 'off')" | head -1)"
[ "$FEAT" = "on" ] || {
  echo
  echo "! Застосунок «Гостьовий застосунок» ВИМКНЕНО для цього рахунку —"
  echo "  сторінка відповідатиме 404. Увімкнути: адмінка → Налаштування → Застосунки."
}
