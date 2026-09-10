-- Два будинки — дві бухгалтерії. Конфігурація фінансів отримує вісь обʼєкта.
--
-- Рішення власника 09.09.2026 (В11, реєстр Д54): «не можуть бути одні фінанси
-- на 2 обʼєкти, бо в них різна бухгалтерія і різні правила по ПДВ і всьому
-- можуть бути; тому і налаштовуватися це все має окремо».
--
-- Шість таблиць конфігурації не мали `property_id` узагалі (INC-038,
-- виміряно контролером по схемі): `fin_tax_rates`, `invoice_series`,
-- `expense_categories`, `finance_accounts`, `business_units`,
-- `finance_counterparties`. Сьома, `fin_cash_closings`, вісь уже мала.
--
-- ── Чому колонка НУЛЬОВА ───────────────────────────────────────────────────
--
-- `NULL` = «на весь рахунок», старшинство — будинок перед рахунком. Той самий
-- взірець, що Д51, `channel_rate_rules` і `invoices`. Обовʼязкова колонка
-- вимагала б вигадати будинок кожному наявному рядку шести таблиць і зламала б
-- готель з одним обʼєктом, який про обʼєкти не думає; нульова лишає всі наявні
-- рядки законними «спільними». Жоден нинішній клієнт не має помітити нічого,
-- поки не заведе другий обʼєкт.
--
-- ── Дві межі, без яких форма шкідлива ─────────────────────────────────────
--
-- Перша не в SQL, а в коді (`stay-charges.repo.ts`): для `fin_tax_rates`
-- «спільне за замовчуванням» МОВЧАТИ не має права. Ставка ПДВ, узята від
-- рахунку для будинку в іншій країні, — це інваріант 8 і інваріант 22 разом, і
-- сума їде в документ держави. Спільний набір застосовується лише до будинку
-- країни рахунку; інакше — названа відмова з іменем будинку і країною.
--
-- Друга тут. `UNIQUE (organization_id, code)` на `invoice_series` не пускав
-- двом будинкам мати кожен свою серію з тим самим кодом — а дві окремі
-- бухгалтерії з однією наскрізною нумерацією це не незручність, а діра в
-- книгах. Обмеження перекладається на COALESCE, бо постґресівський `UNIQUE` не
-- дедуплікує `NULL`: без цього спільний рядок (`property_id IS NULL`) не був би
-- обмежений узагалі. Той самий прийом, що `idx_channel_rate_rules_row` (0016).
--
-- ── Пастка зняття старого обмеження ───────────────────────────────────────
--
-- Старе `UNIQUE (organization_id, code)` створене як ОБМЕЖЕННЯ таблиці, і на
-- свіжій базі його ставить `db/postgres/schema.sql` під іменем від генератора,
-- а на мігрованій — під своїм. Тому знімається воно за ОЗНАЧЕННЯМ
-- (`pg_get_constraintdef`), а не за `conname` (AGENTS §4): сторож за іменем не
-- знайшов би нічого, і два обмеження жили б поруч — з яких старе суворіше, і
-- саме воно й далі забороняло б другому будинку свою серію.
--
-- Перезапускна: другий прогін не знаходить ні колонок до додавання, ні старого
-- обмеження, і нічого не робить.

BEGIN;

ALTER TABLE "fin_tax_rates"          ADD COLUMN IF NOT EXISTS "property_id" TEXT REFERENCES "properties"("id") ON DELETE CASCADE;
ALTER TABLE "invoice_series"         ADD COLUMN IF NOT EXISTS "property_id" TEXT REFERENCES "properties"("id") ON DELETE CASCADE;
ALTER TABLE "expense_categories"     ADD COLUMN IF NOT EXISTS "property_id" TEXT REFERENCES "properties"("id") ON DELETE CASCADE;
ALTER TABLE "finance_accounts"       ADD COLUMN IF NOT EXISTS "property_id" TEXT REFERENCES "properties"("id") ON DELETE CASCADE;
ALTER TABLE "business_units"         ADD COLUMN IF NOT EXISTS "property_id" TEXT REFERENCES "properties"("id") ON DELETE CASCADE;
ALTER TABLE "finance_counterparties" ADD COLUMN IF NOT EXISTS "property_id" TEXT REFERENCES "properties"("id") ON DELETE CASCADE;

-- Читання завжди «цей рахунок, цей будинок або спільне».
CREATE INDEX IF NOT EXISTS "idx_fin_tax_rates_property"          ON "fin_tax_rates"          ("organization_id", "property_id");
CREATE INDEX IF NOT EXISTS "idx_invoice_series_property"         ON "invoice_series"         ("organization_id", "property_id");
CREATE INDEX IF NOT EXISTS "idx_expense_categories_property"     ON "expense_categories"     ("organization_id", "property_id");
CREATE INDEX IF NOT EXISTS "idx_finance_accounts_property"       ON "finance_accounts"       ("organization_id", "property_id");
CREATE INDEX IF NOT EXISTS "idx_business_units_property"         ON "business_units"         ("organization_id", "property_id");
CREATE INDEX IF NOT EXISTS "idx_finance_counterparties_property" ON "finance_counterparties" ("organization_id", "property_id");

-- Старе обмеження серій — за ОЗНАЧЕННЯМ, не за іменем.
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = '"invoice_series"'::regclass
       AND contype = 'u'
       AND pg_get_constraintdef(oid) LIKE 'UNIQUE (organization_id, code)%'
  LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', 'invoice_series', c);
    RAISE NOTICE 'invoice_series: знято UNIQUE (organization_id, code) — %', c;
  END LOOP;
END $$;

-- І той самий індекс, який міг лишитись від SQLite-гілки під власним іменем.
DROP INDEX IF EXISTS "idx_invoice_series_code";

CREATE UNIQUE INDEX IF NOT EXISTS "idx_invoice_series_row"
  ON "invoice_series" ("organization_id", (COALESCE("property_id", '')), "code");

-- ── Лічильник і замок місяця: друга половина, якої в Д54 немає ─────────────
--
-- Знявши «один код на рахунок», ми відкриваємо саме той випадок, задля якого
-- знімали: дві серії з кодом `FA` у двох будинках. А `invoice_counters` і
-- `invoice_periods` ключовані `(організація, серія, рік/місяць)` — тобто обидві
-- серії ділили б ОДИН прогін і ОДИН замок: другий будинок продовжував би чужі
-- номери, а закриття місяця в одному заморожувало б документи іншого. Мовчки.
--
-- Тому лічильник і період належать РЯДКОВІ СЕРІЇ. Ключ переїжджає з PRIMARY KEY
-- на УНІКАЛЬНИЙ ІНДЕКС по `COALESCE`: колонка нульова, а в PRIMARY KEY нульових
-- колонок не буває — і `UNIQUE` сам по собі не дедуплікує NULL.
--
-- Наявні рядки лишаються `NULL`: усе, що видано досі, видано на весь рахунок, і
-- нумерація мусить продовжитись із того самого числа, а не початись спочатку.

ALTER TABLE "invoice_counters" ADD COLUMN IF NOT EXISTS "property_id" TEXT REFERENCES "properties"("id") ON DELETE CASCADE;
ALTER TABLE "invoice_periods"  ADD COLUMN IF NOT EXISTS "property_id" TEXT REFERENCES "properties"("id") ON DELETE CASCADE;

-- Старі ключі — за ОЗНАЧЕННЯМ, не за іменем (AGENTS §4): на свіжій базі їх
-- створив `schema.sql` під іменем від генератора, на мігрованій — під своїм.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conrelid::regclass::text AS tbl, conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
     WHERE conrelid IN ('"invoice_counters"'::regclass, '"invoice_periods"'::regclass)
       AND contype = 'p'
       AND pg_get_constraintdef(oid) LIKE 'PRIMARY KEY (organization_id, series, %'
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
    RAISE NOTICE '%: знято % — %', r.tbl, r.def, r.conname;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "idx_invoice_counters_row"
  ON "invoice_counters" ("organization_id", (COALESCE("property_id", '')), "series", "year");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_invoice_periods_row"
  ON "invoice_periods" ("organization_id", (COALESCE("property_id", '')), "series", "month");

COMMIT;
