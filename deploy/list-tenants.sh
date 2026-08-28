#!/usr/bin/env bash
#
# Хто живе в базі одного середовища — read-only інвентар перед чисткою.
#
#   ./deploy/list-tenants.sh prod
#   ./deploy/list-tenants.sh beta
#
# Друкує кожну організацію: slug, назву, і скільки в неї рядків у головних
# таблицях (юніти, категорії, послуги, бронювання, гості, ваучери, шаблони
# ваучерів) — плюс імена категорій, типів номерів і послуг, бо саме в іменах
# видно спадок першого клієнта («Сауна», «Купель», «Будова F»), а не в
# лічильниках. Нічого не пише: це очі, ножем працює purge-tenant.sh.
#
# Читає під row_security = off (FORCE RLS діє і на власника — без цього
# кожен запит «згори» бачить порожнечу, AGENTS §7).
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
echo "==> list-tenants: $ENV_NAME"

val() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '\r' || true; }
PG_SUPERUSER="$(val PG_SUPERUSER)"; PG_SUPERUSER="${PG_SUPERUSER:-alisio_admin}"
PG_DATABASE="$(val PG_DATABASE)";   PG_DATABASE="${PG_DATABASE:-alisio}"

docker inspect "$PGC" >/dev/null 2>&1 || { echo "контейнера $PGC немає" >&2; exit 2; }

docker exec -i "$PGC" psql -U "$PG_SUPERUSER" -d "$PG_DATABASE" -v ON_ERROR_STOP=1 <<'SQL'
SET row_security = off;

SELECT o.slug, o.name, o.created_at::date AS created,
       (SELECT count(*) FROM properties        p WHERE p.organization_id = o.id) AS props,
       (SELECT count(*) FROM units             u WHERE u.property_id IN (SELECT id FROM properties WHERE organization_id = o.id)) AS units,
       (SELECT count(*) FROM reservations      r WHERE r.organization_id = o.id) AS reservations,
       (SELECT count(*) FROM guests            g WHERE g.organization_id = o.id) AS guests,
       (SELECT count(*) FROM app_users         a WHERE a.organization_id = o.id) AS users,
       (SELECT count(*) FROM gift_cards        c WHERE c.organization_id = o.id) AS vouchers,
       (SELECT count(*) FROM gift_card_templates t WHERE t.organization_id = o.id) AS voucher_tpl
FROM organizations o ORDER BY o.created_at;

\echo
\echo '── Імена, в яких видно спадок (категорії / типи номерів / послуги) ──'
SELECT o.slug, 'category' AS kind, c.name
  FROM categories c JOIN properties p ON p.id = c.property_id JOIN organizations o ON o.id = p.organization_id
UNION ALL
SELECT o.slug, 'unit_type', ut.name
  FROM unit_types ut JOIN properties p ON p.id = ut.property_id JOIN organizations o ON o.id = p.organization_id
UNION ALL
SELECT o.slug, 'service', s.name
  FROM additional_services s JOIN properties p ON p.id = s.property_id JOIN organizations o ON o.id = p.organization_id
ORDER BY 1, 2, 3;
SQL
