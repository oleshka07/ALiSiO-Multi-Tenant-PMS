-- INC-300. Згода GDPR живе на ОСОБІ й переживає бронь; злиття дублікатів гостя.
--
-- ── Чому це блокер ІМПОРТУ, а не покращення на потім ────────────────────
--
-- У Winhotel `ADR_DATENSCHUTZ` — 61 305 рядків, і кожен висить на АДРЕСІ,
-- тобто на особі. У нас згода лежала на `guest_registrations`, у якої
-- `reservation_id` оголошено NOT NULL. Отже згоді людини, у якої в нашій
-- системі немає броні, не було куди лягти — а таких серед тих 61 тисячі
-- більшість. Імпортувати «нікуди» означає втратити її назавжди, і саме цей
-- документ готель мусить показати наглядачеві на вимогу.
--
-- Полагодити після імпорту не можна: даних уже не буде. Тому це перед ним.
--
-- ── Дві згоди — це РІЗНІ згоди, і зливати їх не можна ───────────────────
--
-- `guest_registrations.consent_given/consent_at/consent_ip` ЛИШАЄТЬСЯ і нікуди
-- не переїжджає. Це згода на ЦЬОМУ перебуванні — частина Meldeschein, разом із
-- підписом і часом заселення. Нова таблиця — про ОСОБУ: «цій людині можна
-- слати листи», і воно переживає всі її брони, включно з нульом броней.
--
-- Написано тут явно, бо через місяць вони виглядатимуть як дублікати одне
-- одного, і той, хто їх зіллє, зруйнує або Meldeschein, або доказ згоди.
--
-- ── Версія тексту обовʼязкова ───────────────────────────────────────────
--
-- Згода без версії тексту не доводить нічого: людина погодилась на щось, а на
-- що — невідомо. Winhotel це знає (`DATENSCHUTZSTAM`: три пункти з текстом і
-- `DS_VERSION`), і ми не маємо права знати менше.
--
-- ЗВʼЯЗКУ КЛЮЧЕМ між `guest_consents` і `consent_texts` тут НЕМАЄ, і це
-- свідомо: текст існує в кількох мовах (`locale`), тож унікальним у довіднику
-- є (організація, рід, версія, МОВА), а згода називає версію без мови — людина
-- погодилась на редакцію, а не на переклад. Складений ключ вимагав би або
-- унікальності без мови (тоді переклади нікуди покласти), або згоди на
-- конкретний переклад (тоді той самий текст іншою мовою — «інша згода»).
-- Замість ключа версію звіряє писач (`recordConsent`) названою відмовою, і це
-- стверджує сцена `guest-consents.check.ts`.
--
-- ── Відкликання — не видалення рядка ────────────────────────────────────
--
-- `revoked_at` існує саме тому, що наглядачеві показують «згода була і її
-- відкликали тоді-то». Рядок, якого немає, не доводить нічого В ОБИДВА боки:
-- ні що згода була, ні що її знято.
--
-- ── Похідне, а не друге джерело правди ──────────────────────────────────
--
-- Колонки `guests.marketing_opt_in` тут НЕМАЄ навмисно. «Чи можна цій людині
-- слати листи» рахується з журналу (`marketingAllowed`), бо два джерела
-- розійдуться, і тоді відповідатиме те, яке спитали останнім. Ціна — джойн на
-- екранах розсилки; ціна помилки — лист тому, хто відмовився.
--
-- ── `guests.merged_into` — злитого гостя не видаляють ───────────────────
--
-- 37 тис. адрес в адресній книзі Winhotel; без злиття та сама людина ляже
-- десятки разів і розповзеться по бронях, фактурах і згодах. Але злиття
-- потрібне й без імпорту: дублікатів наробляє портьє, щодня.
--
-- Рядок злитого гостя ЛИШАЄТЬСЯ з посиланням на того, кого лишили. Причина не
-- сентиментальна: посилання на нього лежать у виданих документах і в чужих
-- системах, і «такого гостя немає» — гірша відповідь, ніж «це та сама людина».

-- ── Довідник текстів згод ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS consent_texts (
  id              TEXT DEFAULT encode(gen_random_bytes(16), 'hex') NOT NULL,
  organization_id TEXT NOT NULL,
  consent_kind    TEXT NOT NULL,
  version         TEXT NOT NULL,
  locale          TEXT NOT NULL,
  body            TEXT NOT NULL,
  is_active       BOOLEAN DEFAULT TRUE NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'consent_texts'::regclass AND contype = 'f'
       AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (organization_id) REFERENCES%'
  ) THEN
    ALTER TABLE consent_texts ADD CONSTRAINT fk_consent_texts_organization_id_1
      FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE;
  END IF;
END $$;

-- Версію обирає людина, тож унікальність включає організацію (інваріант 3).
CREATE UNIQUE INDEX IF NOT EXISTS idx_consent_texts_org_kind_version
  ON consent_texts (organization_id, consent_kind, version, locale);
CREATE INDEX IF NOT EXISTS idx_consent_texts_org ON consent_texts (organization_id);

ALTER TABLE consent_texts ALTER COLUMN organization_id
  SET DEFAULT NULLIF(current_setting('app.organization_id', true), '');

ALTER TABLE consent_texts ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_texts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS consent_texts_tenant ON consent_texts;
CREATE POLICY consent_texts_tenant ON consent_texts
  USING (organization_id = current_setting('app.organization_id'))
  WITH CHECK (organization_id = current_setting('app.organization_id'));

-- ── Журнал згод особи ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS guest_consents (
  id              TEXT DEFAULT encode(gen_random_bytes(16), 'hex') NOT NULL,
  organization_id TEXT NOT NULL,
  guest_id        TEXT NOT NULL,
  consent_kind    TEXT NOT NULL,
  version         TEXT NOT NULL,
  source          TEXT NOT NULL,
  given_at        TIMESTAMPTZ DEFAULT now() NOT NULL,
  revoked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'guest_consents'::regclass AND contype = 'f'
       AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (organization_id) REFERENCES%'
  ) THEN
    ALTER TABLE guest_consents ADD CONSTRAINT fk_guest_consents_organization_id_1
      FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'guest_consents'::regclass AND contype = 'f'
       AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (guest_id) REFERENCES%'
  ) THEN
    ALTER TABLE guest_consents ADD CONSTRAINT fk_guest_consents_guest_id_1
      FOREIGN KEY (guest_id) REFERENCES guests (id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_guest_consents_org ON guest_consents (organization_id);
CREATE INDEX IF NOT EXISTS idx_guest_consents_guest
  ON guest_consents (organization_id, guest_id, consent_kind);

ALTER TABLE guest_consents ALTER COLUMN organization_id
  SET DEFAULT NULLIF(current_setting('app.organization_id', true), '');

ALTER TABLE guest_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE guest_consents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS guest_consents_tenant ON guest_consents;
CREATE POLICY guest_consents_tenant ON guest_consents
  USING (organization_id = current_setting('app.organization_id'))
  WITH CHECK (organization_id = current_setting('app.organization_id'));

-- ── Злитого гостя не видаляють ──────────────────────────────────────────
ALTER TABLE guests ADD COLUMN IF NOT EXISTS merged_into TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'guests'::regclass AND contype = 'f'
       AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (merged_into) REFERENCES%'
  ) THEN
    ALTER TABLE guests ADD CONSTRAINT fk_guests_merged_into_1
      FOREIGN KEY (merged_into) REFERENCES guests (id) ON DELETE SET NULL;
  END IF;
END $$;

-- Списки гостей питають «живі, тобто не злиті» на кожному екрані.
CREATE INDEX IF NOT EXISTS idx_guests_merged_into
  ON guests (organization_id) WHERE merged_into IS NULL;
