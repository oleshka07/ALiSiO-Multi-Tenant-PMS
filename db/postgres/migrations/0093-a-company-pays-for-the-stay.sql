-- Компанії-платники: довідник юросіб, на які виставляється документ.
--
-- Блок 4 «День готелю» §2.3 (docs/tasks/2026-09-06-block-4-hotel-day.md);
-- джерело форми — Hoteliera «Companies» (картка з ID, реєстром, банком,
-- контактами і лічильником гостей) та вибір платника на броні
-- «Individual person / Legal entity».
--
-- Досі компанія на броні існувала лише як СЕМЕРО ВІЛЬНИХ ПОЛІВ
-- `reservations.invoice_company_*`, які рецепція набирала руками на кожну
-- бронь заново — та сама фірма пʼять разів пʼятьма різними написаннями.
-- Тепер компанія — рядок довідника; вибір платника на картці ставить
-- `reservations.company_id` І переписує ті сім полів з довідника: документ
-- (`fin_folios.payer_*`, `invoices` через `invoice_company_*`) читає
-- знімок, а не живий рядок — компанія, що переїде наступного року, не
-- перепише минулорічну фактуру (те саме правило, що в 0024 для платника
-- фоліо).
--
-- `business_id` унікальний В МЕЖАХ ОРГАНІЗАЦІЇ (інваріант 3): дві фірми з
-- одним IČO в одного готелю — помилка вводу; та сама фірма у двох готелів —
-- два рядки. Порожній `business_id` не бʼється ні з чим (часткова
-- унікальність). `archived_at` замість видалення: компанія з бронями
-- лишається в історії, але випадає зі списку вибору.
--
-- SQLite-дзеркало — `src/lib/db.ts`, блок «0093» у кінці runMigrations;
-- `company_id` — і в CREATE reservations, і ALTER-ом.

CREATE TABLE IF NOT EXISTS companies (
  id              TEXT DEFAULT encode(gen_random_bytes(16), 'hex') NOT NULL,
  organization_id TEXT NOT NULL,
  name            TEXT NOT NULL,
  business_id     TEXT,
  vat_id          TEXT,
  registry_no     TEXT,
  address_street  TEXT,
  address_city    TEXT,
  address_zip     TEXT,
  address_country TEXT,
  bank_name       TEXT,
  iban            TEXT,
  bic             TEXT,
  email           TEXT,
  phone           TEXT,
  notes           TEXT,
  archived_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);

-- Зовнішні ключі за ОЗНАЧЕННЯМ, не за іменем (0052, AGENTS §4).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'companies'::regclass AND contype = 'f'
       AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (organization_id) REFERENCES%'
  ) THEN
    ALTER TABLE companies ADD CONSTRAINT fk_companies_organization_id_1
      FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_companies_org ON companies (organization_id, name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_org_business_id
  ON companies (organization_id, business_id) WHERE business_id IS NOT NULL;

ALTER TABLE companies ALTER COLUMN organization_id
  SET DEFAULT NULLIF(current_setting('app.organization_id', true), '');

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS companies_tenant ON companies;
CREATE POLICY companies_tenant ON companies
  USING (organization_id = current_setting('app.organization_id'))
  WITH CHECK (organization_id = current_setting('app.organization_id'));

-- Платник броні. NULL — фізособа (гість), як і досі.
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS company_id TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'reservations'::regclass AND contype = 'f'
       AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (company_id) REFERENCES%'
  ) THEN
    ALTER TABLE reservations ADD CONSTRAINT fk_reservations_company_id_1
      FOREIGN KEY (company_id) REFERENCES companies (id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_reservations_company ON reservations (company_id);
