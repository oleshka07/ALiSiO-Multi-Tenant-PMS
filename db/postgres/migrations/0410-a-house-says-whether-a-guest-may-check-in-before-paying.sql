-- 0410: обʼєкт САМ каже, чи пускають у номер до оплати — і хто веде його книгу.
--
-- Блок «Кіоск самообслуговування» (docs/tasks/2026-09-10-block-kiosk.md §3.1),
-- частина А. Три колонки на `properties` і дві на `guest_registrations`.
--
-- ── `checkin_payment_policy`: чому колонка, а не прапорець кіоска ────────
--
-- Рішення власника К1: оплати на кіоску в першій версії немає — гість
-- заселяється, платить уранці на рецепції або при виїзді. Доти варта
-- заселення стояла в тілі PATCH-хендлера числом:
--
--     if (!['paid','prepaid'].includes(payStatus)) → 422
--
-- тобто «до оплати не пускають» було властивістю КОДУ, однаковою для всіх
-- готелів. Кіоску потрібне інше слово, і слово це належить обʼєкту, а не
-- пристрою: якщо його носить кіоск, то той самий готель відповість «можна»
-- терміналу і «не можна» власній рецепції на ту саму бронь. Політика на
-- обʼєкті означає, що і PATCH, і фасад читають ОДНЕ джерело (§3.1: «рецепційний
-- PATCH теж має поважати»).
--
-- Дефолт `prepaid` — щоб наявні готелі не змінили поведінки мовчки: він
-- дослівно те, що робив хендлер до цієї міграції.
--
-- ── `system_of_record`: чия книга головна ───────────────────────────────
--
-- `external` — головна книга ще в чужій системі (Winhotel на час дзеркала),
-- ми ведемо копію; `alisio` — головні ми. Від цього залежить, що кіоск
-- надішле при виїзді: фактуру з нашим номером (`alisio`) чи підсумок
-- перебування без номера і рядок рецепції «виставити фактуру у Winhotel»
-- (`external`, §3.2 сценарій 6). Дефолт `alisio`: готель, який нічого не
-- імпортує, веде свою книгу сам.
--
-- ── `kiosk_walkin_url`: адреса, а не вимикач ────────────────────────────
--
-- К8 (редакція 10.09): walk-in іде через ВЛАСНИЙ онлайн-модуль готелю —
-- CDSoft «Onlinebuchung», той самий, що на його сайті: він пише бронь просто
-- у Winhotel і читає живу наявність звідти. Кіоск відкриває цю адресу окремою
-- сторінкою (вона віддає `X-Frame-Options: DENY`, тож у рамку не йде).
--
-- Порожньо = walk-in на терміналі вимкнено. Колонка, а не константа
-- (інваріант 20): у сусіднього готелю це буде інша адреса, а після переходу
-- на ALiSiO сюди впишуть наш віджет — той самий екран покаже інше, без релізу.
--
-- Тому це TEXT без CHECK: список дозволених адрес тут означав би, що новий
-- готель чекає на міграцію заради власного сайту.
--
-- ── Підпис: чому на `guest_registrations`, а не окремою таблицею ────────
--
-- К3: Meldeschein підписують пальцем іноземці. Підпис належить РЕЄСТРАЦІЇ:
-- він доводить, що ця людина в цьому перебуванні підтвердила свої дані.
-- Окрема таблиця дала б рядок, який переживає знеособлення, — а GDPR-ретенція
-- видаляє `guest_registrations` цілком (`anonymizeOldRegistrations`,
-- `deleteConsentLog`), тож підпис іде разом із рештою і без окремого правила.
--
-- `TEXT`, не `BYTEA`: значення — `data:image/png;base64,…`, як його віддає
-- `canvas.toDataURL()`, і саме в такому вигляді його показує сторінка. ≤ 200 КБ
-- стереже писач (`signature.repo.ts`), не база: відмова обмеження прилітає
-- 500-кою, а завеликий підпис — це звичайний палець на великому екрані, і
-- відповідь на нього — названа відмова.
--
-- SQLite-дзеркало — `src/lib/db.ts` (CREATE properties + ALTER нижче).
-- Перезапускна: другий прогін нічого не змінює.

BEGIN;

ALTER TABLE "properties"
  ADD COLUMN IF NOT EXISTS "checkin_payment_policy" TEXT NOT NULL DEFAULT 'prepaid';
ALTER TABLE "properties"
  ADD COLUMN IF NOT EXISTS "system_of_record" TEXT NOT NULL DEFAULT 'alisio';
ALTER TABLE "properties"
  ADD COLUMN IF NOT EXISTS "kiosk_walkin_url" TEXT;

-- Обмеження за ОЗНАЧЕННЯМ, не за іменем (0052, AGENTS §4): міграція, яку
-- накотили двічі, не мусить падати на вже наявному констрейнті.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = '"properties"'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%checkin_payment_policy%allow_pay_later%'
  ) THEN
    ALTER TABLE "properties"
      ADD CONSTRAINT "properties_checkin_payment_policy_check"
      CHECK (checkin_payment_policy IN ('prepaid', 'allow_pay_later'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = '"properties"'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%system_of_record%alisio%'
  ) THEN
    ALTER TABLE "properties"
      ADD CONSTRAINT "properties_system_of_record_check"
      CHECK (system_of_record IN ('external', 'alisio'));
  END IF;
END $$;

ALTER TABLE "guest_registrations"
  ADD COLUMN IF NOT EXISTS "signature_png" TEXT;
ALTER TABLE "guest_registrations"
  ADD COLUMN IF NOT EXISTS "signed_at" TIMESTAMPTZ;

COMMIT;
