/**
 * The German invoice, generated and then read back.
 *
 *   node src/modules/finance/domain/invoice-pdf-de.check.ts
 *
 * A layout check that asserts nothing about layout. It renders the PDF, parses
 * the text out of the produced file, and requires that every field § 14 UStG
 * demands is actually ON it.
 *
 * Why bother, when invoice-document.check.ts already asserts the model: a
 * field can be present in the model and absent from the page. That is not a
 * hypothetical — a column that runs off the right margin, a block drawn at a
 * y past the page end, or a font with no ü all produce a document that passes
 * every model assertion and cannot be filed. The only way to know is to read
 * the file.
 */
import assert from 'node:assert';
import { buildInvoiceDocument } from './invoice-document.ts';
import { generateGermanInvoicePdf } from './invoice-pdf-de.ts';

const doc = buildInvoiceDocument({
  number: '22421', issueDate: '2026-08-05',
  serviceFrom: '2026-08-04', serviceTo: '2026-08-05',
  status: 'issued', currency: 'EUR', locale: 'de-DE',
  seller: {
    name: 'Hotel Nordstern GmbH', address: 'Hafenstraße 4, 20359 Hamburg',
    taxNumber: '22/815/00123', vatId: 'DE123456789',
    iban: 'DE02120300000000202051', bankName: 'Beispielbank',
  },
  buyer: { name: 'M. Schneider', address: 'Musterweg 7, 10115 Berlin' },
  lines: [
    { position: 1, service_date: '2026-08-04', description: 'Übernachtung', guest_name: 'M. Schneider', unit_code: '213', quantity: 1, unit_price_gross: 143.05, total_gross: 143.05, net_amount: 133.69, tax_amount: 9.36, vat_rate: 7 },
    { position: 2, service_date: '2026-08-05', description: 'Frühstück Speisen', guest_name: 'M. Schneider', unit_code: '213', quantity: 3, unit_price_gross: 12, total_gross: 36, net_amount: 33.64, tax_amount: 2.36, vat_rate: 7 },
    { position: 3, service_date: '2026-08-05', description: 'Frühstück Getränke', guest_name: 'M. Schneider', unit_code: '213', quantity: 3, unit_price_gross: 3, total_gross: 9, net_amount: 7.56, tax_amount: 1.44, vat_rate: 19 },
    { position: 4, service_date: '2026-08-04', description: 'Bar', guest_name: 'M. Schneider', unit_code: '213', quantity: 2, unit_price_gross: 1.9, total_gross: 3.8, net_amount: 3.19, tax_amount: 0.61, vat_rate: 19 },
  ],
  taxTotals: [
    { vat_rate: 19, gross_amount: 12.8, net_amount: 10.76, tax_amount: 2.04 },
    { vat_rate: 7, gross_amount: 179.05, net_amount: 167.34, tax_amount: 11.71 },
  ],
  smallAmountLimit: 250,
});

const { PDFParse } = await import('pdf-parse');
const readText = async (buf: Buffer): Promise<string> => {
  const parsed = await new PDFParse({ data: new Uint8Array(buf) }).getText();
  return parsed.text.replace(/\s+/g, ' ');
};

const page = await readText(await generateGermanInvoicePdf(doc));

// ─── § 14 UStG, field by field, ON THE PAGE ─────────────────────────────────
const MANDATORY: [string, string][] = [
  ['seller name', 'Hotel Nordstern GmbH'],
  ['seller address', 'Hafenstraße 4, 20359 Hamburg'],
  ['Steuernummer', 'Steuernummer: 22/815/00123'],
  ['USt-IdNr', 'USt-IdNr.: DE123456789'],
  ['buyer name', 'M. Schneider'],
  ['buyer address', 'Musterweg 7, 10115 Berlin'],
  ['invoice number', '22421'],
  ['issue date', '05.08.2026'],
  ['period of supply', 'Leistungszeitraum'],
  ['first day of supply', '04.08.2026'],
  ['recapitulation block', 'MwSt-Übersicht'],
  ['7% gross', '179,05 EUR'],
  ['7% net', '167,34 EUR'],
  ['7% tax', '11,71 EUR'],
  ['19% gross', '12,80 EUR'],
  ['19% net', '10,76 EUR'],
  ['19% tax', '2,04 EUR'],
  ['document total', '191,85 EUR'],
];
const missing = MANDATORY.filter(([, needle]) => !page.includes(needle)).map(([name]) => name);
assert.deepStrictEqual(missing, [], `§14 fields missing from the rendered page: ${missing.join(', ')}`);
console.log(`  ok  усі ${MANDATORY.length} обовʼязкових полів §14 UStG справді на сторінці`);

// Every line, with the two hotel columns the reference invoice carries.
for (const l of doc.lines) {
  assert.ok(page.includes(l.description), `line "${l.description}" is not on the page`);
}
assert.ok(page.includes('213'), 'the room number is printed');
assert.ok(page.includes('Gastname') && page.includes('Zi-Nr'), 'the guest and room columns are labelled');
console.log('  ok  усі рядки на місці, разом із колонками Gastname і Zi-Nr');

// Umlauts survive the font. Without DejaVu these come out blank or as boxes,
// and the invoice reads "Frhstck".
assert.ok(page.includes('Übernachtung'), 'Ü survived');
assert.ok(page.includes('Frühstück Speisen'), 'ü survived');
assert.ok(page.includes('Hafenstraße'), 'ß survived');
console.log('  ok  умляути й ß друкуються, а не зникають');

// ─── A storno says so, and names the original ───────────────────────────────
const stornoPage = await readText(await generateGermanInvoicePdf(buildInvoiceDocument({
  ...doc, number: '22422', status: 'storno', correctsNumber: '22421',
  lines: doc.lines.map((l) => ({ ...l, total_gross: -l.total_gross, net_amount: -l.net_amount, tax_amount: -l.tax_amount })),
  taxTotals: doc.taxTotals.map((t) => ({ ...t, gross_amount: -t.gross_amount, net_amount: -t.net_amount, tax_amount: -t.tax_amount })),
})));
assert.ok(stornoPage.includes('Stornorechnung'), 'a reversal is titled Stornorechnung, not Rechnung');
assert.ok(stornoPage.includes('Storniert Rechnung'), 'and says which invoice it reverses');
assert.ok(stornoPage.includes('22421'), 'naming the original by number');
assert.ok(stornoPage.includes('-191,85 EUR'), 'with the amount reversed');
console.log('  ok  сторно назване Stornorechnung, несе номер оригіналу і мінус');

// ─── A Kleinbetragsrechnung prints the note instead of a buyer ──────────────
const smallPage = await readText(await generateGermanInvoicePdf(buildInvoiceDocument({
  ...doc, buyer: null, number: '22423',
  lines: [doc.lines[3]],
  taxTotals: [{ vat_rate: 19, gross_amount: 3.8, net_amount: 3.19, tax_amount: 0.61 }],
})));
assert.ok(smallPage.includes('Kleinbetragsrechnung'), 'the § 33 UStDV note is printed');
assert.ok(!smallPage.includes('Musterweg'), 'and no buyer address appears');
console.log('  ok  Kleinbetragsrechnung друкує посилання на §33 замість покупця');

console.log('invoice-pdf-de: документ згенеровано і прочитано назад — поля §14 на папері');
