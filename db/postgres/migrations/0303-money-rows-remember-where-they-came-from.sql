-- INC-307. Ключ походження там, де повторний імпорт дублює ГРОШІ й ДОКУМЕНТИ.
--
-- ── Виміряно ────────────────────────────────────────────────────────────
--
-- Сутностей, які заводить імпорт (IMPORT-PLAN §1), — 24. Ключ походження мали
-- ТРИ: `guests.external_ref` і `reservations.external_ref` (0301) плюс
-- `fin_operations.source_ref` (пара до `source`, заведена раніше й не нами).
-- Лишався 21, і серед них СІМ таких, де другий прогін імпорту не просто
-- перезапише довідник, а створить другий примірник грошей або документа:
--
--   companies, invoices, fin_invoice_lines, fin_invoice_tax_totals,
--   fin_folio_items, fin_folio_payments, fin_folios
--
-- Решта 14 — довідники (типи номерів, тарифи, сезони, ставки ПДВ, джерела):
-- повтор там перезаписує рядок, а не множить його, і колонка наперед їм не
-- заводиться (див. звіт).
--
-- ── `fin_folios` тут НЕМАЄ, і це не забудькуватість ─────────────────────
--
-- Задача 12 просила «компанії й фінансові рядки насамперед» і тим самим
-- листом лишила `fin_folios` за сесією 1, яка міняє його просто зараз. Дві
-- вказівки не сходяться; узято конкретнішу — іменовану межу, — а розбіжність
-- названо в звіті першим абзацом, як велить AUTOLOOP. Тобто книга проживання
-- лишається без ключа походження, і це єдина з семи, де він досі потрібен.
--
-- ── Форма та сама, що в 0301 — навмисно ─────────────────────────────────
--
-- Частковий UNIQUE із орендарем: `(organization_id, external_ref) WHERE
-- external_ref IS NOT NULL`. Другої форми тут не вигадується — цей ключ
-- читатиме імпортер, а не ми, і однаковість для нього важливіша за
-- витонченість.
--
-- Предикат, як і в 0301, керує РОЗМІРОМ індексу, а не правильністю: у
-- унікальному індексі NULL-и не рівні між собою, тож рядки без походження не
-- конфліктують і без нього (виміряно в 0301).

ALTER TABLE "companies"               ADD COLUMN IF NOT EXISTS "external_ref" TEXT;
ALTER TABLE "invoices"                ADD COLUMN IF NOT EXISTS "external_ref" TEXT;
ALTER TABLE "fin_invoice_lines"       ADD COLUMN IF NOT EXISTS "external_ref" TEXT;
ALTER TABLE "fin_invoice_tax_totals"  ADD COLUMN IF NOT EXISTS "external_ref" TEXT;
ALTER TABLE "fin_folio_items"         ADD COLUMN IF NOT EXISTS "external_ref" TEXT;
ALTER TABLE "fin_folio_payments"      ADD COLUMN IF NOT EXISTS "external_ref" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_external_ref
  ON "companies" ("organization_id", "external_ref") WHERE "external_ref" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_external_ref
  ON "invoices" ("organization_id", "external_ref") WHERE "external_ref" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_fin_invoice_lines_external_ref
  ON "fin_invoice_lines" ("organization_id", "external_ref") WHERE "external_ref" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_fin_invoice_tax_totals_external_ref
  ON "fin_invoice_tax_totals" ("organization_id", "external_ref") WHERE "external_ref" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_fin_folio_items_external_ref
  ON "fin_folio_items" ("organization_id", "external_ref") WHERE "external_ref" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_fin_folio_payments_external_ref
  ON "fin_folio_payments" ("organization_id", "external_ref") WHERE "external_ref" IS NOT NULL;
