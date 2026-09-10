#!/usr/bin/env bash
#
# Скільки в живій базі перекриттів, які ЗАБОРОНИТЬ обмеження INC-045 — read-only.
#
#   ./deploy/check-overlaps.sh beta
#   ./deploy/check-overlaps.sh prod
#
# Питання, на яке відповідає: чи можна взагалі накотити
# `EXCLUDE USING gist (unit_id WITH =, daterange(check_in, check_out) WITH &&)`
# на цю базу. Обмеження перевіряє НАЯВНІ рядки при створенні, тож одна пара
# перекриття — і міграція падає на проді після того, як пройшла в CI на
# порожній базі. Це рівно той клас, заради якого існує репетиція на копії.
#
# Перекриття тут — не помилка даних, а овербукінг, який УЖЕ стався: дві живі
# броні на один номер хоч на одну ніч. Він може бути законним (готель знає і
# розселить), тому скрипт нічого не чистить: він друкує рядки, щоб рішення
# приймала людина.
#
# Умови — ТІ САМІ, що в майбутньому обмеженні, і це не збіг, а вимога:
# напівінтервал (`a.check_in < b.check_out AND b.check_in < a.check_out`),
# `unit_id IS NOT NULL` (бронь без номера не конфліктує ні з ким — смуга
# «Без номера» для броней із каналу), службовий фонд `is_pool` виключений
# (він тримає багато броней НАВМИСНО, `conflicts.repo.ts:35-42`), і статуси
# з `FREES_THE_ROOM` (`conflicts.repo.ts:24`) звільняють номер.
#
# `SET row_security = off` — обовʼязково: FORCE RLS діє і на власника, і без
# цього запит «згори» бачить порожнечу і друкує втішний нуль (AGENTS §7).
set -euo pipefail

ENV_NAME="${1:-}"
case "$ENV_NAME" in
  prod|beta) ;;
  *) echo "usage: $0 {prod|beta}" >&2; exit 2 ;;
esac

cd "$(dirname "$0")/.."
ENV_FILE="deploy/env.${ENV_NAME}"
PGC="alisio-${ENV_NAME}-postgres"
[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE — запускати на сервері" >&2; exit 1; }

val() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '\r' || true; }
PG_SUPERUSER="$(val PG_SUPERUSER)"; PG_SUPERUSER="${PG_SUPERUSER:-alisio_admin}"
PG_DATABASE="$(val PG_DATABASE)";   PG_DATABASE="${PG_DATABASE:-alisio}"

docker inspect "$PGC" >/dev/null 2>&1 || { echo "контейнера $PGC немає" >&2; exit 2; }
echo "==> перекриття броней у $ENV_NAME (read-only)"

docker exec -i "$PGC" psql -U "$PG_SUPERUSER" -d "$PG_DATABASE" -v ON_ERROR_STOP=1 <<'SQL'
SET row_security = off;

WITH pairs AS (
  SELECT a.id AS a_id, b.id AS b_id, a.unit_id,
         a.check_in AS a_in, a.check_out AS a_out, a.status AS a_status,
         b.check_in AS b_in, b.check_out AS b_out, b.status AS b_status,
         a.organization_id
    FROM reservations a
    JOIN reservations b
      ON b.unit_id = a.unit_id AND b.id > a.id
     AND a.check_in < b.check_out AND b.check_in < a.check_out
    JOIN units u ON u.id = a.unit_id
   WHERE a.unit_id IS NOT NULL
     AND COALESCE(u.is_pool, false) = false
     AND a.status NOT IN ('cancelled','no_show')
     AND b.status NOT IN ('cancelled','no_show')
)
SELECT count(*) AS "пар перекриття (нуль = обмеження стане без чистки)" FROM pairs;

WITH pairs AS (
  SELECT a.id AS a_id, b.id AS b_id, a.unit_id,
         a.check_in AS a_in, a.check_out AS a_out, a.status AS a_status,
         b.check_in AS b_in, b.check_out AS b_out, b.status AS b_status,
         a.organization_id
    FROM reservations a
    JOIN reservations b
      ON b.unit_id = a.unit_id AND b.id > a.id
     AND a.check_in < b.check_out AND b.check_in < a.check_out
    JOIN units u ON u.id = a.unit_id
   WHERE a.unit_id IS NOT NULL
     AND COALESCE(u.is_pool, false) = false
     AND a.status NOT IN ('cancelled','no_show')
     AND b.status NOT IN ('cancelled','no_show')
)
SELECT o.slug, u.name AS unit, p.a_id, p.a_in, p.a_out, p.a_status,
       p.b_id, p.b_in, p.b_out, p.b_status
  FROM pairs p
  JOIN units u ON u.id = p.unit_id
  JOIN organizations o ON o.id = p.organization_id
 ORDER BY o.slug, u.name, p.a_in
 LIMIT 50;

-- Другий бік того самого питання: скільки броней БЕЗ номера. Вони обмеженню
-- не заважають (умова `unit_id IS NOT NULL`), але це міра того, наскільки
-- смуга «Без номера» жива — якщо тут густо, її поведінку після обмеження
-- треба перевіряти окремо.
SELECT count(*) AS "броней без номера"
  FROM reservations
 WHERE unit_id IS NULL AND status NOT IN ('cancelled','no_show');
SQL
