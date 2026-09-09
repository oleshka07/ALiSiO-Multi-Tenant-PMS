/**
 * Виселення робить номер брудним — у ТІЙ САМІЙ транзакції, що й статус.
 *
 *   node src/modules/bookings/data/reservation-write.repo.check.ts
 *
 * Три речі, які мусять триматись разом (Блок 4 §2.2, 0092):
 *   1. після `checked_out` номер броні — `dirty`, і в журналі прибирання є
 *      рядок `clean → dirty` з `source = 'checkout'`;
 *   2. падіння запису журналу відкочує ЗМІНУ СТАТУСУ: бронь лишається
 *      `checked_in`, номер — `clean`. Ламається навмисно: `changed_by`, якого
 *      немає в app_users, — FK відмовляє на обох двигунах;
 *   3. бронь без номера виселяється без запису — нема що бруднити.
 * Плюс дочірні броні: їхні номери брудняться теж.
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';

const { runWithOrganization } = await import('@core/auth/tenant-context');
const { getSql } = await import('@core/db/async');
const { writeReservationChange } = await import('./reservation-write.repo.ts');
// Стан номера і журнал — таблиці обʼєкта: читаємо через його двері, не SQL.
const { housekeepingBoard, cleaningHistory } = await import('@properties/kernel');
const { oneProperty, ALL_PROPERTIES } = await import('@core/property-scope');

const sql = getSql();
const ORG = '__codirty__org';
const PROP = '__codirty__prop';
const USER = '__codirty__user';
const ids = {
  cat: '__codirty__cat', ut: '__codirty__ut', u1: '__codirty__u1', u2: '__codirty__u2', u3: '__codirty__u3',
  guest: '__codirty__guest', parent: '__codirty__r_parent', child: '__codirty__r_child',
  noUnit: '__codirty__r_nounit', rollback: '__codirty__r_rollback',
};

async function cleanup() {
  await sql.run("DELETE FROM reservations WHERE id LIKE '__codirty__%'", []);
  await sql.run('DELETE FROM guests WHERE organization_id = ?', [ORG]);
  await sql.run('DELETE FROM app_users WHERE organization_id = ?', [ORG]);
  await sql.run('DELETE FROM properties WHERE organization_id = ?', [ORG]);
  await sql.run('DELETE FROM organizations WHERE id = ?', [ORG]);
}

await cleanup();
await sql.run("INSERT INTO organizations (id, name, slug, default_currency) VALUES (?, ?, ?, 'CZK')", [ORG, 'Dirty', 'codirty']);

try {
  await runWithOrganization(ORG, async () => {
    await sql.run("INSERT INTO properties (id, organization_id, name, slug, country) VALUES (?, ?, 'House', 'codirty', 'CZ')", [PROP, ORG]);
    await sql.run("INSERT INTO app_users (id, organization_id, email, full_name, role, password_hash) VALUES (?, ?, 'd@codirty.test', 'Maid', 'housekeeper', 'x')", [USER, ORG]);
    await sql.run("INSERT INTO categories (id, property_id, name, type) VALUES (?, ?, 'Rooms', 'resort')", [ids.cat, PROP]);
    await sql.run("INSERT INTO unit_types (id, property_id, category_id, name, code) VALUES (?, ?, ?, 'Double', 'DBL')", [ids.ut, PROP, ids.cat]);
    for (const [u, code] of [[ids.u1, '101'], [ids.u2, '102'], [ids.u3, '103']]) {
      await sql.run("INSERT INTO units (id, unit_type_id, property_id, category_id, name, code, cleaning_status) VALUES (?, ?, ?, ?, ?, ?, 'clean')", [u, ids.ut, PROP, ids.cat, code, code]);
    }
    await sql.run("INSERT INTO guests (id, organization_id, first_name, last_name) VALUES (?, ?, 'Eva', 'Nová')", [ids.guest, ORG]);
    const stay = (id: string, unit: string | null, parent: string | null) => sql.run(
      `INSERT INTO reservations (id, organization_id, property_id, unit_id, guest_id, parent_id, check_in, check_out, nights, adults, status, payment_status, total_price, currency)
       VALUES (?, ?, ?, ?, ?, ?, '2026-10-09', '2026-10-11', 2, 2, 'checked_in', 'paid', 2000, 'CZK')`,
      [id, ORG, PROP, unit, ids.guest, parent]);
    await stay(ids.parent, ids.u1, null);
    await stay(ids.child, ids.u2, ids.parent);
    await stay(ids.noUnit, null, null);
    await stay(ids.rollback, ids.u3, null);

    const cleaning = async (u: string) => (await housekeepingBoard(ORG, oneProperty(PROP))).units.find((x) => x.id === u)?.cleaning_status;
    const status = async (r: string) => (await sql.row<any>('SELECT status FROM reservations WHERE id = ?', [r]))?.status;
    const logRows = async (u: string) => (await cleaningHistory(ORG, { scope: ALL_PROPERTIES, unitId: u }))
      .map((r) => ({ from_status: r.from_status, to_status: r.to_status, source: r.source, changed_by: r.changed_by }));

    // ── 1. виселення головної броні: її номер і номер дочірньої — брудні ───
    await writeReservationChange(sql, {
      organizationId: ORG, reservationId: ids.parent,
      statement: "UPDATE reservations SET status = 'checked_out' WHERE id = ?", values: [ids.parent],
      movesStay: true, cascade: { status: 'checked_out' },
      checkout: { changedBy: USER },
    });
    assert.strictEqual(await status(ids.parent), 'checked_out');
    assert.strictEqual(await status(ids.child), 'checked_out', 'дочірня виселена каскадом');
    assert.strictEqual(await cleaning(ids.u1), 'dirty', 'номер головної — брудний');
    assert.strictEqual(await cleaning(ids.u2), 'dirty', 'номер дочірньої — брудний');
    const log = await logRows(ids.u1);
    assert.deepStrictEqual(log.map((r) => [r.from_status, r.to_status, r.source, r.changed_by]), [['clean', 'dirty', 'checkout', USER]]);
    console.log('  ok  виселення → номери головної й дочірньої брудні, журнал каже clean → dirty (checkout)');

    // ── 2. запис журналу падає → статус НЕ змінюється ─────────────────────
    await assert.rejects(
      writeReservationChange(sql, {
        organizationId: ORG, reservationId: ids.rollback,
        statement: "UPDATE reservations SET status = 'checked_out' WHERE id = ?", values: [ids.rollback],
        movesStay: true, cascade: { status: 'checked_out' },
        checkout: { changedBy: '__codirty__nobody' },
      }),
      'невідомий автор запису мав зупинити транзакцію');
    assert.strictEqual(await status(ids.rollback), 'checked_in', 'статус броні відкочено');
    assert.strictEqual(await cleaning(ids.u3), 'clean', 'номер лишився чистим');
    assert.strictEqual((await logRows(ids.u3)).length, 0, 'рядка журналу немає');
    console.log('  ok  падіння журналу відкочує статус броні і стан номера');

    // ── 3. без номера — виселяється тихо ──────────────────────────────────
    await writeReservationChange(sql, {
      organizationId: ORG, reservationId: ids.noUnit,
      statement: "UPDATE reservations SET status = 'checked_out' WHERE id = ?", values: [ids.noUnit],
      movesStay: true, cascade: { status: 'checked_out' },
      checkout: { changedBy: USER },
    });
    assert.strictEqual(await status(ids.noUnit), 'checked_out');
    console.log('  ok  бронь без номера виселяється без запису прибирання');
  });
} finally {
  await cleanup();
}

console.log('reservation-write: виселення бруднить номер у тій самій транзакції; падіння журналу відкочує статус');
