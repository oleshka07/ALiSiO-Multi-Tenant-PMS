-- 0403: знімок бази Winhotel — рядок в орендаря, перш ніж файл на томі.
--
-- Застосунок `winhotel_import` (docs/tasks/2026-09-10-block-winhotel-import.md
-- §2.2). Агент на сервері готелю щоночі шле gbak-знімок бази Winhotel.MX;
-- приймальний маршрут кладе файл на том `winhotel-snapshots` і пише сюди
-- один рядок: коли знято, яким режимом (готовий бекап / gbak / копія файла),
-- контрольна сума, розмір і стан. Далі стан переводить застосунок, читаючи
-- маркери мосту (`<id>.extracted` / `<id>.failed`), а після імпорту — числа
-- звірки в `counts_json` (частина Б, §2.6).
--
-- Тенантна, з RLS, як усе в застосунку (§1: «таблиці застосунку — свої,
-- `winhotel_*`, з organization_id і RLS; у таблиці ядра нових колонок не
-- додаємо»). Один знімок на добу на організацію — правило писача
-- (`snapshots.repo.ts`), не констрейнт: доба рахується від часу прийому, а
-- повтор того самого sha256 віддає той самий рядок без другого.
--
-- `sha256` унікальний В МЕЖАХ організації: той самий бекап двічі — один
-- рядок; два готелі з однаковим файлом (тестова копія) — два. Табличний
-- UNIQUE, не окремий індекс: генератор `pg-schema.mjs` переказує кожен
-- унікальний індекс SQLite ще й констрейнтом, і окремий індекс дав би новому
-- клієнту два обмеження на одні колонки, а мігрованому — одне
-- (`check-schema-drift`).
--
-- `counts_json` — JSONB, як усі `*_json` (мапа генератора): на Postgres драйвер
-- віддає обʼєкт, на SQLite — рядок; репозиторій зводить обидва до рядка.
--
-- SQLite-дзеркало — `src/lib/db.ts`, `migrateWinhotelImport()`.

CREATE TABLE IF NOT EXISTS winhotel_snapshots (
  id              TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  taken_at        TIMESTAMPTZ,
  mode            TEXT NOT NULL,
  sha256          TEXT NOT NULL,
  size_bytes      BIGINT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'received',
  error           TEXT,
  counts_json     JSONB,
  received_at     TIMESTAMPTZ DEFAULT now() NOT NULL,
  imported_at     TIMESTAMPTZ,
  PRIMARY KEY (id),
  UNIQUE (organization_id, sha256),
  CHECK (status IN ('received', 'extracting', 'extracted', 'imported', 'failed')),
  CHECK (mode IN ('backup', 'gbak', 'copy'))
);

-- Зовнішній ключ за ОЗНАЧЕННЯМ, не за іменем (0052, AGENTS §4).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'winhotel_snapshots'::regclass AND contype = 'f'
       AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (organization_id) REFERENCES%'
  ) THEN
    ALTER TABLE winhotel_snapshots ADD CONSTRAINT fk_winhotel_snapshots_organization_id_1
      FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_winhotel_snapshots_org ON winhotel_snapshots (organization_id);
CREATE INDEX IF NOT EXISTS idx_winhotel_snapshots_received ON winhotel_snapshots (organization_id, received_at);

ALTER TABLE winhotel_snapshots ALTER COLUMN organization_id
  SET DEFAULT NULLIF(current_setting('app.organization_id', true), '');

ALTER TABLE winhotel_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE winhotel_snapshots FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS winhotel_snapshots_tenant ON winhotel_snapshots;
CREATE POLICY winhotel_snapshots_tenant ON winhotel_snapshots
  USING (organization_id = current_setting('app.organization_id'))
  WITH CHECK (organization_id = current_setting('app.organization_id'));
