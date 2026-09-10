-- Звʼязок «цей тариф — цієї фірми» (INC-205, CORE-GAPS п.1).
--
-- ── Чому таблиця, а не колонка ──────────────────────────────────────────
--
-- Виміряно на базі Ґрайца (docs/research/winhotel/MAPPING.md §125–129), не
-- вигадано:
--
--   PREISCODE 3 «Firmenpreise» — ОДИН прайс-код на ВСІХ корпоративних гостей;
--   PREISCODE 8 і 10          — по одному на конкретну фірму (MATCHC
--                               FIRMA_B_DZD_1/2);
--   привʼязка                 — ADRESSEN.PR_CODE, тобто прайс-код на адресі.
--
-- Тобто в його даних ОДИН тариф обслуговує БАГАТО фірм. Колонка
-- `rate_plans.company_id` цього не виражає: «Firmenpreise» довелося б завести
-- по разу на кожну з 12 фірм — дванадцять однакових тарифів, які треба
-- тримати синхронними руками, і кожен зі своїм календарем цін. Це той самий
-- клас, що інваріант 20: дані, які клієнт міняє сам, розмножені по коду.
--
-- Колонка `companies.rate_plan_id` виразила б обидва випадки одним полем — і
-- її свідомо НЕ обрано з двох причин. Перша: `companies` цього раунду тримає
-- сесія 1, і писати туди заборонено межею задачі. Друга, і вона переживе
-- раунд: «кому видно цей тариф» — властивість ТАРИФУ, і зберігати її треба
-- там, де її читає котирування, а не за джойном через фірму. Плюс фірма з
-- двома тарифами (конференційний і загальний корпоративний) — звичайна річ,
-- і колонка її забороняє без потреби.
--
-- ── Що тримає орендаря ──────────────────────────────────────────────────
--
-- `organization_id` на самому рядку (інваріант 2): `rate_plans` власного
-- `organization_id` НЕ має — вона тенантна через `property_id → properties`,
-- — тож без колонки тут політика мусила б ходити двома джойнами. UNIQUE
-- включає організацію (інваріант 3).
--
-- Видалення фірми або тарифу забирає звʼязок із собою: звʼязок без одного з
-- кінців — це рядок, який нікому нічого не дозволяє, але з якого котирування
-- зробить порожній набір замість відмови (інваріант 13).

BEGIN;

CREATE TABLE IF NOT EXISTS "company_rate_plans" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "company_id" TEXT NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "rate_plan_id" TEXT NOT NULL REFERENCES "rate_plans"("id") ON DELETE CASCADE,
  "created_at" TIMESTAMPTZ DEFAULT now() NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("organization_id", "company_id", "rate_plan_id")
);

CREATE INDEX IF NOT EXISTS "idx_company_rate_plans_org"
  ON "company_rate_plans" ("organization_id");

-- Котирування питає «які тарифи в цієї фірми», писач — «чи ця фірма має цей
-- тариф»; обидва накриваються UNIQUE вище. Цей індекс — для третього питання,
-- «чиї цей тариф», яке ставить видалення тарифу і екран налаштувань.
CREATE INDEX IF NOT EXISTS "idx_company_rate_plans_plan"
  ON "company_rate_plans" ("rate_plan_id");

COMMIT;

-- ── Другий пояс: політика орендаря (INC-206) ────────────────────────────
--
-- Дописано 11.09.2026, після того як репетиція злиття впала словами
-- `tables without row-level security: company_rate_plans`.
--
-- Перша редакція цієї міграції завела таблицю без жодного рядка про RLS —
-- і розійшлася зі СВІЖОЮ базою, де генератор політику ставить сам
-- (`schema.sql`). Тобто новий клієнт діставав пояс, а бета й прод — ні.
--
-- Чому цього не побачила жодна сцена: код тут несе `organization_id` у
-- КОЖНОМУ запиті явно, тож дірки немає й сьогодні — перший пояс тримає. Але
-- другий існує рівно для писача, який завтра забуде орендаря в підзапиті: на
-- свіжій базі його зловить політика, на мігрованій — ніщо. Властивість, яку
-- не видно, поки тримає інша, доводиться не гейтом, а репетицією.
--
-- Форма взята з ГЕНЕРАТОРА дослівно (`scripts/pg-schema.mjs`, вивід у
-- `schema.sql`), а не написана своя: розбіжність у тексті предиката дала б
-- той самий дрейф іншими словами.
--
-- Ідемпотентність — `DROP POLICY IF EXISTS` перед `CREATE`, як у 0300:
-- `CREATE POLICY IF NOT EXISTS` у Postgres немає, а міграція вже накотилась
-- там, де її встигли накотити, і накотиться вдруге.

BEGIN;

ALTER TABLE "company_rate_plans" ALTER COLUMN "organization_id"
  SET DEFAULT NULLIF(current_setting('app.organization_id', true), '');

ALTER TABLE "company_rate_plans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "company_rate_plans" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "company_rate_plans_tenant" ON "company_rate_plans";
CREATE POLICY "company_rate_plans_tenant" ON "company_rate_plans"
  USING ("organization_id" = current_setting('app.organization_id'))
  WITH CHECK ("organization_id" = current_setting('app.organization_id'));

COMMIT;
