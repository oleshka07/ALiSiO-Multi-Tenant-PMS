-- 0404: імпорт Winhotel памʼятає, який рядок Winhotel став яким нашим, і
-- складає окремо те, чого ядро ще не вміє.
--
-- Частина Б застосунку `winhotel_import` (docs/tasks/2026-09-10-block-winhotel-import.md
-- §2.5): дві таблиці застосунку, обидві тенантні, з RLS; у таблиці ядра нових
-- колонок не додається (§1 задачі).
--
-- `winhotel_refs` — відповідність «рядок Winhotel → наш рядок»: сутність
-- (`address`, `company`, `reservation`, `folio_line`, `payment`, …), `LNR`
-- Winhotel і наш id. ТІЛЬКИ через неї повторний імпорт знаходить свій рядок;
-- `fingerprint` — відбиток полів, з яких рядок був зроблений: той самий
-- відбиток на наступному знімку означає «нічого не змінилось» без читання
-- нашого рядка (частина таблиць ядра не має дверей на читання для застосунку).
--
-- `winhotel_staging` — те, що з бази готелю прийшло, а покласти в ядро немає
-- куди або немає дверей (`CORE-GAPS.md`): заморожені фактури з чужою
-- нумерацією, способи оплати поза чотирма класами, готівка на німецькому
-- обʼєкті до TSE (фіскальна варта), згоди GDPR, касова книга, сальдо. Повний
-- JSON рядка і ПРИЧИНА словом; лічильник іде у звіт імпорту. Нічого не
-- губиться і нічого не імітується (§1 задачі: «втрата даних неприпустима,
-- підробка ядра — теж»). Один рядок на (організація, сутність, LNR):
-- наступний знімок оновлює payload, а не дублює.
--
-- SQLite-дзеркало — `src/lib/db.ts`, `migrateWinhotelImport()`.

CREATE TABLE IF NOT EXISTS winhotel_refs (
  id              TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  entity          TEXT NOT NULL,
  winhotel_lnr    BIGINT NOT NULL,
  our_id          TEXT NOT NULL,
  fingerprint     TEXT,
  created_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  UNIQUE (organization_id, entity, winhotel_lnr)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'winhotel_refs'::regclass AND contype = 'f'
       AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (organization_id) REFERENCES%'
  ) THEN
    ALTER TABLE winhotel_refs ADD CONSTRAINT fk_winhotel_refs_organization_id_1
      FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_winhotel_refs_org ON winhotel_refs (organization_id);
CREATE INDEX IF NOT EXISTS idx_winhotel_refs_our ON winhotel_refs (organization_id, entity, our_id);

ALTER TABLE winhotel_refs ALTER COLUMN organization_id
  SET DEFAULT NULLIF(current_setting('app.organization_id', true), '');

ALTER TABLE winhotel_refs ENABLE ROW LEVEL SECURITY;
ALTER TABLE winhotel_refs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS winhotel_refs_tenant ON winhotel_refs;
CREATE POLICY winhotel_refs_tenant ON winhotel_refs
  USING (organization_id = current_setting('app.organization_id'))
  WITH CHECK (organization_id = current_setting('app.organization_id'));

CREATE TABLE IF NOT EXISTS winhotel_staging (
  id              TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  snapshot_id     TEXT,
  entity          TEXT NOT NULL,
  winhotel_lnr    BIGINT NOT NULL,
  reason          TEXT NOT NULL,
  payload_json    JSONB,
  created_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  UNIQUE (organization_id, entity, winhotel_lnr)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'winhotel_staging'::regclass AND contype = 'f'
       AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (organization_id) REFERENCES%'
  ) THEN
    ALTER TABLE winhotel_staging ADD CONSTRAINT fk_winhotel_staging_organization_id_1
      FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_winhotel_staging_org ON winhotel_staging (organization_id);
CREATE INDEX IF NOT EXISTS idx_winhotel_staging_entity ON winhotel_staging (organization_id, entity, reason);

ALTER TABLE winhotel_staging ALTER COLUMN organization_id
  SET DEFAULT NULLIF(current_setting('app.organization_id', true), '');

ALTER TABLE winhotel_staging ENABLE ROW LEVEL SECURITY;
ALTER TABLE winhotel_staging FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS winhotel_staging_tenant ON winhotel_staging;
CREATE POLICY winhotel_staging_tenant ON winhotel_staging
  USING (organization_id = current_setting('app.organization_id'))
  WITH CHECK (organization_id = current_setting('app.organization_id'));
