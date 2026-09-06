/**
 * Фільтри списку броней: «конфліктні» і «скасовані клієнтом» (Блок 4 §2.5).
 *
 *   node src/modules/bookings/data/list-filters.check.ts
 *
 * Написано ДО коду (інваріант 24) і зламано навмисно: з `<` замість `<=`
 * на межі сусідні броні (виїзд 12-го / заїзд 12-го) ставали «конфліктними»,
 * і рецепція бачила овербукінг там, де його немає.
 *
 * Осі (інваріант 26), кожна з ДВОМА значеннями:
 *   кімната — спільна / інша / службова (`is_pool`) / без кімнати;
 *   перетин — накладаються / сусідні (півінтервал);
 *   статус  — жива / скасована;
 *   автор скасування — канал (`channel_cancelled`) / стійка (`status_change`).
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';

const { runWithOrganization } = await import('@core/auth/tenant-context');
const { getSql } = await import('@core/db/async');
const { CANCELLED_BY_CLIENT_SQL, orderByClause } = await import('./list-filters.ts');
// Конфлікт живе поруч із вартою перенесення — один опис на обидва питання.
const { CONFLICTING_SQL } = await import('./conflicts.repo.ts');

const sql = getSql();
const ORG = '__colist__org';
const PROP = '__colist__prop';
const ids = {
  cat: '__colist__cat', ut: '__colist__ut', u1: '__colist__u1', u2: '__colist__u2', pool: '__colist__pool',
  guest: '__colist__guest',
};

async function cleanup() {
  await sql.run("DELETE FROM booking_activity_log WHERE reservation_id LIKE '__colist__%'", []);
  await sql.run("DELETE FROM reservations WHERE id LIKE '__colist__%'", []);
  await sql.run('DELETE FROM guests WHERE organization_id = ?', [ORG]);
  await sql.run('DELETE FROM properties WHERE organization_id = ?', [ORG]);
  await sql.run('DELETE FROM organizations WHERE id = ?', [ORG]);
}

await cleanup();
await sql.run("INSERT INTO organizations (id, name, slug, default_currency) VALUES (?, ?, ?, 'CZK')", [ORG, 'List', 'colist']);

try {
  await runWithOrganization(ORG, async () => {
    await sql.run("INSERT INTO properties (id, organization_id, name, slug, country) VALUES (?, ?, 'House', 'colist', 'CZ')", [PROP, ORG]);
    await sql.run("INSERT INTO categories (id, property_id, name, type) VALUES (?, ?, 'Rooms', 'resort')", [ids.cat, PROP]);
    await sql.run("INSERT INTO unit_types (id, property_id, category_id, name, code) VALUES (?, ?, ?, 'Double', 'DBL')", [ids.ut, PROP, ids.cat]);
    for (const [u, code, pool] of [[ids.u1, '101', 'FALSE'], [ids.u2, '102', 'FALSE'], [ids.pool, 'POOL', 'TRUE']] as const) {
      await sql.run(
        `INSERT INTO units (id, unit_type_id, property_id, category_id, name, code, is_pool) VALUES (?, ?, ?, ?, ?, ?, ${pool})`,
        [u, ids.ut, PROP, ids.cat, code, code]);
    }
    await sql.run("INSERT INTO guests (id, organization_id, first_name, last_name) VALUES (?, ?, 'Eva', 'Nová')", [ids.guest, ORG]);

    const stay = (id: string, unit: string | null, ci: string, co: string, status = 'confirmed', createdAt = '2026-09-01 10:00:00') => sql.run(
      `INSERT INTO reservations (id, organization_id, property_id, unit_id, guest_id, check_in, check_out, nights, adults, status, payment_status, total_price, currency, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 2, 2, ?, 'unpaid', 2000, 'CZK', ?)`,
      [id, ORG, PROP, unit, ids.guest, ci, co, status, createdAt]);

    // ── кімната 101: дві броні НАКЛАДАЮТЬСЯ ────────────────────────────────
    await stay('__colist__over_a', ids.u1, '2026-10-10', '2026-10-13');
    await stay('__colist__over_b', ids.u1, '2026-10-12', '2026-10-15');
    // ── кімната 102: СУСІДНІ, виїзд у день заїзду — не конфлікт ────────────
    await stay('__colist__next_a', ids.u2, '2026-10-10', '2026-10-12');
    await stay('__colist__next_b', ids.u2, '2026-10-12', '2026-10-14');
    // ── службовий фонд: накладаються навмисно ──────────────────────────────
    await stay('__colist__pool_a', ids.pool, '2026-10-10', '2026-10-13');
    await stay('__colist__pool_b', ids.pool, '2026-10-11', '2026-10-14');
    // ── скасована поверх живої: кімнату звільняє ───────────────────────────
    await stay('__colist__dead', ids.u2, '2026-10-10', '2026-10-14', 'cancelled');
    // ── без кімнати: поіменно ні з ким не конфліктує ───────────────────────
    await stay('__colist__nounit', null, '2026-10-10', '2026-10-13');

    const ask = async (clause: string): Promise<string[]> => {
      const rows = await sql.rows<any>(
        `SELECT r.id FROM reservations r
           JOIN properties p ON p.id = r.property_id
          WHERE p.organization_id = ? AND (${clause})
          ORDER BY r.id`, [ORG]);
      return rows.map((x: any) => String(x.id));
    };

    assert.deepStrictEqual(await ask(CONFLICTING_SQL), ['__colist__over_a', '__colist__over_b'],
      'конфліктні — рівно дві броні кімнати 101');
    console.log('  ok  конфлікт: спільна кімната з перетином — обидві; сусідні (виїзд = заїзд) — жодної');
    console.log('  ok  службовий фонд не конфліктує; скасована звільняє кімнату; бронь без кімнати не в списку');

    // ── автор скасування ───────────────────────────────────────────────────
    await stay('__colist__c_channel', ids.u1, '2026-11-01', '2026-11-03', 'cancelled');
    await stay('__colist__c_desk', ids.u1, '2026-11-05', '2026-11-07', 'cancelled');
    await stay('__colist__c_silent', ids.u1, '2026-11-09', '2026-11-11', 'cancelled');
    // Канал МІНЯВ цю бронь, а скасувала стійка. Без цього рядка вісь
    // вироджена: «скасував канал» і «канал колись торкався» дають один
    // список, і `LIKE 'channel_%'` проходить (знайдено зламом 3).
    await stay('__colist__c_deskmod', ids.u1, '2026-11-13', '2026-11-15', 'cancelled');
    const log = (id: string, res: string, action: string, user: string | null) => sql.run(
      `INSERT INTO booking_activity_log (id, organization_id, reservation_id, action, details, user_id, user_name)
       VALUES (?, (SELECT organization_id FROM reservations WHERE id = ?), ?, ?, 'x', ?, ?)`,
      // Імʼя автора тут довільне: фільтр читає ДІЮ, а не підпис. Вендора не
      // називаємо — його імена живуть лише в адаптері (`check-vendor-isolation`).
      [id, res, res, action, user, user ? 'Рецепція' : 'Канал']);
    await log('__colist__l1', '__colist__c_channel', 'channel_cancelled', null);
    await log('__colist__l2', '__colist__c_desk', 'status_change', '__colist__user');
    // Жива бронь, яку канал колись міняв: дія каналу є, скасування немає.
    await log('__colist__l3', '__colist__over_a', 'channel_modified', null);
    // Скасована стійкою бронь, яку канал ДО ТОГО міняв — та сама вісь із
    // другого боку: дія каналу є, але скасування не його.
    await log('__colist__l4', '__colist__c_deskmod', 'channel_modified', null);
    await log('__colist__l5', '__colist__c_deskmod', 'status_change', '__colist__user');

    assert.deepStrictEqual(await ask(CANCELLED_BY_CLIENT_SQL), ['__colist__c_channel'],
      'клієнтом — лише та, що має рядок channel_cancelled');
    console.log('  ok  скасована клієнтом: канал — так; стійка — ні; скасована без сліду — ні; жива зі змінами з каналу — ні');
  });

  // ── сортування: білий список, а не рядок із запиту ────────────────────────
  assert.strictEqual(orderByClause('created_at', 'desc'), ' ORDER BY r.created_at DESC, r.id ASC');
  assert.strictEqual(orderByClause('check_out', 'asc'), ' ORDER BY r.check_out ASC, r.id ASC');
  assert.strictEqual(orderByClause(null, null), ' ORDER BY r.check_in ASC, r.id ASC', 'без параметрів — заїзд за зростанням');
  assert.strictEqual(orderByClause('total_price; DROP TABLE reservations', 'desc'),
    ' ORDER BY r.check_in DESC, r.id ASC', 'невідоме поле — дефолт, а не текст із запиту');
  assert.ok(!orderByClause('x', 'ASC; DELETE FROM guests').includes('DELETE'), 'напрямок теж не з запиту');
  console.log('  ok  сортування з білого списку; невідоме поле — дефолт; порядок відтворюваний (другий ключ — id)');
} finally {
  await cleanup();
}

console.log('list-filters: конфліктні — це спільна кімната з перетином; скасовані клієнтом — ті, що прийшли з каналу');
