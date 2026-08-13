/**
 * What an invoice must say — checked against the law, not against a layout.
 *
 *   node src/modules/finance/domain/invoice-document.check.ts
 *
 * The numbers are invoice 22.421 again. What is new here is the German
 * paperwork around them: the § 14 UStG mandatory fields, the § 33 UStDV
 * simplified form, and the fact that a German document formats a number as
 * 1.234,56 while a Czech one does not.
 */
import assert from 'node:assert';
import { buildInvoiceDocument, missingMandatoryFields, type InvoiceDocumentInput } from './invoice-document.ts';

const LINES = [
  { position: 1, service_date: '2026-08-04', description: 'Übernachtung', guest_name: 'M. Schneider', unit_code: '213', quantity: 1, unit_price_gross: 143.05, total_gross: 143.05, net_amount: 133.69, tax_amount: 9.36, vat_rate: 7 },
  { position: 2, service_date: '2026-08-05', description: 'Frühstück Speisen', guest_name: 'M. Schneider', unit_code: '213', quantity: 3, unit_price_gross: 12, total_gross: 36, net_amount: 33.64, tax_amount: 2.36, vat_rate: 7 },
  { position: 3, service_date: '2026-08-05', description: 'Frühstück Getränke', guest_name: 'M. Schneider', unit_code: '213', quantity: 3, unit_price_gross: 3, total_gross: 9, net_amount: 7.56, tax_amount: 1.44, vat_rate: 19 },
  { position: 4, service_date: '2026-08-04', description: 'Bar', guest_name: 'M. Schneider', unit_code: '213', quantity: 2, unit_price_gross: 1.9, total_gross: 3.8, net_amount: 3.19, tax_amount: 0.61, vat_rate: 19 },
];
const TOTALS = [
  { vat_rate: 19, gross_amount: 12.8, net_amount: 10.76, tax_amount: 2.04 },
  { vat_rate: 7, gross_amount: 179.05, net_amount: 167.34, tax_amount: 11.71 },
];

const BASE: InvoiceDocumentInput = {
  number: '22421', issueDate: '2026-08-05',
  serviceFrom: '2026-08-04', serviceTo: '2026-08-05',
  status: 'issued', currency: 'EUR', locale: 'de-DE',
  seller: {
    name: 'Hotel Nordstern GmbH', address: 'Hafenstraße 4, 20359 Hamburg',
    taxNumber: '22/815/00123', vatId: 'DE123456789',
    iban: 'DE02120300000000202051', bankName: 'Beispielbank',
  },
  buyer: { name: 'M. Schneider', address: 'Musterweg 7, 10115 Berlin' },
  lines: LINES, taxTotals: TOTALS,
  smallAmountLimit: 250,
};

// ─── The totals come from the groups ────────────────────────────────────────
const doc = buildInvoiceDocument(BASE);
assert.strictEqual(doc.gross, 191.85, 'gross of the document');
assert.strictEqual(doc.net, 178.10, 'net, from the groups');
assert.strictEqual(doc.tax, 13.75, 'tax, from the groups');
assert.strictEqual(doc.outstanding, 191.85, 'nothing paid yet');
console.log('  ok  підсумки беруться з груп: 191,85 / 178,10 / 13,75');

// ─── German formatting, and it is not the interface language ────────────────
assert.strictEqual(doc.formatMoney(1234.5), '1.234,50 EUR', 'German thousands and decimal separators');
assert.strictEqual(doc.formatDate('2026-08-05'), '05.08.2026', 'German date');
assert.strictEqual(doc.labels.recap, 'MwSt-Übersicht', 'German labels');

const cz = buildInvoiceDocument({ ...BASE, locale: 'cs-CZ', currency: 'CZK' });
assert.strictEqual(cz.formatDate('2026-08-05'), '5. 8. 2026', 'Czech date');
assert.strictEqual(cz.labels.recap, 'Rekapitulace DPH', 'Czech labels');
assert.notStrictEqual(cz.formatMoney(1234.5), doc.formatMoney(1234.5), 'the two countries format differently');
console.log('  ok  формат і підписи йдуть від локалі організації: 1.234,50 EUR проти чеського');

// ─── § 14 UStG: nothing missing ─────────────────────────────────────────────
assert.deepStrictEqual(missingMandatoryFields(doc), [], 'a complete German invoice');
console.log('  ok  повна німецька фактура не має пропущених обовʼязкових полів');

// Each mandatory field, removed one at a time, must be named.
const cases: [string, Partial<InvoiceDocumentInput>][] = [
  ['seller.address', { seller: { ...BASE.seller, address: null } }],
  ['seller.taxNumber/vatId', { seller: { ...BASE.seller, taxNumber: null, vatId: null } }],
  ['buyer.name', { buyer: { name: '', address: 'x' } }],
  ['buyer.address', { buyer: { name: 'x', address: null } }],
  ['servicePeriod', { serviceFrom: null, serviceTo: null, lines: LINES.map((l) => ({ ...l, service_date: '' })) }],
  ['lines', { lines: [] }],
];
for (const [field, patch] of cases) {
  // A large enough gross so the simplified form does not excuse the buyer.
  const broken = buildInvoiceDocument({ ...BASE, ...patch, smallAmountLimit: 0 } as InvoiceDocumentInput);
  assert.ok(
    missingMandatoryFields(broken).includes(field),
    `removing ${field} must be reported — got ${JSON.stringify(missingMandatoryFields(broken))}`,
  );
}
console.log('  ok  кожне прибране обовʼязкове поле називається поіменно');

// Steuernummer OR USt-IdNr is enough — §14 Abs. 4 Nr. 2 asks for one.
const onlyVatId = buildInvoiceDocument({ ...BASE, seller: { ...BASE.seller, taxNumber: null } });
assert.deepStrictEqual(missingMandatoryFields(onlyVatId), [], 'the VAT ID alone satisfies the requirement');
console.log('  ok  досить Steuernummer АБО USt-IdNr, не обовʼязково обох');

// ─── § 33 UStDV: a small invoice may omit the buyer ─────────────────────────
const small = buildInvoiceDocument({
  ...BASE,
  buyer: null,
  lines: [LINES[3]],
  taxTotals: [{ vat_rate: 19, gross_amount: 3.8, net_amount: 3.19, tax_amount: 0.61 }],
});
assert.strictEqual(small.isSmallAmount, true, '3,80 is below the 250 limit');
assert.deepStrictEqual(missingMandatoryFields(small), [], 'a simplified invoice needs no buyer');
console.log('  ok  Kleinbetragsrechnung до 250 € не потребує даних покупця');

// The boundary is the gross of the document, so the whole invoice at 191,85
// is ALSO simplified under a limit of 250 — that is the rule, not a loophole.
const wholeInvoice = buildInvoiceDocument({ ...BASE, buyer: null });
assert.strictEqual(wholeInvoice.isSmallAmount, true, '191,85 is below the 250 limit');
assert.deepStrictEqual(missingMandatoryFields(wholeInvoice), [], 'and so needs no buyer either');

// Lower the limit and the same document becomes a full invoice.
const overLimit = buildInvoiceDocument({ ...BASE, buyer: null, smallAmountLimit: 100 });
assert.strictEqual(overLimit.isSmallAmount, false, '191,85 is above a limit of 100');
assert.ok(missingMandatoryFields(overLimit).includes('buyer.name'), 'above the limit the buyer is required');
console.log('  ok  вище ліміту та сама фактура вимагає покупця');

// A jurisdiction with no simplified form: no limit set, never simplified.
const noLimit = buildInvoiceDocument({ ...BASE, buyer: null, smallAmountLimit: null, gross: undefined } as InvoiceDocumentInput);
assert.strictEqual(noLimit.isSmallAmount, false, 'without a configured limit there is no simplified form');
console.log('  ok  без заданого ліміту спрощеної форми не існує — це рішення юрисдикції');

// ─── A Czech document is not judged by German rules ─────────────────────────
const czBare = buildInvoiceDocument({ ...BASE, locale: 'cs-CZ', buyer: null, seller: { name: 'Kemp s.r.o.' } });
assert.deepStrictEqual(missingMandatoryFields(czBare), [], 'German mandatory fields do not apply to a Czech invoice');
console.log('  ok  чеський документ не судиться німецькими правилами');

// ─── Storno carries the number it reverses ──────────────────────────────────
const storno = buildInvoiceDocument({
  ...BASE, number: '22422', status: 'storno', correctsNumber: '22421',
  lines: LINES.map((l) => ({ ...l, total_gross: -l.total_gross, net_amount: -l.net_amount, tax_amount: -l.tax_amount })),
  taxTotals: TOTALS.map((t) => ({ vat_rate: t.vat_rate, gross_amount: -t.gross_amount, net_amount: -t.net_amount, tax_amount: -t.tax_amount })),
});
assert.strictEqual(storno.gross, -191.85, 'the reversal is negative');
assert.strictEqual(storno.labels.storno, 'Stornorechnung', 'and titled as one');
assert.strictEqual(storno.correctsNumber, '22421', 'and names the document it reverses');
console.log('  ok  сторно назване Stornorechnung і несе номер оригіналу');

console.log('invoice-document: §14 UStG перевіряється поіменно, локаль — від організації');
