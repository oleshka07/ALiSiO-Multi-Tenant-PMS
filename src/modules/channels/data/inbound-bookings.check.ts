/**
 * Та сама ревізія, доставлена двічі, не створює другої броні.
 *
 *   node src/modules/channels/data/inbound-bookings.check.ts
 *
 * Це чекпоінт CP4 (`docs/research/NORTHSTAR.md` §4), і питання в ньому
 * поставлене так: «що станеться, якщо Channex доставить ту саму ревізію
 * двічі?». Відповідь має бути доказом, а не запевненням.
 *
 * Повторна доставка тут — буденність, не аварія. Вебхуки приходять не в тому
 * порядку, у якому сталися події (документація Channex каже це дослівно),
 * `ack` шлеться ПІСЛЯ коміту, тож процес, що впав між ними, побачить ту саму
 * ревізію ще раз. Так само зробить повтор мережі й кнопка «синхронізувати».
 *
 * Написано ДО реалізації і мало бути червоним (інваріант 24). Було: перша
 * версія `applyRevision()` робила `INSERT` на кожну ревізію — дві броні на
 * одного гостя, і побачив би це готель за одним столом сніданку на два
 * номери.
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';

const { runWithOrganization } = await import('@core/auth/tenant-context');
const { getSql } = await import('@core/db/async');
const { applyRevision } = await import('./inbound-bookings.repo.ts');

const sql = getSql();
const ORG = '__cm_check__org';
const PROP = '__cm_check__prop';
const CAT = '__cm_check__cat';
const TYPE = '__cm_check__type';
const GUEST = '__cm_check__guest';
const CONN = '__cm_check__conn';

async function cleanup() {
  await sql.run('DELETE FROM cm_inbound_bookings WHERE organization_id = ?', [ORG]);
  await sql.run('DELETE FROM cm_connections WHERE organization_id = ?', [ORG]);
  await sql.run('DELETE FROM reservations WHERE organization_id = ?', [ORG]);
  await sql.run("DELETE FROM unit_types WHERE id LIKE '__cm_check__%'", []);
  await sql.run("DELETE FROM categories WHERE id LIKE '__cm_check__%'", []);
  await sql.run("DELETE FROM guests WHERE id LIKE '__cm_check__%'", []);
  await sql.run("DELETE FROM properties WHERE id LIKE '__cm_check__%'", []);
  await sql.run('DELETE FROM organizations WHERE id = ?', [ORG]);
}

await cleanup();
await sql.run('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)', [ORG, 'CM', ORG]);

try {
  await runWithOrganization(ORG, async () => {
    await sql.run('INSERT INTO properties (id, organization_id, name, slug) VALUES (?, ?, ?, ?)',
      [PROP, ORG, 'CM', PROP]);
    await sql.run('INSERT INTO categories (id, property_id, name, type) VALUES (?, ?, ?, ?)',
      [CAT, PROP, 'Rooms', 'room']);
    await sql.run('INSERT INTO unit_types (id, property_id, category_id, name, code) VALUES (?, ?, ?, ?, ?)',
      [TYPE, PROP, CAT, 'DZ', 'DZ']);
    await sql.run('INSERT INTO guests (id, organization_id, first_name, last_name) VALUES (?, ?, ?, ?)',
      [GUEST, ORG, 'Chan', 'Nel']);
    // `provider` називається ЯВНО: DEFAULT у схемі немає навмисно — імені
    // вендора в спільній схемі не буває (інваріант И1). Зʼєднання без
    // провайдера безглузде, тож база про це й питає.
    await sql.run(
      `INSERT INTO cm_connections (id, organization_id, property_id, provider,
                                   webhook_token, webhook_secret, is_enabled)
       VALUES (?, ?, ?, ?, ?, ?, TRUE)`,
      [CONN, ORG, PROP, 'probe', 'tok_check', 'sec_check'],
    );

    const rev = (over: Record<string, unknown> = {}) => ({
      remoteRevisionId: 'rev-1',
      remoteBookingId: 'bkg-1',
      status: 'new' as const,
      otaReservationCode: 'BDC-777',
      otaName: 'Booking.com',
      raw: { hello: 'world' },
      checkIn: '2026-10-10',
      checkOut: '2026-10-12',
      unitTypeId: TYPE,
      adults: 2,
      children: 0,
      totalPrice: 300,
      currency: 'EUR',
      ...over,
    });

    const countReservations = async () =>
      Number(((await sql.row<any>(
        'SELECT COUNT(*) AS n FROM reservations WHERE organization_id = ?', [ORG])) as any).n);
    const countJournal = async () =>
      Number(((await sql.row<any>(
        'SELECT COUNT(*) AS n FROM cm_inbound_bookings WHERE organization_id = ?', [ORG])) as any).n);

    // ── CP4: та сама ревізія двічі ───────────────────────────────────────
    const first = await applyRevision(CONN, rev());
    assert.strictEqual(first.result, 'applied', `перша ревізія: ${JSON.stringify(first)}`);
    assert.strictEqual(await countReservations(), 1, 'перша ревізія мала створити одну бронь');

    const again = await applyRevision(CONN, rev());
    assert.strictEqual(again.result, 'duplicate',
      'повторна доставка тієї самої ревізії мала бути впізнана як дубль');
    assert.strictEqual(await countReservations(), 1,
      'повторна доставка створила ДРУГУ бронь — це два сніданки на одного гостя');
    assert.strictEqual(await countJournal(), 1, 'журнал теж не має двоїтись');
    console.log('  ok  та сама ревізія двічі → одна бронь, один рядок журналу');

    // Дубль однаково впізнається, навіть якщо решта полів приїхала іншою:
    // ключ — саме ідентифікатор ревізії, а не вміст.
    const noisy = await applyRevision(CONN, rev({ totalPrice: 999, adults: 4 }));
    assert.strictEqual(noisy.result, 'duplicate',
      'ревізія з тим самим id, але іншим вмістом, мала лишитись дублем');
    assert.strictEqual(await countReservations(), 1);
    console.log('  ok  дубль упізнається за id ревізії, а не за вмістом');

    // ── Наступна ревізія ТІЄЇ САМОЇ броні — зміна, не нова бронь ─────────
    const modified = await applyRevision(CONN, rev({
      remoteRevisionId: 'rev-2', status: 'modified', checkOut: '2026-10-14', totalPrice: 450,
    }));
    assert.strictEqual(modified.result, 'applied');
    assert.strictEqual(await countReservations(), 1,
      'зміна створила другу бронь замість того, щоб змінити наявну');
    assert.strictEqual(await countJournal(), 2, 'кожна ревізія лишає свій рядок журналу');
    assert.strictEqual(modified.result === 'applied' ? modified.created : true, false,
      'друга ревізія тієї самої броні не мала СТВОРЮВАТИ бронь');

    const after = await sql.row<any>(
      'SELECT check_out, total_price FROM reservations WHERE organization_id = ?', [ORG]) as any;
    assert.strictEqual(String(after.check_out).slice(0, 10), '2026-10-14',
      'зміна дат не доїхала до броні');
    assert.strictEqual(Number(after.total_price), 450, 'зміна суми не доїхала до броні');
    console.log('  ok  наступна ревізія змінює ТУ САМУ бронь, а не створює нову');

    // ── Скасування ───────────────────────────────────────────────────────
    const cancelled = await applyRevision(CONN, rev({
      remoteRevisionId: 'rev-3', status: 'cancelled',
    }));
    assert.strictEqual(cancelled.result, 'applied');
    assert.strictEqual(await countReservations(), 1, 'скасування не видаляє бронь, а міняє статус');
    const st = await sql.row<any>(
      'SELECT status FROM reservations WHERE organization_id = ?', [ORG]) as any;
    assert.strictEqual(st.status, 'cancelled', 'скасована ревізія не скасувала бронь');
    console.log('  ok  скасування міняє статус, а не стирає бронь');

    // ── Бронь лягає БЕЗ номера (CP3) ─────────────────────────────────────
    const placed = await sql.row<any>(
      'SELECT unit_id, unit_type_id FROM reservations WHERE organization_id = ?', [ORG]) as any;
    assert.strictEqual(placed.unit_id, null,
      'канал не знає про кімнати — бронь мала лягти без призначеного номера');
    assert.strictEqual(placed.unit_type_id, TYPE, 'тип номера мав зберегтися');
    console.log('  ok  бронь із каналу лягає на ТИП номера, без кімнати');

    // ── Чуже зʼєднання ───────────────────────────────────────────────────
    const nowhere = await applyRevision('__no_such_connection__', rev({ remoteRevisionId: 'rev-9' }));
    assert.strictEqual(nowhere.result, 'refused',
      'ревізія на неіснуюче зʼєднання мала бути відхилена, а не створити бронь нізвідки');
    assert.strictEqual(await countReservations(), 1);
    console.log('  ok  ревізія без зʼєднання відмовляє, а не вигадує бронь');
  });
} finally {
  await cleanup();
}

console.log('inbound: ревізія стає бронню рівно один раз');
