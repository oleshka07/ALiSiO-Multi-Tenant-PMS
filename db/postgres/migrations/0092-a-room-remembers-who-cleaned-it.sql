-- Історія прибирання: хто, коли і з якого стану перевів номер.
--
-- Блок 4 «День готелю» §2.2 (docs/tasks/2026-09-06-block-4-hotel-day.md);
-- джерело форми — Hoteliera, Housekeeping Board / Cleaning History і блок
-- «Recent Cleaning Activity» на дашборді. `units.cleaning_status`
-- (`clean | dirty | in_progress`) досі міняли мовчки — PATCH номера з
-- налаштувань, чекліст зміни на телефоні; тепер його міняє ще й виселення
-- (номер стає `dirty` у тій самій транзакції, що статус броні). Без журналу
-- «хто прибрав 203 і коли» не мало відповіді.
--
-- Рядок = одна зміна стану одного номера. `source`: `manual` — борд або
-- чекліст, `checkout` — автоматика виселення; вільний рядок, не CHECK.
-- `changed_by` — FK на app_users: невідомий автор — відмова, а не порожній
-- рядок; NULL лишається для автоматики без людини. Пише лише модуль
-- `properties` (`data/cleaning.repo.ts`), читає housekeeping через фасад.
--
-- SQLite-дзеркало — `src/lib/db.ts`, блок «0092» у кінці runMigrations.

CREATE TABLE IF NOT EXISTS unit_cleaning_log (
  id              TEXT DEFAULT encode(gen_random_bytes(16), 'hex') NOT NULL,
  organization_id TEXT NOT NULL,
  unit_id         TEXT NOT NULL,
  from_status     TEXT NOT NULL,
  to_status       TEXT NOT NULL,
  source          TEXT DEFAULT 'manual' NOT NULL,
  changed_by      TEXT,
  changed_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
  note            TEXT,
  PRIMARY KEY (id)
);

-- Зовнішні ключі за ОЗНАЧЕННЯМ, не за іменем (0052, AGENTS §4).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'unit_cleaning_log'::regclass AND contype = 'f'
       AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (changed_by) REFERENCES%'
  ) THEN
    ALTER TABLE unit_cleaning_log ADD CONSTRAINT fk_unit_cleaning_log_changed_by_1
      FOREIGN KEY (changed_by) REFERENCES app_users (id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'unit_cleaning_log'::regclass AND contype = 'f'
       AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (unit_id) REFERENCES%'
  ) THEN
    ALTER TABLE unit_cleaning_log ADD CONSTRAINT fk_unit_cleaning_log_unit_id_2
      FOREIGN KEY (unit_id) REFERENCES units (id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'unit_cleaning_log'::regclass AND contype = 'f'
       AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (organization_id) REFERENCES%'
  ) THEN
    ALTER TABLE unit_cleaning_log ADD CONSTRAINT fk_unit_cleaning_log_organization_id_3
      FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_unit_cleaning_log_org ON unit_cleaning_log (organization_id, changed_at);
CREATE INDEX IF NOT EXISTS idx_unit_cleaning_log_unit ON unit_cleaning_log (unit_id, changed_at);

ALTER TABLE unit_cleaning_log ALTER COLUMN organization_id
  SET DEFAULT NULLIF(current_setting('app.organization_id', true), '');

ALTER TABLE unit_cleaning_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE unit_cleaning_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS unit_cleaning_log_tenant ON unit_cleaning_log;
CREATE POLICY unit_cleaning_log_tenant ON unit_cleaning_log
  USING (organization_id = current_setting('app.organization_id'))
  WITH CHECK (organization_id = current_setting('app.organization_id'));
