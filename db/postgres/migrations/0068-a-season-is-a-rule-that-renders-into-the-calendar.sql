-- Сезони (Блок 2 крок 1, Ц27): сутність, клітинка ціни сезон × тип × тариф,
-- і джерело кожного рядка календаря.
--
-- ── Сезон — правило, яке рендериться в календар ──────────────────────────────
--
-- `seasons` — дати обʼєкта (обидві межі включно, NAMING §2), без перетинів у
-- межах обʼєкта (тримає писач і гейт `seasons.repo.check`; інтервальне
-- обмеження в схемі не ставиться, бо SQLite його не вміє, а схема одна на два
-- двигуни). `season_prices` — одна клітинка на сезон × тип × тариф;
-- `rate_plan_id` NULL — базова ціна типу в сезоні.
--
-- Клітинка НЕ читається котируванням. Запис клітинки РЕНДЕРИТЬ ночі сезону в
-- `price_calendar` тим самим писачем, що й масовий редактор
-- (`bulkUpdatePrices`): через двері `@channels/outbox` у тій самій
-- транзакції, одним діапазоном на пару на весь сезон (Ц15), з маскою полів
-- (Ц34). Канал і віджет читають календар, як і досі — інваріант 16 цілий,
-- другого джерела ціни не зʼявляється.
--
-- ── `price_calendar.source` ──────────────────────────────────────────────────
--
-- `season` — розгорнуто з клітинки; `manual` — редактор дня чи масовий, тобто
-- точкове перевизначення дати, яке перерендер сезону НЕ затирає (їхній
-- `overridden_from`); прибрати перевизначення — окрема дія. `import` — файл
-- готелю. Усі наявні рядки — `manual`: набрані рукою до сезонів і є
-- перевизначеннями; сезон, заведений поверх них, застосується лише там, де
-- ціни ще не було, або після «прибрати перевизначення». Обмеження джерела не
-- мають — вони живуть на базовому рядку типу незалежно від ціни.

ALTER TABLE price_calendar ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'price_calendar'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%source%'
  ) THEN
    ALTER TABLE price_calendar ADD CONSTRAINT price_calendar_source_check
      CHECK (source IN ('season', 'manual', 'import'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS seasons (
  id              TEXT DEFAULT encode(gen_random_bytes(16), 'hex') NOT NULL,
  organization_id TEXT NOT NULL,
  property_id     TEXT NOT NULL,
  name            TEXT NOT NULL,
  date_from       DATE NOT NULL,
  date_to         DATE NOT NULL,
  sort_order      INTEGER DEFAULT 0 NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS season_prices (
  id              TEXT DEFAULT encode(gen_random_bytes(16), 'hex') NOT NULL,
  organization_id TEXT NOT NULL,
  season_id       TEXT NOT NULL,
  unit_type_id    TEXT NOT NULL,
  rate_plan_id    TEXT,
  price           NUMERIC(14,2) NOT NULL,
  weekend_price   NUMERIC(14,2),
  created_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);

-- Зовнішні ключі за ОЗНАЧЕННЯМ, не за іменем (0052, AGENTS §4).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'seasons'::regclass AND contype = 'f'
                   AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (organization_id) REFERENCES%') THEN
    ALTER TABLE seasons ADD CONSTRAINT fk_seasons_organization_id_1
      FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'seasons'::regclass AND contype = 'f'
                   AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (property_id) REFERENCES%') THEN
    ALTER TABLE seasons ADD CONSTRAINT fk_seasons_property_id_2
      FOREIGN KEY (property_id) REFERENCES properties (id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'season_prices'::regclass AND contype = 'f'
                   AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (organization_id) REFERENCES%') THEN
    ALTER TABLE season_prices ADD CONSTRAINT fk_season_prices_organization_id_1
      FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'season_prices'::regclass AND contype = 'f'
                   AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (season_id) REFERENCES%') THEN
    ALTER TABLE season_prices ADD CONSTRAINT fk_season_prices_season_id_2
      FOREIGN KEY (season_id) REFERENCES seasons (id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'season_prices'::regclass AND contype = 'f'
                   AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (unit_type_id) REFERENCES%') THEN
    ALTER TABLE season_prices ADD CONSTRAINT fk_season_prices_unit_type_id_3
      FOREIGN KEY (unit_type_id) REFERENCES unit_types (id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'season_prices'::regclass AND contype = 'f'
                   AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (rate_plan_id) REFERENCES%') THEN
    ALTER TABLE season_prices ADD CONSTRAINT fk_season_prices_rate_plan_id_4
      FOREIGN KEY (rate_plan_id) REFERENCES rate_plans (id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_seasons_org ON seasons (organization_id);
CREATE INDEX IF NOT EXISTS idx_seasons_property ON seasons (property_id, date_from);
CREATE INDEX IF NOT EXISTS idx_season_prices_org ON season_prices (organization_id);
-- Одна клітинка на сезон × тип × тариф; COALESCE — UNIQUE не обмежує NULL.
CREATE UNIQUE INDEX IF NOT EXISTS idx_season_prices_cell
  ON season_prices (season_id, unit_type_id, (COALESCE(rate_plan_id, '')));

ALTER TABLE seasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE seasons FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS seasons_tenant ON seasons;
CREATE POLICY seasons_tenant ON seasons
  USING (organization_id = current_setting('app.organization_id'))
  WITH CHECK (organization_id = current_setting('app.organization_id'));

ALTER TABLE season_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE season_prices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS season_prices_tenant ON season_prices;
CREATE POLICY season_prices_tenant ON season_prices
  USING (organization_id = current_setting('app.organization_id'))
  WITH CHECK (organization_id = current_setting('app.organization_id'));
