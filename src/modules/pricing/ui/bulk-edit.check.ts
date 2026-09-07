/**
 * Масовий редактор у простому режимі прибирає ціну вихідних так само, як денний.
 *
 *   node src/modules/pricing/ui/bulk-edit.check.ts
 *
 * Рецензія раунду 9, Р9.1 — блокер. Живий привід: `base_price: 333` на
 * 25–28.11 при `weekend_price` 115 давав 25.11 → 333, 26.11 → 333, а 27.11 і
 * 28.11 → 115.
 *
 * Осі (інваріант 26). Твердження стверджує про ТРИ осі, і фікстура різна по
 * кожній: режим (простий / розширений), чи змінено ціну (333 / порожньо), і
 * що саме сказано про вихідні (порожньо / число / галочка). На одному
 * значенні будь-якої з них «прибирає завжди» і «не прибирає ніколи» дали б
 * однакову відповідь.
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';

const { buildBulkPayload } = await import('./bulk-edit.ts');

const RANGE = { dateFrom: '2026-11-25', dateTo: '2026-11-28', applyTo: 'all' as const };
const EMPTY = {
  ...RANGE, basePrice: '' as const, weekendPrice: '' as const, clearWeekend: false,
  minStay: '' as const, maxStay: '' as const,
};
const SIMPLE = { ratePlanSelected: false, allPlans: false, advanced: false };
const ADVANCED = { ratePlanSelected: false, allPlans: false, advanced: true };

// ── 1. Простий режим, ціну ЗМІНЕНО: ціна вихідних прибирається ────────────
//
// Це і є Р9.1. `undefined` тут означало «не чіпати», і невидиме 115
// переживало правку.
const changed = buildBulkPayload({ ...EMPTY, basePrice: 333 }, SIMPLE);
assert.strictEqual(changed.base_price, 333);
assert.strictEqual(changed.weekend_price, null,
  '2026-11-27: мусить коштувати 333, а не 115 — у простому режимі зміна ціни прибирає ціну вихідних');

// ── 2. Простий режим, ціну НЕ чіпали: ціна вихідних недоторкана ───────────
//
// Друге значення осі «чи змінено ціну». Без нього «прибирати завжди» було б
// зеленим — а це знищувало б ціни вихідних правкою самого лише мінімуму ночей.
const onlyMinStay = buildBulkPayload({ ...EMPTY, minStay: 3 }, SIMPLE);
assert.strictEqual(onlyMinStay.base_price, undefined);
assert.strictEqual(onlyMinStay.weekend_price, undefined,
  'ціну не міняли — ціна вихідних не називається взагалі, інакше правка мінімуму витирала б її');
assert.strictEqual(onlyMinStay.min_stay, 3);

// ── 3. Розширений режим: слово оператора, а не режим ──────────────────────
//
// Друге значення осі «режим». На самому лише простому режимі правило
// «прибирати при зміні ціни» було б невідрізненне від «прибирати завжди».
const advChanged = buildBulkPayload({ ...EMPTY, basePrice: 333 }, ADVANCED);
assert.strictEqual(advChanged.weekend_price, undefined,
  'у розширеному режимі поле видиме: порожнє означає «не змінювати», і зміна ціни його не чіпає');

const advNumber = buildBulkPayload({ ...EMPTY, basePrice: 333, weekendPrice: 400 }, ADVANCED);
assert.strictEqual(advNumber.weekend_price, 400, 'назване число їде як є');

const advClear = buildBulkPayload({ ...EMPTY, clearWeekend: true }, ADVANCED);
assert.strictEqual(advClear.weekend_price, null, 'галочка «Прибрати» прибирає й без зміни ціни');

// ── 4. Невидимі поля простого режиму не їдуть ─────────────────────────────
//
// CTA/CTD і максимум ночей за перемикачем: у простому режимі їх на екрані
// немає, отже вони не змінені. «Закрито» лишається — Ц44.
const withHidden = buildBulkPayload(
  { ...EMPTY, basePrice: 333, maxStay: 5, cta: true, ctd: true, closed: true }, SIMPLE);
assert.strictEqual(withHidden.max_stay, undefined, 'максимум ночей — розширене поле');
assert.strictEqual(withHidden.cta, undefined, 'CTA — розширене поле');
assert.strictEqual(withHidden.ctd, undefined, 'CTD — розширене поле');
assert.strictEqual(withHidden.closed, true, '«Закрито» лишається і в простому режимі (Ц44)');

const advHidden = buildBulkPayload(
  { ...EMPTY, basePrice: 333, maxStay: 5, cta: true }, ADVANCED);
assert.strictEqual(advHidden.max_stay, 5, 'у розширеному ті самі поля їдуть');
assert.strictEqual(advHidden.cta, true);

// ── 5. Область обмежень ───────────────────────────────────────────────────
assert.strictEqual(buildBulkPayload({ ...EMPTY, minStay: 2 }, SIMPLE).restrictionsScope, undefined,
  'без вибраного тарифу області немає');
assert.strictEqual(
  buildBulkPayload({ ...EMPTY, minStay: 2 }, { ...SIMPLE, ratePlanSelected: true }).restrictionsScope, 'pair',
  'прапорець знятий — лише на пару (Ц45)');
assert.strictEqual(
  buildBulkPayload({ ...EMPTY, minStay: 2 }, { ...SIMPLE, ratePlanSelected: true, allPlans: true }).restrictionsScope, 'type');

console.log('bulk-edit: у простому режимі зміна ціни прибирає ціну вихідних, а правка без ціни її не чіпає');
