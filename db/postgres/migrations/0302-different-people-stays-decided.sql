-- INC-304. «Це різні люди» памʼятається, і хто злив — теж.
--
-- ── Чому відмова мусить жити ────────────────────────────────────────────
--
-- Шукач дублікатів (INC-303) пропонує пари. Якщо «це різні люди» ніде не
-- лишається, та сама пара спливатиме щодня — портьє звикне натискати «різні»
-- не дивлячись, і одного дня так закриє справжній дублікат. Тобто без цієї
-- таблиці шукач псує сам себе тим більше, чим довше працює.
--
-- ── Пара, а не напрямок — і тримає це БАЗА ──────────────────────────────
--
-- Злиття має бік: кого лишили, кого злили. Відмова боку НЕ МАЄ: «Іван і
-- Іван — різні люди» однакове в обидва боки. Якби рядки писались як прийшли,
-- у таблиці зʼявилися б (A,B) і (B,A) як дві різні відмови, і шукач, що
-- питає лише одну з форм, показав би пару, яку вже відхилили.
--
-- Тому пара зберігається ВПОРЯДКОВАНОЮ, і це не домовленість у коді, а
-- `CHECK (guest_low_id < guest_high_id)`: другу форму база просто не прийме.
-- Разом із UNIQUE це означає, що відмова існує рівно в одному вигляді.
--
-- ── `merged_at` / `merged_by` колонками, а не журналом ──────────────────
--
-- Хто злив і коли — факт САМОГО РЯДКА, як і `merged_into`, і буває рівно
-- один раз. Окремий журнал розділив би одну правду на два місця, які можуть
-- розійтися: журнал ротують і чистять, `merged_into` лишається назавжди, і
-- тоді «ким став цей рядок» знає одна таблиця, а «хто це зробив» — інша, вже
-- порожня. Сусідній `booking_activity_log` для цього не годиться й технічно:
-- у нього `reservation_id NOT NULL`, а злиття гостя броні не має.

ALTER TABLE "guests" ADD COLUMN IF NOT EXISTS "merged_at" TIMESTAMPTZ;
ALTER TABLE "guests" ADD COLUMN IF NOT EXISTS "merged_by" TEXT;

CREATE TABLE IF NOT EXISTS guest_not_duplicates (
  id              TEXT DEFAULT encode(gen_random_bytes(16), 'hex') NOT NULL,
  organization_id TEXT NOT NULL,
  guest_low_id    TEXT NOT NULL,
  guest_high_id   TEXT NOT NULL,
  decided_by      TEXT,
  decided_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
  note            TEXT,
  PRIMARY KEY (id),
  CHECK (guest_low_id < guest_high_id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'guest_not_duplicates'::regclass AND contype = 'f'
       AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (organization_id) REFERENCES%'
  ) THEN
    ALTER TABLE guest_not_duplicates ADD CONSTRAINT fk_guest_not_duplicates_organization_id_1
      FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'guest_not_duplicates'::regclass AND contype = 'f'
       AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (guest_low_id) REFERENCES%'
  ) THEN
    ALTER TABLE guest_not_duplicates ADD CONSTRAINT fk_guest_not_duplicates_guest_low_id_1
      FOREIGN KEY (guest_low_id) REFERENCES guests (id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'guest_not_duplicates'::regclass AND contype = 'f'
       AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (guest_high_id) REFERENCES%'
  ) THEN
    ALTER TABLE guest_not_duplicates ADD CONSTRAINT fk_guest_not_duplicates_guest_high_id_1
      FOREIGN KEY (guest_high_id) REFERENCES guests (id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_guest_not_duplicates_pair
  ON guest_not_duplicates (organization_id, guest_low_id, guest_high_id);
CREATE INDEX IF NOT EXISTS idx_guest_not_duplicates_org
  ON guest_not_duplicates (organization_id);

ALTER TABLE guest_not_duplicates ALTER COLUMN organization_id
  SET DEFAULT NULLIF(current_setting('app.organization_id', true), '');

ALTER TABLE guest_not_duplicates ENABLE ROW LEVEL SECURITY;
ALTER TABLE guest_not_duplicates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS guest_not_duplicates_tenant ON guest_not_duplicates;
CREATE POLICY guest_not_duplicates_tenant ON guest_not_duplicates
  USING (organization_id = current_setting('app.organization_id'))
  WITH CHECK (organization_id = current_setting('app.organization_id'));
