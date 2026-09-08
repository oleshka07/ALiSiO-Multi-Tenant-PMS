/**
 * Видалена фактура не лишає по собі рядків (Р10.14).
 *
 *   node src/modules/invoicing/data/invoice-delete.check.ts
 *
 * `fin_invoice_lines.invoice_id` і `fin_invoice_tax_totals.invoice_id` —
 * `TEXT NOT NULL` БЕЗ зовнішнього ключа на `invoices`. Обидві таблиці пишуться
 * однією транзакцією разом із самою фактурою (`folio.repo.ts`), тобто
 * `invoice_id` завжди вказує на `invoices.id` — але база про це не знає, тож
 * `DELETE FROM invoices` лишає їх на місці, вказувати в нікуди.
 *
 * У проді фактури видаляють ДВА маршрути, і жоден не чіпає рядки:
 * `/api/invoices/[id]` (одна) і `/api/accounting/invoice-batch` (оптом по
 * організації, каналу й місяцю). Числа це не псує — читачі ходять по
 * `invoice_id` живої фактури, — але книги розходяться мовчки, і чим довше
 * працює готель, тим більший цей хвіст.
 *
 * Твердження нижче не про арифметику, а саме про хвіст: після видалення обома
 * шляхами рядків не лишається. Сусід у сцені 3 — щоб «прибрали все» не
 * виявилось «прибрали чуже».
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';

const { runWithOrganization } = await import('@core/auth/tenant-context');
const { getSql } = await import('@core/db/async');
const { createFolio, addCharges, issueInvoice } = await import('./folio.repo.ts');
const { deleteInvoicesWhere } = await import('./invoice-delete.repo.ts');

const sql = getSql();
const ORG = 'org_invdel';
const OTHER = 'org_invdel_other';

async function wipe(org: string, prefix: string) {
  await runWithOrganization(org, async () => {
    await sql.run('DELETE FROM fin_invoice_tax_totals WHERE organization_id = ?', [org]);
    await sql.run('DELETE FROM fin_invoice_lines WHERE organization_id = ?', [org]);
    await sql.run('DELETE FROM invoices WHERE organization_id = ?', [org]);
    await sql.run('DELETE FROM fin_folio_items WHERE organization_id = ?', [org]);
    await sql.run('DELETE FROM fin_folios WHERE organization_id = ?', [org]);
    await sql.run(`DELETE FROM reservations WHERE id LIKE '${prefix}%'`, []);
    await sql.run(`DELETE FROM units WHERE id LIKE '${prefix}%'`, []);
    await sql.run(`DELETE FROM unit_types WHERE id LIKE '${prefix}%'`, []);
    await sql.run(`DELETE FROM categories WHERE id LIKE '${prefix}%'`, []);
    await sql.run(`DELETE FROM guests WHERE id LIKE '${prefix}%'`, []);
    await sql.run(`DELETE FROM properties WHERE id LIKE '${prefix}%'`, []);
  });
  await sql.run('DELETE FROM organizations WHERE id = ?', [org]);
}

async function cleanup() {
  await wipe(ORG, 'invdel_');
  await wipe(OTHER, 'invdelo_');
}

/** Готель із одним номером і одним заїздом; повертає id броні. */
async function seed(org: string, prefix: string, name: string) {
  await sql.run('INSERT INTO organizations(id, name, slug, language) VALUES (?,?,?,?)',
    [org, name, org.replace(/_/g, '-'), 'de']);
  const res = `${prefix}res`;
  await runWithOrganization(org, async () => {
    await sql.run('INSERT INTO properties(id, organization_id, name, slug, country) VALUES (?,?,?,?,?)',
      [`${prefix}p`, org, 'Haus', `${prefix}haus`, 'DE']);
    await sql.run('INSERT INTO categories(id, property_id, name, type) VALUES (?,?,?,?)',
      [`${prefix}c`, `${prefix}p`, 'Zimmer', 'hotel']);
    await sql.run('INSERT INTO unit_types(id, property_id, category_id, name, code) VALUES (?,?,?,?,?)',
      [`${prefix}t`, `${prefix}p`, `${prefix}c`, 'DZ', 'DZ']);
    await sql.run('INSERT INTO units(id, unit_type_id, property_id, category_id, name, code) VALUES (?,?,?,?,?,?)',
      [`${prefix}u`, `${prefix}t`, `${prefix}p`, `${prefix}c`, '101', '101']);
    await sql.run('INSERT INTO guests(id, organization_id, first_name, last_name) VALUES (?,?,?,?)',
      [`${prefix}g`, org, 'Anna', 'Weber']);
    await sql.run(
      `INSERT INTO reservations(id, organization_id, property_id, unit_id, guest_id,
                                check_in, check_out, nights, adults, children, infants,
                                status, payment_status, source, total_price, currency, commission_amount)
       VALUES (?,?,?,?,?, '2026-10-05','2026-10-07',2,2,0,0,'confirmed','unpaid','direct',178,'EUR',0)`,
      [res, org, `${prefix}p`, `${prefix}u`, `${prefix}g`]);
  });
  return res;
}

/**
 * Виписати фактуру з ДВОМА ставками ПДВ — вісь не вироджена (інваріант 26).
 *
 * Одна ставка дала б один рядок `fin_invoice_tax_totals`, і «прибрали рядки
 * податків» не відрізнялось би від «прибрали один рядок випадково».
 */
async function issueWithLines(org: string, res: string, label: string) {
  return runWithOrganization(org, async () => {
    const folio = await createFolio({ reservationId: res, payerKind: 'guest', payerName: 'Anna Weber', label });
    await addCharges([
      { folioId: folio, reservationId: res, serviceDate: '2026-10-05', kind: 'lodging',
        description: 'Übernachtung', guestName: 'Anna Weber', unitCode: '101',
        quantity: 2, unitPriceGross: 44.5, totalGross: 89, vatRate: 7, source: 'manual' },
      { folioId: folio, reservationId: res, serviceDate: '2026-10-06', kind: 'service',
        description: 'Minibar', guestName: 'Anna Weber', unitCode: '101',
        quantity: 1, unitPriceGross: 19, totalGross: 19, vatRate: 19, source: 'manual' },
    ]);
    return issueInvoice({ folioId: folio });
  });
}

const counts = (org: string, invoiceId?: string) => runWithOrganization(org, async () => {
  const where = invoiceId ? ' AND invoice_id = ?' : '';
  const p = invoiceId ? [org, invoiceId] : [org];
  return {
    invoices: (await sql.rows(`SELECT id FROM invoices WHERE organization_id = ?${invoiceId ? ' AND id = ?' : ''}`, p)).length,
    lines: (await sql.rows(`SELECT id FROM fin_invoice_lines WHERE organization_id = ?${where}`, p)).length,
    taxes: (await sql.rows(`SELECT id FROM fin_invoice_tax_totals WHERE organization_id = ?${where}`, p)).length,
  };
});

await cleanup();
try {
  // ── Сцена 1. Одна фактура: рядки є, потім їх немає ──────────────────────
  const res = await seed(ORG, 'invdel_', 'Löschhaus');
  const inv = await issueWithLines(ORG, res, 'A');

  const before = await counts(ORG, inv.invoiceId);
  assert.strictEqual(before.invoices, 1, 'фактури немає — засів не спрацював');
  assert.strictEqual(before.lines, 2, `рядків мало бути 2, а є ${before.lines}`);
  assert.strictEqual(before.taxes, 2, `ставок мало бути 2 (7 % і 19 %), а є ${before.taxes}`);
  console.log(`  ok  фактура виписана з рядками і двома ставками (${before.lines} рядки, ${before.taxes} ставки)`);

  // Той самий предикат, що в маршруті `/api/invoices/[id]`.
  await runWithOrganization(ORG, () => deleteInvoicesWhere(
    'id = ? AND organization_id = ?', [inv.invoiceId, ORG]));

  const after = await counts(ORG, inv.invoiceId);
  assert.strictEqual(after.invoices, 0, 'фактура лишилась');
  assert.strictEqual(after.lines, 0, `видалена фактура лишила ${after.lines} рядків, що вказують у нікуди`);
  assert.strictEqual(after.taxes, 0, `видалена фактура лишила ${after.taxes} рядків податків, що вказують у нікуди`);
  console.log('  ok  видалена одиночна фактура не лишила ні рядків, ні ставок');

  // ── Сцена 2. Оптове видалення — той самий предикат, що в invoice-batch ──
  const inv2 = await issueWithLines(ORG, res, 'B');
  const inv3 = await issueWithLines(ORG, res, 'C');
  const bulkBefore = await counts(ORG);
  assert.strictEqual(bulkBefore.invoices, 2, 'дві фактури для оптової сцени не завелись');
  assert.strictEqual(bulkBefore.lines, 4, `рядків мало бути 4, а є ${bulkBefore.lines}`);

  await runWithOrganization(ORG, () => deleteInvoicesWhere('organization_id = ?', [ORG]));

  const bulkAfter = await counts(ORG);
  assert.strictEqual(bulkAfter.invoices, 0, 'оптове видалення лишило фактури');
  assert.strictEqual(bulkAfter.lines, 0, `оптове видалення лишило ${bulkAfter.lines} осиротілих рядків`);
  assert.strictEqual(bulkAfter.taxes, 0, `оптове видалення лишило ${bulkAfter.taxes} осиротілих ставок`);
  console.log(`  ok  оптове видалення двох фактур (${inv2.invoiceNumber}, ${inv3.invoiceNumber}) не лишило хвоста`);

  // ── Сцена 3. Сусід не зачеплений ────────────────────────────────────────
  const resO = await seed(OTHER, 'invdelo_', 'Nachbarhaus');
  const invO = await issueWithLines(OTHER, resO, 'N');

  await runWithOrganization(ORG, () => deleteInvoicesWhere('organization_id = ?', [ORG]));

  const neighbour = await counts(OTHER, invO.invoiceId);
  assert.strictEqual(neighbour.invoices, 1, 'видалення в одного орендаря знесло фактуру сусіда');
  assert.strictEqual(neighbour.lines, 2, `у сусіда лишилось ${neighbour.lines} рядків замість 2`);
  assert.strictEqual(neighbour.taxes, 2, `у сусіда лишилось ${neighbour.taxes} ставок замість 2`);
  console.log('  ok  прибирання одного орендаря не чіпає рядків сусіда');

  console.log('invoice-delete: видалена фактура не лишає рядків — ні поодинці, ні оптом, і не через межу орендаря');
} finally {
  await cleanup();
}
