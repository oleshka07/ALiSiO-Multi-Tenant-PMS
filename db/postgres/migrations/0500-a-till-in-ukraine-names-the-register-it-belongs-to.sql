-- 0500: каса українського обʼєкта називає реєстратор, якому належить,
--       і лишає слід від кожного слова, сказаного йому.
--
-- Модуль юрисдикції `fiscal_ua` (docs/tasks/2026-09-19-ua-fiscal.md, частина А).
-- П8 + інваріант 22: специфічне для однієї країни живе окремим модулем, ядро
-- лишається нейтральним. Тому обидві таблиці мають префікс модуля, і жодна
-- колонка ядра (`fin_folio_payments`, `fin_folios`, `properties`) цією
-- міграцією не змінюється — там не зʼявляється нічого, що називало б країну.
--
-- Дві таблиці, обидві тенантні, наявних даних не чіпають.
--
-- `prro_settings` — реквізити каси ОДНОГО обʼєкта: драйвер, касир, фіскальний
-- номер реєстратора, локальний номер точки, податковий номер. Один рядок на
-- обʼєкт, бо каса стоїть у будинку, а не в рахунку — той самий закон, що для
-- TSE (З11), і та сама причина (INC-029). `driver` за замовчуванням `none`:
-- обʼєкт, якого не налаштували, відмовляє названо, а не обирає провайдера сам.
--
-- `prro_operations` — КОЖНЕ звертання до каси: відкриття зміни, чек, Z-звіт;
-- вдале і невдале. Це водночас реєстр чеків і журнал збоїв, і це одна таблиця
-- навмисно: збій — це операція зі станом `failed`, а два списки довелося б
-- зводити, щоб відповісти на єдине питання, яке в рецепції справді є.
--
-- Окремої таблиці ЗМІН немає навмисно: чи входить Z-звіт у перший реліз —
-- відкритий чекпоінт власника (docs/research/prro-providers.md §2), і таблиця
-- під нерозвʼязане питання це форма, вгадана наперед. Поточна зміна
-- виводиться: останнє `shift_open` без `shift_close` після нього.
--
-- `payment_id` — посилання БЕЗ зовнішнього ключа, і це рішення, а не недогляд
-- (У3). Перший варіант ніс FK на `fin_folio_payments` з ON DELETE SET NULL, і
-- сцена одразу показала, чим це погано: запис у журнал став дією, яка вміє
-- ВПАСТИ. Журнал збоїв, який сам падає, коли посилання не зійшлося, — це
-- тиша рівно там, де потрібен слід, а весь сенс А5 у тому, що гучна відмова
-- краща за мовчазну втрату чека. Журнал фіксує, що було сказано касі на той
-- момент; цілісність тут не варта можливості не записатись.
--
-- SQLite-дзеркало — `src/lib/db.ts`, блок `prro_settings` / `prro_operations`.

CREATE TABLE IF NOT EXISTS prro_settings (
  id                     TEXT DEFAULT encode(gen_random_bytes(16), 'hex') NOT NULL,
  organization_id        TEXT NOT NULL,
  property_id            TEXT NOT NULL,
  driver                 TEXT DEFAULT 'none' NOT NULL,
  cashier_name           TEXT,
  register_fiscal_number TEXT,
  point_local_number     TEXT,
  tax_number             TEXT,
  created_at             TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at             TIMESTAMPTZ DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  UNIQUE (property_id),
  CHECK (driver IN ('none', 'test'))
);

-- Зовнішні ключі за ОЗНАЧЕННЯМ, не за іменем (0052, AGENTS §4).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'prro_settings'::regclass AND contype = 'f'
       AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (organization_id) REFERENCES%'
  ) THEN
    ALTER TABLE prro_settings ADD CONSTRAINT fk_prro_settings_organization_id_1
      FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'prro_settings'::regclass AND contype = 'f'
       AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (property_id) REFERENCES%'
  ) THEN
    ALTER TABLE prro_settings ADD CONSTRAINT fk_prro_settings_property_id_2
      FOREIGN KEY (property_id) REFERENCES properties (id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_prro_settings_org ON prro_settings (organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_prro_settings_row ON prro_settings (property_id);

ALTER TABLE prro_settings ALTER COLUMN organization_id
  SET DEFAULT NULLIF(current_setting('app.organization_id', true), '');

ALTER TABLE prro_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE prro_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS prro_settings_tenant ON prro_settings;
CREATE POLICY prro_settings_tenant ON prro_settings
  USING (organization_id = current_setting('app.organization_id'))
  WITH CHECK (organization_id = current_setting('app.organization_id'));

CREATE TABLE IF NOT EXISTS prro_operations (
  id              TEXT DEFAULT encode(gen_random_bytes(16), 'hex') NOT NULL,
  organization_id TEXT NOT NULL,
  property_id     TEXT NOT NULL,
  kind            TEXT NOT NULL,
  status          TEXT NOT NULL,
  payment_id      TEXT,
  shift_id        TEXT,
  fiscal_number   TEXT,
  total           NUMERIC(14,2),
  error           TEXT,
  created_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  CHECK (kind IN ('shift_open', 'receipt', 'shift_close')),
  CHECK (status IN ('registered', 'failed'))
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'prro_operations'::regclass AND contype = 'f'
       AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (organization_id) REFERENCES%'
  ) THEN
    ALTER TABLE prro_operations ADD CONSTRAINT fk_prro_operations_organization_id_1
      FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'prro_operations'::regclass AND contype = 'f'
       AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (property_id) REFERENCES%'
  ) THEN
    ALTER TABLE prro_operations ADD CONSTRAINT fk_prro_operations_property_id_2
      FOREIGN KEY (property_id) REFERENCES properties (id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_prro_operations_org ON prro_operations (organization_id, created_at);
CREATE INDEX IF NOT EXISTS idx_prro_operations_property ON prro_operations (property_id, created_at);
CREATE INDEX IF NOT EXISTS idx_prro_operations_payment ON prro_operations (payment_id);

ALTER TABLE prro_operations ALTER COLUMN organization_id
  SET DEFAULT NULLIF(current_setting('app.organization_id', true), '');

ALTER TABLE prro_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE prro_operations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS prro_operations_tenant ON prro_operations;
CREATE POLICY prro_operations_tenant ON prro_operations
  USING (organization_id = current_setting('app.organization_id'))
  WITH CHECK (organization_id = current_setting('app.organization_id'));
