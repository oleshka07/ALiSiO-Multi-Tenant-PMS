-- Маска змінених полів у черзі і журнал відправлень з тілом.
--
-- Блок 0.5 — пересертифікація Channex після листа від 05.09.2026. Пройшов лише
-- тест 11 (бронь від каналу); решта відхилена за форму ТІЛА:
--
--   Б1  повідомлення несе весь стан, не дельту — тест 2 чекає лише `rates`,
--       тест 5 лише мінімум, тест 7 лише чотири обмеження;
--   Б2  повний синк без чотирьох обмежень — на горизонті не було жодного
--       базового рядка, і дефолтів ніхто не називав.
--
-- ── `cm_outbox.field_mask` ─────────────────────────────────────────────────
--
-- Координата тепер каже не лише ДЕ змінилось, а й ЩО: біти в порядку
-- `RATE_FIELDS` домену — ціна, «закрито», мінімум, максимум, заборона заїзду,
-- заборона виїзду. NULL — усі поля: повний синк, зміна тарифу чи типу, і всі
-- рядки, що лежали в черзі до цієї міграції (тому колонка nullable і без
-- бекфілу — старий рядок їде, як їхав). Два рядки однієї координати з різними
-- масками зливаються тим самим `ON CONFLICT`, що тримає злиття координат:
-- побітове АБО, NULL поглинає. Значення при цьому далі читаються з джерела в
-- момент відправлення — маска звужує тіло, не джерело.
--
-- ── `cm_sends` ─────────────────────────────────────────────────────────────
--
-- Кожен виклик до менеджера каналів — рядком: смуга, тіло дослівно, статус,
-- розписка (task id), скільки значень і які ключі (`summary`, JSON нашими
-- координатами). Розписка на координаті (`cm_outbox.receipt`, 0061) казала,
-- ЩО поїхало; вона не казала, З ЯКИМИ ПОЛЯМИ — і саме за поля вендор
-- відхилив. Невдалий виклик — теж рядок, зі статусом і без task id. У тілі
-- немає ні ПІБ, ні секретів (ключ — у заголовку), тож ретенція 90 днів кроном
-- GDPR, не назавжди.

ALTER TABLE cm_outbox ADD COLUMN IF NOT EXISTS field_mask INTEGER;

CREATE TABLE IF NOT EXISTS cm_sends (
  id              TEXT DEFAULT encode(gen_random_bytes(16), 'hex') NOT NULL,
  organization_id TEXT NOT NULL,
  connection_id   TEXT NOT NULL,
  lane            TEXT NOT NULL,
  sent_at         TIMESTAMPTZ DEFAULT now() NOT NULL,
  task_id         TEXT,
  request_body    TEXT NOT NULL,
  response_status INTEGER,
  error           TEXT,
  rows_count      INTEGER DEFAULT 0 NOT NULL,
  summary         TEXT,
  PRIMARY KEY (id),
  CHECK (lane IN ('availability', 'rate'))
);

-- Зовнішні ключі за ОЗНАЧЕННЯМ, не за іменем (0052, AGENTS §4): на свіжій базі
-- ці ж ключі вже створив schema.sql під своїми іменами.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'cm_sends'::regclass AND contype = 'f'
       AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (organization_id) REFERENCES%'
  ) THEN
    ALTER TABLE cm_sends ADD CONSTRAINT fk_cm_sends_organization_id_1
      FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'cm_sends'::regclass AND contype = 'f'
       AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (connection_id) REFERENCES%'
  ) THEN
    ALTER TABLE cm_sends ADD CONSTRAINT fk_cm_sends_connection_id_2
      FOREIGN KEY (connection_id) REFERENCES cm_connections (id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cm_sends_org ON cm_sends (organization_id);
-- Екран читає «останні N цього зʼєднання», ретенція — «старші за дату».
CREATE INDEX IF NOT EXISTS idx_cm_sends_connection ON cm_sends (connection_id, sent_at);

ALTER TABLE cm_sends ENABLE ROW LEVEL SECURITY;
ALTER TABLE cm_sends FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cm_sends_tenant ON cm_sends;
CREATE POLICY cm_sends_tenant ON cm_sends
  USING (organization_id = current_setting('app.organization_id'))
  WITH CHECK (organization_id = current_setting('app.organization_id'));
