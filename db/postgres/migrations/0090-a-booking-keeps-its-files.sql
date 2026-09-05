-- Вкладення до броні.
--
-- Блок 4 «День готелю», картка броні з вкладками (docs/tasks/2026-09-06-block-4-hotel-day.md
-- §2.1, джерело форми — Hoteliera, вкладка «Files»). Досі файл можна було
-- покласти лише в `api/file-upload` без прив'язки до чогось: шлях казав, чий
-- готель, і не казав, до якої броні. Рецепція тримала скани й підтвердження
-- поза системою.
--
-- Рядок = один файл однієї броні: хто поклав, коли, під якою назвою, якого
-- типу. Сам файл лежить у тому ж сховищі `data/uploads/<org>/reservations/…`,
-- що й решта вкладень, і читається тим самим `GET /api/uploads`, який звіряє
-- організацію в шляху. `organization_id` явно в рядку (інваріант 12) — не
-- лише в шляху.
--
-- Ретенція — разом із бронню (ON DELETE CASCADE). GDPR-цикл знеособлення цю
-- таблицю не чіпає: файл броні не є персональними даними гостя в розумінні
-- знеособлення реєстрації, а стирання гостя за запитом іде окремим шляхом.
--
-- `kind` — вільний рядок (`document`, `photo`, `other`), не CHECK: словник
-- вкладень не має вимагати міграції.
--
-- SQLite-дзеркало — `src/lib/db.ts`, блок «0090» у кінці runMigrations.

CREATE TABLE IF NOT EXISTS reservation_files (
  id              TEXT DEFAULT encode(gen_random_bytes(16), 'hex') NOT NULL,
  organization_id TEXT NOT NULL,
  reservation_id  TEXT NOT NULL,
  kind            TEXT DEFAULT 'other' NOT NULL,
  path            TEXT NOT NULL,
  original_name   TEXT NOT NULL,
  mime_type       TEXT,
  size_bytes      BIGINT DEFAULT 0 NOT NULL,
  uploaded_by     TEXT,
  created_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);

-- Зовнішні ключі за ОЗНАЧЕННЯМ, не за іменем (0052, AGENTS §4): на свіжій базі
-- ці ж ключі вже створив schema.sql під своїми іменами.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'reservation_files'::regclass AND contype = 'f'
       AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (reservation_id) REFERENCES%'
  ) THEN
    ALTER TABLE reservation_files ADD CONSTRAINT fk_reservation_files_reservation_id_1
      FOREIGN KEY (reservation_id) REFERENCES reservations (id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'reservation_files'::regclass AND contype = 'f'
       AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (organization_id) REFERENCES%'
  ) THEN
    ALTER TABLE reservation_files ADD CONSTRAINT fk_reservation_files_organization_id_2
      FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_reservation_files_org ON reservation_files (organization_id);
-- Картка читає «файли цієї броні за часом».
CREATE INDEX IF NOT EXISTS idx_reservation_files_reservation ON reservation_files (reservation_id, created_at);

-- Орендар вставленого рядка — той, ким уже біжить зʼєднання (0005); NULLIF,
-- щоб «орендаря не встановили» лишалось помилкою, а не порожньою організацією.
ALTER TABLE reservation_files ALTER COLUMN organization_id
  SET DEFAULT NULLIF(current_setting('app.organization_id', true), '');

ALTER TABLE reservation_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservation_files FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reservation_files_tenant ON reservation_files;
CREATE POLICY reservation_files_tenant ON reservation_files
  USING (organization_id = current_setting('app.organization_id'))
  WITH CHECK (organization_id = current_setting('app.organization_id'));
