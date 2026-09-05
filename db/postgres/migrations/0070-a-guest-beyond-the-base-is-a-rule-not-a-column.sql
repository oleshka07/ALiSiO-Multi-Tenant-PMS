-- Надбавки за заселеність (Блок 2 крок 3, Ц30) — правило, не колонка.
--
-- Ніч = ціна тарифу за `base_occupancy` дорослих + надбавка за кожного
-- дорослого понад базу + надбавка за кожну дитину за її віковою вилкою.
-- Правило — рядок `extra_occupancy_rules`: тариф (NULL = усі), тип (NULL =
-- усі), гість (дорослий | дитина з вилкою або на всі вилки), проживання і
-- харчування — кожне відсотком від ціни ночі або сумою, додаткове ліжко.
-- Точніше правило перебиває загальне (тариф × тип > тариф > тип > усі); два
-- правила однакової точності на одного гостя — відмова писача.
--
-- Вікові вилки — на організації: `child_age_bands` — JSON-список меж
-- (`[3, 12]` → 0–2, 3–11, 12–17; дорослий від 18); `[]` — одна вилка 0–17.
--
-- `rate_plans.child_extra_gross` (0057, Ц12) стає правилом «дитина, усі
-- вилки, проживання сумою» на своєму тарифі — і зникає разом із читачами
-- (інваріант 16: одне джерело). Дитина без правила — ніч без ціни, як і
-- досі без названої ціни (інваріант 17).

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS child_age_bands TEXT NOT NULL DEFAULT '[]';

CREATE TABLE IF NOT EXISTS extra_occupancy_rules (
  id              TEXT DEFAULT encode(gen_random_bytes(16), 'hex') NOT NULL,
  organization_id TEXT NOT NULL,
  property_id     TEXT NOT NULL,
  rate_plan_id    TEXT,
  unit_type_id    TEXT,
  guest_kind      TEXT NOT NULL,
  age_band_index  INTEGER,
  lodging_mode    TEXT,
  lodging_value   NUMERIC(14,2),
  meal_mode       TEXT,
  meal_value      NUMERIC(14,2),
  extra_bed       BOOLEAN DEFAULT FALSE NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'extra_occupancy_rules'::regclass AND contype = 'c'
                   AND pg_get_constraintdef(oid) LIKE '%guest_kind%') THEN
    ALTER TABLE extra_occupancy_rules ADD CONSTRAINT extra_occupancy_rules_guest_kind_check CHECK (guest_kind IN ('adult', 'child'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'extra_occupancy_rules'::regclass AND contype = 'c'
                   AND pg_get_constraintdef(oid) LIKE '%lodging_mode%') THEN
    ALTER TABLE extra_occupancy_rules ADD CONSTRAINT extra_occupancy_rules_lodging_mode_check CHECK (lodging_mode IN ('fixed', 'percent'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'extra_occupancy_rules'::regclass AND contype = 'c'
                   AND pg_get_constraintdef(oid) LIKE '%meal_mode%') THEN
    ALTER TABLE extra_occupancy_rules ADD CONSTRAINT extra_occupancy_rules_meal_mode_check CHECK (meal_mode IN ('fixed', 'percent'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'extra_occupancy_rules'::regclass AND contype = 'f'
                   AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (organization_id) REFERENCES%') THEN
    ALTER TABLE extra_occupancy_rules ADD CONSTRAINT fk_extra_occupancy_rules_organization_id_1
      FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'extra_occupancy_rules'::regclass AND contype = 'f'
                   AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (property_id) REFERENCES%') THEN
    ALTER TABLE extra_occupancy_rules ADD CONSTRAINT fk_extra_occupancy_rules_property_id_2
      FOREIGN KEY (property_id) REFERENCES properties (id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'extra_occupancy_rules'::regclass AND contype = 'f'
                   AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (rate_plan_id) REFERENCES%') THEN
    ALTER TABLE extra_occupancy_rules ADD CONSTRAINT fk_extra_occupancy_rules_rate_plan_id_3
      FOREIGN KEY (rate_plan_id) REFERENCES rate_plans (id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'extra_occupancy_rules'::regclass AND contype = 'f'
                   AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (unit_type_id) REFERENCES%') THEN
    ALTER TABLE extra_occupancy_rules ADD CONSTRAINT fk_extra_occupancy_rules_unit_type_id_4
      FOREIGN KEY (unit_type_id) REFERENCES unit_types (id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_extra_occupancy_rules_org ON extra_occupancy_rules (organization_id);
CREATE INDEX IF NOT EXISTS idx_extra_occupancy_rules_property ON extra_occupancy_rules (property_id);

ALTER TABLE extra_occupancy_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE extra_occupancy_rules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS extra_occupancy_rules_tenant ON extra_occupancy_rules;
CREATE POLICY extra_occupancy_rules_tenant ON extra_occupancy_rules
  USING (organization_id = current_setting('app.organization_id'))
  WITH CHECK (organization_id = current_setting('app.organization_id'));

-- Ціна дитини з тарифу → правило на цьому тарифі; колонка йде разом із читачами.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'rate_plans' AND column_name = 'child_extra_gross') THEN
    INSERT INTO extra_occupancy_rules (id, organization_id, property_id, rate_plan_id, unit_type_id, guest_kind, age_band_index, lodging_mode, lodging_value, meal_mode, meal_value, extra_bed)
    SELECT encode(gen_random_bytes(16), 'hex'), p.organization_id, rp.property_id, rp.id, NULL, 'child', NULL, 'fixed', rp.child_extra_gross, NULL, NULL, FALSE
      FROM rate_plans rp JOIN properties p ON p.id = rp.property_id
     WHERE rp.child_extra_gross IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM extra_occupancy_rules r WHERE r.rate_plan_id = rp.id AND r.unit_type_id IS NULL AND r.guest_kind = 'child' AND r.age_band_index IS NULL);
    ALTER TABLE rate_plans DROP COLUMN child_extra_gross;
  END IF;
END $$;
