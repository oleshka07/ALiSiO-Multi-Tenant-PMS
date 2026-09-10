-- 0411: термінал у холі — рядок в орендаря, перш ніж екран у холі.
--
-- Застосунок `kiosk` (docs/tasks/2026-09-10-block-kiosk.md §3.1), частина А.
-- Три таблиці: сам пристрій, одноразовий код парування і журнал того, що на
-- ньому робили.
--
-- ── Чому пристрій — рядок, а не рядок у конфізі ─────────────────────────
--
-- Кіоск відповідає БЕЗ СЕСІЇ: у холі немає людини, яка входить. Право він
-- доводить токеном (`Authorization: Bearer`), а токен мусить вести до одного
-- рядка — інакше «відкликати термінал» означає «змінити ключ усім». Звідси
-- `revoked_at`: відкликаний пристрій лишається в журналі (його події нікуди
-- не діваються) і перестає відповідати.
--
-- `token_hash` — sha256 секрета під `seal()`, як токен агента Winhotel
-- (`src/apps/winhotel-import/data/agent-token.ts`). Значення показується раз,
-- при паруванні; витік бази токена не дає (інваріант 7).
--
-- `property_id` NOT NULL: застосунок роду `device` з областю `property` (§1).
-- Термінал стоїть у ХОЛІ конкретного будинку, і бронь сусіднього будинку тієї
-- самої організації він знайти не мусить — це та сама вісь, що INC-029.
--
-- ── `kiosk_pairings`: код на десять хвилин, і чому шість цифр ───────────
--
-- Код набирають ПАЛЬЦЕМ на 86-дюймовому екрані, тож він короткий (§3.1).
-- Шість цифр — це мільйон значень, тобто сам по собі код слабкий; тримають
-- його три інші речі, і кожна обовʼязкова: строк `expires_at` (10 хв),
-- одноразовість (`used_at` — другий раз не спрацює) і ліміт частоти на
-- приймальному маршруті. У базі — ХЕШ коду, не код: рядок, прочитаний
-- дампом, не парує нічого.
--
-- Приймальний маршрут сесії не має і орендаря ще не знає, тож рядок
-- читається перепусткою на ЗʼЄДНАННІ (інваріант 14): `code_hash` додано в
-- `PUBLIC_TOKEN_READ` (`scripts/pg-schema.mjs`), політика нижче звіряє
-- `app.public_token` сама, і вікно завширшки в один запит — далі йде
-- звичайний `runWithOrganization` тієї організації, яку код назвав. Нове
-- `app.*_token` при цьому НЕ заводиться: інваріант 14 каже прямо — одне
-- налаштування на всі такі таблиці.
--
-- ── `kiosk_events`: навіщо журнал, якщо є `booking_activity_log` ────────
--
-- Той журнал відповідає на «що сталося з БРОНЮ». Тут питання інше — «що
-- робили на ЦЬОМУ терміналі за добу»: скільки людей заселилось само, де
-- впало, що замовили (§3.3, екран «Kiosk heute» і лист о 7:00). Подія
-- посилається на бронь, але існує й без неї: «шукав і не знайшов» — це теж
-- подія, і саме вона каже, що екран не працює.
--
-- `result` — `ok | refused | error`; `kind` — вільний рядок (`checkin`,
-- `checkout`, `register`, `search_miss`…): словник подій росте швидше за
-- міграції, а невідоме слово в журналі нічого не відчиняє (docs/NAMING.md).
--
-- Тенантні всі три, з RLS, як усе в застосунку. SQLite-дзеркало —
-- `src/lib/db.ts`, `migrateKiosk()`.

CREATE TABLE IF NOT EXISTS kiosk_devices (
  id              TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  property_id     TEXT NOT NULL,
  name            TEXT NOT NULL,
  token_hash      TEXT NOT NULL,
  paired_at       TIMESTAMPTZ,
  last_seen_at    TIMESTAMPTZ,
  revoked_at      TIMESTAMPTZ,
  config_json     JSONB,
  created_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS kiosk_pairings (
  id              TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  property_id     TEXT NOT NULL,
  name            TEXT NOT NULL,
  code_hash       TEXT NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  used_at         TIMESTAMPTZ,
  device_id       TEXT,
  created_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS kiosk_events (
  id              TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  device_id       TEXT NOT NULL,
  reservation_id  TEXT,
  kind            TEXT NOT NULL,
  result          TEXT NOT NULL DEFAULT 'ok',
  detail          TEXT,
  at              TIMESTAMPTZ DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  CHECK (result IN ('ok', 'refused', 'error'))
);

-- Зовнішні ключі за ОЗНАЧЕННЯМ, не за іменем (0052, AGENTS §4).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'kiosk_devices'::regclass AND contype = 'f'
       AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (organization_id) REFERENCES%'
  ) THEN
    ALTER TABLE kiosk_devices ADD CONSTRAINT fk_kiosk_devices_organization_id_1
      FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'kiosk_devices'::regclass AND contype = 'f'
       AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (property_id) REFERENCES%'
  ) THEN
    ALTER TABLE kiosk_devices ADD CONSTRAINT fk_kiosk_devices_property_id_1
      FOREIGN KEY (property_id) REFERENCES properties (id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'kiosk_pairings'::regclass AND contype = 'f'
       AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (organization_id) REFERENCES%'
  ) THEN
    ALTER TABLE kiosk_pairings ADD CONSTRAINT fk_kiosk_pairings_organization_id_1
      FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'kiosk_pairings'::regclass AND contype = 'f'
       AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (property_id) REFERENCES%'
  ) THEN
    ALTER TABLE kiosk_pairings ADD CONSTRAINT fk_kiosk_pairings_property_id_1
      FOREIGN KEY (property_id) REFERENCES properties (id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'kiosk_events'::regclass AND contype = 'f'
       AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (organization_id) REFERENCES%'
  ) THEN
    ALTER TABLE kiosk_events ADD CONSTRAINT fk_kiosk_events_organization_id_1
      FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE;
  END IF;
  -- Пристрій із подій НЕ каскадує: відкликаний термінал зникає з екрана, а
  -- доба, яку він відпрацював, лишається в журналі. `ON DELETE CASCADE` тут
  -- означав би, що «прибрати термінал» стирає й доказ того, що він робив.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'kiosk_events'::regclass AND contype = 'f'
       AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (reservation_id) REFERENCES%'
  ) THEN
    ALTER TABLE kiosk_events ADD CONSTRAINT fk_kiosk_events_reservation_id_1
      FOREIGN KEY (reservation_id) REFERENCES reservations (id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_kiosk_devices_org ON kiosk_devices (organization_id);
CREATE INDEX IF NOT EXISTS idx_kiosk_devices_property ON kiosk_devices (organization_id, property_id);
CREATE INDEX IF NOT EXISTS idx_kiosk_pairings_org ON kiosk_pairings (organization_id);
CREATE INDEX IF NOT EXISTS idx_kiosk_pairings_code ON kiosk_pairings (code_hash);
CREATE INDEX IF NOT EXISTS idx_kiosk_events_org ON kiosk_events (organization_id);
CREATE INDEX IF NOT EXISTS idx_kiosk_events_device_at ON kiosk_events (organization_id, device_id, at);

ALTER TABLE kiosk_devices ALTER COLUMN organization_id
  SET DEFAULT NULLIF(current_setting('app.organization_id', true), '');
ALTER TABLE kiosk_pairings ALTER COLUMN organization_id
  SET DEFAULT NULLIF(current_setting('app.organization_id', true), '');
ALTER TABLE kiosk_events ALTER COLUMN organization_id
  SET DEFAULT NULLIF(current_setting('app.organization_id', true), '');

ALTER TABLE kiosk_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE kiosk_devices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kiosk_devices_tenant ON kiosk_devices;
CREATE POLICY kiosk_devices_tenant ON kiosk_devices
  USING (organization_id = current_setting('app.organization_id'))
  WITH CHECK (organization_id = current_setting('app.organization_id'));

-- Єдина з трьох, яку відчиняє перепустка: приймальний маршрут парування
-- читає СВІЙ рядок за хешем коду, ще не знаючи орендаря (інваріант 14).
-- Відчинено лише ЧИТАННЯ і лише по `code_hash`; запис — як усюди, під
-- орендарем. Дзеркало цього рядка — `PUBLIC_TOKEN_READ` у pg-schema.mjs,
-- щоб схема нового клієнта збіглася з мігрованою.
ALTER TABLE kiosk_pairings ENABLE ROW LEVEL SECURITY;
ALTER TABLE kiosk_pairings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kiosk_pairings_tenant ON kiosk_pairings;
CREATE POLICY kiosk_pairings_tenant ON kiosk_pairings
  USING (organization_id = current_setting('app.organization_id')
     OR code_hash = NULLIF(current_setting('app.public_token', true), ''))
  WITH CHECK (organization_id = current_setting('app.organization_id'));

ALTER TABLE kiosk_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE kiosk_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kiosk_events_tenant ON kiosk_events;
CREATE POLICY kiosk_events_tenant ON kiosk_events
  USING (organization_id = current_setting('app.organization_id'))
  WITH CHECK (organization_id = current_setting('app.organization_id'));
