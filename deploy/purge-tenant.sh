#!/usr/bin/env bash
#
# Повне знесення одного орендаря з бази середовища — свідомо і з доказом.
#
#   ./deploy/purge-tenant.sh beta <org-slug>
#   ./deploy/purge-tenant.sh prod <org-slug>   # після ок на беті
#
# Навіщо. Тестові організації (спадок першого клієнта) мають зникнути з
# прод і бети цілком: «жодного рядка з organization_id старого орендаря».
# Видалити організацію з екрана не можна — екран знає лише свій модуль, а
# орендар живе у ~60 таблицях напряму і ще в ~40 через FK.
#
# Як влаштовано:
#   1. показує, ЩО видалить: назву організації і кількість рядків у головних
#      таблицях — рішення ухвалюється на цифрах, не на слові «старий»;
#   2. вимагає НАБРАТИ slug (вставлений блок команд не підтвердить сам себе
#      — та сама наука, що в apply-db-limits.sh, INC-007);
#   3. знімає дамп — точка повернення, якщо видалили не те;
#   4. видаляє В ОДНІЙ ТРАНЗАКЦІЇ: спершу два ребра без каскаду
#      (platform_sessions.acting_organization_id → NULL; cart_events через
#      reservations; booking_service_orders через booking_sites), далі
#      проходи по ВСІХ таблицях з organization_id (список береться з
#      information_schema на місці, а не тримається в голові — нова таблиця
#      з інваріанта §3.2 потрапляє під ніж автоматично), FK-порядок
#      вирішують повтори: заблоковане в цьому проході видалиться в
#      наступному, каскади заберуть таблиці без organization_id;
#   5. доказ У ТІЙ ЖЕ транзакції: нуль рядків орендаря в кожній тенантній
#      таблиці і відсутній рядок organizations — інакше EXCEPTION, і вся
#      транзакція відкочується: напіввидаленого орендаря не існує, або
#      чисто, або як було.
#
# Під row_security = off: FORCE RLS діє і на власника (AGENTS §7), без
# цього DELETE «згори» мовчки зачепив би нуль рядків — і доказ би це
# спіймав, але навіщо ходити по колу.
set -euo pipefail

ENV_NAME="${1:-}"
ORG_SLUG="${2:-}"
case "$ENV_NAME" in
  prod|beta|local) ;;
  *) echo "usage: $0 {prod|beta|local} <org-slug>" >&2; exit 2 ;;
esac
[ -n "$ORG_SLUG" ] || { echo "usage: $0 {prod|beta|local} <org-slug>" >&2; exit 2; }
case "$ORG_SLUG" in
  *[!a-z0-9_-]*) echo "slug «$ORG_SLUG» містить недозволені символи ([a-z0-9_-])" >&2; exit 2 ;;
esac

cd "$(dirname "$0")/.."
echo "==> purge-tenant: $ENV_NAME, slug=$ORG_SLUG"

if [ "$ENV_NAME" = "local" ]; then
  # Стенд з AGENTS §7 (psql -h /tmp/pg -p 55432) — той самий небезпечний SQL
  # проходить репетицію тут, перш ніж торкнутися сервера. Дамп — pg_dump
  # на ту саму адресу.
  PGH="${LOCAL_PG_HOST:-/tmp/pg}"; PGP="${LOCAL_PG_PORT:-55432}"
  PG_SUPERUSER="${LOCAL_PG_USER:-alisio}"; PG_DATABASE="${LOCAL_PG_DB:-alisio_local}"
  PSQL() { psql -h "$PGH" -p "$PGP" -U "$PG_SUPERUSER" -d "$PG_DATABASE" -v ON_ERROR_STOP=1 "$@"; }
  DUMPCMD() { pg_dump -h "$PGH" -p "$PGP" -U "$PG_SUPERUSER" -d "$PG_DATABASE"; }
else
  ENV_FILE="deploy/env.${ENV_NAME}"
  PGC="alisio-${ENV_NAME}-postgres"
  [ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE — запускати на сервері" >&2; exit 1; }
  val() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '\r' || true; }
  PG_SUPERUSER="$(val PG_SUPERUSER)"; PG_SUPERUSER="${PG_SUPERUSER:-alisio_admin}"
  PG_DATABASE="$(val PG_DATABASE)";   PG_DATABASE="${PG_DATABASE:-alisio}"
  docker inspect "$PGC" >/dev/null 2>&1 || { echo "контейнера $PGC немає" >&2; exit 2; }
  PSQL() { docker exec -i "$PGC" psql -U "$PG_SUPERUSER" -d "$PG_DATABASE" -v ON_ERROR_STOP=1 "$@"; }
  DUMPCMD() { docker exec -i "$PGC" pg_dump -U "$PG_SUPERUSER" -d "$PG_DATABASE"; }
fi

# ── 1. Що саме буде видалено ────────────────────────────────────────────────
ORG_ID="$(PSQL -tAc "SET row_security = off; SELECT id FROM organizations WHERE slug = '$ORG_SLUG'" | tail -1)"
[ -n "$ORG_ID" ] || { echo "!! організації зі slug «$ORG_SLUG» немає в $ENV_NAME — нічого видаляти" >&2; exit 2; }

echo "==> знайдено організацію:"
PSQL <<SQL
SET row_security = off;
SELECT o.name, o.slug, o.created_at::date AS created,
       (SELECT count(*) FROM units u JOIN properties p ON p.id = u.property_id WHERE p.organization_id = o.id) AS units,
       (SELECT count(*) FROM reservations r WHERE r.organization_id = o.id) AS reservations,
       (SELECT count(*) FROM guests g WHERE g.organization_id = o.id) AS guests,
       (SELECT count(*) FROM gift_cards c WHERE c.organization_id = o.id) AS vouchers,
       (SELECT count(*) FROM app_users a WHERE a.organization_id = o.id) AS users
FROM organizations o WHERE o.id = '$ORG_ID';
SQL

# ── 2. Підтвердження людини ─────────────────────────────────────────────────
echo "!! Це НЕЗВОРОТНЄ видалення всіх даних цієї організації з бази $ENV_NAME"
echo "!! (дамп-страховка знімається наступним кроком)."
printf '!! Щоб продовжити, набери slug (%s) і Enter; будь-що інше — відмова: ' "$ORG_SLUG"
read -r CONFIRM || CONFIRM=""
if [ "$CONFIRM" != "$ORG_SLUG" ]; then
  echo "відмова: очікував «${ORG_SLUG}», отримав «${CONFIRM:0:60}»." >&2
  exit 1
fi

# ── 3. Дамп — точка повернення ──────────────────────────────────────────────
mkdir -p deploy/backups
STAMP="$(date +%Y%m%d-%H%M%S)"
DUMP="deploy/backups/alisio-${ENV_NAME}-purge-${ORG_SLUG}-${STAMP}.sql.gz"
echo "==> дамп перед видаленням: $DUMP"
DUMPCMD | gzip > "$DUMP" \
  || { echo "!! дамп не знявся — нічого не видаляю" >&2; exit 1; }
[ -s "$DUMP" ] || { echo "!! дамп порожній — нічого не видаляю" >&2; exit 1; }
echo "    $(du -h "$DUMP" | cut -f1)"

# ── 4+5. Видалення і доказ в одній транзакції ───────────────────────────────
echo "==> видаляю орендаря «$ORG_SLUG» ($ORG_ID)"
PSQL <<SQL
SET row_security = off;
BEGIN;

DO \$\$
DECLARE
  org text := '$ORG_ID';
  t record;
  fails int := 0;
  pass int;
BEGIN
  -- Ребра без ON DELETE CASCADE, які інакше заблокували б видалення:
  -- сесія платформного адміна, що «діє від імені» цієї організації, і
  -- події кошика/замовлення послуг, чиї батьки помруть каскадом.
  UPDATE platform_sessions SET acting_organization_id = NULL
   WHERE acting_organization_id = org;
  DELETE FROM cart_events ce USING reservations r
   WHERE ce.reservation_id = r.id AND r.organization_id = org;
  DELETE FROM booking_service_orders bso USING booking_sites s
   WHERE bso.site_id = s.id AND s.organization_id = org;

  FOR pass IN 1..12 LOOP
    fails := 0;
    FOR t IN
      SELECT c.table_name
      FROM information_schema.columns c
      JOIN information_schema.tables tb
        ON tb.table_name = c.table_name AND tb.table_schema = 'public'
       AND tb.table_type = 'BASE TABLE'
      WHERE c.column_name = 'organization_id' AND c.table_schema = 'public'
    LOOP
      BEGIN
        EXECUTE format('DELETE FROM %I WHERE organization_id = \$1', t.table_name) USING org;
      EXCEPTION WHEN foreign_key_violation THEN
        fails := fails + 1;
      END;
    END LOOP;
    EXIT WHEN fails = 0;
  END LOOP;

  IF fails > 0 THEN
    RAISE EXCEPTION 'після 12 проходів % таблиць лишились FK-блокованими — транзакцію відкочено, база ЦІЛА', fails;
  END IF;

  DELETE FROM organizations WHERE id = org;
END \$\$;

-- Доказ у тій самій транзакції: нуль рядків орендаря СКРІЗЬ, або відкат.
DO \$\$
DECLARE
  org text := '$ORG_ID';
  t record;
  n bigint;
  checked int := 0;
  dirty int := 0;
BEGIN
  FOR t IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables tb
      ON tb.table_name = c.table_name AND tb.table_schema = 'public'
     AND tb.table_type = 'BASE TABLE'
    WHERE c.column_name = 'organization_id' AND c.table_schema = 'public'
  LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE organization_id = \$1', t.table_name) INTO n USING org;
    checked := checked + 1;
    IF n > 0 THEN
      dirty := dirty + 1;
      RAISE WARNING '%: % рядків орендаря ще на місці', t.table_name, n;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM organizations WHERE id = org) THEN
    dirty := dirty + 1;
    RAISE WARNING 'рядок organizations досі існує';
  END IF;
  IF dirty > 0 THEN
    RAISE EXCEPTION 'НЕ ЧИСТО: % місць — транзакцію відкочено, база у стані «як було»', dirty;
  END IF;
  RAISE NOTICE 'доказ: 0 рядків орендаря в усіх % тенантних таблицях, organizations порожня від нього', checked;
END \$\$;

COMMIT;
SQL

echo "==> орендаря «$ORG_SLUG» видалено і доведено нулями."
echo "==> подивитись, хто лишився: ./deploy/list-tenants.sh $ENV_NAME"
