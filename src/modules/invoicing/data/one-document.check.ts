/**
 * ОДНА БРОНЬ — ОДИН ДОКУМЕНТ НА ТІ САМІ ГРОШІ.
 *
 *   node src/modules/invoicing/data/one-document.check.ts
 *
 * ── Дефект, проти якого це написано (ревізія 16.09.2026, П3) ────────────
 *
 * Документів на стою два шляхи: позначка «оплачено» на картці виписує
 * legacy-фактуру на `total_price`, а кнопка у фоліо — фактуру на рядки
 * рахунку. Захист стояв в ОДИН бік: legacy не виписується, коли оплата
 * прийшла через фоліо (`payment_method: folio/folio_cash`). Другий бік був
 * відчинений, і звичайний порядок дій рецепції — «позначив оплаченою, потім
 * виставив рахунок» — давав ДВА номери однієї серії на ту саму суму:
 *
 *     2026-001 · 1000 · folio=немає · issued
 *     2026-002 · 1000 · folio=af79… · issued
 *
 * Виправити таке можна лише сторно: номер уже спалено.
 *
 * ── Осі, по яких фікстура не вироджена (інваріант 26) ───────────────────
 *
 * 1. Бронь З нарахуваннями у фоліо і бронь БЕЗ них. З однією твердження
 *    «legacy не виписується» зелене й на коді, який не виписує ніколи, —
 *    а це зламало б готелі, які фоліо не ведуть.
 * 2. Документ є / документ скасований. Без другого значення твердження
 *    «виписка з фоліо відмовляє» зелене й на коді, який відмовляє завжди.
 * 3. Відмова НАЗИВАЄ номер: текст без номера не каже, що саме сторнувати.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-onedoc-'));
process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { runWithOrganization } = await import('@core/auth/tenant-context.ts');
const { seedTwoProperties } = await import('@core/fixtures/two-properties.ts');
const folio = await import('./folio.repo.ts');
const { generateInvoiceForReservation } = await import('./reservation-invoice.repo.ts');

const sql = getSql();
const fx = await seedTwoProperties();
const ORG = fx.organizationId;
const STAY = 1000;

const fails: string[] = [];
const say = (cond: boolean, what: string) => {
  if (cond) console.log(`  ok  ${what}`);
  else { fails.push(what); console.log(`  ЧЕРВОНЕ  ${what}`); }
};

const docs = (reservationId: string) => runWithOrganization(ORG, async () => (await sql.rows<{
  invoice_number: string; folio_id: string | null; status: string;
}>('SELECT invoice_number, folio_id, status FROM invoices WHERE reservation_id = ? AND organization_id = ?',
  [reservationId, ORG])));

await runWithOrganization(ORG, async () => {
  // ── 1. Бронь БЕЗ фоліо: legacy лишається робочим шляхом ────────────────
  const plain = fx.a.reservationIds[0];
  const legacyId = await generateInvoiceForReservation(plain, { confirmed: true, source: 'cash' });
  say(!!legacyId, 'бронь без рахунку у фоліо: legacy-документ мусить виписатись');
  say((await docs(plain)).length === 1, `і рівно один: ${(await docs(plain)).length}`);

  // ── 2. Бронь, яку ведуть у фоліо: legacy НЕ виписується ────────────────
  const billed = fx.a.reservationIds[1];
  const folioId = await folio.ensureReservationFolio(billed);
  await folio.addCharges([{
    folioId, reservationId: billed, serviceDate: fx.a.checkIns[1], kind: 'lodging',
    description: 'Проживання', guestName: null, unitCode: null,
    quantity: 1, unitPriceGross: STAY, totalGross: STAY, vatRate: 0, source: 'manual',
  }]);
  const suppressed = await generateInvoiceForReservation(billed, { confirmed: true, source: 'cash' });
  say(suppressed === null, 'бронь із нарахуваннями у фоліо: legacy-документ НЕ виписується');
  say((await docs(billed)).length === 0, `і в базі його немає: ${(await docs(billed)).length}`);

  // Документ виставляє фоліо, і він один.
  const issued = await folio.issueInvoice({ folioId });
  const after = await docs(billed);
  say(after.length === 1 && after[0].folio_id === folioId,
    `документ виписує фоліо, і він один: ${after.map((d) => d.invoice_number).join(', ')}`);
  say(issued.gross === STAY, `на суму рядків рахунку (${issued.gross}), а не на total_price`);

  // ── 3. Зворотний бік: після legacy виписка з фоліо ВІДМОВЛЯЄ ───────────
  const both = fx.b.reservationIds[0];
  const legacyBoth = await generateInvoiceForReservation(both, { confirmed: true, source: 'cash' });
  say(!!legacyBoth, 'на броні без фоліо legacy виписався — фікстура готова');
  const folioBoth = await folio.ensureReservationFolio(both);
  await folio.addCharges([{
    folioId: folioBoth, reservationId: both, serviceDate: fx.b.checkIns[0], kind: 'lodging',
    description: 'Проживання', guestName: null, unitCode: null,
    quantity: 1, unitPriceGross: STAY, totalGross: STAY, vatRate: 0, source: 'manual',
  }]);
  let refusal = '';
  try {
    await folio.issueInvoice({ folioId: folioBoth });
  } catch (e: unknown) { refusal = (e as Error)?.message ?? ''; }
  const legacyNumber = String((await docs(both)).find((d) => d.folio_id === null)?.invoice_number ?? '');
  say(refusal !== '', 'другий документ на ту саму бронь мусить бути відмовлений');
  say(refusal.includes(legacyNumber) && legacyNumber !== '',
    `і відмова НАЗИВАЄ номер, який треба сторнувати (${legacyNumber || 'номера немає'}): «${refusal.slice(0, 80)}»`);
  say((await docs(both)).length === 1, `документів лишилось ${(await docs(both)).length}, мав бути 1`);

  // ── 4. Після сторно legacy виписка з фоліо проходить ───────────────────
  //
  // Стан «документ скасовано» ставиться прямо: сторно — окремий шлях зі
  // своїм гейтом, а тут перевіряється рівно те, що відмова ДИВИТЬСЯ на
  // статус, а не на саму наявність рядка.
  await sql.run(
    "UPDATE invoices SET status = 'cancelled' WHERE reservation_id = ? AND organization_id = ? AND folio_id IS NULL",
    [both, ORG]);
  let issuedAfterStorno = '';
  try {
    issuedAfterStorno = (await folio.issueInvoice({ folioId: folioBoth })).invoiceNumber;
  } catch (e: unknown) { issuedAfterStorno = `ВІДМОВА: ${(e as Error)?.message}`; }
  say(/^\d{4}-\d+$/.test(issuedAfterStorno),
    `після сторно фоліо виписує свій документ: ${issuedAfterStorno}`);
});

fs.rmSync(tmp, { recursive: true, force: true });
if (fails.length) { console.error(`\none-document: ${fails.length} червоних`); process.exit(1); }
console.log('one-document: на одну бронь виходить один документ, і відмова називає номер');
