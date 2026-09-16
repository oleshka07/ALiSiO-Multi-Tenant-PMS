#!/usr/bin/env bash
#
# Наскільки розійшлись платіжні книги в ЖИВІЙ базі. Read-only.
#
#   ./deploy/count-payment-gap.sh beta
#   ./deploy/count-payment-gap.sh prod
#   ./deploy/count-payment-gap.sh local          # стенд AGENTS §7
#
# ── Навіщо ────────────────────────────────────────────────────────────────
#
# Ревізія платіжних шляхів (16.09.2026, Д83) знайшла, що грошей приймали
# ДВОЄ дверей, і вони писали в різні книги: оплата з екрана фоліо лягала
# тільки в рахунок гостя — ні рядка в касі, ні слова на броні. Правка зводить
# двері в одні, але ВЖЕ ЗАПИСАНЕ вона не чіпає: переписувати заднім числом
# чужі гроші не можна, це рішення людини.
#
# Цей скрипт відповідає на три питання, кожне числом і списком:
#
#   1. Скільки готівкових платежів у рахунках гостей НЕ мають парного рядка
#      каси. Це гроші, яких не бачать ні P&L, ні залишок рахунку.
#      Переказ і ваучер сюди НЕ входять — вони в касу не лягають за правилом.
#   2. Скільки броней мають БІЛЬШЕ ОДНОГО не скасованого документа. Це два
#      номери на ті самі гроші; виправляється лише сторно.
#   3. Скільки броней, чиє слово розходиться з рахунком гостя: борг нуль, а
#      слово «не оплачено» (або навпаки). Саме це бачить рецепція й гість.
#
# Нічого не змінює і присуду не виносить: рядок може бути законним (готівку
# внесли до переведення дверей), і рішення про кожен ухвалює людина.
#
# ── Чому суперкористувач і `SET row_security = off` ───────────────────────
#
# Як у `count-payer-folios.sh`: політика `fin_folios` читає
# `current_setting('app.organization_id')` без другого аргументу і КИДАЄ на
# невстановленому параметрі, а з підставленим порожнім орендарем питання
# звузилось би до одного готелю — тобто до втішного нуля. Питання тут
# наскрізне: воно про всю базу.
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

# База без 0096 не має чим звʼязати платіж із рядком каси — це «міграції ще
# не накочено», а не збій скрипта.
HAS_LINK="$(PSQL -tAc "SET row_security = off; SELECT count(*) FROM information_schema.columns WHERE table_name='fin_operations' AND column_name='folio_payment_id'" | tail -1)"
if [ "$HAS_LINK" = "0" ]; then
  echo "!! колонки fin_operations.folio_payment_id немає — 0096 не накочено; спершу міграції" >&2
  exit 2
fi

echo "==> розбіжність платіжних книг у $ENV_NAME (read-only)"

PSQL <<'SQL'
SET row_security = off;

-- 1. ГОТІВКА В РАХУНКУ ГОСТЯ БЕЗ ПАРНОГО РЯДКА КАСИ ────────────────────────
--
-- Пара шукається саме за `folio_payment_id`: за сумою й датою вона зійшлася б
-- випадково там, де двоє гостей заплатили однаково в один день.
SELECT count(*)                          AS "готівкових платежів усього",
       count(*) FILTER (WHERE o.id IS NULL) AS "БЕЗ рядка каси",
       COALESCE(SUM(p.amount) FILTER (WHERE o.id IS NULL), 0) AS "сума поза касою"
  FROM fin_folio_payments p
  LEFT JOIN fin_operations o ON o.folio_payment_id = p.id
 WHERE p.method = 'cash';

SELECT p.organization_id, p.property_id, p.paid_at, p.amount, p.folio_id
  FROM fin_folio_payments p
  LEFT JOIN fin_operations o ON o.folio_payment_id = p.id
 WHERE p.method = 'cash' AND o.id IS NULL
 ORDER BY p.paid_at DESC
 LIMIT 50;

-- 2. ДВА ДОКУМЕНТИ НА ОДНУ БРОНЬ ───────────────────────────────────────────
SELECT count(*) AS "броней із двома+ документами" FROM (
  SELECT reservation_id
    FROM invoices
   WHERE reservation_id IS NOT NULL AND status <> 'cancelled'
   GROUP BY reservation_id
  HAVING count(*) > 1
) x;

SELECT i.reservation_id, string_agg(i.invoice_number || ' (' ||
         CASE WHEN i.folio_id IS NULL THEN 'позначка оплати' ELSE 'рахунок гостя' END || ')', ', '
         ORDER BY i.issued_at) AS "документи",
       SUM(i.amount) AS "разом"
  FROM invoices i
 WHERE i.reservation_id IS NOT NULL AND i.status <> 'cancelled'
 GROUP BY i.reservation_id
HAVING count(*) > 1
 ORDER BY 1
 LIMIT 50;

-- 3. СЛОВО БРОНІ ПРОТИ РАХУНКУ ГОСТЯ ───────────────────────────────────────
--
-- Лише броні, у рахунку яких щось НАРАХОВАНО: порожня книга не каже «нічого
-- не винен», вона не каже нічого (той самий закон, що в `decideCheckout`).
WITH book AS (
  SELECT f.reservation_id,
         COALESCE(SUM(i.total_gross), 0) AS charged,
         COALESCE((SELECT SUM(p.amount) FROM fin_folio_payments p
                    JOIN fin_folios f2 ON f2.id = p.folio_id
                   WHERE f2.reservation_id = f.reservation_id), 0) AS paid
    FROM fin_folios f
    LEFT JOIN fin_folio_items i ON i.folio_id = f.id AND i.voided_by_item_id IS NULL
   WHERE f.reservation_id IS NOT NULL
   GROUP BY f.reservation_id
)
SELECT count(*) FILTER (WHERE b.charged > 0 AND b.charged - b.paid <= 0 AND r.payment_status <> 'paid'
                          AND COALESCE(r.is_prepaid, FALSE) = FALSE)  AS "рахунок закритий, слово ні",
       count(*) FILTER (WHERE b.charged > 0 AND b.charged - b.paid > 0 AND r.payment_status = 'paid') AS "слово «оплачено», а борг є"
  FROM book b JOIN reservations r ON r.id = b.reservation_id;
SQL

echo
echo "Нічого не змінено. Рядок у списку може бути законним: готівка, внесена"
echo "до переведення дверей (Д83), лишається в рахунку гостя й не має пари в"
echo "касі. Рішення по кожному — людини."
