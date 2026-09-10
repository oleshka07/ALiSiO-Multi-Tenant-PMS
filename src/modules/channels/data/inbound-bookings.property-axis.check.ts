/**
 * Ревізія зʼєднання будинку А не торкається будинку Б — того самого рахунку.
 *
 *   node src/modules/channels/data/inbound-bookings.property-axis.check.ts
 *
 * ── Яка тут вісь ────────────────────────────────────────────────────────
 *
 * Не орендар. Орендар тут тримається і тримався: кожен запит несе
 * `organization_id`, політики на місці. Це INC-029 — **вісь обʼєкта**: один
 * рахунок може мати кілька будинків, і `cm_connections.property_id` називає
 * РІВНО ОДИН. Зʼєднання — це і є вісь: колонка ставиться при заведенні і
 * жоден писач `connections.repo.ts` її не міняє.
 *
 * Тобто твердження просте: **ревізія, що приїхала зʼєднанням будинку А, не
 * може ні прочитати, ні змінити нічого в будинку Б** — навіть коли Б
 * належить тому самому рахунку і політика його пропускає.
 *
 * ── Дві сцени, і вони різного роду ──────────────────────────────────────
 *
 * **Досяжна.** `putMapping` доводить, що зʼєднання СВОЄ (`connectionInTenant`),
 * і не питає, чи належить `local_id` будинку цього зʼєднання. Каталожний синк
 * перелічує типи по `connection.propertyId`, тож звичайним шляхом мапінг
 * лишається в межах будинку, — але двері відчинені, і ревізія з типом
 * сусіднього будинку доїжджала до `INSERT` без жодного питання: бронь
 * створювалась у будинку А з типом будинку Б, а `noteAvailabilityChanged`
 * складав пару «будинок А × тип Б», якої не буває. Помилку видно не в лозі, а
 * в шахматці сусіда — через день.
 *
 * **Сторожова.** Журнал (`cm_inbound_bookings.reservation_id`) — єдиний шлях,
 * яким `applyRevision` знаходить свою бронь. Пише туди лише вона сама, тож
 * рядок на бронь чужого будинку означає відновлення з дампа, ручну правку або
 * псування. Саме тому це і перевіряється: стан «неможливий за побудовою» —
 * це стан, який ніхто не ловить, і читач, який його не помічає, мовчки
 * перепише чужому будинку дати й статус.
 *
 * ── Числа, і чому вони не вироджені (інваріант 26) ──────────────────────
 *
 * Два будинки, по типу в кожному, і зʼєднання ЛИШЕ на А. Дати планової броні
 * будинку Б (2026-11-01 → 11-03) і дати ревізії (2026-10-10 → 10-12) не
 * перетинаються жодним днем, тож «не змінили» і «змінили» тут — різні числа, а
 * не однакові. Позитивний контроль стоїть першим: якби сцена була зелена від
 * того, що ревізії відмовляють ЗАВЖДИ, він би впав.
 *
 * ── Червоність доведена на нинішньому коді ──────────────────────────────
 *
 * До правки: сцена 1 падала на `applied` замість `refused` (бронь створювалась
 * із типом чужого будинку), сцена 3 — на `check_in`, що став `2026-10-10`
 * замість `2026-11-01`, тобто ревізія будинку А переписала бронь будинку Б.
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';

const { runWithOrganization } = await import('@core/auth/tenant-context');
const { getSql } = await import('@core/db/async');
const { applyRevision } = await import('./inbound-bookings.repo.ts');

const sql = getSql();
const ORG = '__cmpa__org';
const PROP_A = '__cmpa__prop_a';
const PROP_B = '__cmpa__prop_b';
const CAT_A = '__cmpa__cat_a';
const CAT_B = '__cmpa__cat_b';
const TYPE_A = '__cmpa__type_a';
const TYPE_B = '__cmpa__type_b';
const GUEST = '__cmpa__guest';
const CONN = '__cmpa__conn';
/** Бронь СУСІДНЬОГО будинку — та, якої ревізія зʼєднання А не має бачити. */
const RES_B = '__cmpa__res_b';

async function cleanup() {
  await runWithOrganization(ORG, async () => {
    await sql.run('DELETE FROM cm_inbound_bookings WHERE organization_id = ?', [ORG]);
    await sql.run('DELETE FROM booking_activity_log WHERE organization_id = ?', [ORG]);
    await sql.run('DELETE FROM cm_outbox WHERE organization_id = ?', [ORG]);
    await sql.run('DELETE FROM cm_mappings WHERE organization_id = ?', [ORG]);
    await sql.run('DELETE FROM cm_connections WHERE organization_id = ?', [ORG]);
    await sql.run(
      `DELETE FROM reservation_sub_bookings
        WHERE reservation_id IN (SELECT id FROM reservations WHERE organization_id = ?)`, [ORG]);
    await sql.run('DELETE FROM reservations WHERE organization_id = ?', [ORG]);
    await sql.run('DELETE FROM guests WHERE organization_id = ?', [ORG]);
    await sql.run(
      'DELETE FROM unit_types WHERE property_id IN (SELECT id FROM properties WHERE organization_id = ?)', [ORG]);
    await sql.run(
      'DELETE FROM categories WHERE property_id IN (SELECT id FROM properties WHERE organization_id = ?)', [ORG]);
    await sql.run('DELETE FROM properties WHERE organization_id = ?', [ORG]);
  });
  await sql.run('DELETE FROM organizations WHERE id = ?', [ORG]);
}

await cleanup();
await sql.run('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)', [ORG, 'CM axis', ORG]);

try {
  await runWithOrganization(ORG, async () => {
    // ── Два будинки одного рахунку ────────────────────────────────────────
    for (const [prop, cat, type, name] of [
      [PROP_A, CAT_A, TYPE_A, 'A'], [PROP_B, CAT_B, TYPE_B, 'B'],
    ]) {
      await sql.run('INSERT INTO properties (id, organization_id, name, slug) VALUES (?, ?, ?, ?)',
        [prop, ORG, `Дім ${name}`, prop]);
      await sql.run('INSERT INTO categories (id, property_id, name, type) VALUES (?, ?, ?, ?)',
        [cat, prop, 'Rooms', 'room']);
      await sql.run('INSERT INTO unit_types (id, property_id, category_id, name, code) VALUES (?, ?, ?, ?, ?)',
        [type, prop, cat, `Тип ${name}`, `T${name}`]);
    }
    await sql.run('INSERT INTO guests (id, organization_id, first_name, last_name) VALUES (?, ?, ?, ?)',
      [GUEST, ORG, 'Axis', 'Probe']);

    // Зʼєднання — ЛИШЕ на будинку А. Це і є вісь.
    await sql.run(
      `INSERT INTO cm_connections (id, organization_id, property_id, provider,
                                   webhook_token, webhook_secret, is_enabled)
       VALUES (?, ?, ?, ?, ?, ?, TRUE)`,
      [CONN, ORG, PROP_A, 'probe', 'tok_axis', 'sec_axis'],
    );

    const rev = (over: Record<string, unknown> = {}) => ({
      remoteRevisionId: 'axis-rev-1',
      remoteBookingId: 'axis-bkg-1',
      status: 'new' as const,
      otaReservationCode: 'AX-1',
      otaName: 'Probe.com',
      raw: {},
      checkIn: '2026-10-10',
      checkOut: '2026-10-12',
      unitTypeId: TYPE_A,
      adults: 2,
      children: 0,
      totalPrice: 300,
      currency: 'EUR',
      ...over,
    });

    const reservationsIn = async (propertyId: string) => Number(((await sql.row<any>(
      'SELECT COUNT(*) AS n FROM reservations WHERE organization_id = ? AND property_id = ?',
      [ORG, propertyId])) as any).n);

    // ── Контроль: свій будинок працює ────────────────────────────────────
    //
    // Стоїть першим навмисно. Без нього все нижче лишалось би зеленим на
    // реалізації, яка відмовляє КОЖНІЙ ревізії.
    {
      const ok = await applyRevision(sql, CONN, rev());
      assert.strictEqual(ok.result, 'applied', `своя ревізія мала пройти: ${JSON.stringify(ok)}`);
      assert.strictEqual(await reservationsIn(PROP_A), 1, 'бронь мала лягти в будинок А');
      assert.strictEqual(await reservationsIn(PROP_B), 0, 'у будинку Б не мало зʼявитись нічого');
    }
    console.log('  ok  ревізія свого будинку проходить (контроль)');

    // ── Сцена 1: тип СУСІДНЬОГО будинку ──────────────────────────────────
    {
      const alien = await applyRevision(sql, CONN, rev({
        remoteRevisionId: 'axis-rev-2', remoteBookingId: 'axis-bkg-2', unitTypeId: TYPE_B,
      }));
      assert.strictEqual(alien.result, 'refused',
        `ревізія з типом номера ЧУЖОГО будинку мала відмовити, а не створити бронь: ${JSON.stringify(alien)}`);
      assert.match((alien as any).reason, /unit_type/,
        `причина відмови має називати рід: ${JSON.stringify(alien)}`);
      assert.strictEqual(await reservationsIn(PROP_A), 1,
        'відмова не має лишати по собі броні в будинку А');
      assert.strictEqual(await reservationsIn(PROP_B), 0,
        'і тим паче в будинку Б');
    }
    console.log('  ok  тип номера сусіднього будинку — названа відмова, не бронь');

    // ── Сцена 2: те саме в КІМНАТІ групи ─────────────────────────────────
    //
    // Окрема сцена, а не варіація: групу веде інша гілка (`applyGroup`), і
    // тип кімнати їде туди своїм полем. Перевірка на одному полі лишила б
    // друге відчиненим.
    {
      const alienRoom = await applyRevision(sql, CONN, rev({
        remoteRevisionId: 'axis-rev-3', remoteBookingId: 'axis-bkg-3',
        rooms: [
          { key: 'r1', unitTypeId: TYPE_A, checkIn: '2026-10-10', checkOut: '2026-10-12', adults: 2, amount: 300 },
          { key: 'r2', unitTypeId: TYPE_B, checkIn: '2026-10-10', checkOut: '2026-10-12', adults: 1, amount: 210 },
        ],
      }));
      assert.strictEqual(alienRoom.result, 'refused',
        `кімната групи з типом чужого будинку мала відмовити: ${JSON.stringify(alienRoom)}`);
      assert.strictEqual(await reservationsIn(PROP_A), 1,
        'відмовлена група не лишає ні майстра, ні дочірніх');
    }
    console.log('  ok  кімната групи з типом чужого будинку — теж відмова');

    // ── Сцена 3: журнал показує на бронь чужого будинку ──────────────────
    //
    // Сторожова сцена. Рядок журналу пише лише `applyRevision`, тож у
    // здоровій базі його `reservation_id` завжди в будинку зʼєднання. Він
    // може розійтись із дійсністю лише ззовні — відновлення, ручна правка. І
    // саме тоді читач, який довіряє журналу на слово, переписує чужу бронь.
    await sql.run(
      `INSERT INTO reservations (id, organization_id, property_id, unit_type_id, guest_id,
                                 check_in, check_out, nights, adults, children,
                                 status, payment_status, source, total_price, currency)
       VALUES (?, ?, ?, ?, ?, '2026-11-01', '2026-11-03', 2, 2, 0,
               'confirmed', 'unpaid', 'direct', 500, 'EUR')`,
      [RES_B, ORG, PROP_B, TYPE_B, GUEST],
    );
    await sql.run(
      `INSERT INTO cm_inbound_bookings
         (id, organization_id, connection_id, remote_revision_id, remote_booking_id,
          status, payload, reservation_id, applied_at)
       VALUES (?, ?, ?, 'axis-rev-old', 'axis-bkg-4', 'new', '{}', ?, CURRENT_TIMESTAMP)`,
      [`${CONN}_j_old`, ORG, CONN, RES_B],
    );

    {
      let refused = false;
      try {
        const out = await applyRevision(sql, CONN, rev({
          remoteRevisionId: 'axis-rev-4', remoteBookingId: 'axis-bkg-4', status: 'modified' as const,
        }));
        refused = out.result === 'refused';
      } catch {
        // Виняток теж годиться: він відкочує транзакцію разом із рядком
        // журналу, тобто ревізія не стає «вже баченою». Що саме обрано —
        // сказано в коді читача; сцена стверджує НАСЛІДОК.
        refused = true;
      }
      assert.ok(refused, 'ревізія, чий журнал показує на бронь чужого будинку, мала відмовити');

      const b = await sql.row<any>(
        'SELECT check_in, check_out, status, total_price FROM reservations WHERE id = ?', [RES_B]) as any;
      assert.strictEqual(String(b.check_in).slice(0, 10), '2026-11-01',
        'ревізія зʼєднання будинку А переписала ДАТИ броні будинку Б');
      assert.strictEqual(String(b.check_out).slice(0, 10), '2026-11-03', 'і дату виїзду теж');
      assert.strictEqual(Number(b.total_price), 500, 'і суму');
    }
    console.log('  ok  журнал на бронь чужого будинку — відмова, чужа бронь ціла');
  });
} finally {
  await cleanup();
}

console.log('inbound-bookings.property-axis: зʼєднання будинку А не дістає до будинку Б (INC-029)');
