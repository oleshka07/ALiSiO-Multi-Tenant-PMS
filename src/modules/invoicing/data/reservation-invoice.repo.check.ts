/**
 * Фактура броні справді ВИПИСУЄТЬСЯ: після виклику в `invoices` є рядок.
 *
 *   node src/modules/invoicing/data/reservation-invoice.repo.check.ts
 *
 * Той самий клас, що кома в гостьовому порталі, і теж прожив довго: з
 * 28.08.2026 (`7cd6a91`) усередині SQL-шаблону стояли рядки JS-коментаря
 * `//`, якого SQL коментарем не вважає. `INSERT` не парсився, `catch`
 * ковтав виняток у `console.error`, а виклик із `reservation.handlers`
 * зроблено fire-and-forget — тож створення броні виглядало успішним, і
 * фактури просто не було. Ні `tsc` (SQL — рядок), ні сусідній гейт
 * `folio-invoice.check` цього не бачили: той стверджує, що рахунки
 * платників уціліли, а що зʼявився НОВИЙ документ — не стверджував ніхто,
 * тому `null` проходив зеленим.
 *
 * Тому твердження тут — про ВІДПОВІДЬ і про стан таблиці: повернувся не
 * `null`, у `invoices` рівно один рядок, у нього є номер, сума й валюта
 * броні. Запит, який не парситься, такого дати не може.
 *
 * Осі (інваріант 26): дві броні одного готелю з РІЗНИМИ валютами і різними
 * сумами (4200 EUR і 1500 CZK) — «узяли валюту готелю» чи «узяли сталу» на
 * такій фікстурі не проходить; плюс повторний виклик на тій самій броні —
 * ідемпотентність, а не другий номер на ті самі гроші.
 *
 * Чого тут НЕ доводиться і чому: гілка `res.currency || organizationCurrency()`
 * (`:103`) з реального рядка недосяжна — `reservations.currency` має
 * NOT NULL, і вставка без валюти відхиляється базою. Тобто це мертвий
 * запасний шлях, а не поведінка; названо у звіті, окремо від цієї правки.
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';

const { getSql } = await import('@core/db/async');
const { generateInvoiceForReservation } = await import('./reservation-invoice.repo.ts');

const sql = getSql();
const ORG = '__res_invoice__';
const PROP = `${ORG}_prop`;
const R_EUR = `${ORG}_r_eur`;
const R_CZK = `${ORG}_r_czk`;

async function cleanup() {
  await sql.run('DELETE FROM invoices WHERE organization_id = ?', [ORG]);
  await sql.run('DELETE FROM invoice_counters WHERE organization_id = ?', [ORG]).catch(() => {});
  await sql.run('DELETE FROM reservations WHERE property_id = ?', [PROP]);
  await sql.run('DELETE FROM guests WHERE organization_id = ?', [ORG]);
  await sql.run('DELETE FROM properties WHERE organization_id = ?', [ORG]);
  await sql.run('DELETE FROM organizations WHERE id = ?', [ORG]);
}

await cleanup();
try {
  await sql.run('INSERT INTO organizations (id, name, slug, default_currency) VALUES (?, ?, ?, ?)', [ORG, ORG, ORG, 'CZK']);
  await sql.run('INSERT INTO properties (id, organization_id, name, slug) VALUES (?, ?, ?, ?)', [PROP, ORG, ORG, PROP]);
  await sql.run('INSERT INTO guests (id, organization_id, first_name, last_name) VALUES (?, ?, ?, ?)', [`${ORG}_g`, ORG, 'Anna', 'Guest']);
  for (const [id, currency, total] of [[R_EUR, 'EUR', 4200], [R_CZK, 'CZK', 1500]] as [string, string, number][]) {
    await sql.run(
      `INSERT INTO reservations (id, organization_id, property_id, guest_id, check_in, check_out, nights,
                                 adults, status, payment_status, total_price, currency, source)
       VALUES (?, ?, ?, ?, '2026-11-01', '2026-11-03', 2, 2, 'confirmed', 'paid', ?, ?, 'direct')`,
      [id, ORG, PROP, `${ORG}_g`, total, currency],
    );
  }

  // ── 1. Виклик виписує документ, а не мовчки віддає null ────────────────
  const id = await generateInvoiceForReservation(R_EUR, { confirmed: true, source: 'cash' });
  assert.ok(id, 'фактура броні мусить виписатись: повернувся null — запит не пройшов, а виняток зʼїв catch');
  const rows = await sql.rows<any>('SELECT * FROM invoices WHERE reservation_id = ?', [R_EUR]);
  assert.strictEqual(rows.length, 1, `у invoices мусить бути рівно один рядок, а їх ${rows.length}`);
  const inv = rows[0];
  assert.ok(String(inv.invoice_number || '').length > 0, 'у фактури є номер із серії HOUSE');
  assert.strictEqual(Number(inv.amount), 4200, 'сума — з броні');
  assert.strictEqual(String(inv.currency), 'EUR', 'валюта — броні, не готелю і не стала');

  // ── 2. Друга бронь — інша валюта й інша сума ─────────────────────────
  const second = await generateInvoiceForReservation(R_CZK);
  assert.ok(second, 'друга бронь теж виписується');
  const secondInv = await sql.row<any>('SELECT currency, amount, invoice_number FROM invoices WHERE reservation_id = ?', [R_CZK]);
  assert.strictEqual(String(secondInv.currency), 'CZK', 'кожна фактура несе валюту СВОЄЇ броні');
  assert.strictEqual(Number(secondInv.amount), 1500, 'і свою суму');
  assert.notStrictEqual(String(secondInv.invoice_number), String(inv.invoice_number), 'номери різні — серія видає наступний');

  // ── 3. Повторний виклик не робить другого номера ──────────────────────
  const again = await generateInvoiceForReservation(R_EUR);
  assert.strictEqual(again, id, 'повторний виклик віддає ту саму фактуру');
  const after = await sql.rows<any>('SELECT id FROM invoices WHERE reservation_id = ?', [R_EUR]);
  assert.strictEqual(after.length, 1, 'і не заводить другий документ на ті самі гроші');

  console.log('reservation-invoice: фактура броні виписується — рядок, номер, сума і валюта; повтор не двоїть');
} finally {
  await cleanup();
}
