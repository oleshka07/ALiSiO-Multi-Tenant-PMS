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
-- `organization_id` NOT NULL і без мовчазного дефолту в коді: рядок без
-- орендаря — це витрата, яку не виставити нікому, тобто рівно те, що ця
-- таблиця мала прибрати. DEFAULT від контексту сесії лишається (як у решти
-- scoped-таблиць, міграція 0005) — але INSERT називає колонку явно
-- (інваріант 12), бо на SQLite цього DEFAULT немає.
CREATE TABLE IF NOT EXISTS "ai_usage" (
  "id" TEXT DEFAULT encode(gen_random_bytes(16), 'hex') NOT NULL,
  "organization_id" TEXT NOT NULL,
  -- Що саме робили: 'ocr_document', 'translate_content'. TEXT, а не CHECK:
  -- наступна функція з моделлю не має вимагати міграції, щоб зʼявитись у
  -- лічильнику, а невідомий ключ екран показує як є.
  "feature" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "prompt_tokens" BIGINT DEFAULT 0 NOT NULL,
  "completion_tokens" BIGINT DEFAULT 0 NOT NULL,
  -- Сума двох, збережена окремо: постачальник віддає її сам, і для
  -- нерозділених відповідей вона єдине, що є.
  "total_tokens" BIGINT DEFAULT 0 NOT NULL,
  -- TEXT, не TIMESTAMPTZ, і це не недогляд: підсумок за місяць береться як
  -- substr(created_at, 1, 7), бо `strftime` не існує в Postgres, а `to_char`
  -- у SQLite. Зріз ISO-рядка розуміють обидва двигуни однаково.
  "created_at" TEXT NOT NULL,
  PRIMARY KEY ("id")
);

ALTER TABLE "ai_usage" ADD CONSTRAINT "fk_ai_usage_organization_id_1"
  FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS "idx_ai_usage_org" ON "ai_usage" ("organization_id");
CREATE INDEX IF NOT EXISTS "idx_ai_usage_month" ON "ai_usage" ("organization_id", "created_at");

ALTER TABLE "ai_usage" ALTER COLUMN "organization_id"
  SET DEFAULT NULLIF(current_setting('app.organization_id', true), '');

ALTER TABLE "ai_usage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_usage" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ai_usage_tenant" ON "ai_usage"
  USING ("organization_id" = current_setting('app.organization_id'))
  WITH CHECK ("organization_id" = current_setting('app.organization_id'));
