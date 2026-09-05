-- Правила цін і промо (Блок 2 крок 4, Ц31; Hoteliera «Price rules» / «Promos»).
--
-- Правило — знижка або надбавка до ціни ночі ПІСЛЯ надбавок за заселеність
-- (Ц30) і ДО зборів. Умови: період (проживання — по ночах; заїзду або виїзду
-- — на всю поїздку), дні тижня, тарифи й типи списками (NULL = усі),
-- тривалість, за скільки днів заброньовано (раннє бронювання / останній
-- момент), заселеність. Дія — мінус чи плюс, відсотком від поточної ціни ночі
-- або сумою; кілька правил — за пріоритетом, кожне на результат попереднього.
--
-- Промо — те саме правило з кодом (`kind = 'promo'`): діє лише коли код
-- названо, лічить використання, може бути «лише онлайн». Одна таблиця на
-- обидва, бо умови й дія в них ті самі — дві таблиці подвоїли б писача й
-- читача.
--
-- Списки — JSON у TEXT: схема одна на два двигуни, а SQLite масивів не має.
-- Промокод унікальний у межах організації без регістру (інваріант 3).

CREATE TABLE IF NOT EXISTS price_rules (
  id                      TEXT DEFAULT encode(gen_random_bytes(16), 'hex') NOT NULL,
  organization_id         TEXT NOT NULL,
  property_id             TEXT NOT NULL,
  name                    TEXT NOT NULL,
  title_for_guest         TEXT,
  kind                    TEXT DEFAULT 'rule' NOT NULL,
  code                    TEXT,
  condition_kind          TEXT,
  date_from               TEXT,
  date_to                 TEXT,
  week_days               TEXT,
  rate_plan_ids           TEXT,
  unit_type_ids           TEXT,
  min_los                 INTEGER,
  max_los                 INTEGER,
  booked_days_before_from INTEGER,
  booked_days_before_to   INTEGER,
  occupancy_from          INTEGER,
  occupancy_to            INTEGER,
  action                  TEXT NOT NULL,
  value                   NUMERIC(14,2) NOT NULL,
  value_kind              TEXT NOT NULL,
  priority                INTEGER DEFAULT 100 NOT NULL,
  is_active               BOOLEAN DEFAULT TRUE NOT NULL,
  online_only             BOOLEAN DEFAULT FALSE NOT NULL,
  max_uses                INTEGER,
  current_uses            INTEGER DEFAULT 0 NOT NULL,
  created_at              TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at              TIMESTAMPTZ DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'price_rules'::regclass AND contype = 'c'
                   AND pg_get_constraintdef(oid) LIKE '%kind = ANY%' AND pg_get_constraintdef(oid) NOT LIKE '%value_kind%' AND pg_get_constraintdef(oid) NOT LIKE '%condition_kind%') THEN
    ALTER TABLE price_rules ADD CONSTRAINT price_rules_kind_check CHECK (kind IN ('rule', 'promo'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'price_rules'::regclass AND contype = 'c'
                   AND pg_get_constraintdef(oid) LIKE '%condition_kind%') THEN
    ALTER TABLE price_rules ADD CONSTRAINT price_rules_condition_kind_check CHECK (condition_kind IN ('period_of_stay', 'period_of_checkin', 'period_of_checkout'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'price_rules'::regclass AND contype = 'c'
                   AND pg_get_constraintdef(oid) LIKE '%action%') THEN
    ALTER TABLE price_rules ADD CONSTRAINT price_rules_action_check CHECK (action IN ('decrease', 'increase'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'price_rules'::regclass AND contype = 'c'
                   AND pg_get_constraintdef(oid) LIKE '%value_kind%') THEN
    ALTER TABLE price_rules ADD CONSTRAINT price_rules_value_kind_check CHECK (value_kind IN ('percent', 'fixed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'price_rules'::regclass AND contype = 'f'
                   AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (organization_id) REFERENCES%') THEN
    ALTER TABLE price_rules ADD CONSTRAINT fk_price_rules_organization_id_1
      FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'price_rules'::regclass AND contype = 'f'
                   AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (property_id) REFERENCES%') THEN
    ALTER TABLE price_rules ADD CONSTRAINT fk_price_rules_property_id_2
      FOREIGN KEY (property_id) REFERENCES properties (id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_price_rules_org ON price_rules (organization_id);
CREATE INDEX IF NOT EXISTS idx_price_rules_property ON price_rules (property_id, priority);
CREATE UNIQUE INDEX IF NOT EXISTS idx_price_rules_promo_code ON price_rules (organization_id, lower(code)) WHERE code IS NOT NULL;

ALTER TABLE price_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_rules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS price_rules_tenant ON price_rules;
CREATE POLICY price_rules_tenant ON price_rules
  USING (organization_id = current_setting('app.organization_id'))
  WITH CHECK (organization_id = current_setting('app.organization_id'));
