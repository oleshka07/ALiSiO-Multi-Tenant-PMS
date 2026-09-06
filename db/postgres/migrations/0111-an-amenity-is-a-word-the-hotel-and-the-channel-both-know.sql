-- Блок 5a, п. 2.2: зручності — довідник організації і два призначення.
--
-- До цього «зручності» були вільним текстом у `guest_page_config.amenities`:
-- рядок на тип номера, який ніхто не може ані порахувати, ані перекласти, ані
-- віддати каналу. Готель, у якого «Wi-Fi, сейф, балкон» в одному типі й
-- «wifi/safe/balkon» у другому, для будь-якого читача має дві різні речі.
--
-- Тепер це словник із чотирьох таблиць:
--
--   amenity_categories  розділи каталогу (Загальне, У номері, Ванна…)
--   amenities           сама зручність: код, назва, іконка і ОБЛАСТЬ
--   property_amenities  що є в готелі
--   unit_type_amenities що є в номерах цього типу
--
-- ОБЛАСТЬ (`scope`) — головне поле, і воно не косметика. У джерела форми
-- (Hoteliera) кожна зручність позначена `L`, `R` або `L+R`: ліфт буває лише
-- в будинку, фен — лише в номері, а сніданок у номер — і там, і там.
-- Без цього поля матриця призначення пропонує повісити ліфт на тип номера,
-- і готель це зробить, бо перелік довгий і однаковий.
--
-- Код (`code`) — наш стабільний ключ (`wifi`, `elevator`, `sea_view`), назва —
-- те, що бачить людина її мовою. Мапінг на OTA робиться від коду; назву
-- готель міняє як хоче, і це нічого не ламає.
--
-- `organization_id` у кожній таблиці, включно з призначеннями: правило
-- інваріанта 2 без винятків, і саме воно дає політику без підзапиту.

CREATE TABLE IF NOT EXISTS amenity_categories (
  id TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(16), 'hex'),
  organization_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  sort_order BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

CREATE TABLE IF NOT EXISTS amenities (
  id TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(16), 'hex'),
  organization_id TEXT NOT NULL,
  category_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  -- Ключ іконки, не сама іконка: набір малюється на клієнті, і зберігати тут
  -- SVG означало б, що зміна набору вимагає міграції даних.
  icon TEXT,
  -- 'property' — лише обʼєкт, 'unit_type' — лише тип номера, 'both' — обидва.
  scope TEXT NOT NULL DEFAULT 'both',
  sort_order BIGINT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code),
  CHECK (scope IN ('property', 'unit_type', 'both'))
);

CREATE TABLE IF NOT EXISTS property_amenities (
  id TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(16), 'hex'),
  organization_id TEXT NOT NULL,
  property_id TEXT NOT NULL,
  amenity_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (property_id, amenity_id)
);

CREATE TABLE IF NOT EXISTS unit_type_amenities (
  id TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(16), 'hex'),
  organization_id TEXT NOT NULL,
  unit_type_id TEXT NOT NULL,
  amenity_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (unit_type_id, amenity_id)
);

CREATE INDEX IF NOT EXISTS idx_amenity_categories_org ON amenity_categories(organization_id);
CREATE INDEX IF NOT EXISTS idx_amenities_org ON amenities(organization_id);
CREATE INDEX IF NOT EXISTS idx_amenities_category ON amenities(category_id);
CREATE INDEX IF NOT EXISTS idx_property_amenities_org ON property_amenities(organization_id);
CREATE INDEX IF NOT EXISTS idx_property_amenities_property ON property_amenities(property_id);
CREATE INDEX IF NOT EXISTS idx_unit_type_amenities_org ON unit_type_amenities(organization_id);
CREATE INDEX IF NOT EXISTS idx_unit_type_amenities_type ON unit_type_amenities(unit_type_id);

-- Ключі — за ОЗНАЧЕННЯМ, а не за іменем: на свіжій базі той самий ключ уже
-- створив `schema.sql` під своїм номером, і сторож за `conname` завів би
-- другий такий самий (AGENTS §4).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'amenity_categories'::regclass
       AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (organization_id) REFERENCES%'
  ) THEN
    ALTER TABLE amenity_categories
      ADD CONSTRAINT fk_amenity_categories_organization
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'amenities'::regclass
       AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (organization_id) REFERENCES%'
  ) THEN
    ALTER TABLE amenities
      ADD CONSTRAINT fk_amenities_organization
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'amenities'::regclass
       AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (category_id) REFERENCES%'
  ) THEN
    ALTER TABLE amenities
      ADD CONSTRAINT fk_amenities_category
      FOREIGN KEY (category_id) REFERENCES amenity_categories(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'property_amenities'::regclass
       AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (property_id) REFERENCES%'
  ) THEN
    ALTER TABLE property_amenities
      ADD CONSTRAINT fk_property_amenities_property
      FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'property_amenities'::regclass
       AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (amenity_id) REFERENCES%'
  ) THEN
    ALTER TABLE property_amenities
      ADD CONSTRAINT fk_property_amenities_amenity
      FOREIGN KEY (amenity_id) REFERENCES amenities(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'unit_type_amenities'::regclass
       AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (unit_type_id) REFERENCES%'
  ) THEN
    ALTER TABLE unit_type_amenities
      ADD CONSTRAINT fk_unit_type_amenities_unit_type
      FOREIGN KEY (unit_type_id) REFERENCES unit_types(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'unit_type_amenities'::regclass
       AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (amenity_id) REFERENCES%'
  ) THEN
    ALTER TABLE unit_type_amenities
      ADD CONSTRAINT fk_unit_type_amenities_amenity
      FOREIGN KEY (amenity_id) REFERENCES amenities(id) ON DELETE CASCADE;
  END IF;
END $$;

ALTER TABLE amenity_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE amenity_categories FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS amenity_categories_tenant ON amenity_categories;
CREATE POLICY amenity_categories_tenant ON amenity_categories
  USING (organization_id = current_setting('app.organization_id'))
  WITH CHECK (organization_id = current_setting('app.organization_id'));

ALTER TABLE amenities ENABLE ROW LEVEL SECURITY;
ALTER TABLE amenities FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS amenities_tenant ON amenities;
CREATE POLICY amenities_tenant ON amenities
  USING (organization_id = current_setting('app.organization_id'))
  WITH CHECK (organization_id = current_setting('app.organization_id'));

ALTER TABLE property_amenities ENABLE ROW LEVEL SECURITY;
ALTER TABLE property_amenities FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS property_amenities_tenant ON property_amenities;
CREATE POLICY property_amenities_tenant ON property_amenities
  USING (organization_id = current_setting('app.organization_id'))
  WITH CHECK (organization_id = current_setting('app.organization_id'));

ALTER TABLE unit_type_amenities ENABLE ROW LEVEL SECURITY;
ALTER TABLE unit_type_amenities FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS unit_type_amenities_tenant ON unit_type_amenities;
CREATE POLICY unit_type_amenities_tenant ON unit_type_amenities
  USING (organization_id = current_setting('app.organization_id'))
  WITH CHECK (organization_id = current_setting('app.organization_id'));
