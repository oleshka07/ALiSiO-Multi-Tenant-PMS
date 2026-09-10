#!/usr/bin/env bash
#
# Скільки в живій базі фоліо БЕЗ броні — і що це за рядки. Read-only.
#
#   ./deploy/count-payer-folios.sh beta
#   ./deploy/count-payer-folios.sh prod
#   ./deploy/count-payer-folios.sh local          # стенд AGENTS §7
#
# Питання, на яке відповідає: чи не лишилось у цій базі рахунків, які
# оголосили себе фірмовими ДО міграції 0140, тобто до появи
# `fin_folios.company_id`. Такий рядок невидимий з обох боків: у списку
# рахунків броні його немає (броні немає), а у «відкритих фактурах фірми»
# його немає теж — читач фільтрує саме по `company_id`
# (`folio.repo.ts` `openInvoicesOfCompany`).
#
# `fin_folios.reservation_id` був нульовим у схемі задовго до 0140 — база
# дозволяла рахунок без броні ще тоді, коли код цього не вмів. Тому питання
# ставиться не «скільки без броні» (фоліо ПЛАТНИКА і є рядок без броні, і їх
# стане більше навмисно), а «скільки без броні І БЕЗ ФІРМИ».
#
# ── Чому суперкористувач і `SET row_security = off` ─────────────────────────
#
# Перша редакція цього інструмента була `.mjs` і бралася зʼєднанням
# ЗАСТОСУНКУ (`alisio_app`). Оператор запустив її рівно так, як велів
# DEPLOY.md, і дістав не числа, а стек:
#
#   error: unrecognized configuration parameter "app.organization_id"
#
# Політика на `fin_folios` читає `current_setting('app.organization_id')` без
# другого аргументу, тож на невстановленому параметрі вона КИДАЄ. Це третій
# випадок класу за дві доби (INC-101, `company_rate_plans`) і перший — не в
# міграції, а в інструменті.
#
# Полагодити «підставити порожнього орендаря» не можна: тоді скрипт рахував
# би фоліо ОДНОГО орендаря — тобто нуль — і мовчки казав би «все гаразд». Він
# за призначенням НАСКРІЗНИЙ: питає про базу перед переїздом клієнта. Тому
# зʼєднання суперкористувача і явний `SET row_security = off`, як у
# `deploy/check-overlaps.sh`: `FORCE ROW LEVEL SECURITY` діє й на власника
# схеми, і без цього рядка запит «згори» бачить порожнечу і друкує втішний
# нуль (AGENTS §7).
#
# Нічого не змінює і нічого не чистить: друкує рядки, щоб рішення приймала
# людина. Привʼязати старий рахунок не до тієї фірми гірше, ніж не
# привʼязати зовсім.
set -euo pipefail

ENV_NAME="${1:-}"
case "$ENV_NAME" in
  prod|beta|local) ;;
  *) echo "usage: $0 {prod|beta|local}" >&2; exit 2 ;;
esac

cd "$(dirname "$0")/.."

if [ "$ENV_NAME" = "local" ]; then
  PGH="${LOCAL_PG_HOST:-/tmp/pg}"; PGP="${LOCAL_PG_PORT:-55432}"
  PG_SUPERUSER="${LOCAL_PG_USER:-alisio}"; PG_DATABASE="${LOCAL_PG_DB:-alisio_local}"
  PSQL() { psql -h "$PGH" -p "$PGP" -U "$PG_SUPERUSER" -d "$PG_DATABASE" -v ON_ERROR_STOP=1 "$@"; }
else
  ENV_FILE="deploy/env.${ENV_NAME}"
  PGC="alisio-${ENV_NAME}-postgres"
  [ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE — запускати на сервері" >&2; exit 1; }
  val() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '\r' || true; }
  PG_SUPERUSER="$(val PG_SUPERUSER)"; PG_SUPERUSER="${PG_SUPERUSER:-alisio_admin}"
  PG_DATABASE="$(val PG_DATABASE)";   PG_DATABASE="${PG_DATABASE:-alisio}"
  docker inspect "$PGC" >/dev/null 2>&1 || { echo "контейнера $PGC немає" >&2; exit 2; }
  PSQL() { docker exec -i "$PGC" psql -U "$PG_SUPERUSER" -d "$PG_DATABASE" -v ON_ERROR_STOP=1 "$@"; }
fi

echo "==> фоліо без броні у $ENV_NAME (read-only)"

# База без 0140 — це відповідь «міграції ще не накочено», а не збій скрипта.
HAS_COL="$(PSQL -tAc "SET row_security = off; SELECT count(*) FROM information_schema.columns WHERE table_name='fin_folios' AND column_name='company_id'" | tail -1)"
if [ "$HAS_COL" = "0" ]; then
  echo "!! колонки fin_folios.company_id немає — 0140 не накочено; спершу міграції" >&2
  exit 2
fi

PSQL <<'SQL'
SET row_security = off;

SELECT count(*)                                                   AS "фоліо всього",
       count(*) FILTER (WHERE reservation_id IS NULL)             AS "без броні",
       count(*) FILTER (WHERE reservation_id IS NULL
                          AND company_id IS NULL)                 AS "без броні І без фірми"
  FROM fin_folios;

-- Що САМЕ в цих рядках. Без цього присуд «розібрати» не має на чому стояти:
-- рядок, створений до 0140, має `company_id IS NULL` не тому, що код чогось
-- не заповнив, а тому, що колонки тоді не існувало.
--
-- `payer_debtor_no` показується НАВМИСНО поруч із датою: до 0140 туди
-- підставлявся реєстраційний номер фірми, після — номер, який видає готель.
-- Зіставляти старі рядки з довідником по цьому полю НЕ МОЖНА: зміст поля
-- змінився, і привʼязка вийде не до тієї фірми (Д60).
SELECT id, organization_id, payer_kind, payer_name, payer_debtor_no,
       label, currency, status, created_at
  FROM fin_folios
 WHERE reservation_id IS NULL AND company_id IS NULL
 ORDER BY created_at;
SQL
