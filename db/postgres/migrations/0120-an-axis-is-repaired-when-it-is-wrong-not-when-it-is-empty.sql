-- 0120: вісь статті лікується за РОЗБІЖНІСТЮ з правилом, не за порожнечею
--
-- Р12.1 підписував осі там, де порожньо (міграція 0097,
-- scripts/seed-chart-of-accounts.mjs, обидва бекфіли SQLite). Це лишало без
-- лікування рівно ті бази, яким гірше за всіх (Р13.6): одноразовий легасі-
-- бекфіл db.ts ставив осі НЕПОРОЖНІМИ й неправильними —
--
--   * std_group = 'Financing' не потрапляв у жоден його WHEN, тож стаття
--     падала в останній рядок (op_type IS NULL -> other/other). `investors` —
--     надходження від інвестора — діставала вісь «інше», і в P&L її гроші йшли
--     НИЖЧЕ EBITDA зі знаком мінус: те, що в готель ПРИНЕСЛИ, зменшувало його
--     чистий результат;
--   * Revenue -> classifier 'other' — прямо, першим же рядком: проживання
--     переставало бути виручкою.
--
-- Обидва значення непорожні, тож наступний бекфіл, який лікує порожнє, після
-- них не спрацьовував уже ніколи, а `--list` показував «без осей: 0» — не «є
-- проблема, якої не видно», а «проблеми немає».
--
-- Порядок не переставляється: спершу за `code`, і лише рядки БЕЗ коду плану —
-- за `std_group`. Два рядки навмисно відхиляються від своєї групи (`variable`
-- — COGS, але власний рядок P&L «Змінні»; `investors` — Financing, але
-- надходження), і лікування самою лише групою зламало б обидва.
--
-- Групи, якої немає в переліку нижче, ця міграція НЕ чіпає: вгадана вісь це
-- гроші в чужому рядку звіту. Такі статті називає читач P&L названою відмовою
-- (`pnl-classifier.check`) і `seed-chart-of-accounts.mjs --list` — по імені.
--
-- Те саме правило й тим самим порядком — src/modules/finance/data/axis-repair.ts
-- (гейт axis-repair.check) і блок 0120 у src/lib/db.ts.
--
-- Ідемпотентна: умова порівнює нинішнє значення з очікуваним.

-- 1. За кодом плану рахунків.
UPDATE expense_categories SET op_type = 'income', classifier = 'revenue'
 WHERE code = 'accommodation'
   AND (COALESCE(op_type, '') <> 'income' OR COALESCE(classifier, '') <> 'revenue');
UPDATE expense_categories SET op_type = 'income', classifier = 'revenue'
 WHERE code = 'services_rev'
   AND (COALESCE(op_type, '') <> 'income' OR COALESCE(classifier, '') <> 'revenue');
UPDATE expense_categories SET op_type = 'income', classifier = 'revenue'
 WHERE code = 'other_rev'
   AND (COALESCE(op_type, '') <> 'income' OR COALESCE(classifier, '') <> 'revenue');
UPDATE expense_categories SET op_type = 'expense', classifier = 'variable'
 WHERE code = 'variable'
   AND (COALESCE(op_type, '') <> 'expense' OR COALESCE(classifier, '') <> 'variable');
UPDATE expense_categories SET op_type = 'expense', classifier = 'operational'
 WHERE code = 'rent'
   AND (COALESCE(op_type, '') <> 'expense' OR COALESCE(classifier, '') <> 'operational');
UPDATE expense_categories SET op_type = 'expense', classifier = 'operational'
 WHERE code = 'utilities'
   AND (COALESCE(op_type, '') <> 'expense' OR COALESCE(classifier, '') <> 'operational');
UPDATE expense_categories SET op_type = 'expense', classifier = 'operational'
 WHERE code = 'payroll'
   AND (COALESCE(op_type, '') <> 'expense' OR COALESCE(classifier, '') <> 'operational');
UPDATE expense_categories SET op_type = 'expense', classifier = 'operational'
 WHERE code = 'marketing'
   AND (COALESCE(op_type, '') <> 'expense' OR COALESCE(classifier, '') <> 'operational');
UPDATE expense_categories SET op_type = 'expense', classifier = 'operational'
 WHERE code = 'professional'
   AND (COALESCE(op_type, '') <> 'expense' OR COALESCE(classifier, '') <> 'operational');
UPDATE expense_categories SET op_type = 'expense', classifier = 'operational'
 WHERE code = 'consumables'
   AND (COALESCE(op_type, '') <> 'expense' OR COALESCE(classifier, '') <> 'operational');
UPDATE expense_categories SET op_type = 'expense', classifier = 'operational'
 WHERE code = 'other_exp'
   AND (COALESCE(op_type, '') <> 'expense' OR COALESCE(classifier, '') <> 'operational');
UPDATE expense_categories SET op_type = 'expense', classifier = 'tax'
 WHERE code = 'taxes'
   AND (COALESCE(op_type, '') <> 'expense' OR COALESCE(classifier, '') <> 'tax');
UPDATE expense_categories SET op_type = 'expense', classifier = 'capex'
 WHERE code = 'capex'
   AND (COALESCE(op_type, '') <> 'expense' OR COALESCE(classifier, '') <> 'capex');
UPDATE expense_categories SET op_type = 'income', classifier = 'financing'
 WHERE code = 'investors'
   AND (COALESCE(op_type, '') <> 'income' OR COALESCE(classifier, '') <> 'financing');
UPDATE expense_categories SET op_type = 'transfer', classifier = 'other'
 WHERE code = 'transfer'
   AND (COALESCE(op_type, '') <> 'transfer' OR COALESCE(classifier, '') <> 'other');

-- 2. Рядки БЕЗ коду плану — за групою обліку.
UPDATE expense_categories SET op_type = 'income', classifier = 'revenue'
 WHERE std_group = 'Revenue'
   AND (code IS NULL OR code NOT IN ('accommodation', 'services_rev', 'other_rev', 'variable', 'rent', 'utilities', 'payroll', 'marketing', 'professional', 'consumables', 'other_exp', 'taxes', 'capex', 'investors', 'transfer'))
   AND (COALESCE(op_type, '') <> 'income' OR COALESCE(classifier, '') <> 'revenue');
UPDATE expense_categories SET op_type = 'expense', classifier = 'cogs'
 WHERE std_group = 'COGS'
   AND (code IS NULL OR code NOT IN ('accommodation', 'services_rev', 'other_rev', 'variable', 'rent', 'utilities', 'payroll', 'marketing', 'professional', 'consumables', 'other_exp', 'taxes', 'capex', 'investors', 'transfer'))
   AND (COALESCE(op_type, '') <> 'expense' OR COALESCE(classifier, '') <> 'cogs');
UPDATE expense_categories SET op_type = 'expense', classifier = 'operational'
 WHERE std_group = 'OPEX'
   AND (code IS NULL OR code NOT IN ('accommodation', 'services_rev', 'other_rev', 'variable', 'rent', 'utilities', 'payroll', 'marketing', 'professional', 'consumables', 'other_exp', 'taxes', 'capex', 'investors', 'transfer'))
   AND (COALESCE(op_type, '') <> 'expense' OR COALESCE(classifier, '') <> 'operational');
UPDATE expense_categories SET op_type = 'expense', classifier = 'tax'
 WHERE std_group = 'Taxes'
   AND (code IS NULL OR code NOT IN ('accommodation', 'services_rev', 'other_rev', 'variable', 'rent', 'utilities', 'payroll', 'marketing', 'professional', 'consumables', 'other_exp', 'taxes', 'capex', 'investors', 'transfer'))
   AND (COALESCE(op_type, '') <> 'expense' OR COALESCE(classifier, '') <> 'tax');
UPDATE expense_categories SET op_type = 'expense', classifier = 'capex'
 WHERE std_group = 'CAPEX'
   AND (code IS NULL OR code NOT IN ('accommodation', 'services_rev', 'other_rev', 'variable', 'rent', 'utilities', 'payroll', 'marketing', 'professional', 'consumables', 'other_exp', 'taxes', 'capex', 'investors', 'transfer'))
   AND (COALESCE(op_type, '') <> 'expense' OR COALESCE(classifier, '') <> 'capex');
UPDATE expense_categories SET op_type = 'income', classifier = 'financing'
 WHERE std_group = 'Financing'
   AND (code IS NULL OR code NOT IN ('accommodation', 'services_rev', 'other_rev', 'variable', 'rent', 'utilities', 'payroll', 'marketing', 'professional', 'consumables', 'other_exp', 'taxes', 'capex', 'investors', 'transfer'))
   AND (COALESCE(op_type, '') <> 'income' OR COALESCE(classifier, '') <> 'financing');
UPDATE expense_categories SET op_type = 'transfer', classifier = 'other'
 WHERE std_group = 'Transfer'
   AND (code IS NULL OR code NOT IN ('accommodation', 'services_rev', 'other_rev', 'variable', 'rent', 'utilities', 'payroll', 'marketing', 'professional', 'consumables', 'other_exp', 'taxes', 'capex', 'investors', 'transfer'))
   AND (COALESCE(op_type, '') <> 'transfer' OR COALESCE(classifier, '') <> 'other');
