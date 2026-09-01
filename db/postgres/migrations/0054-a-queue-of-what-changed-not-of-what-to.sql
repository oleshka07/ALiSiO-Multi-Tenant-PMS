-- Черга вихідних змін і журнал вхідних подій.
--
-- ── Черга каже «що змінилося», а не «на що» ───────────────────────────────
--
-- Рядок `cm_outbox` — це КООРДИНАТА: «наявність типу X на дату D змінилась».
-- Колонки під значення тут немає, і це не забудькуватість. Поточне число
-- батчер читає з джерела — наявність через `availabilityByDay()`, ціну через
-- `priceNights()` (інваріант 16).
--
-- Інакше два записи в чергу за 40 секунд дали б дві відправки з РІЗНИМИ
-- числами, і яке доїде останнім — питання порядку в черзі, а не стану
-- готелю. У канал поїхало б застаріле, і виглядало б це як успіх.
--
-- ── Дві смуги, бо цього вимагає менеджер каналів ──────────────────────────
--
-- «At Channex we like to receive updates for Availability and Rate &
-- Restrictions separately… We push these updates to the front of the queue
-- for processing» — наявність має власний, швидший шлях на їхньому боці.
-- Змішати її з цінами означає самим собі сповільнити найтерміновіше:
-- застаріла наявність продає номер, якого немає, а застаріла ціна — це лише
-- неправильні гроші.
--
-- `rate` при цьому означає «ціни І обмеження»: `min_stay`, закриття продажу
-- і заборони заїзду йдуть тим самим запитом і витрачають той самий ліміт
-- 10 на хвилину на обʼєкт.
--
-- ── Осі заселеності в черзі немає, і це висновок із живого API ────────────
--
-- Запит обмежень приймає всі заселеності одного тарифу в ОДНОМУ значенні
-- (INVENTORY §4.2). Рядок на заселеність дав би втричі більше рядків і
-- жодного зайвого виклику.
--
-- ── Чому `claimed_at`, а не FOR UPDATE SKIP LOCKED ────────────────────────
--
-- Той Postgres-only, а розробка й одне завдання CI йдуть на SQLite. Тому
-- захоплення — це `UPDATE … SET claimed_at = ? WHERE … AND claimed_at IS
-- NULL` і читання позначених: працює однаково на обох двигунах.
--
-- Наслідок, який тримає перевірка: зміна, що прийшла ПІСЛЯ захоплення, не
-- зливається із захопленим рядком. Той уже в польоті зі старим числом, і
-- злиття означало б, що нова ціна не поїде НІКОЛИ — без жодної помилки.
--
-- ── `cm_events`: вебхук пише сирим і відповідає 200 ───────────────────────
--
-- Вебхук не робить жодного запиту до менеджера каналів і жодної доменної
-- роботи: він кладе сирий рядок і віддає 200. Робота — за кроном. Інакше
-- повільна відповідь на вебхук стає причиною повторної доставки, а та —
-- причиною ще однієї повільної відповіді.

CREATE TABLE IF NOT EXISTS cm_outbox (
  id              TEXT DEFAULT encode(gen_random_bytes(16), 'hex') NOT NULL,
  organization_id TEXT NOT NULL,
  connection_id   TEXT NOT NULL,
  kind            TEXT NOT NULL,
  unit_type_id    TEXT,
  rate_plan_id    TEXT,
  stay_date       DATE NOT NULL,
  claimed_at      TIMESTAMPTZ,
  sent_at         TIMESTAMPTZ,
  attempts        INTEGER DEFAULT 0 NOT NULL,
  last_error      TEXT,
  created_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  CHECK (kind IN ('availability', 'rate'))
);

CREATE TABLE IF NOT EXISTS cm_events (
  id              TEXT DEFAULT encode(gen_random_bytes(16), 'hex') NOT NULL,
  organization_id TEXT NOT NULL,
  connection_id   TEXT NOT NULL,
  event_type      TEXT NOT NULL,
  payload         TEXT NOT NULL,
  received_at     TIMESTAMPTZ DEFAULT now() NOT NULL,
  processed_at    TIMESTAMPTZ,
  PRIMARY KEY (id)
);

-- Зовнішні ключі за ОЗНАЧЕННЯМ, не за іменем: на свіжій базі ці ж ключі вже
-- створив `db/postgres/schema.sql` під своїми іменами, бо генератор нумерує
-- їх у власному порядку, і сторож за іменем додав би другий такий самий
-- (див. 0052 і AGENTS §4).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'cm_outbox'::regclass AND contype = 'f'
       AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (organization_id) REFERENCES%'
  ) THEN
    ALTER TABLE cm_outbox ADD CONSTRAINT fk_cm_outbox_organization_id_1
      FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'cm_outbox'::regclass AND contype = 'f'
       AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (connection_id) REFERENCES%'
  ) THEN
    ALTER TABLE cm_outbox ADD CONSTRAINT fk_cm_outbox_connection_id_2
      FOREIGN KEY (connection_id) REFERENCES cm_connections (id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'cm_events'::regclass AND contype = 'f'
       AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (organization_id) REFERENCES%'
  ) THEN
    ALTER TABLE cm_events ADD CONSTRAINT fk_cm_events_organization_id_1
      FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'cm_events'::regclass AND contype = 'f'
       AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (connection_id) REFERENCES%'
  ) THEN
    ALTER TABLE cm_events ADD CONSTRAINT fk_cm_events_connection_id_2
      FOREIGN KEY (connection_id) REFERENCES cm_connections (id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cm_outbox_org ON cm_outbox (organization_id);
CREATE INDEX IF NOT EXISTS idx_cm_events_org ON cm_events (organization_id);
-- Головний запит батчера: «що чекає у цій смузі цього зʼєднання».
CREATE INDEX IF NOT EXISTS idx_cm_outbox_pending
  ON cm_outbox (connection_id, kind) WHERE sent_at IS NULL AND claimed_at IS NULL;
-- І пошук уже захопленого — для повернення в чергу після невдачі.
CREATE INDEX IF NOT EXISTS idx_cm_outbox_claimed
  ON cm_outbox (connection_id) WHERE claimed_at IS NOT NULL AND sent_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cm_events_unprocessed
  ON cm_events (connection_id) WHERE processed_at IS NULL;

ALTER TABLE cm_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE cm_outbox FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cm_outbox_tenant ON cm_outbox;
CREATE POLICY cm_outbox_tenant ON cm_outbox
  USING (organization_id = current_setting('app.organization_id'))
  WITH CHECK (organization_id = current_setting('app.organization_id'));

ALTER TABLE cm_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE cm_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cm_events_tenant ON cm_events;
CREATE POLICY cm_events_tenant ON cm_events
  USING (organization_id = current_setting('app.organization_id'))
  WITH CHECK (organization_id = current_setting('app.organization_id'));
