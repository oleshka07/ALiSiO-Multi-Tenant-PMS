/**
 * Гостьова сторінка ВІДКРИВАЄТЬСЯ: `/api/guest/[token]` на живій броні — 200.
 *
 *   node src/modules/guests/data/guest-portal.check.ts
 *
 * Чому цей гейт існує. З 27.07.2026 у списку колонок `getReservationByToken`
 * бракувало коми перед `p.name` — `SELECT` не парсився, читання кидало, і
 * сторінка не відкривалася НІ В КОГО, включно з `main`. Побачити це можна
 * було лише відкривши посилання: `tsc` SQL не читає (інваріант: SQL — це
 * рядок), `npm run check` цього запиту не кликав, а хендлер відповідав
 * загальним «Booking not found»/502, тобто виглядало як зіпсовані дані
 * однієї броні, а не як зламаний код. Півтора місяця.
 *
 * Тому твердження тут — не про форму запиту, а про ВІДПОВІДЬ: 200 і в тілі
 * та сама бронь. Запит, який не парситься, такого дати не може, хоч би як
 * його переписали.
 *
 * Осі (інваріант 26): дві броні одного готелю — жива (200) і чужий токен
 * (404); у живої заповнені саме ті таблиці, чиї колонки перелічує запит
 * (гість, номер, категорія, тип, обʼєкт, організація), інакше «200» довело б
 * лише те, що запит не впав на порожнечі.
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';

const { getSql } = await import('@core/db/async');
const { getGuestPortal } = await import('@guests');

const sql = getSql();
const ORG = '__guest_portal__';
const PROP = `${ORG}_prop`;
const TOKEN = 'tok_guest_portal_check_0001';
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);

async function cleanup() {
  await sql.run('DELETE FROM reservations WHERE property_id = ?', [PROP]);
  await sql.run('DELETE FROM guests WHERE organization_id = ?', [ORG]);
  await sql.run('DELETE FROM units WHERE property_id = ?', [PROP]);
  await sql.run('DELETE FROM unit_types WHERE property_id = ?', [PROP]);
  await sql.run('DELETE FROM categories WHERE property_id = ?', [PROP]);
  await sql.run('DELETE FROM properties WHERE organization_id = ?', [ORG]);
  await sql.run('DELETE FROM organization_features WHERE organization_id = ?', [ORG]);
  await sql.run('DELETE FROM organizations WHERE id = ?', [ORG]);
}

await cleanup();
try {
  await sql.run('INSERT INTO organizations (id, name, slug, language) VALUES (?, ?, ?, ?)', [ORG, ORG, ORG, 'uk']);
  // Гостьова сторінка — платний модуль (П15): без нього варта віддає той
  // самий 404, що й неіснуючий токен, і сцена доводила б не те.
  await sql.run('INSERT INTO organization_features (organization_id, feature, enabled) VALUES (?, ?, ?)', [ORG, 'guest_page', 1]);
  await sql.run(
    `INSERT INTO properties (id, organization_id, name, slug, address, city, country, phone, email, check_in_time, check_out_time)
     VALUES (?, ?, 'Hotel', ?, 'Street 1', 'City', 'CZ', '+420000000000', 'hotel@example.test', '14:00', '10:00')`,
    [PROP, ORG, PROP],
  );
  await sql.run('INSERT INTO categories (id, property_id, name, type) VALUES (?, ?, ?, ?)', [`${ORG}_cat`, PROP, 'Rooms', 'room']);
  await sql.run(
    `INSERT INTO unit_types (id, property_id, category_id, name, code, description,
                             max_adults, max_children, max_occupancy, base_occupancy, beds_single, beds_double, beds_sofa)
     VALUES (?, ?, ?, 'Double', 'DBL', 'Room description', 2, 0, 2, 2, 0, 1, 0)`,
    [`${ORG}_ut`, PROP, `${ORG}_cat`],
  );
  await sql.run(
    `INSERT INTO units (id, property_id, unit_type_id, category_id, name, code, beds) VALUES (?, ?, ?, ?, '101', '101', 2)`,
    [`${ORG}_unit`, PROP, `${ORG}_ut`, `${ORG}_cat`],
  );
  await sql.run(
    `INSERT INTO guests (id, organization_id, first_name, last_name, email, phone) VALUES (?, ?, 'Anna', 'Guest', ?, '+420111111111')`,
    [`${ORG}_g`, ORG, 'anna@example.test'],
  );
  await sql.run(
    `INSERT INTO reservations (id, organization_id, property_id, guest_id, unit_id, check_in, check_out, nights,
                               adults, children, infants, status, payment_status, total_price, currency, source, guest_page_token)
     VALUES (?, ?, ?, ?, ?, ?, ?, 2, 2, 0, 0, 'confirmed', 'unpaid', 4000, 'CZK', 'direct', ?)`,
    [`${ORG}_r`, ORG, PROP, `${ORG}_g`, `${ORG}_unit`, iso(1), iso(3), TOKEN],
  );

  const call = (token: string) => getGuestPortal(
    new Request('http://localhost/api/guest/' + token) as any,
    { params: Promise.resolve({ token }) },
  );

  // ── Жива бронь: сторінка відкривається ────────────────────────────────
  const res = await call(TOKEN);
  const body = await res.clone().json().catch(() => ({} as any));
  assert.strictEqual(res.status, 200,
    `гостьова сторінка мусить відкриватись: ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
  assert.strictEqual(body?.reservation?.id ?? body?.id ?? body?.reservationId, `${ORG}_r`,
    `у відповіді мусить бути та сама бронь: ${JSON.stringify(body).slice(0, 300)}`);

  // ── Чужий токен: 404, і та сама відповідь для «немає» й «не наше» ─────
  const missing = await call('tok_nobody_ever_issued_this');
  assert.strictEqual(missing.status, 404, 'неіснуючий токен — 404, а не 500 і не 502');

  console.log('guest-portal: посилання гостя відкривається (200 і та сама бронь), чужий токен — 404');
} finally {
  await cleanup();
}
