/**
 * Self-check for the Booking.com Excel parser after the SheetJS -> ExcelJS swap.
 * Run: node src/modules/bookings/domain/booking-com-excel.check.ts
 *
 * Covers the three things the swap could plausibly break: header reading,
 * localized column aliases, and cell-value flattening (Date / formula / richText).
 */
import assert from 'node:assert';
import ExcelJS from 'exceljs';
import { parseBookingComExcel } from './booking-com-excel.ts';

async function sheetToBuffer(rows: any[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const HEADERS_EN = [
  'Book number', 'Guest name(s)', 'Check-in', 'Check-out', 'Status',
  'Duration (nights)', 'Adults', 'Children', 'Persons', 'Price', 'Unit type',
];

async function testEnglish() {
  const buf = await sheetToBuffer([
    HEADERS_EN,
    ['1234567890', 'Doe, John', new Date(Date.UTC(2026, 4, 22)), new Date(Date.UTC(2026, 4, 25)),
      'ok', 3, 2, 0, 2, '4 500,50 CZK', 'Double Room'],
  ]);
  const res = await parseBookingComExcel(buf);
  assert.strictEqual(res.errors.length, 0, `unexpected errors: ${JSON.stringify(res.errors)}`);
  assert.strictEqual(res.rows.length, 1);
  const r = res.rows[0];
  assert.strictEqual(r.bookNumber, '1234567890');
  assert.strictEqual(r.guestName, 'Doe, John');
  assert.strictEqual(r.checkIn, '2026-05-22', `checkIn was ${r.checkIn}`);
  assert.strictEqual(r.checkOut, '2026-05-25', `checkOut was ${r.checkOut}`);
  assert.strictEqual(r.duration, 3);
  assert.strictEqual(r.adults, 2);
  assert.strictEqual(r.priceMajor, 4500.5, `price was ${r.priceMajor}`);
  assert.strictEqual(r.currency, 'CZK');
  assert.strictEqual(r.unitTypeRaw, 'Double Room');
  console.log('  ok  english headers + Date cells + EU price format');
}

async function testUkrainianAliases() {
  const buf = await sheetToBuffer([
    ['Номер бронювання', "Ім'я гостя", 'Заїзд', 'Виїзд', 'Статус',
      'Тривалість (ночі)', 'Дорослі', 'Діти', 'Осіб', 'Ціна', 'Тип номера'],
    ['777', 'Шевченко Тарас', '22.05.2026', '25.05.2026', 'ok', 3, 2, 1, 3, '3 000 CZK', 'Panoramic Dome'],
  ]);
  const res = await parseBookingComExcel(buf);
  assert.strictEqual(res.errors.length, 0, `unexpected errors: ${JSON.stringify(res.errors)}`);
  assert.strictEqual(res.rows.length, 1);
  const r = res.rows[0];
  assert.strictEqual(r.bookNumber, '777');
  assert.strictEqual(r.guestName, 'Шевченко Тарас');
  assert.strictEqual(r.checkIn, '2026-05-22', `checkIn was ${r.checkIn}`);
  assert.strictEqual(r.children, 1);
  assert.strictEqual(r.unitTypeRaw, 'Panoramic Dome');
  console.log('  ok  ukrainian column aliases + DD.MM.YYYY dates');
}

async function testRichTextAndFormula() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.addRow(HEADERS_EN);
  const row = ws.addRow(['555', null, '2026-06-01', '2026-06-03', 'ok', 2, 2, 0, 2, '100 EUR', 'Suite']);
  // Guest name as rich text; Price as a formula with a cached result.
  row.getCell(2).value = { richText: [{ text: 'Anna ' }, { text: 'Nowak' }] } as any;
  row.getCell(10).value = { formula: 'CONCATENATE("100"," EUR")', result: '100 EUR' } as any;
  const res = await parseBookingComExcel(Buffer.from(await wb.xlsx.writeBuffer()));
  assert.strictEqual(res.errors.length, 0, `unexpected errors: ${JSON.stringify(res.errors)}`);
  assert.strictEqual(res.rows[0].guestName, 'Anna Nowak');
  assert.strictEqual(res.rows[0].priceMajor, 100);
  console.log('  ok  richText cells + formula cells flatten to scalars');
}

async function testMissingRequiredColumns() {
  const buf = await sheetToBuffer([['Foo', 'Bar'], ['a', 'b']]);
  const res = await parseBookingComExcel(buf);
  assert.strictEqual(res.rows.length, 0);
  assert.strictEqual(res.errors[0].field, 'headers');
  console.log('  ok  missing required columns still reported, not silently empty');
}

const run = async () => {
  for (const t of [testEnglish, testUkrainianAliases, testRichTextAndFormula, testMissingRequiredColumns]) {
    await t();
  }
  console.log('booking-com-excel: all checks passed');
};

run().catch((e) => {
  console.error('booking-com-excel CHECK FAILED:', e.message);
  process.exit(1);
});
