-- 0097: план рахунків і бізнес-юніти належать ГОТЕЛЮ, а не базі (INC-025)
--
-- Довідник фінансів сіявся один раз на всю базу: SQLite-міграція брала
-- `SELECT id FROM organizations LIMIT 1` — прямо проти інваріанта 1 — і
-- вставляла пʼятнадцять рядків із ЛІТЕРАЛЬНИМИ первинними ключами
-- (ec_accommodation, ec_other_exp, …). Другий комплект неможливий за
-- означенням PK. Справжній сівач (core/provisioning.ts) статей не сіяв
-- узагалі, а місток платежів пришпилював 'ec_accommodation' кожній
-- готівковій оплаті будь-якого готелю.
--
-- Наслідок залежав від походження бази, і обидві гілки погані:
--   - чиста інсталяція: статей немає ні в кого, зовнішній ключ порушується,
--     і готівкова оплата віддає 500 УЖЕ ПЕРШОМУ готелю;
--   - база, налита з демо: статті належать готелю №1, операції готелю №2
--     тихо чіпляються на ЧУЖИЙ рядок (RI-тригери виконуються з вимкненою row
--     security, тож ключ пропускає), а політика при читанні його ховає. Звіти
--     йдуть через LEFT JOIN, тож виручка не зникає — вона лягає з порожньою
--     назвою і COALESCE(classifier,'other'): проживання другого готелю
--     потрапляє в P&L не в той рядок, мовчки.
--
-- Того самого класу — business_units (bu_shared, bu_review).
--
-- Сталою величиною стає `code`, унікальний У МЕЖАХ ОРГАНІЗАЦІЇ (інваріант 3);
-- ідентифікатор рядка випадковий і належить готелю. Історичні літеральні
-- рядки лишаються на місці — усі посилання на них цілі, — просто отримують
-- свій код.

ALTER TABLE expense_categories ADD COLUMN IF NOT EXISTS code TEXT;
ALTER TABLE business_units     ADD COLUMN IF NOT EXISTS code TEXT;

-- 1. Підписати історичні літеральні ключі їхніми кодами.
UPDATE expense_categories SET code = substr(id, 4)
 WHERE code IS NULL AND id LIKE 'ec\_%' AND substr(id, 4) IN (
   'accommodation','services_rev','other_rev','variable','rent','utilities',
   'payroll','marketing','professional','consumables','other_exp','taxes',
   'capex','investors','transfer');
UPDATE business_units SET code = substr(id, 4)
 WHERE code IS NULL AND id LIKE 'bu\_%' AND substr(id, 4) IN ('shared','review');

-- 2. Унікальність — у межах організації, не бази.
CREATE UNIQUE INDEX IF NOT EXISTS idx_expense_categories_org_code
  ON expense_categories (organization_id, code) WHERE code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_business_units_org_code
  ON business_units (organization_id, code) WHERE code IS NOT NULL;

-- Кроку «досіяти довідник кожній організації» тут БІЛЬШЕ НЕМАЄ (INC-028).
--
-- Він був, і це було неправильно за родом: міграція котиться до того, як
-- орендар існує, тож «для кожної організації» в ній — це вже не міграція, а
-- сівач, що вдає міграцію. Рішення контролера 08.09: засів довідників живе
-- ТІЛЬКИ в provisionOrganization, де орендар відомий і створюється тут-таки.
--
-- Наслідок названо прямо, а не залишено на здогад: організація, заведена ДО
-- переїзду засіву, лишається без довідника, і перша ж готівкова оплата
-- ВІДМОВЛЯЄ названо — payment-bridge.requireCategory каже, чого бракує і що
-- зробити. Разова дія адміністратора: scripts/seed-chart-of-accounts.mjs.
-- Наявних баз ця міграція не чіпає (той самий принцип, що з мертвими
-- таблицями 07.09: additive-схема так, дані — ні).
