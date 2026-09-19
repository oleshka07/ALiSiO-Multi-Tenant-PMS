-- 0421: зображення обʼєкта, названі РОЛЯМИ.
--
-- ── Навіщо ────────────────────────────────────────────────────────────────
--
-- Оператор має завантажити лого й кілька фірмових зображень один раз, а
-- застосунки — брати їх звідти. Сьогодні лого лежить колонкою
-- `properties.brand_logo_url` (0419), і цього досить рівно для одного лого.
--
-- ── Чому таблиця, а не ще колонки ─────────────────────────────────────────
--
-- Бо просили саме «щоб потім можна було витягнути в інші застосунки»: нова
-- роль у колонковому варіанті — це щоразу міграція, а тут рядок із іншим
-- `role`, тобто зміна в ОДНОМУ файлі коду (`core/brand-assets.ts`).
--
-- І чому не `property_photos`: та таблиця — галерея (багато рядків, порядок,
-- підпис), її читає гостьовий портал запитом БЕЗ фільтра. Лого, покладене
-- туди, зʼявилось би серед фотографій готелю на екрані гостя. Тут інша форма:
-- рівно один рядок на роль (UNIQUE нижче), без порядку й підпису.
--
-- ── Попередження, куплене дорого ─────────────────────────────────────────
--
-- Типізовані фото обʼєкта тут УЖЕ робили: `property_photos.photo_type` із
-- CHECK на building/territory/common/aerial. Її немає — вона в `DEAD_COLUMNS`
-- у `src/lib/db.ts`, тобто її знесли як мертву: писач був, читача не було
-- жодного. Тому в реєстрі ролей кожна роль НАЗИВАЄ свого читача, і
-- `brand-assets.check` це стверджує. CHECK на `role` тут свідомо немає з того
-- ж міркування, що в 0410 і 0419: нова роль не має вимагати міграції бази;
-- слово звіряє код (`readBrandAssetRole`), а невідоме просто не показується.
--
-- ── Лого переїжджає, а не дублюється ──────────────────────────────────────
--
-- `properties.brand_logo_url` переноситься в роль 'logo' і ОЧИЩАЄТЬСЯ. Дві
-- адреси одного лого — це два джерела одного факту, і відповідала б та, кого
-- спитали останнім: клас запасного 'CZK'. Дані не гинуть — вони в новій
-- таблиці; колонка лишається порожньою й піде під прибиральник мертвих даних.
--
-- Ціна названа: `deploy.sh` накочує міграції МІЖ збіркою і рестартом, тож
-- кілька секунд старий код читає вже очищену колонку і не показує лого.
-- Косметика на секунди, без втрати даних.

CREATE TABLE IF NOT EXISTS property_brand_assets (
  id TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(16), 'hex'),
  organization_id TEXT NOT NULL,
  property_id TEXT NOT NULL,
  role TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ключі — ОКРЕМО від CREATE, і питаються за ОЗНАЧЕННЯМ, а не за іменем.
-- `ADD CONSTRAINT IF NOT EXISTS` у Postgres немає, а на свіжій базі ті самі
-- два ключі вже поставив `db/postgres/schema.sql` під СВОЇМИ іменами
-- (генератор нумерує їх у своєму порядку). Сторож за `conname` не впізнав би
-- їх і додав би ДРУГІ такі самі — рівно те, чим 0048, 0052 і 0053 дали разом
-- сім пар (AGENTS §4).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'property_brand_assets'::regclass AND contype = 'f'
       AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (property_id) REFERENCES%'
  ) THEN
    ALTER TABLE property_brand_assets ADD CONSTRAINT fk_property_brand_assets_property_id_1
      FOREIGN KEY (property_id) REFERENCES properties (id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'property_brand_assets'::regclass AND contype = 'f'
       AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (organization_id) REFERENCES%'
  ) THEN
    ALTER TABLE property_brand_assets ADD CONSTRAINT fk_property_brand_assets_organization_id_2
      FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE;
  END IF;
END $$;

-- Один рядок на роль: «дві обкладинки» не мають сенсу, а екран, який дістав
-- би дві, обирав би за порядком рядків від бази (клас INC-027).
CREATE UNIQUE INDEX IF NOT EXISTS idx_property_brand_assets_role
  ON property_brand_assets (property_id, role);
CREATE INDEX IF NOT EXISTS idx_property_brand_assets_org
  ON property_brand_assets (organization_id);

ALTER TABLE property_brand_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE property_brand_assets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS property_brand_assets_tenant ON property_brand_assets;
CREATE POLICY property_brand_assets_tenant ON property_brand_assets
  USING (organization_id = current_setting('app.organization_id'))
  WITH CHECK (organization_id = current_setting('app.organization_id'));

-- Перенесення. Ідемпотентне з обох боків: ON CONFLICT нічого не псує на
-- другому проході, а очищення колонки на другому проході вже нічого не знайде.
INSERT INTO property_brand_assets (organization_id, property_id, role, url)
SELECT p.organization_id, p.id, 'logo', p.brand_logo_url
  FROM properties p
 WHERE p.brand_logo_url IS NOT NULL AND TRIM(p.brand_logo_url) <> ''
ON CONFLICT (property_id, role) DO NOTHING;

UPDATE properties SET brand_logo_url = NULL
 WHERE brand_logo_url IS NOT NULL AND TRIM(brand_logo_url) <> '';
