-- Похідний тариф (Блок 2 крок 2, Ц28) — правило поверх іншого тарифу.
--
-- Ціна доби похідного = ціна базового тарифу на цю дату (власний рядок бази,
-- а без нього — базовий рядок типу) ± коригування: відсоток або сума, вгору
-- чи вниз. Своїх клітинок сезону він не має; ціна РЕНДЕРИТЬСЯ в
-- `price_calendar` рядком тарифу з `source = 'derived'` тим самим писачем,
-- що масовий редактор і сезони — щоб канал отримав число (`derived_option`
-- Channex не використовуємо, Ц7). Зміна бази перерендерює похідні; точкове
-- перевизначення дати (`manual` з ціною) перерендер обходить.
--
-- Словники закриті (docs/NAMING.md): pricing_type manual|derived,
-- adjustment_kind percent|fixed, adjustment_direction increase|decrease.
-- «Похідний від похідного» відмовляє писач (`based_on_invalid`), не схема:
-- ланцюжок правил ніхто не прочитає. Валюта похідного — валюта бази.

ALTER TABLE rate_plans ADD COLUMN IF NOT EXISTS pricing_type TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE rate_plans ADD COLUMN IF NOT EXISTS based_on_rate_plan_id TEXT;
ALTER TABLE rate_plans ADD COLUMN IF NOT EXISTS adjustment_kind TEXT;
ALTER TABLE rate_plans ADD COLUMN IF NOT EXISTS adjustment_value NUMERIC(14,2);
ALTER TABLE rate_plans ADD COLUMN IF NOT EXISTS adjustment_direction TEXT;

-- Констрейнти — за ОЗНАЧЕННЯМ, не за іменем (AGENTS §4).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'rate_plans'::regclass AND contype = 'c'
                   AND pg_get_constraintdef(oid) LIKE '%pricing_type%') THEN
    ALTER TABLE rate_plans ADD CONSTRAINT rate_plans_pricing_type_check CHECK (pricing_type IN ('manual', 'derived'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'rate_plans'::regclass AND contype = 'c'
                   AND pg_get_constraintdef(oid) LIKE '%adjustment_kind%') THEN
    ALTER TABLE rate_plans ADD CONSTRAINT rate_plans_adjustment_kind_check CHECK (adjustment_kind IN ('percent', 'fixed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'rate_plans'::regclass AND contype = 'c'
                   AND pg_get_constraintdef(oid) LIKE '%adjustment_direction%') THEN
    ALTER TABLE rate_plans ADD CONSTRAINT rate_plans_adjustment_direction_check CHECK (adjustment_direction IN ('increase', 'decrease'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'rate_plans'::regclass AND contype = 'f'
                   AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (based_on_rate_plan_id) REFERENCES%') THEN
    ALTER TABLE rate_plans ADD CONSTRAINT fk_rate_plans_based_on_rate_plan_id_2
      FOREIGN KEY (based_on_rate_plan_id) REFERENCES rate_plans (id);
  END IF;
END $$;

-- `derived` серед джерел ціни календаря (0068 знав три). CHECK замінюється
-- цілком: імʼя довільне — на свіжій базі його дав schema.sql, на мігрованій —
-- 0068; шукаємо за означенням і не чіпаємо, якщо «derived» уже є.
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
            WHERE conrelid = 'price_calendar'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%source%'
  LOOP
    IF c.def NOT LIKE '%derived%' THEN
      EXECUTE format('ALTER TABLE price_calendar DROP CONSTRAINT %I', c.conname);
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'price_calendar'::regclass AND contype = 'c'
                   AND pg_get_constraintdef(oid) LIKE '%source%') THEN
    ALTER TABLE price_calendar ADD CONSTRAINT price_calendar_source_check
      CHECK (source IN ('season', 'manual', 'import', 'derived'));
  END IF;
END $$;
