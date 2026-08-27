-- Витрачені токени належать тому, хто їх витратив.
--
-- OpenAI кличеться з двох місць — розпізнавання документа гостя
-- (`guests/domain/ai/ocr-document.ts`) і машинний переклад контенту
-- (`core/i18n/translate.ts`). Обидва йдуть ключем СЕРВЕРА, спільним на всіх
-- клієнтів: рахунок від постачальника приходить один, а витрачають його різні
-- готелі. Способу сказати, хто скільки, не існувало — а отже, не існувало й
-- способу це перевиставити.
--
-- Один рядок = один виклик моделі. Журнал, а не лічильник: підсумок за місяць
-- виводиться з рядків, а число, яке лише збільшується, не вміє відповісти «за
-- що саме» і не переживає перерахунку.
--
-- ── Чому все всередині CREATE TABLE і DO-блоку ─────────────────────────────
--
-- Ця міграція мусить бути безпечною ПІСЛЯ `schema.sql`: у CI база піднімається
-- зі схеми, а потім по ній їдуть усі міграції. Окремий
-- `ALTER TABLE … ADD CONSTRAINT` цього не переживає — в Postgres він не має
-- `IF NOT EXISTS`, і другий прохід падає на «constraint already exists».
-- Саме так ця міграція і завалила збірку з першого разу.
--
-- Тому зовнішній ключ оголошений ПРЯМО в CREATE TABLE: якщо таблиця вже є,
-- `IF NOT EXISTS` не робить нічого — і робити нема чого. Решта (дефолт від
-- контексту, RLS, політика) ідемпотентна сама.
--
-- `organization_id` NOT NULL і без мовчазного дефолту в коді: рядок без
-- орендаря — це витрата, яку не виставити нікому, тобто рівно те, що ця
-- таблиця мала прибрати. DEFAULT від сесії лишається (як у решти
-- scoped-таблиць, міграція 0005), але INSERT називає колонку явно
-- (інваріант 12) — на SQLite цього DEFAULT немає.
CREATE TABLE IF NOT EXISTS "ai_usage" (
  "id" TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(16), 'hex'),
  "organization_id" TEXT NOT NULL
    REFERENCES "organizations" ("id") ON DELETE CASCADE,
  -- Що саме робили: 'ocr_document', 'translate_content'. TEXT, а не CHECK:
  -- наступна функція з моделлю не має вимагати міграції, щоб зʼявитись у
  -- лічильнику, а невідомий ключ екран показує як є.
  "feature" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "prompt_tokens" BIGINT NOT NULL DEFAULT 0,
  "completion_tokens" BIGINT NOT NULL DEFAULT 0,
  -- Сума двох, збережена окремо: постачальник віддає її сам, і для
  -- нерозділених відповідей вона єдине, що є.
  "total_tokens" BIGINT NOT NULL DEFAULT 0,
  -- TEXT, не TIMESTAMPTZ, і це не недогляд: підсумок за місяць береться як
  -- substr(created_at, 1, 7), бо `strftime` не існує в Postgres, а `to_char`
  -- у SQLite. Зріз ISO-рядка розуміють обидва двигуни однаково.
  "created_at" TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_ai_usage_org" ON "ai_usage" ("organization_id");
CREATE INDEX IF NOT EXISTS "idx_ai_usage_month" ON "ai_usage" ("organization_id", "created_at");

DO $$
DECLARE r text;
BEGIN
  EXECUTE 'ALTER TABLE ai_usage ALTER COLUMN "organization_id"
    SET DEFAULT NULLIF(current_setting(''app.organization_id'', true), '''')';
  EXECUTE 'ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE ai_usage FORCE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS ai_usage_tenant ON ai_usage';
  EXECUTE 'CREATE POLICY ai_usage_tenant ON ai_usage
    USING ("organization_id" = current_setting(''app.organization_id''))
    WITH CHECK ("organization_id" = current_setting(''app.organization_id''))';

  -- Права застосунку. Без цього циклу таблиця існує, політика на місці, і
  -- жоден INSERT не проходить: роль застосунку не є власником і не має на неї
  -- жодного гранту. Виглядало б це як «лічильник не рахує», а не як помилка
  -- доступу — бо `recordAiUsage` навмисно ковтає свої винятки.
  --
  -- Ролі беруться з `reservations`: хто має право читати броні, той і є
  -- застосунок. Перелічувати їх тут означало б другий список ролей, який
  -- розійдеться з першим.
  FOR r IN
    SELECT DISTINCT grantee FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND table_name = 'reservations'
       AND privilege_type = 'SELECT' AND grantee <> current_user
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ai_usage TO %I', r);
  END LOOP;
END $$;
