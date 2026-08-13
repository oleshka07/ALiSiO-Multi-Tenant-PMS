/**
 * The invoice number's shape is data.
 *
 *   node src/modules/finance/domain/invoice-number-format.check.ts
 *
 * Two things are asserted here, and the first matters more than the second:
 * the default template must reproduce EXACTLY the numbers this product has
 * been issuing. A hotel's invoice numbers are a legal run; a template change
 * that shifts them by a character breaks the continuity of somebody's books.
 */
import assert from 'node:assert';
import { formatInvoiceNumber, DEFAULT_TEMPLATE } from './invoice-number-format.ts';

// ─── What is already issued must keep being issued ──────────────────────────
assert.strictEqual(
  formatInvoiceNumber(DEFAULT_TEMPLATE, { prefix: 'BKG-', year: 2026, seq: 1 }),
  'BKG-2026-001',
  'the Booking.com series, unchanged',
);
assert.strictEqual(
  formatInvoiceNumber(DEFAULT_TEMPLATE, { prefix: '', year: 2026, seq: 7 }),
  '2026-007',
  'the house series, unchanged',
);
assert.strictEqual(
  formatInvoiceNumber(DEFAULT_TEMPLATE, { prefix: 'TEYA-', year: 2026, seq: 142 }),
  'TEYA-2026-142',
  'three digits are not a limit, only a minimum',
);
assert.strictEqual(
  formatInvoiceNumber(DEFAULT_TEMPLATE, { prefix: '', year: 2026, seq: 1234 }),
  '2026-1234',
  'a counter past the padding is not truncated',
);
console.log('  ok  дефолтний шаблон дає рівно ті номери, що й досі');

// ─── A hotel whose numbers look nothing like ours ───────────────────────────
assert.strictEqual(
  formatInvoiceNumber('{seq}', { prefix: '', year: 2026, seq: 22421 }),
  '22421',
  'a plain running number, as the German pilot issues',
);
assert.strictEqual(
  formatInvoiceNumber('RG-{year}/{seq:5}', { prefix: '', year: 2026, seq: 42 }),
  'RG-2026/00042',
  'literal text around the tokens stays literal',
);
assert.strictEqual(
  formatInvoiceNumber('{yy}{seq:4}', { prefix: '', year: 2026, seq: 9 }),
  '260009',
  'two-digit year',
);
console.log('  ok  шаблон описує будь-яку форму без жодного рядка коду');

// ─── An empty or broken template must not produce an empty number ───────────
assert.strictEqual(
  formatInvoiceNumber('', { prefix: '', year: 2026, seq: 3 }),
  '2026-003',
  'an empty template falls back to the default, never to an empty string',
);
assert.strictEqual(
  formatInvoiceNumber('{unknown}-{seq}', { prefix: '', year: 2026, seq: 3 }),
  '{unknown}-3',
  'an unknown token is left alone rather than silently dropped',
);
console.log('  ok  порожній шаблон дає дефолт, невідомий токен видно очима');

console.log('invoice-number-format: форма номера — налаштування, а не код');
