-- Спосіб оплати — РЯДОК ГОТЕЛЮ, а не одне з чотирьох слів у CHECK.
--
-- ── Що було і чому цього мало ───────────────────────────────────────────
--
-- `fin_folio_payments.method` тримав чотири класи в обмеженні бази:
-- `cash | card_terminal | transfer | voucher`. Класи правильні — код ними
-- живе (готівка йде в касову книгу і під §146a AO, переказ ні), — але вони
-- відповідають на питання «як з цим поводитись», а не «чим саме заплатили».
--
-- У живому готелі другий список довший і належить ЙОМУ: 24 рядки, і кожен
-- несе те, чого клас не несе — рахунок обліку, ознаку «на дебітора»,
-- прапорець EC-термінала, доступність у вебі. «Картка» там не один спосіб, а
-- кілька, з РІЗНИМИ рахунками обліку, і бухгалтер розрізняє їх у книгах.
-- Скласти їх у чотири кошики означає втратити рахунок обліку — саме те, що
-- звіряють.
--
-- ── Довідник НАД класом, а не ЗАМІСТЬ нього ─────────────────────────────
--
-- `CHECK` лишається, і це рішення, а не спадок: клас потрібен КОДУ. Тому
-- рядок довідника НАЗИВАЄ спосіб і НЕСЕ клас своєю властивістю (`kind`), а
-- платіжка й далі має `method` — той самий клас, тепер узятий із рядка, а не
-- введений окремо. Два джерела одного факту тут неможливі за побудовою:
-- писач бере `kind` з довідника (Д61).
--
-- ── `settles_to_debtor` — місток до дебітора, і він не про гроші ────────
--
-- Оплата «на дебітора» (`M_DEPITOR` у джерелі) грошима не є: вона переносить
-- борг на фірму. Каса її не бачить, виторг не росте, а «відкриті фактури
-- фірми» — навпаки. Ознака стоїть на СПОСОБІ, бо саме готель вирішує, який
-- зі своїх способів це означає.
--
-- ── Назва: NULL означає «стандартна назва класу» ────────────────────────
--
-- Засів НЕ вигадує слів жодною мовою. Міграція не може вгадати мову готелю
-- (той самий довід, що в О5 про каталог зручностей), а показати чеське слово
-- німецькому портьє гірше, ніж не показати нічого. Тому в засіяних рядках
-- `name IS NULL`, і екран показує переклад КЛАСУ; щойно готель напише своє —
-- воно й показується. Це не мовчазний дефолт: чотири класи це словник
-- продукту (як `reservations.status`), а не дані клієнта.
--
-- ── Засів — тут, а не в коді при першому відкритті екрана ───────────────
--
-- Інакше готель, який ще не заходив у налаштування, дістав би платіж, що
-- вказує в нікуди. Зворотне заповнення тут МОЖНА — на відміну від Д60, — бо
-- зміст `method` не мінявся: клас як був класом, так і лишився, і рядок
-- знаходиться за ним однозначно.

BEGIN;

CREATE TABLE IF NOT EXISTS "fin_payment_methods" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  -- Стійкий ключ рядка в межах готелю: за ним його знаходить зворотне
  -- заповнення і за ним його впізнає імпорт. Людина його не бачить.
  "code" TEXT NOT NULL,
  -- Те, що бачить портьє. NULL — «стандартна назва класу» (див. вище).
  "name" TEXT,
  -- КЛАС: як із цими грішми поводитись. Ті самі чотири, що в CHECK платіжки.
  "kind" TEXT NOT NULL,
  -- Рахунок обліку (`KONTONR`): те, заради чого довідник і заводиться.
  "ledger_account" TEXT,
  -- Не гроші, а перенесення боргу на фірму (`M_DEPITOR`).
  "settles_to_debtor" BOOLEAN DEFAULT FALSE NOT NULL,
  -- «Не пропонувати нове». Видалити використаний спосіб не можна (Д61), а
  -- перестати ним платити — звичайна щоденна дія.
  "is_active" BOOLEAN DEFAULT TRUE NOT NULL,
  "position" BIGINT DEFAULT 0 NOT NULL,
  "created_at" TIMESTAMPTZ DEFAULT now() NOT NULL,
  "updated_at" TIMESTAMPTZ DEFAULT now() NOT NULL,
  PRIMARY KEY ("id"),
  -- Інваріант 3: ключ, який обирає людина, унікальний У МЕЖАХ організації.
  UNIQUE ("organization_id", "code"),
  CHECK ("kind" IN ('cash','card_terminal','transfer','voucher'))
);

CREATE INDEX IF NOT EXISTS "idx_fin_payment_methods_org"
  ON "fin_payment_methods" ("organization_id", "position");

-- Пояс орендаря — У ЦЬОМУ Ж ФАЙЛІ (check-migration-rls), формою з генератора.
ALTER TABLE "fin_payment_methods" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fin_payment_methods" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fin_payment_methods_tenant" ON "fin_payment_methods";
CREATE POLICY "fin_payment_methods_tenant" ON "fin_payment_methods"
  USING ("organization_id" = current_setting('app.organization_id'))
  WITH CHECK ("organization_id" = current_setting('app.organization_id'));

-- Платіжка вказує на рядок довідника. `method` лишається і лишається
-- обовʼязковим: клас читають дев'ять місць коду, і читати його через джойн
-- заради краси означало б переписати їх усі сьогодні.
ALTER TABLE "fin_folio_payments" ADD COLUMN IF NOT EXISTS "method_id" TEXT
  REFERENCES "fin_payment_methods"("id") ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS "idx_fin_folio_payments_method"
  ON "fin_folio_payments" ("method_id");

-- ── Засів: чотири стандартні рядки КОЖНІЙ організації ───────────────────
--
-- `WHERE NOT EXISTS` замість `ON CONFLICT`: конфлікт ловився б за іменем
-- обмеження, а воно на свіжій базі своє (те саме, про що AGENTS §4 попереджає
-- щодо констрейнтів). Ідемпотентність тут тримається питанням до даних.
INSERT INTO "fin_payment_methods" (id, organization_id, code, kind, position)
SELECT encode(gen_random_bytes(16), 'hex'), o.id, k.code, k.code, k.pos
  FROM "organizations" o
  CROSS JOIN (VALUES ('cash', 0), ('card_terminal', 1), ('transfer', 2), ('voucher', 3))
       AS k(code, pos)
 WHERE NOT EXISTS (
   SELECT 1 FROM "fin_payment_methods" m
    WHERE m.organization_id = o.id AND m.code = k.code);

-- ── Зворотне заповнення: кожна наявна платіжка вказує на свій рядок ─────
UPDATE "fin_folio_payments" p
   SET "method_id" = m.id
  FROM "fin_payment_methods" m
 WHERE m.organization_id = p.organization_id
   AND m.code = p.method
   AND p.method_id IS NULL;

COMMIT;
