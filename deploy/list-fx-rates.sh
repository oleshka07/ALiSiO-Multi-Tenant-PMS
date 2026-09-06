#!/usr/bin/env bash
#
# Кому нічний прохід ČNB написав курс, якого готель не просив — read-only.
#
#   ./deploy/list-fx-rates.sh prod
#   ./deploy/list-fx-rates.sh beta
#
# Навіщо це існує. До 07.09.2026 крон `sync-cnb-rates` брав КОЖЕН готель із
# обліковою валютою CZK і писав йому чотири зашиті валюти (EUR, USD, GBP,
# PLN) — незалежно від того, що готель оголосив у себе на екрані. Курс,
# внесений готелем удень, тієї ж ночі перекривався банківським, а
# `rate_source = 'manual'` при цьому не значив нічого. Виправлення (крон
# пропускає валюти, які готель фіксує сам) спиняє це НАПЕРЕД — і не чіпає
# рядків, які вже лежать у базі.
#
# А вони лежать. `latestRate()` бере найсвіжіший `effective_from`, тож готель
# із фіксованим курсом і далі бачитиме банківський, поки не внесе свій ще раз
# (сьогоднішньою датою — і з цього моменту виграє він).
#
# Чому це ЗВІТ, а не чистка. У `finance_exchange_rates` немає колонки
# походження: рядок банку і рядок готелю відрізняються лише тим, хто його
# написав, і після запису це вже не відновлюється. Автоматична чистка
# «зайвого» стирала б курси, за якими могли бути виписані документи. Тому
# скрипт лише називає місця, а рішення ухвалює готель — своїм новим курсом.
#
# Нічого не пише. Читає під row_security = off (FORCE RLS діє й на власника,
# AGENTS §7).
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
echo "==> list-fx-rates: $ENV_NAME"

val() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '\r' || true; }
PG_SUPERUSER="$(val PG_SUPERUSER)"; PG_SUPERUSER="${PG_SUPERUSER:-alisio_admin}"
PG_DATABASE="$(val PG_DATABASE)";   PG_DATABASE="${PG_DATABASE:-alisio}"

docker inspect "$PGC" >/dev/null 2>&1 || { echo "контейнера $PGC немає" >&2; exit 2; }

docker exec -i "$PGC" psql -U "$PG_SUPERUSER" -d "$PG_DATABASE" -v ON_ERROR_STOP=1 <<'SQL'
SET row_security = off;

\echo '── Валюти показу, як їх оголосив готель ──────────────────────────────'
SELECT o.slug, o.default_currency AS base, c.code, c.rate_source, c.sort_order
  FROM organization_currencies c JOIN organizations o ON o.id = c.organization_id
 ORDER BY o.slug, c.sort_order, c.code;

\echo
\echo '── Курс, який побачить гість СЬОГОДНІ (найсвіжіший рядок пари) ───────'
\echo '   fixed = готель оголосив manual: перевірте, чи це справді його число.'
SELECT o.slug, c.code, c.rate_source,
       fx.rate, fx.effective_from, fx.created_at
  FROM organization_currencies c
  JOIN organizations o ON o.id = c.organization_id
  LEFT JOIN LATERAL (
    SELECT r.rate, r.effective_from, r.created_at
      FROM finance_exchange_rates r
     WHERE r.organization_id = c.organization_id
       AND r.from_currency = c.code
       AND r.to_currency = o.default_currency
     ORDER BY r.effective_from DESC
     LIMIT 1
  ) fx ON TRUE
 ORDER BY o.slug, c.code;

\echo
\echo '── Рядки, яких ніхто не просив ───────────────────────────────────────'
\echo '   Пари, які писав старий крон (EUR/USD/GBP/PLN → CZK) і яких немає'
\echo '   в оголошеному переліку з джерелом cnb. Їх читає не лише вітрина:'
\echo '   invoicing/domain/fx.ts бере той самий latestRate().'
SELECT o.slug, r.from_currency, r.to_currency,
       count(*) AS rows, min(r.effective_from) AS from_day, max(r.effective_from) AS to_day
  FROM finance_exchange_rates r
  JOIN organizations o ON o.id = r.organization_id
 WHERE r.to_currency = 'CZK'
   AND r.from_currency IN ('EUR', 'USD', 'GBP', 'PLN')
   AND NOT EXISTS (
     SELECT 1 FROM organization_currencies c
      WHERE c.organization_id = r.organization_id
        AND c.code = r.from_currency
        AND c.rate_source = 'cnb')
 GROUP BY o.slug, r.from_currency, r.to_currency
 ORDER BY o.slug, r.from_currency;
SQL
