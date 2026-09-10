-- Одна колонка — один тип, незалежно від того, ЩО в базі було раніше.
--
-- ── Що сталося (INC-308, 10.09.2026) ────────────────────────────────────
--
-- `db/postgres/schema.sql` генерується з локальної SQLite і ВГАДУЄ тип за
-- іменем колонки. Міграція тип ОГОЛОШУЄ. Там, де таблицю створюють обидва,
-- чинним стає той, хто був перший, — а це залежить від віку середовища:
--
--   давнє середовище   таблиці ще не було → її створила МІГРАЦІЯ
--   новий клієнт і CI  таблицю створює `schema.sql`, а `CREATE TABLE
--                      IF NOT EXISTS` міграції мовчки нічого не робить
--
-- Тобто два різні продукти під одним іменем. Знайшлося не читанням: на
-- гілці робіт `check:pg` червонів рядком
-- `invalid input syntax for type bigint: "false"` — писач способів оплати
-- передає `false` (інваріант 12), міграція 0141 оголосила BOOLEAN, а
-- `schema.sql` дав BIGINT. Новий готель не міг додати спосіб оплати взагалі.
--
-- Разом таких колонок було 22; ця міграція вирівнює ДЕСЯТЬ — ті, де
-- оголошення міграції очевидно чинне, а вгадане генератором ламає або
-- писача, або точність грошей. Решта 12 (int/bigint, date/text, jsonb/text,
-- обовʼязковість `organizations.language`) названі в реєстрі
-- `check-schema-drift` і чекають рішення: там зміна типу міняє поведінку
-- запитів, а не лише представлення.
--
-- ── Чому не «полагодити генератор і забути» ─────────────────────────────
--
-- Генератор полагоджено теж (мапа OVERRIDE у `scripts/pg-schema.mjs`), і
-- новий клієнт відсьогодні дістає правильні типи. Але бази, ЗАВЕДЕНІ з
-- попереднього `schema.sql`, уже існують — і мовчать: рядок не пишеться,
-- ставка ПДВ лежить подвійною точністю. Тому вирівнювання і тут.
--
-- Ідемпотентно: питає КАТАЛОГ про фактичний тип, а не журнал міграцій.
-- Там, де тип уже правильний, не робиться нічого.

BEGIN;

DO $$
DECLARE
  r RECORD;
  cur TEXT;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      -- прапорці: писач передає true/false, BIGINT відхиляє це на місці
      ('fin_payment_methods', 'settles_to_debtor', 'boolean',       'settles_to_debtor <> 0', 'false'),
      ('invoice_series',      'reset_yearly',      'boolean',       'reset_yearly <> 0',      'true'),
      -- гроші й ставки: подвійна точність не тримає 0.10 (шапка pg-schema.mjs)
      ('fin_folio_items',        'quantity',   'numeric(12,3)', 'quantity::numeric(12,3)', '1'),
      ('fin_folio_items',        'vat_rate',   'numeric(5,2)',  'vat_rate::numeric(5,2)',  '0'),
      ('fin_invoice_lines',      'quantity',   'numeric(12,3)', 'quantity::numeric(12,3)', '1'),
      ('fin_invoice_lines',      'vat_rate',   'numeric(5,2)',  'vat_rate::numeric(5,2)',  '0'),
      ('fin_invoice_tax_totals', 'vat_rate',   'numeric(5,2)',  'vat_rate::numeric(5,2)',  NULL),
      ('fin_tax_rates',          'rate',       'numeric(5,2)',  'rate::numeric(5,2)',      NULL),
      ('organization_invoicing', 'buyer_name_threshold', 'numeric(14,2)',
                                 'buyer_name_threshold::numeric(14,2)', NULL),
      -- і назад: «days» затягнулось у шаблон грошей і стало NUMERIC(14,2)
      ('organization_invoicing', 'due_days',   'bigint',        'due_days::bigint',        '14')
    ) AS v(tbl, col, want, using_expr, dflt)
  LOOP
    IF to_regclass(format('public.%I', r.tbl)) IS NULL THEN
      CONTINUE;
    END IF;

    SELECT format_type(a.atttypid, a.atttypmod) INTO cur
      FROM pg_attribute a
     WHERE a.attrelid = format('public.%I', r.tbl)::regclass
       AND a.attname = r.col AND a.attnum > 0 AND NOT a.attisdropped;

    IF cur IS NULL OR cur = r.want THEN
      CONTINUE;
    END IF;

    -- Дефолт знімається ПЕРШИМ: `0` проти BOOLEAN Postgres не приводить сам,
    -- і зміна типу відмовила б через нього, а не через дані.
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I DROP DEFAULT', r.tbl, r.col);
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I TYPE %s USING (%s)',
                   r.tbl, r.col, r.want, r.using_expr);
    IF r.dflt IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET DEFAULT %s', r.tbl, r.col, r.dflt);
    END IF;

    RAISE NOTICE '0304: %.% % -> %', r.tbl, r.col, cur, r.want;
  END LOOP;
END $$;

COMMIT;
