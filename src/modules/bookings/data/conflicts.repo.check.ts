/**
 * Перенесення броні бачить і чужу бронь, і закриття номера (Блок 4 §2.4).
 *
 *   node src/modules/bookings/data/conflicts.repo.check.ts
 *
 * Написано ДО коду: PATCH дивився лише на броні, і гість переїжджав у номер,
 * закритий на ремонт. Осі (інваріант 26): два номери (звичайний і басейн),
 * бронь і блокування на різних датах, скасована бронь.
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';

const { runWithOrganization } = await import('@core/auth/tenant-context');
const { getSql } = await import('@core/db/async');
const { findStayConflict } = await import('./conflicts.repo.ts');

const sql = getSql();
const ORG = '__coconf__org';
const PROP = '__coconf__prop';
const ids = { cat: '__coconf__cat', ut: '__coconf__ut', u1: '__coconf__u1', pool: '__coconf__pool', guest: '__coconf__guest',
  r1: '__coconf__r1', rCancelled: '__coconf__r_cancelled', rMoving: '__coconf__r_moving', blk: '__coconf__blk' };

async function cleanup() {
  await sql.run("DELETE FROM availability_blocks WHERE id LIKE '__coconf__%'", []);
  await sql.run("DELETE FROM reservations WHERE id LIKE '__coconf__%'", []);
  await sql.run('DELETE FROM guests WHERE organization_id = ?', [ORG]);
  await sql.run('DELETE FROM properties WHERE organization_id = ?', [ORG]);
  await sql.run('DELETE FROM organizations WHERE id = ?', [ORG]);
}

await cleanup();
await sql.run("INSERT INTO organizations (id, name, slug, default_currency) VALUES (?, ?, ?, 'CZK')", [ORG, 'Conf', 'coconf']);

try {
  await runWithOrganization(ORG, async () => {
    await sql.run("INSERT INTO properties (id, organization_id, name, slug, country) VALUES (?, ?, 'House', 'coconf', 'CZ')", [PROP, ORG]);
    await sql.run("INSERT INTO categories (id, property_id, name, type) VALUES (?, ?, 'Rooms', 'resort')", [ids.cat, PROP]);
    await sql.run("INSERT INTO unit_types (id, property_id, category_id, name, code) VALUES (?, ?, ?, 'Double', 'DBL')", [ids.ut, PROP, ids.cat]);
    await sql.run("INSERT INTO units (id, unit_type_id, property_id, category_id, name, code, is_pool) VALUES (?, ?, ?, ?, '101', '101', FALSE)", [ids.u1, ids.ut, PROP, ids.cat]);
    await sql.run("INSERT INTO units (id, unit_type_id, property_id, category_id, name, code, is_pool) VALUES (?, ?, ?, ?, 'Pool', 'POOL', TRUE)", [ids.pool, ids.ut, PROP, ids.cat]);
    await sql.run("INSERT INTO guests (id, organization_id, first_name, last_name) VALUES (?, ?, 'Eva', 'Nová')", [ids.guest, ORG]);
    const stay = (id: string, unit: string, ci: string, co: string, status: string) => sql.run(
      `INSERT INTO reservations (id, organization_id, property_id, unit_id, guest_id, check_in, check_out, nights, adults, status, payment_status, total_price, currency)
       VALUES (?, ?, ?, ?, ?, ?, ?, 2, 2, ?, 'unpaid', 2000, 'CZK')`,
      [id, ORG, PROP, unit, ids.guest, ci, co, status]);
    await stay(ids.r1, ids.u1, '2026-10-10', '2026-10-12', 'confirmed');
    await stay(ids.rCancelled, ids.u1, '2026-10-20', '2026-10-22', 'cancelled');
    await stay(ids.rMoving, ids.pool, '2026-10-01', '2026-10-03', 'confirmed');
    await sql.run(
      `INSERT INTO availability_blocks (id, organization_id, unit_id, date_from, date_to, reason) VALUES (?, ?, ?, '2026-10-15', '2026-10-17', 'maintenance')`,
      [ids.blk, ORG, ids.u1]);

    const at = (ci: string, co: string, unit = ids.u1) =>
      findStayConflict(sql, { unitId: unit, checkIn: ci, checkOut: co, excludeReservationId: ids.rMoving });

    assert.deepStrictEqual(await at('2026-10-11', '2026-10-13'), { kind: 'booking', id: ids.r1 }, 'накриває чужу бронь');
    assert.strictEqual(await at('2026-10-12', '2026-10-14'), null, 'заїзд у день виїзду — вільно (півінтервал)');
    assert.strictEqual(await at('2026-10-08', '2026-10-10'), null, 'виїзд у день заїзду чужої — вільно');
    console.log('  ok  чужа бронь — конфлікт, півінтервал з обох боків');

    const blocked = await at('2026-10-16', '2026-10-18');
    assert.strictEqual(blocked?.kind, 'block', 'закритий номер — конфлікт');
    assert.deepStrictEqual(blocked && [blocked.reason, blocked.date_from, blocked.date_to], ['maintenance', '2026-10-15', '2026-10-17']);
    assert.strictEqual(await at('2026-10-17', '2026-10-19'), null, 'після кінця блокування — вільно (date_to виключний)');
    console.log('  ok  закриття номера видно, з причиною і датами; кінець блокування виключний');

    assert.strictEqual(await at('2026-10-20', '2026-10-22'), null, 'скасована бронь номер не тримає');
    assert.strictEqual(await at('2026-10-10', '2026-10-12', ids.pool), null, 'басейн приймає скільки завгодно');
    const self = await findStayConflict(sql, { unitId: ids.u1, checkIn: '2026-10-10', checkOut: '2026-10-12', excludeReservationId: ids.r1 });
    assert.strictEqual(self, null, 'бронь сама собі не заважає');
    console.log('  ok  скасована не рахується, басейн не конфліктує, своя бронь виключена');
  });
} finally {
  await cleanup();
}

console.log('conflicts: перенесення бачить чужу бронь і закриття номера, півінтервал, басейн вільний');
