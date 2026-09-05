-- Рівень OTA: дзеркало каналів зʼєднання (К2).
--
-- ── Чому таблиця повертається ─────────────────────────────────────────────
--
-- §4.3 ТЗ прибрав `cm_channels` із гіпотези 0.2 свідомо, і довід був
-- правильний: «дзеркалити чуже налаштування у себе — це зобовʼязатись тримати
-- дзеркало свіжим; оператор змінить його у вікні iFrame, наша копія протухне
-- мовчки, і відповідь на питання "чи ввімкнено канал" залежатиме від того,
-- кого спитали».
--
-- Довід лишається чинним, і саме він задає ФОРМУ цієї таблиці. Вона не
-- зберігає нічого свого: жодного нашого прапорця, жодного налаштування, яке
-- можна змінити тільки в нас. Кожен рядок — знімок відповіді вендора з міткою
-- часу, і прохід перезаписує дзеркало ЦІЛКОМ: канал, якого немає у відповіді,
-- зникає й у нас. Тобто зобовʼязання тримати свіжим виконується механізмом, а
-- не обіцянкою, і найгірший можливий стан — «дані годину як застарілі», а не
-- «дані розходяться назавжди».
--
-- ── Навіщо взагалі ────────────────────────────────────────────────────────
--
-- Ц8: наш тариф на тому боці створено, але який OTA його побачить, вирішують
-- мапінг-айтеми ВСЕРЕДИНІ менеджера каналів. Досі це закривалося інструкцією
-- готельєру — «зайдіть і не мапте цей тариф на Booking», — і жоден гейт цього
-- не тримав. Тепер відповідь читається: `mapped_json` несе ідентифікатори
-- тарифів вендора, змаплених на цей канал, і через `cm_mappings` вони
-- перекладаються в НАШІ пари «тип × тариф». Звідси й попередження «тариф є в
-- дзеркалі, але не змаплений на жоден канал» — тепер це число на екрані, а не
-- інструкція.
--
-- ── Чого тут немає ────────────────────────────────────────────────────────
--
-- Закритого словника OTA. `ota_code` — рядок без CHECK: перелік каналів
-- належить вендору, він росте, і `CHECK (ota_code IN …)` означав би, що новий
-- канал не записується взагалі — тобто готель, який його підключив, бачив би
-- порожньо. Те саме міркування, що в §4.3: «перелік підключених каналів
-- читається з менеджера каналів».
--
-- Імені вендора теж немає (И1): `provider` живе в `cm_connections`, а тут —
-- лише «наше ↔ їхнє». `ota_code` це код OTA (Booking.com, Airbnb), тобто
-- бізнес готелю, а не назва менеджера каналів.

CREATE TABLE IF NOT EXISTS cm_channels (
  id                TEXT DEFAULT encode(gen_random_bytes(16), 'hex') NOT NULL,
  organization_id   TEXT NOT NULL,
  connection_id     TEXT NOT NULL,
  -- Ідентифікатор підключення каналу на тому боці.
  remote_channel_id TEXT NOT NULL,
  -- Код адаптера каналу: Booking.com, Airbnb, Expedia… Без CHECK — див. шапку.
  ota_code          TEXT DEFAULT '' NOT NULL,
  title             TEXT DEFAULT '' NOT NULL,
  -- «Disabled connections do not send updates to the channel» — стан ЇХНІЙ,
  -- ми його лише показуємо.
  is_active         BOOLEAN DEFAULT FALSE NOT NULL,
  -- Налаштування підключення, як їх віддав вендор. JSONB: читає їх людина на
  -- екрані, а не запит.
  settings_json     JSONB,
  -- Тарифи вендора, змаплені на цей канал (`rate_plans` мапінг-айтемів).
  -- Масив у JSON, а не окрема таблиця: це знімок чужої відповіді цілком, і
  -- окремої сутності з нього не буває — вона є на тому боці.
  mapped_json       JSONB,
  synced_at         TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at        TIMESTAMPTZ DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  -- Ключ включає `connection_id`, який належить організації — інваріант 3
  -- виконано транзитивно, як у `cm_mappings`.
  UNIQUE (connection_id, remote_channel_id)
);

-- Зовнішні ключі окремо й за ОЗНАЧЕННЯМ, а не за іменем: `ADD CONSTRAINT IF
-- NOT EXISTS` у Postgres немає, а на свіжій базі ці ключі вже створив
-- `schema.sql` під своїми іменами (див. 0052 — сторож за іменем додав другий
-- такий самий).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'cm_channels'::regclass AND contype = 'f'
       AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (organization_id) REFERENCES%'
  ) THEN
    ALTER TABLE cm_channels ADD CONSTRAINT fk_cm_channels_organization_id_1
      FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'cm_channels'::regclass AND contype = 'f'
       AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (connection_id) REFERENCES%'
  ) THEN
    ALTER TABLE cm_channels ADD CONSTRAINT fk_cm_channels_connection_id_2
      FOREIGN KEY (connection_id) REFERENCES cm_connections (id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cm_channels_org ON cm_channels (organization_id);
-- Головний запит екрана: «покажи канали цього зʼєднання».
CREATE INDEX IF NOT EXISTS idx_cm_channels_connection ON cm_channels (connection_id);

-- Мітка свіжості живе на ЗʼЄДНАННІ, а не лише на рядках каналів.
--
-- Бо «каналів нуль» і «ще не питали» — різні стани, а рядків у першому немає
-- жодного. Без цієї колонки порожня відповідь не лишала б сліду, і лімітер
-- «не частіше разу на годину» питав би вендора на кожне відкриття екрана —
-- з того самого бюджету обʼєкта, з якого їдуть ціни.
ALTER TABLE cm_connections ADD COLUMN IF NOT EXISTS channels_synced_at TIMESTAMPTZ;

ALTER TABLE cm_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE cm_channels FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cm_channels_tenant ON cm_channels;
CREATE POLICY cm_channels_tenant ON cm_channels
  USING (organization_id = current_setting('app.organization_id'))
  WITH CHECK (organization_id = current_setting('app.organization_id'));
