-- Ревізія стає бронню рівно один раз.
--
-- ── Дві таблиці, два різні питання ────────────────────────────────────────
--
-- `cm_connections` — чим ЦЕЙ обʼєкт повʼязаний із менеджером каналів.
-- Ключ API сюди не пишеться: він у `channel_credentials` (інваріант 7 —
-- жодних секретів у схемі, яку читає пів застосунку). `webhook_token` і
-- `webhook_secret` — виняток за необхідністю: обидва безглузді без знання
-- URL і відкликаються зміною рядка.
--
-- `cm_inbound_bookings` — ЖУРНАЛ РЕВІЗІЙ, а не копія броней. Channex віддає
-- стрічку ревізій: `remote_booking_id` стабільний між ними, id самої ревізії
-- — ні. Одна бронь дає ревізію на створення, ще одну на кожну зміну і ще
-- одну на скасування.
--
-- ── Навіщо журнал, якщо є `reservations` ──────────────────────────────────
--
-- Бо та сама ревізія приїде вдруге, і це буденність, а не аварія:
--
--   вебхуки приходять НЕ в тому порядку, у якому сталися події — так сказано
--     в документації Channex дослівно;
--   `ack` шлеться ПІСЛЯ коміту (інваріант И5), тож процес, який упав між
--     ними, побачить ту саму ревізію ще раз;
--   те саме роблять повтор мережі й кнопка «синхронізувати».
--
-- `UNIQUE(connection_id, remote_revision_id)` — і є весь захист. Не перевірка
-- «а чи є вже такий рядок» перед вставкою: між перевіркою і вставкою
-- вміщається другий процес, і саме там дубль народжується. Обмеження бази
-- цього вікна не має.
--
-- ── Порядок, який коштував червоного гейта ────────────────────────────────
--
-- Перша версія коду писала спершу бронь, потім журнал — і на повторній
-- доставці падала на UNIQUE вже ПІСЛЯ того, як створила ДРУГУ бронь. Тобто
-- обмеження спрацьовувало, а дубль лишався: два сніданки на одного гостя.
-- Тепер журнал пишеться першим і саме він є воротами.
--
-- ── `payload` і GDPR ──────────────────────────────────────────────────────
--
-- Сира ревізія містить ПІБ, email і телефон гостя. Рядок лишається назавжди
-- (він доказ у суперечці), але `payload` знеособлюється тим самим циклом, що
-- й решта — `/api/cron/gdpr-retention`, розклад 04:40. `anonymized_at`
-- фіксує, коли це сталося.
--
-- Ретенція має бути не довшою за потребу і НЕ КОРОТШОЮ за Channex: там
-- бронювання зникає через 3 місяці після виїзду, тож після цього моменту наш
-- рядок — єдиний, що лишився. Знеособлення так, видалення рядка ні.

CREATE TABLE IF NOT EXISTS cm_connections (
  id                 TEXT DEFAULT encode(gen_random_bytes(16), 'hex') NOT NULL,
  organization_id    TEXT NOT NULL,
  property_id        TEXT NOT NULL,
  -- Без DEFAULT: імені вендора в спільній схемі не буває (інваріант И1).
  provider           TEXT NOT NULL,
  environment        TEXT DEFAULT 'staging' NOT NULL,
  remote_property_id TEXT,
  webhook_token      TEXT NOT NULL,
  webhook_secret     TEXT NOT NULL,
  remote_webhook_id  TEXT,
  is_enabled         BOOLEAN DEFAULT false NOT NULL,
  last_full_sync_at  TIMESTAMPTZ,
  created_at         TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at         TIMESTAMPTZ DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  UNIQUE (webhook_token),
  UNIQUE (organization_id, property_id, provider, environment),
  CHECK (environment IN ('staging', 'production'))
);

CREATE TABLE IF NOT EXISTS cm_inbound_bookings (
  id                   TEXT DEFAULT encode(gen_random_bytes(16), 'hex') NOT NULL,
  organization_id      TEXT NOT NULL,
  connection_id        TEXT NOT NULL,
  remote_revision_id   TEXT NOT NULL,
  remote_booking_id    TEXT NOT NULL,
  ota_reservation_code TEXT,
  ota_name             TEXT,
  status               TEXT NOT NULL,
  reservation_id       TEXT,
  payload              TEXT NOT NULL,
  is_unmapped          BOOLEAN DEFAULT false NOT NULL,
  received_at          TIMESTAMPTZ DEFAULT now() NOT NULL,
  applied_at           TIMESTAMPTZ,
  confirmed_at         TIMESTAMPTZ,
  anonymized_at        TIMESTAMPTZ,
  PRIMARY KEY (id),
  UNIQUE (connection_id, remote_revision_id),
  CHECK (status IN ('new', 'modified', 'cancelled'))
);

-- Зовнішні ключі окремо: `ADD CONSTRAINT IF NOT EXISTS` у Postgres немає,
-- тож повторний накат ловиться через каталог.
--
-- І ловиться за ОЗНАЧЕННЯМ, а не за іменем. Ім'я тут наше й довільне, а на
-- свіжій базі ці ж ключі вже створив `schema.sql` — під СВОЇМИ іменами, бо
-- генератор нумерує їх у своєму порядку. Сторож за іменем не знаходить
-- нічого і додає ДРУГИЙ такий самий ключ: новий клієнт отримує не «без
-- констрейнта», а дубльований констрейнт під двома іменами. Знайшов
-- `check-schema-drift` на справжньому Postgres.
--
-- Той самий прийом уже стоїть у 0050 для CHECK — з тієї ж причини.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'cm_connections'::regclass AND contype = 'f'
       AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (organization_id) REFERENCES%'
  ) THEN
    ALTER TABLE cm_connections ADD CONSTRAINT fk_cm_connections_organization_id_1
      FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'cm_connections'::regclass AND contype = 'f'
       AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (property_id) REFERENCES%'
  ) THEN
    ALTER TABLE cm_connections ADD CONSTRAINT fk_cm_connections_property_id_2
      FOREIGN KEY (property_id) REFERENCES properties (id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'cm_inbound_bookings'::regclass AND contype = 'f'
       AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (organization_id) REFERENCES%'
  ) THEN
    ALTER TABLE cm_inbound_bookings ADD CONSTRAINT fk_cm_inbound_bookings_organization_id_1
      FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'cm_inbound_bookings'::regclass AND contype = 'f'
       AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (connection_id) REFERENCES%'
  ) THEN
    ALTER TABLE cm_inbound_bookings ADD CONSTRAINT fk_cm_inbound_bookings_connection_id_2
      FOREIGN KEY (connection_id) REFERENCES cm_connections (id) ON DELETE CASCADE;
  END IF;
  -- Бронь можуть видалити руками; журнал ревізій від цього не зникає, він
  -- лише перестає на неї вказувати.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'cm_inbound_bookings'::regclass AND contype = 'f'
       AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (reservation_id) REFERENCES%'
  ) THEN
    ALTER TABLE cm_inbound_bookings ADD CONSTRAINT fk_cm_inbound_bookings_reservation_id_3
      FOREIGN KEY (reservation_id) REFERENCES reservations (id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cm_connections_org ON cm_connections (organization_id);
CREATE INDEX IF NOT EXISTS idx_cm_inbound_org ON cm_inbound_bookings (organization_id);
CREATE INDEX IF NOT EXISTS idx_cm_inbound_booking
  ON cm_inbound_bookings (connection_id, remote_booking_id);
-- Стрічка віддає лише непідтверджені — саме їх ми й шукаємо щохвилини.
CREATE INDEX IF NOT EXISTS idx_cm_inbound_unconfirmed
  ON cm_inbound_bookings (connection_id) WHERE confirmed_at IS NULL;

-- Політики орендаря. Обидві таблиці несуть organization_id власною колонкою,
-- тож звірка пряма — без підзапиту через properties.
ALTER TABLE cm_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE cm_connections FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cm_connections_tenant ON cm_connections;
CREATE POLICY cm_connections_tenant ON cm_connections
  USING (organization_id = current_setting('app.organization_id'))
  WITH CHECK (organization_id = current_setting('app.organization_id'));

ALTER TABLE cm_inbound_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE cm_inbound_bookings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cm_inbound_bookings_tenant ON cm_inbound_bookings;
CREATE POLICY cm_inbound_bookings_tenant ON cm_inbound_bookings
  USING (organization_id = current_setting('app.organization_id'))
  WITH CHECK (organization_id = current_setting('app.organization_id'));
