#!/usr/bin/env bash
#
# Скільки живих даних тримає модифікатор ціни точки збуту — read-only.
#
#   ./deploy/measure-price-modifier.sh prod
#   ./deploy/measure-price-modifier.sh beta
#
# ── Навіщо це окремий скрипт ──────────────────────────────────────────────
#
# Рішення Ц7 переносить `pricing_modifier_percent` із сайту на ТОЧКУ ЗБУТУ
# (сайт і зʼєднання з каналом — обидві половини одним рухом). Обґрунтування
# «перенесення безкоштовне» стоїть на одному числі: рядків з ненульовим
# модифікатором немає. Виміряне воно було на ЛОКАЛЬНІЙ базі розробки, а
# локальна база — це не прод.
#
# Якщо тут знайдеться хоч один ненульовий модифікатор, перенесення перестає
# бути рухом схеми і стає міграцією ЖИВИХ ДАНИХ: робити його «одним рухом
# разом із батчером» тоді не можна, бо батчер поїде на числі, якого ніхто не
# звіряв. Що робити далі — рішення власника, не скрипта.
#
# Це передумова фази 4 нарівні з ключем API і allowlist (CHANNEX-INTEGRATION
# §Фаза 4, HANDOVER-2026-09-01 §6).
#
# ── Чому міряються ЧОТИРИ колонки, а не одна ──────────────────────────────
#
# `pricing_modifier_percent` без `pricing_modifier_type` не означає нічого:
# 10 — це «дешевше на 10%» чи «дорожче на 10%»? Дефолт колонки — `less`.
# Перенести відсоток і забути напрямок означає перевернути знак на всіх
# рядках одразу й мовчки.
#
# `pricing_mode` = `dependent` і `derived_from_plan_id` — сусідня машинерія
# того самого рішення: тариф, похідний від тарифу (Hoteliera «based on
# existing rate plan», Channex `derived_option`). Ц7 її НЕ скасовує, але
# рядки, у яких вона вже вживана, треба побачити до, а не після.
#
# ── Read-only ─────────────────────────────────────────────────────────────
#
# Жодного запису. Читає під `row_security = off`: FORCE RLS діє і на
# власника схеми, тож без цього кожен запит «згори» бачить порожнечу і
# скрипт радісно звітував би «нуль рядків» на повній базі (AGENTS §7).
# Саме та брехня, від якої застерігає інваріант 13.
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
echo "==> measure-price-modifier: $ENV_NAME"

# `|| true` обовʼязково: порожній ключ під `set -e` убив би скрипт до першого
# рядка виводу, і оператор побачив би тишу замість числа (гейт check-fatal-grep).
val() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '\r' || true; }
PG_SUPERUSER="$(val PG_SUPERUSER)"; PG_SUPERUSER="${PG_SUPERUSER:-alisio_admin}"
PG_DATABASE="$(val PG_DATABASE)";   PG_DATABASE="${PG_DATABASE:-alisio}"

docker inspect "$PGC" >/dev/null 2>&1 || { echo "контейнера $PGC немає" >&2; exit 2; }

docker exec -i "$PGC" psql -U "$PG_SUPERUSER" -d "$PG_DATABASE" -v ON_ERROR_STOP=1 <<'SQL'
SET row_security = off;

-- ── ХТО ПИТАЄ, І ЧИ ВІДПОВІДЬ ВЗАГАЛІ МОЖЕ БУТИ ЧЕСНОЮ ────────────────────
--
-- Нуль, отриманий роллю, яку фільтрує RLS, виглядає РІВНО так само, як
-- чесний нуль. І читається так само — «переносимо вільно», тобто найгірший
-- можливий неправдивий результат: ним ухвалюють рішення переписати чужі
-- ціни. Тому роль друкується у вивід, а не лишається в шапці файла: через
-- півроку шапку не відкриють, а число прочитають.
--
-- І перевіряється, а не друкується для краси: якщо роль не обходить RLS,
-- скрипт ВІДМОВЛЯЄ (інваріант 13 — перевірка, яка не знайшла очікуваного,
-- відмовляє, а не дозволяє).
\echo '── Хто питає ───────────────────────────────────────────────────────'
SELECT current_user                        AS роль,
       current_setting('row_security')     AS row_security,
       (SELECT rolsuper  FROM pg_roles WHERE rolname = current_user) AS суперкористувач,
       (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS обходить_rls,
       pg_get_userbyid(datdba) = current_user AS власник_бази
  FROM pg_database WHERE datname = current_database();

DO $$
DECLARE ok boolean;
BEGIN
  SELECT rolsuper OR rolbypassrls
       OR current_user = (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database())
    INTO ok FROM pg_roles WHERE rolname = current_user;
  IF NOT ok THEN
    RAISE EXCEPTION 'роль % не обходить RLS — будь-який нуль тут нічого не означає, і найменше за все означає «даних немає»', current_user;
  END IF;
END $$;

-- Контрольні лічильники: нуль у порожній базі й нуль, схований політикою,
-- відрізняються саме тут. Якщо готелі є, а сайтів нема — нуль чесний.
-- Якщо не видно навіть готелів, значить видно взагалі нічого.
\echo
\echo '── Контроль: чи видно базу взагалі ──────────────────────────────────'
SELECT (SELECT count(*) FROM organizations) AS готелів,
       (SELECT count(*) FROM properties)    AS обʼєктів,
       (SELECT count(*) FROM booking_sites) AS сайтів,
       (SELECT count(*) FROM rate_plans)    AS тарифів;

-- Колонки може не бути: на базі, старшій за міграцію 0016, або якщо хтось
-- уже почав перенесення. Питаємо каталог, а не вгадуємо — інакше скрипт
-- впаде з «column does not exist» і це прочитається як «нуль».
\echo '── Чи є взагалі що міряти ──────────────────────────────────────────'
SELECT column_name, data_type, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'site_rate_plans'
   AND column_name IN ('pricing_modifier_percent', 'pricing_modifier_type',
                       'pricing_mode', 'derived_from_plan_id')
 ORDER BY column_name;

\echo
\echo '── ГОЛОВНЕ ЧИСЛО: рядки і ненульові модифікатори ───────────────────'
SELECT
  count(*)                                                          AS rows_total,
  count(*) FILTER (WHERE pricing_modifier_percent IS NOT NULL)      AS modifier_set,
  count(*) FILTER (WHERE COALESCE(pricing_modifier_percent, 0) <> 0) AS modifier_nonzero,
  count(*) FILTER (WHERE pricing_mode = 'dependent')                AS mode_dependent,
  count(*) FILTER (WHERE derived_from_plan_id IS NOT NULL)          AS derived_from_plan
FROM site_rate_plans;

\echo
\echo '── Хто саме, якщо ненульові є (порожньо = перенесення безкоштовне) ─'
-- `site_rate_plans` не має organization_id: орендар транзитивно через
-- booking_sites (це ж і в політиці RLS). Тому join, а не колонка.
SELECT o.slug,
       s.id                        AS site_id,
       p.name                      AS plan_name,
       p.pricing_modifier_percent  AS pct,
       p.pricing_modifier_type     AS direction,
       p.pricing_mode,
       p.derived_from_plan_id,
       p.is_active
  FROM site_rate_plans p
  JOIN booking_sites  s ON s.id = p.site_id
  JOIN organizations  o ON o.id = s.organization_id
 WHERE COALESCE(p.pricing_modifier_percent, 0) <> 0
    OR p.pricing_mode = 'dependent'
    OR p.derived_from_plan_id IS NOT NULL
 ORDER BY o.slug, p.name;

\echo
\echo '── Розподіл напрямку: відсоток без напрямку не означає нічого ──────'
SELECT COALESCE(pricing_modifier_type, '(null)') AS direction,
       count(*)                                  AS rows,
       min(pricing_modifier_percent)             AS pct_min,
       max(pricing_modifier_percent)             AS pct_max
  FROM site_rate_plans
 GROUP BY 1 ORDER BY 1;
SQL

echo
echo "── Як це читати ────────────────────────────────────────────────────"
echo "СПЕРШУ подивіться блок «Хто питає»: row_security має бути off, а роль —"
echo "обходити RLS. Скрипт на цьому відмовляє сам, але число читають окремо"
echo "від скрипта, тож воно має нести доказ поруч із собою."
echo "Далі «Контроль»: нуль сайтів при нулі ГОТЕЛІВ — це не «даних немає»,"
echo "це «нічого не видно»."
echo
echo "modifier_nonzero = 0  →  перенесення колонки на точку збуту (Ц7) —"
echo "                        рух схеми, можна одним комітом із батчером."
echo "modifier_nonzero > 0  →  це МІГРАЦІЯ ЖИВИХ ДАНИХ. Зупинитись і"
echo "                        показати власнику перелік вище: перенести"
echo "                        числа чи лишити асиметрію до окремої роботи —"
echo "                        рішення про гроші клієнта, не про форму коду."
