/**
 * VAT arithmetic, checked against a real invoice.
 *
 *   node src/modules/finance/domain/invoice-vat.check.ts
 *
 * The fixture is not invented. It is invoice no. 22.421 of 05.08.2026 from the
 * German pilot's current system — a document their Steuerberater has accepted.
 * Every number below was read off that paper.
 *
 * WHY THIS FILE EXISTS, and please read it before "fixing" anything here:
 *
 * The recapitulation block on that invoice does NOT equal the sum of the
 * per-line nets. It is off by exactly one cent, on BOTH rate groups, on the
 * same sheet:
 *
 *          printed (from group gross)   by summing lines
 *   7%     167,34 net / 11,71 tax       167,33 / 11,72
 *   19%     10,76 net /  2,04 tax        10,75 /  2,05
 *
 * That is not an error in their software. Computing the net from the group's
 * gross is permitted (Abschn. 14.5 UStAE) and is what the document carries.
 * If our invoice printed the line-sum instead, it would disagree with the one
 * the tax office already has for the same stay.
 *
 * So the assertions below are deliberately two-sided: they assert the group
 * figures ARE the printed ones, and that the line-sum is different. The second
 * half is there so that a future change which "makes it consistent" fails
 * loudly instead of quietly re-deciding a tax question.
 */
import assert from 'node:assert';
import { lineAmounts, taxGroups, invoiceGross, pickRate, type TaxedLine, type TaxRate } from './invoice-vat.ts';

// ─── Invoice 22.421, 05.08.2026 ─────────────────────────────────────────────
//
// One night for three people: the room at 7%, breakfast split into food (7%)
// and drinks (19%) — the split German hotels have had to make since food in
// hospitality moved to 7% on 2026-01-01 — plus two drinks from the bar.
const INVOICE: TaxedLine[] = [
  { gross: 143.05, vatRate: 7 },   // Übernachtung
  { gross: 36.00, vatRate: 7 },   // Frühstück Speisen, 3 × 12,00
  { gross: 9.00, vatRate: 19 },  // Frühstück Getränke, 3 × 3,00
  { gross: 3.80, vatRate: 19 },  // Bar, 2 × 1,90
];

const groups = taxGroups(INVOICE);
const g7 = groups.find((g) => g.vatRate === 7)!;
const g19 = groups.find((g) => g.vatRate === 19)!;

// ─── The printed recapitulation ─────────────────────────────────────────────
assert.strictEqual(g7.gross, 179.05, '7%: gross of the group');
assert.strictEqual(g7.net, 167.34, '7%: net as printed');
assert.strictEqual(g7.tax, 11.71, '7%: tax as printed');
console.log('  ok  7% — 179,05 / 167,34 / 11,71, як на документі');

assert.strictEqual(g19.gross, 12.80, '19%: gross of the group');
assert.strictEqual(g19.net, 10.76, '19%: net as printed');
assert.strictEqual(g19.tax, 2.04, '19%: tax as printed');
console.log('  ok  19% — 12,80 / 10,76 / 2,04, як на документі');

assert.strictEqual(invoiceGross(INVOICE), 191.85, 'gross total of the document');
console.log('  ok  разом 191,85');

// ─── And the line-by-line sum is NOT that ───────────────────────────────────
//
// The point of this half: it must stay different. A change that makes the two
// agree has silently answered a tax question, and this is where that shows up.
const perLine = INVOICE.map(lineAmounts);
const lineNet7 = perLine.filter((_, i) => INVOICE[i].vatRate === 7).reduce((s, l) => s + l.net, 0);
const lineNet19 = perLine.filter((_, i) => INVOICE[i].vatRate === 19).reduce((s, l) => s + l.net, 0);

assert.strictEqual(Number(lineNet7.toFixed(2)), 167.33, 'summing the 7% lines gives 167,33');
assert.strictEqual(Number(lineNet19.toFixed(2)), 10.75, 'summing the 19% lines gives 10,75');
assert.notStrictEqual(Number(lineNet7.toFixed(2)), g7.net, 'the two methods must not be made to agree');
assert.notStrictEqual(Number(lineNet19.toFixed(2)), g19.net, 'the two methods must not be made to agree');
console.log('  ok  порядкова сума дає 167,33 і 10,75 — на цент інша, і має такою лишитись');

// ─── The rates are data, not code ───────────────────────────────────────────
//
// Same function, Czech rates, a hotel that is not in Germany. If anything in
// this module ever learns the numbers 19 and 7, this breaks.
const CZ: TaxedLine[] = [
  { gross: 2500.00, vatRate: 12 },  // ubytování
  { gross: 300.00, vatRate: 21 },  // nápoje
];
const cz = taxGroups(CZ);
assert.strictEqual(cz.find((g) => g.vatRate === 12)!.net, 2232.14, 'CZ 12% net');
assert.strictEqual(cz.find((g) => g.vatRate === 21)!.net, 247.93, 'CZ 21% net');
assert.deepStrictEqual(cz.map((g) => g.vatRate), [21, 12], 'groups print highest rate first');
console.log('  ok  ті самі функції рахують чеські 21/12 — ставка приходить даними');

// ─── Zero rate, and a rate that leaves nothing to round ─────────────────────
const zero = taxGroups([{ gross: 50.0, vatRate: 0 }]);
assert.strictEqual(zero[0].net, 50.0, '0%: net equals gross');
assert.strictEqual(zero[0].tax, 0, '0%: no tax');
console.log('  ok  нульова ставка не породжує ні податку, ні копійки з нізвідки');


// ─── The rate follows the date of service, not the date of the invoice ──────
//
// Germany moved food in hospitality to the reduced rate on 2026-01-01. The
// pilot's own history crosses that line, so both rows exist in their table and
// both must stay: the old one is not deleted, it is closed.
const DE_FOOD: TaxRate[] = [
  { code: 'reduced', rate: 19, valid_from: '2020-01-01', valid_to: '2025-12-31' },
  { code: 'reduced', rate: 7, valid_from: '2026-01-01', valid_to: null },
];

assert.strictEqual(pickRate(DE_FOOD, 'reduced', '2025-12-31')!.rate, 19, 'breakfast on 31 Dec 2025 is 19%');
assert.strictEqual(pickRate(DE_FOOD, 'reduced', '2026-01-01')!.rate, 7, 'breakfast on 1 Jan 2026 is 7%');
assert.strictEqual(pickRate(DE_FOOD, 'reduced', '2026-08-05')!.rate, 7, 'and stays 7% on the reference invoice');
console.log('  ok  сніданок 31.12.2025 — 19%, 01.01.2026 — 7%: ставка йде за датою послуги');

// A day nothing covers must not silently become zero.
assert.strictEqual(pickRate(DE_FOOD, 'reduced', '2019-06-01'), null, 'no rate covers this day');
assert.strictEqual(pickRate(DE_FOOD, 'standard', '2026-08-05'), null, 'no standard rate in this fixture');
console.log('  ok  день, який не покриває жодна ставка, дає null, а не нуль відсотків');

// A timestamp is accepted where a date is expected — service_date arrives as
// both, depending on which table it came from.
assert.strictEqual(pickRate(DE_FOOD, 'reduced', '2026-01-01T09:30:00Z')!.rate, 7, 'a timestamp works too');

// Overlapping rows: the later start wins, so a correction is an insert.
const OVERLAP: TaxRate[] = [
  { code: 'standard', rate: 19, valid_from: '2020-01-01', valid_to: null },
  { code: 'standard', rate: 20, valid_from: '2027-01-01', valid_to: null },
];
assert.strictEqual(pickRate(OVERLAP, 'standard', '2026-12-31')!.rate, 19, 'before the change');
assert.strictEqual(pickRate(OVERLAP, 'standard', '2027-01-01')!.rate, 20, 'from the change on');
console.log('  ok  нова ставка додається рядком, стара лишається історією');

console.log('invoice-vat: рекапітуляція рахується від брутто групи — як на справжньому документі');
