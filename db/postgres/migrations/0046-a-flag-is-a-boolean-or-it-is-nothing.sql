-- Вісім прапорців, які були числами.
--
-- ── Що було зламано ───────────────────────────────────────────────────────
--
-- `unit_types.bookable_online` — прапорець «продається онлайн». У Postgres
-- колонка виходила BIGINT, бо генератор схеми впізнає прапорці за ШАБЛОНОМ
-- ІМЕНІ (`^is_`, `_active$`, …), а `bookable_online` під нього не підпадав.
--
-- Сім запитів у чотирьох публічних маршрутах віджета порівнювали її з `TRUE`:
--
--   widget-config-public   WHERE ut.bookable_online = TRUE
--   widget-calendar-public (×4)
--   widget-availability
--   widget-reserve
--
-- Postgres на це відповідає `operator does not exist: bigint = boolean`, тобто
-- 500. **Публічний віджет — конфіг, календар, доступність і саме бронювання —
-- не працював на Postgres узагалі**, тобто на беті й проді. На SQLite усе було
-- гаразд, бо там `TRUE` це просто 1, і локально ніхто нічого не бачив.
--
-- Разом із ним переводяться ще сім колонок, які так само є прапорцями за
-- змістом і числами за типом. Вони поки не ламались лише тому, що їх ніхто не
-- порівнював із `TRUE` — тобто це була не безпека, а везіння.
--
-- ── Чому саме BOOLEAN, а не «поправити запити на = 1» ─────────────────────
--
-- Інваріант 12 вимагає писати прапорці як `TRUE`/`FALSE`. Поки колонка число,
-- виконати цю вимогу неможливо, і код розходиться: десь `= 1`, десь `= TRUE`,
-- і половина ламається на Postgres. Тип має відповідати змісту — тоді обидва
-- двигуни згодні, і правило можна тримати гейтом.
--
-- Заразом шов навчено приймати JS-булеві на ВХОДІ (`bindable` у
-- `core/db/async.ts`): better-sqlite3 їх не прив'язує, тож раніше код мусив
-- зводити прапорець до 0/1 вручну — і саме звідти бралися числа в
-- BOOLEAN-колонках.
--
-- ── Перетворення ──────────────────────────────────────────────────────────
--
-- `USING (col <> 0)` — 0 стає false, будь-що інше true. NULL лишається NULL,
-- і це важливо для `breakfast_included`: там три стани, і null означає
-- «вирішує правило каналу», а не «без сніданку».
--
-- DEFAULT знімається перед зміною типу і ставиться назад уже булевим: інакше
-- Postgres відмовляється, бо старий DEFAULT (число) не приводиться до нового
-- типу.
--
-- Перезапускна: `information_schema` питається про поточний тип, і вже
-- переведена колонка пропускається.
DO $$
DECLARE
  r RECORD;
  targets CONSTANT text[][] := ARRAY[
    ['unit_types',            'bookable_online',     'true'],
    ['unit_types',            'extra_bed_available', 'false'],
    ['unit_types',            'breakfast_included',  NULL],
    ['categories',            'show_in_tasks',       'true'],
    ['categories',            'show_in_finance',     'false'],
    ['categories',            'show_in_booking',     'true'],
    ['additional_services',   'available_in_widget', 'false'],
    ['organization_invoicing','show_payment_qr',     'false']
  ];
  t text; c text; d text;
  i int;
BEGIN
  FOR i IN 1 .. array_length(targets, 1) LOOP
    t := targets[i][1]; c := targets[i][2]; d := targets[i][3];

    SELECT data_type INTO r FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = t AND column_name = c;
    CONTINUE WHEN NOT FOUND;                 -- колонки немає — нічого робити
    CONTINUE WHEN r.data_type = 'boolean';   -- уже переведена

    EXECUTE format('ALTER TABLE %I ALTER COLUMN %I DROP DEFAULT', t, c);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN %I TYPE BOOLEAN USING (%I <> 0)', t, c, c);
    IF d IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I ALTER COLUMN %I SET DEFAULT %s', t, c, d);
    END IF;

    RAISE NOTICE '  % .% → BOOLEAN', t, c;
  END LOOP;
END $$;
