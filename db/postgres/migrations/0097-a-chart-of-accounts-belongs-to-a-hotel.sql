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

-- 3. Досіяти повний довідник КОЖНІЙ організації, у якої його немає.
--    Це і є лікування: на чинній беті готель №2 не має жодної статті.
INSERT INTO expense_categories
  (id, organization_id, code, name, std_group, pnl_line,
   include_in_pnl, include_in_cash, alloc_method, is_capex, icon, color, sort_order)
SELECT encode(gen_random_bytes(16), 'hex'), o.id, s.code, s.name, s.std_group, s.pnl_line,
       s.include_in_pnl, s.include_in_cash, s.alloc_method, s.is_capex, s.icon, s.color, s.sort_order
  FROM organizations o
  CROSS JOIN (VALUES
    ('accommodation','Accommodation','Revenue','Accommodation',1,1,'DIRECT',false,'🏠','#22c55e',1),
    ('services_rev','Services','Revenue','Services',1,1,'DIRECT',false,'🛎️','#f59e0b',2),
    ('other_rev','Other income','Revenue','Other income',1,1,'DIRECT',false,'💰','#84cc16',3),
    ('variable','Variable costs','COGS','Variable costs',1,1,'DIRECT',false,'📦','#991b1b',4),
    ('rent','Rent','OPEX','Rent',1,1,'RENT',false,'🏢','#6366f1',5),
    ('utilities','Utilities','OPEX','Utilities',1,1,'UTILITIES',false,'🔌','#8b5cf6',6),
    ('payroll','Payroll','OPEX','Payroll',1,1,'SHARED_PAYROLL',false,'👥','#a855f7',7),
    ('marketing','Marketing','OPEX','Marketing',1,1,'HQ',false,'📢','#ec4899',8),
    ('professional','Professional services','OPEX','Professional services',1,1,'HQ',false,'💼','#14b8a6',9),
    ('consumables','Consumables','OPEX','Consumables',1,1,'HQ',false,'🧹','#78716c',10),
    ('other_exp','Other expenses','OPEX','Other expenses',1,1,'HQ',false,'📋','#6b7280',11),
    ('taxes','Taxes','Taxes','Taxes',1,1,'HQ',false,'🏛️','#334155',12),
    ('capex','Capital expenditure','CAPEX','CAPEX',0,1,'NONE',true,'🏗️','#0ea5e9',13),
    ('investors','Financing','Financing','Financing',0,1,'NONE',false,'🏦','#059669',14),
    ('transfer','Transfer','Transfer','Transfer',0,1,'NONE',false,'↔️','#94a3b8',15)
  ) AS s(code, name, std_group, pnl_line, include_in_pnl, include_in_cash,
         alloc_method, is_capex, icon, color, sort_order)
 WHERE NOT EXISTS (
   SELECT 1 FROM expense_categories c
    WHERE c.organization_id = o.id AND c.code = s.code);

INSERT INTO business_units (id, organization_id, code, name, unit_type, is_shared, sort_order)
SELECT encode(gen_random_bytes(16), 'hex'), o.id, s.code, s.name, s.unit_type, s.is_shared, s.sort_order
  FROM organizations o
  CROSS JOIN (VALUES
    ('shared','Shared / HQ','Shared / HQ',true,1),
    ('review','To review','Unassigned / review',false,2)
  ) AS s(code, name, unit_type, is_shared, sort_order)
 WHERE NOT EXISTS (
   SELECT 1 FROM business_units b
    WHERE b.organization_id = o.id AND b.code = s.code);
