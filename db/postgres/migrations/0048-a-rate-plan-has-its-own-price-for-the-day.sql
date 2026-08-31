-- Ціна належить тарифу, а не лише типу номера.
--
-- Рішення власника §10.11 docs/CHANNEX-INTEGRATION.md: тариф іде в календар
-- цін, заселеність лишається в `price_occupancy`, зводить їх `priceNights()`.
--
-- ── Навіщо ────────────────────────────────────────────────────────────────
--
-- Channex будує ціни на ТАРИФАХ, і це не стильова відмінність, а вимога
-- сертифікації. Тест 4 просить рівно це: один тип номера, два тарифи,
-- діапазони дат перетинаються, ціни не пов'язані відсотком. Перевірено на
-- живому API 31 серпня (docs/vendor/channex/INVENTORY.md §14.1): на 13
-- листопада той самий «Double Room» одночасно віддає 312.66 за одним тарифом
-- і 111.00 за другим. `price_calendar` із ключем (unit_type_id, date) цього
-- не виражає — на один тип і одну добу там рівно один рядок.
--
-- ── Що саме міняється ─────────────────────────────────────────────────────
--
-- 1. `price_calendar.rate_plan_id` — NULL означає «базова ціна типу номера»,
--    тобто рівно те, чим є КОЖЕН наявний рядок. Тому колонка nullable і без
--    дефолту: жоден рядок не треба чіпати, і жоден готель не помітить зміни,
--    доки не заведе тариф.
-- 2. Старий UNIQUE(unit_type_id, date) знімається, бо він і є те, що
--    забороняє другий тариф на ту саму добу.
-- 3. Замість нього — унікальний ІНДЕКС із COALESCE.
-- 4. `reservations.unit_type_id` — бронь з OTA приходить на тип, не на номер.
--
-- ── Чому індекс, а не розширений UNIQUE ───────────────────────────────────
--
-- `UNIQUE(unit_type_id, rate_plan_id, date)` виглядає очевидним і не працює:
-- `rate_plan_id` nullable, а UNIQUE не обмежує NULL — ні тут, ні в SQLite.
-- Два БАЗОВІ рядки на ту саму добу пройшли б обидва, і яка ціна виграє,
-- залежало б від порядку читання. Це вже коштувало проєкту крові на
-- `price_occupancy` (див. `idx_price_occupancy_row`), тому тут одразу
-- індекс по виразу.
--
-- `''` як заступник NULL годиться, бо колонка TEXT на обох двигунах; у
-- `price_occupancy` довелося брати дати-вартові саме тому, що там колонки
-- типізовані як DATE.
--
-- ── Порядок ───────────────────────────────────────────────────────────────
--
-- Колонка з'являється ДО того, як знімається констрейнт, і індекс — після
-- обох. Міграція перезапускна: кожен крок перевіряє стан, якого досягає.

-- 1. Колонка ---------------------------------------------------------------
ALTER TABLE "price_calendar"
  ADD COLUMN IF NOT EXISTS "rate_plan_id" TEXT;

-- 2. Старий констрейнт ------------------------------------------------------
--
-- Ім'я не вписується літералом: Postgres дав його автоматично
-- (`price_calendar_unit_type_id_date_key`), а база, що пережила ручні правки
-- чи давніший дамп, може називати той самий констрейнт інакше. Тому шукаємо
-- за ВМІСТОМ: будь-який UNIQUE рівно на (unit_type_id, date).
DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace ns ON ns.oid = rel.relnamespace
     WHERE rel.relname = 'price_calendar'
       AND ns.nspname = current_schema()
       AND con.contype = 'u'
       AND (
         -- `::text` не косметика: `pg_attribute.attname` має тип `name`, і
         -- `name[] = text[]` — це «operator does not exist», тобто міграція,
         -- яка падає на сервері після того, як пройшла всі статичні перевірки.
         -- Спіймано живим Postgres, не читанням.
         SELECT array_agg(att.attname::text ORDER BY att.attname::text)
           FROM unnest(con.conkey) AS k(attnum)
           JOIN pg_attribute att
             ON att.attrelid = con.conrelid AND att.attnum = k.attnum
       ) = ARRAY['date', 'unit_type_id']
  LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', 'price_calendar', c.conname);
    RAISE NOTICE 'price_calendar: dropped UNIQUE constraint %', c.conname;
  END LOOP;
END $$;

-- 3. Унікальність, яка тримає обидва роди рядків ----------------------------
CREATE UNIQUE INDEX IF NOT EXISTS "idx_price_calendar_row"
  ON "price_calendar" ("unit_type_id", (COALESCE("rate_plan_id", '')), "date");

CREATE INDEX IF NOT EXISTS "idx_price_cal_rate_plan"
  ON "price_calendar" ("rate_plan_id");

-- 4. Тип номера на бронюванні ----------------------------------------------
--
-- §2.3 блокер 3: `unit_id NOT NULL` не лишав місця для броні з каналу — вона
-- називає тип номера, а який саме номер дістанеться гостю, вирішує готель.
-- Колонка лише ЗАПИСУЄ відповідь. Правила автопризначення номера тут немає й
-- не має бути: це фаза 5 і окреме продуктове рішення, а вигадане тут воно
-- почало б роздавати номери в кожному готелі на сервері.
ALTER TABLE "reservations"
  ADD COLUMN IF NOT EXISTS "unit_type_id" TEXT;

CREATE INDEX IF NOT EXISTS "idx_reservations_unit_type"
  ON "reservations" ("unit_type_id");

-- 5. Зовнішні ключі --------------------------------------------------------
--
-- Схема їх має (195 штук, окремими ALTER наприкінці `schema.sql`), тож нові
-- колонки мусять їх мати теж — інакше свіжа база з `schema.sql` і мігрована
-- база розійшлися б.
--
-- Імена взяті з РЕГЕНЕРОВАНОГО `schema.sql`, а не вигадані: генератор нумерує
-- ключі в порядку колонок таблиці, тож обидва нові виходять під номером 1.
-- (Побічний ефект, який тут нікого не рятує й не шкодить: у свіжій базі
-- сусідні ключі `reservations` зсунулись на одиницю. Імена констрейнтів ніде
-- не згадуються в коді, а перейменовувати їх міграцією на живій базі — це
-- шум заради косметики.)
--
-- `IF NOT EXISTS` для констрейнта в Postgres немає, тому кожен загорнутий у
-- перевірку каталогу: міграція мусить лишатись перезапускною.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_price_calendar_rate_plan_id_1') THEN
    ALTER TABLE "price_calendar" ADD CONSTRAINT "fk_price_calendar_rate_plan_id_1"
      FOREIGN KEY ("rate_plan_id") REFERENCES "rate_plans" ("id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_reservations_unit_type_id_1') THEN
    ALTER TABLE "reservations" ADD CONSTRAINT "fk_reservations_unit_type_id_1"
      FOREIGN KEY ("unit_type_id") REFERENCES "unit_types" ("id");
  END IF;
END $$;

-- ── RLS ───────────────────────────────────────────────────────────────────
--
-- Політик не чіпаємо навмисно. `price_calendar_tenant` доводить орендаря
-- через `unit_type_id -> unit_types -> properties`, і новий стовпчик цього не
-- міняє: рядок тарифу належить тому ж типу номера, що й базовий.
-- `reservations` має власний `organization_id` і свою політику.
--
-- Окремо варте уваги: політика `price_calendar` перевіряє САМЕ `unit_type_id`.
-- Тариф із чужого готелю в `rate_plan_id` вона не спинить — це робить
-- зовнішній ключ вище і застосунок, який бере тарифи через
-- `propertyRatePlans()`.
