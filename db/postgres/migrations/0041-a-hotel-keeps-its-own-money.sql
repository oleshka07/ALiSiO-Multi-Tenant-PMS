-- Готель веде облік у СВОЇЙ валюті, а показує суми ще в кількох.
--
-- Основна валюта вже є — `organizations.default_currency`. Тут зʼявляються
-- ДРУГОРЯДНІ: 1–3 валюти, у яких готель показує суми гостю у віджеті чи
-- партнеру у звіті. Облік від цього не змінюється: фоліо, фактури й звіти
-- лишаються в основній.
--
-- ── Чому курсу немає в цій таблиці ─────────────────────────────────────────
--
-- Спокуса покласти сюди `manual_rate` велика: одна колонка, і ручний курс
-- нікуди не треба нести. Але тоді курсів стає два — ручний тут і
-- автоматичний у `finance_exchange_rates`, — і будь-який екран мусить знати,
-- який із них сьогодні чинний. Це та сама вада, що коштувала чотирьох різних
-- цін на ніч (інваріант 16): друге джерело істини завжди розходиться з
-- першим, і завжди тихо.
--
-- Тому тут лише ЗВІДКИ береться курс, а сам курс — завжди в
-- `finance_exchange_rates`. Ручне введення пише туди рядок із датою; крон
-- ČNB пише туди ж. Один запит відповідає на «скільки коштує євро», хоч би
-- хто його вніс, і історія курсів зʼявляється безкоштовно.
--
-- ── Чому основна валюта НЕ дублюється сюди ────────────────────────────────
--
-- Одне значення в двох місцях розходиться. `organizations.default_currency`
-- лишається єдиною відповіддю на «у чому цей готель веде облік», і
-- `core/currency.ts` читає саме її — без запасного значення: валюти, якої
-- немає, не існує, як не існує ціни, якої не назвали.
CREATE TABLE IF NOT EXISTS "organization_currencies" (
  "id" TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(16), 'hex'),
  "organization_id" TEXT NOT NULL
    REFERENCES "organizations" ("id") ON DELETE CASCADE,
  -- ISO 4217, три літери. Без CHECK-переліку: список валют світу не є
  -- бізнес-словником клієнта, але й не має жити в схемі — нова валюта не
  -- повинна вимагати міграції.
  "code" TEXT NOT NULL,
  -- 'manual' | 'cnb'. TEXT, не CHECK: НБУ і ЄЦБ додадуться рядком у коді й
  -- джерелом у кроні, без міграції. Невідоме значення екран показує як є.
  "rate_source" TEXT NOT NULL DEFAULT 'manual',
  "sort_order" BIGINT NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE ("organization_id", "code")
);

CREATE INDEX IF NOT EXISTS "idx_org_currencies_org"
  ON "organization_currencies" ("organization_id");

DO $$
DECLARE r text;
BEGIN
  EXECUTE 'ALTER TABLE organization_currencies ALTER COLUMN "organization_id"
    SET DEFAULT NULLIF(current_setting(''app.organization_id'', true), '''')';
  EXECUTE 'ALTER TABLE organization_currencies ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE organization_currencies FORCE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS organization_currencies_tenant ON organization_currencies';
  EXECUTE 'CREATE POLICY organization_currencies_tenant ON organization_currencies
    USING ("organization_id" = current_setting(''app.organization_id''))
    WITH CHECK ("organization_id" = current_setting(''app.organization_id''))';

  -- Права застосунку. Без цього циклу таблиця існує, політика на місці, і
  -- жоден запит не проходить: роль застосунку не власник і не має гранту.
  -- Ролі беруться з `reservations` — хто читає броні, той і є застосунок;
  -- другий список ролей розійшовся б із першим.
  FOR r IN
    SELECT DISTINCT grantee FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND table_name = 'reservations'
       AND privilege_type = 'SELECT' AND grantee <> current_user
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON organization_currencies TO %I', r);
  END LOOP;
END $$;
