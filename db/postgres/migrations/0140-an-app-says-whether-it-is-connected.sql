-- 0140: застосунок каже, чи він підключений, а готель — чого йому бракує.
--
-- Блок «Застосунки» (docs/tasks/2026-09-09-block-apps.md §3.3, §3.4).
--
-- Дві нові таблиці, обидві тенантні, наявних даних не чіпають.
--
-- `app_connections` — стан звʼязку із чужою системою, одне місце замість
-- трьох (виняток fiskaly, console.log пошти, мітки cm_connections). Один
-- рядок на (організація, обʼєкт-або-NULL, застосунок): статус, час останнього
-- успіху, час і ТЕКСТ останньої помилки — З7, готель бачить текст.
--
-- Закон: креденшели належать організації (`channel_credentials`), підключення
-- — обʼєкту. `property_id` NULL для пошти (скринька організації) і заповнений
-- для fiskaly (TSE стоїть на обʼєкті, `fin_fiscal_settings.property_id`).
-- Перевіряє писач (`core/app-connections.ts`) і гейт `apps.check.ts`; CHECK у
-- базі не ставиться — база не знає реєстру застосунків.
--
-- Унікальність — по виразу `COALESCE(property_id, '')`: два NULL у UNIQUE
-- не рівні, і пошта організації отримала б рядок на кожен звіт.
--
-- `app_wishes` — попит: готель натиснув «хочу» на застосунку, якого ще немає
-- (З2). Один рядок на (організація, застосунок) — другий натиск не створює
-- другого. Лічильник «скільки готелів хочуть» читає лише постачальник; готель
-- бачить лише свій стан «ви вже позначили».
--
-- Журналу викликів (`app_calls`) НЕМАЄ навмисно (відкликано контролером
-- 09.09): у fiskaly є `fin_fiscal_outages`, у каналів — `cm_sends`/`cm_events`.
--
-- SQLite-дзеркало — `src/lib/db.ts`, `migrateApps()` наприкінці runMigrations.

CREATE TABLE IF NOT EXISTS app_connections (
  id              TEXT DEFAULT encode(gen_random_bytes(16), 'hex') NOT NULL,
  organization_id TEXT NOT NULL,
  property_id     TEXT,
  app             TEXT NOT NULL,
  status          TEXT NOT NULL,
  last_ok_at      TIMESTAMPTZ,
  last_error_at   TIMESTAMPTZ,
  last_error      TEXT,
  updated_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  CHECK (status IN ('connected', 'degraded', 'error', 'disabled'))
);

-- Зовнішні ключі за ОЗНАЧЕННЯМ, не за іменем (0052, AGENTS §4).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'app_connections'::regclass AND contype = 'f'
       AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (organization_id) REFERENCES%'
  ) THEN
    ALTER TABLE app_connections ADD CONSTRAINT fk_app_connections_organization_id_1
      FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'app_connections'::regclass AND contype = 'f'
       AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (property_id) REFERENCES%'
  ) THEN
    ALTER TABLE app_connections ADD CONSTRAINT fk_app_connections_property_id_2
      FOREIGN KEY (property_id) REFERENCES properties (id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_app_connections_org ON app_connections (organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_connections_row
  ON app_connections (organization_id, COALESCE(property_id, ''), app);

ALTER TABLE app_connections ALTER COLUMN organization_id
  SET DEFAULT NULLIF(current_setting('app.organization_id', true), '');

ALTER TABLE app_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_connections FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_connections_tenant ON app_connections;
CREATE POLICY app_connections_tenant ON app_connections
  USING (organization_id = current_setting('app.organization_id'))
  WITH CHECK (organization_id = current_setting('app.organization_id'));

CREATE TABLE IF NOT EXISTS app_wishes (
  id              TEXT DEFAULT encode(gen_random_bytes(16), 'hex') NOT NULL,
  organization_id TEXT NOT NULL,
  app             TEXT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  UNIQUE (organization_id, app)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'app_wishes'::regclass AND contype = 'f'
       AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (organization_id) REFERENCES%'
  ) THEN
    ALTER TABLE app_wishes ADD CONSTRAINT fk_app_wishes_organization_id_1
      FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_app_wishes_org ON app_wishes (organization_id);

ALTER TABLE app_wishes ALTER COLUMN organization_id
  SET DEFAULT NULLIF(current_setting('app.organization_id', true), '');

ALTER TABLE app_wishes ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_wishes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_wishes_tenant ON app_wishes;
CREATE POLICY app_wishes_tenant ON app_wishes
  USING (organization_id = current_setting('app.organization_id'))
  WITH CHECK (organization_id = current_setting('app.organization_id'));
