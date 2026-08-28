-- Будови прибрано.
--
-- ── Що це було ────────────────────────────────────────────────────────────
--
-- Таблиця `buildings` із двома FK, повним CRUD (`/api/buildings`), власним
-- типом iCal-каналу і колонкою `building_id` у трьох таблицях. Заведено під
-- корпус «F» першого клієнта: 17 номерів F1–F17, модалка розселення, що
-- малювала фізичний коридор, і засів віртуального «Чорновик F».
--
-- Другого клієнта воно не стосувалося ніколи, а першому давало те саме, що
-- вже давала колонка `units.zone` — вільний текст, який готель пише сам.
-- Календар це навіть не приховував: рядки він групував по
-- `building_name || zone`, тобто по будові АБО зоні, одним виразом. Дві
-- підсистеми робили одну роботу, і одна з них коштувала таблицю, маршрут,
-- політику RLS і гілку в кожному екрані номерного фонду.
--
-- ── Чому DROP, а не «лишимо, раптом знадобиться» ──────────────────────────
--
-- Порожня таблиця з політикою й індексами не безкоштовна: вона зʼявляється в
-- кожному аудиті, її треба тримати в схемі, у генераторі політик і в голові.
-- Корпус описується зоною; знадобиться ієрархія — вона буде іншою, бо
-- проєктуватиметься не під один готель.
--
-- ── Порядок ───────────────────────────────────────────────────────────────
--
-- Спершу канали: `ical_channels.building_id` має FK ON DELETE CASCADE, тож
-- рядок каналу на будову зник би разом із нею мовчки. Такий канал є лише в
-- одного клієнта і означає «один календар на весь корпус» — поведінку, якої
-- більше немає. Видаляємо його явно, щоб це було видно в журналі міграцій.
DELETE FROM "ical_channels" WHERE "channel_type" = 'building';

-- CHECK перевипускається під один тип, що лишився. `DEFAULT 'unit'` — щоб
-- вставка без цього поля не падала: тип більше не вибір.
--
-- Ім'я старого констрейнта не вгадується: `schema.sql` створює CHECK без
-- імені, і Postgres дає такі `ical_channels_check`, `ical_channels_check1`
-- — за порядком у таблиці, тобто по-різному на різних інсталяціях.
-- `DROP CONSTRAINT IF EXISTS "…_channel_type_check"` мовчки не зробив би
-- нічого, старий CHECK лишився б поруч із новим, і ніхто б цього не побачив.
-- Тому шукаємо за визначенням.
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = '"ical_channels"'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%channel_type%'
  LOOP
    EXECUTE format('ALTER TABLE "ical_channels" DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

ALTER TABLE "ical_channels" ALTER COLUMN "channel_type" SET DEFAULT 'unit';
UPDATE "ical_channels" SET "channel_type" = 'unit' WHERE "channel_type" <> 'unit';
ALTER TABLE "ical_channels" ADD CONSTRAINT "ical_channels_channel_type_check"
  CHECK (channel_type IN ('unit'));
ALTER TABLE "ical_channels" DROP COLUMN IF EXISTS "building_id";

-- Колонки, що посилались на будову. `ON DELETE SET NULL` в обох, тож дані
-- номерів і типів не залежали від неї — зникає лише посилання.
ALTER TABLE "unit_types" DROP COLUMN IF EXISTS "building_id";
ALTER TABLE "units" DROP COLUMN IF EXISTS "building_id";

DROP TABLE IF EXISTS "buildings";

-- ── Категорія прайса віджета ──────────────────────────────────────────────
--
-- `widget_price_list.category` мала CHECK `IN ('glamping','buildings','camping')`
-- — три слова першого клієнта, зашиті в базу. Готель із категоріями «Номери»
-- і «Апартаменти» діставав відмову бази на власну категорію: не порожній
-- список, а помилку запису.
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = '"widget_price_list"'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%category%'
  LOOP
    EXECUTE format('ALTER TABLE "widget_price_list" DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
