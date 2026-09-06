/**
 * Правила діють ДО зборів, і збір рахується від ціни ПІСЛЯ знижки.
 *
 *   node src/modules/pricing/data/quote.repo.check.ts
 *
 * Рецензія 07.09 раунд 2, правка 4.6. Порядок «спершу правила, потім збори»
 * (Ц31) доводився лише читанням `quote.repo.ts`: `priceNights` вище,
 * `applyFees` нижче. Нічого б не впало, якби рядки помінялися місцями, —
 * а різниця це гроші на кожному рахунку, де є відсотковий збір: 10 % від
 * 200,00 і 10 % від 180,00 — не те саме число.
 *
 * Порядок саме такий, а не навпаки, бо збір — це відсоток від того, що гість
 * СПЛАТИТЬ за проживання, а не від прейскуранта: знижка зменшує базу збору.
 *
 * Осі (інваріант 26): знижка −10 % і відсотковий збір 10 % на одну ніч за
 * 200,00. Правильний порядок дає проживання 180,00 і збір 18,00 (разом
 * 198,00); протилежний — збір 20,00 (разом 200,00). Числа арифметично
 * несумісні: 18 ≠ 20 і 198 ≠ 200. Плюс друге котирування БЕЗ правила
 * (проживання 200,00, збір 20,00) — інакше твердження було б зеленим і на
 * коді, який просто не рахує зборів.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-quote-'));
process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { calculateQuote } = await import('./quote.repo.ts');

const sql = getSql();
const ORG = '__quote_order__';
const PROP = `${ORG}_prop`;
const CAT = `${ORG}_cat`;
const TYPE = `${ORG}_type`;

await sql.run('INSERT INTO organizations (id, name, slug, default_currency) VALUES (?, ?, ?, ?)', [ORG, ORG, ORG, 'EUR']);
await sql.run('INSERT INTO properties (id, organization_id, name, slug) VALUES (?, ?, ?, ?)', [PROP, ORG, ORG, PROP]);
await sql.run('INSERT INTO categories (id, property_id, name, type) VALUES (?, ?, ?, ?)', [CAT, PROP, 'Rooms', 'room']);
await sql.run(
  `INSERT INTO unit_types (id, property_id, category_id, name, code, base_occupancy, max_adults, max_children, max_occupancy)
   VALUES (?, ?, ?, ?, ?, 2, 4, 2, 6)`,
  [TYPE, PROP, CAT, 'Double', 'DBL'],
);
await sql.run(
  'INSERT INTO price_calendar (id, unit_type_id, rate_plan_id, date, base_price) VALUES (?, ?, NULL, ?, ?)',
  [`${ORG}_pc`, TYPE, '2027-04-10', 200],
);
await sql.run(
  `INSERT INTO fees_taxes (id, property_id, name, type, amount, is_active) VALUES (?, ?, 'Сервісний збір', 'percentage', 10, TRUE)`,
  [`${ORG}_fee`, PROP],
);

// ── 1. Без правила: збір — 10 % від 200,00 ────────────────────────────────
const plain = await calculateQuote(TYPE, '2027-04-10', '2027-04-11', 2, 0);
assert.strictEqual(plain.accommodationTotal, 200, `проживання без правила — 200,00, а вийшло ${plain.accommodationTotal}`);
assert.strictEqual(plain.feesTotal, 20, `збір 10 % від 200,00 — 20,00, а вийшло ${plain.feesTotal}`);

// ── 2. Правило −10 % — і збір рахується вже від 180,00 ────────────────────
await sql.run(
  `INSERT INTO price_rules (id, organization_id, property_id, name, kind, action, value, value_kind, priority, is_active)
   VALUES (?, ?, ?, 'Квітень −10 %', 'rule', 'decrease', 10, 'percent', 10, TRUE)`,
  [`${ORG}_rule`, ORG, PROP],
);
const ruled = await calculateQuote(TYPE, '2027-04-10', '2027-04-11', 2, 0);
assert.strictEqual(ruled.accommodationTotal, 180, `правило спрацювало: 200,00 − 10 % = 180,00, а вийшло ${ruled.accommodationTotal}`);
assert.strictEqual(ruled.feesTotal, 18,
  `збір мусить рахуватись від ціни ПІСЛЯ правил: 10 % від 180,00 = 18,00. Вийшло ${ruled.feesTotal} — 20,00 означає, що збори порахували раніше за правила`);
assert.strictEqual(ruled.total, 198, `разом 180,00 + 18,00 = 198,00, а вийшло ${ruled.total}`);
assert.notStrictEqual(ruled.total, plain.total, 'знижка мусить бути видима в підсумку квоти');

console.log('quote: правила діють до зборів — збір рахується від ціни після знижки (198,00, не 200,00)');

await sql.run('DELETE FROM price_rules WHERE organization_id = ?', [ORG]);
await sql.run('DELETE FROM fees_taxes WHERE property_id = ?', [PROP]);
await sql.run('DELETE FROM price_calendar WHERE unit_type_id = ?', [TYPE]);
await sql.run('DELETE FROM unit_types WHERE property_id = ?', [PROP]);
await sql.run('DELETE FROM categories WHERE property_id = ?', [PROP]);
await sql.run('DELETE FROM properties WHERE organization_id = ?', [PROP]);
await sql.run('DELETE FROM organizations WHERE id = ?', [ORG]);
fs.rmSync(tmp, { recursive: true, force: true });
