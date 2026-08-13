/**
 * Freezing a folio into an invoice, and reversing one.
 *
 *   node src/modules/finance/domain/invoice-snapshot.check.ts
 *
 * The fixture is invoice 22.421 again, this time end to end: four charges off a
 * folio become four printed lines plus the two-row MwSt-Übersicht, and the
 * numbers must be the ones on the paper.
 */
import assert from 'node:assert';
import { buildSnapshot, buildStorno, type FolioItem } from './invoice-snapshot.ts';

const FOLIO: FolioItem[] = [
  { id: 'i1', service_date: '2026-08-04', description: 'Übernachtung', guest_name: 'M. Schneider', unit_code: '213', quantity: 1, unit_price_gross: 143.05, total_gross: 143.05, vat_rate: 7 },
  { id: 'i2', service_date: '2026-08-05', description: 'Frühstück Speisen', guest_name: 'M. Schneider', unit_code: '213', quantity: 3, unit_price_gross: 12, total_gross: 36, vat_rate: 7 },
  { id: 'i3', service_date: '2026-08-05', description: 'Frühstück Getränke', guest_name: 'M. Schneider', unit_code: '213', quantity: 3, unit_price_gross: 3, total_gross: 9, vat_rate: 19 },
  { id: 'i4', service_date: '2026-08-04', description: 'Bar', guest_name: 'M. Schneider', unit_code: '213', quantity: 2, unit_price_gross: 1.9, total_gross: 3.8, vat_rate: 19 },
];

const snap = buildSnapshot(FOLIO);

// ─── The document ───────────────────────────────────────────────────────────
assert.strictEqual(snap.lines.length, 4, 'four charges, four lines');
assert.deepStrictEqual(snap.lines.map((l) => l.position), [1, 2, 3, 4], 'positions are 1-based and in order');
assert.strictEqual(snap.gross, 191.85, 'the guest pays 191,85');
console.log('  ok  чотири нарахування стають чотирма рядками, разом 191,85');

// The columns a German hotel invoice prints per line, carried onto the row
// rather than looked up later.
assert.strictEqual(snap.lines[0].guest_name, 'M. Schneider', 'Gastname is copied onto the line');
assert.strictEqual(snap.lines[0].unit_code, '213', 'Zi-Nr is copied onto the line');
assert.strictEqual(snap.lines[0].service_date, '2026-08-04', 'Leistungsdatum is copied onto the line');
assert.strictEqual(snap.lines[0].source_item_id, 'i1', 'the folio item it came from is remembered');
console.log('  ok  гість, номер кімнати і дата послуги лежать на самому рядку');

// ─── The recapitulation is the printed one ──────────────────────────────────
assert.deepStrictEqual(
  snap.taxTotals.map((t) => [t.vat_rate, t.gross_amount, t.net_amount, t.tax_amount]),
  [[19, 12.8, 10.76, 2.04], [7, 179.05, 167.34, 11.71]],
  'MwSt-Übersicht as printed on invoice 22.421',
);
console.log('  ok  MwSt-Übersicht: 19% — 12,80/10,76/2,04 · 7% — 179,05/167,34/11,71');

// And the document total is the sum of the GROUPS, which is a cent away from
// the sum of the line nets. Both live on the invoice; this is the pair.
const lineNetSum = Number(snap.lines.reduce((s, l) => s + l.net_amount, 0).toFixed(2));
assert.strictEqual(snap.net, 178.10, 'net of the document, from the groups');
assert.strictEqual(lineNetSum, 178.08, 'and the line-by-line sum, which differs');
assert.notStrictEqual(snap.net, lineNetSum, 'the two must not be made to agree');
console.log('  ok  підсумок береться з груп, а не зі суми рядків — і різниця збережена');

// ─── Storno is a mirror ─────────────────────────────────────────────────────
const storno = buildStorno(snap);
assert.strictEqual(storno.gross, -191.85, 'the reversal is the negative of the original');
assert.strictEqual(money0(snap.gross + storno.gross), 0, 'together they sum to nothing');
assert.deepStrictEqual(
  storno.taxTotals.map((t) => [t.vat_rate, t.gross_amount, t.tax_amount]),
  [[19, -12.8, -2.04], [7, -179.05, -11.71]],
  'the recapitulation reverses too — the tax office gets its money back on paper',
);
console.log('  ok  сторно — дзеркало: разом з оригіналом дає нуль');

// Descriptions, dates and rates are untouched. A storno the guest cannot match
// against the original line by line is a storno the accountant will query.
assert.deepStrictEqual(
  storno.lines.map((l) => [l.description, l.service_date, l.vat_rate, l.quantity]),
  snap.lines.map((l) => [l.description, l.service_date, l.vat_rate, l.quantity]),
  'everything except the money is identical',
);
console.log('  ok  усе, крім грошей, лишається тим самим — рядок у рядок');

// ─── A folio with one rate has one recapitulation row ───────────────────────
const single = buildSnapshot([FOLIO[0]]);
assert.strictEqual(single.taxTotals.length, 1, 'one rate, one row');
assert.strictEqual(single.gross, 143.05, 'and the total is that line');
console.log('  ok  одна ставка — один рядок рекапітуляції');

// ─── An empty folio produces an empty document, not a crash ────────────────
const empty = buildSnapshot([]);
assert.deepStrictEqual([empty.lines.length, empty.taxTotals.length, empty.gross], [0, 0, 0],
  'nothing in, nothing out');
console.log('  ok  порожнє фоліо не падає і не вигадує рядків');

function money0(n: number): number { return Number(n.toFixed(2)); }

console.log('invoice-snapshot: фактура — копія, а не погляд; сторно — дзеркало');
