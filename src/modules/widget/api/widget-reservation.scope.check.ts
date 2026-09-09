/**
 * Сайт віддає бронь СВОГО будинку — і жодну іншу.
 *
 *   node src/modules/widget/api/widget-reservation.scope.check.ts
 *
 * ── Що ламалося ─────────────────────────────────────────────────────────
 *
 * `GET /api/booking/reservation?id=…` — публічний маршрут: його відкриває
 * сторінка «ваше бронювання» після оплати, без сесії. Орендаря він тримав
 * (`withSite` → організація сайта), а далі читав `reservations WHERE r.id = ?`
 * і на цьому зупинявся.
 *
 * Але сайт заведено ПІД ОБʼЄКТ: `booking_sites.property_id` — `NOT NULL`.
 * Тобто готель із двома будинками і двома сайтами віддавав сайтові А бронь
 * будинку Б — з датами, сумою, і, головне, **іменем, поштою і телефоном
 * гостя**, якого цей сайт ніколи не бачив. Це вісь INC-029 на публічній
 * поверхні, і помітити її з боку гостя не можна: сторінка виглядає своєю.
 *
 * ── Чому легасі-шлях лишається як був ───────────────────────────────────
 *
 * `withSite(null)` — віджет першого клієнта, вбудований до того, як зʼявились
 * сайти (`useBookingWidget` шле `siteId` лише `if (siteId)`). Обʼєкта там не
 * названо НІЧИМ, тож звузити нема по чому; орендаря та гілка тримає окремо —
 * єдина організація або відмова. Сцена стверджує цю відмову, і разом із нею
 * НАЗИВАЄ свою межу: на базі з кількома організаціями обидві причини 404
 * невідрізнювані, тож «звуження туди не дістає» вона не доводить (пояснено
 * на місці твердження).
 *
 * ── Числа ───────────────────────────────────────────────────────────────
 *
 * Спільна фікстура: 2 броні в А, 3 в Б. Сцена питає ПОІМЕННО — бронь Б через
 * сайт А, — тож вироджених чисел тут немає за побудовою: відповідь або та
 * бронь, або нічого. Обидва боки перевіряються з обох сайтів, бо «сайт А не
 * бачить Б» саме по собі зелене і на коді, який не бачить нічого.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-widget-scope-'));
process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { seedTwoProperties } = await import('@core/fixtures/two-properties.ts');
const { getWidgetReservation } = await import('./widget-reservation.handlers.ts');

const sql = getSql();
const fx = await seedTwoProperties();

// Два сайти, по одному на будинок. `property_id` тут не прикраса — саме він і
// є віссю, яку читач мусить поважати.
const site = async (id: string, slug: string, propertyId: string) => sql.run(
  `INSERT INTO booking_sites (id, organization_id, property_id, name, slug, status)
   VALUES (?, ?, ?, ?, ?, 'active')`,
  [id, fx.organizationId, propertyId, slug, slug]);
await site('__wsc__site_a', 'site-a', fx.a.id);
await site('__wsc__site_b', 'site-b', fx.b.id);

/** Маршрут як його бачить гість: рядок запиту, без сесії. */
const ask = async (reservationId: string, siteId?: string) => {
  const url = new URL(`http://probe/api/booking/reservation?id=${reservationId}`);
  if (siteId) url.searchParams.set('siteId', siteId);
  const res = await getWidgetReservation({ nextUrl: url } as never);
  return { status: res.status, body: await res.json() as any };
};

const inA = fx.a.reservationIds[0];
const inB = fx.b.reservationIds[0];
assert.ok(inA && inB && inA !== inB, 'фікстура не дала двох різних броней — сцені нема що розрізняти');

// ── Свій сайт бачить свою бронь ──────────────────────────────────────────
{
  const own = await ask(inA, '__wsc__site_a');
  assert.strictEqual(own.status, 200, `сайт А не побачив власної броні (${own.status})`);
  assert.strictEqual(own.body.reservation?.id, inA, 'віддано не ту бронь');
}
{
  const own = await ask(inB, '__wsc__site_b');
  assert.strictEqual(own.status, 200, `сайт Б не побачив власної броні (${own.status})`);
  assert.strictEqual(own.body.reservation?.id, inB, 'віддано не ту бронь');
}
console.log('  ok  кожен сайт віддає бронь свого будинку');

// ── Чужу — не бачить, і саме 404, а не порожнє тіло ──────────────────────
//
// Обидва напрямки: «А не бачить Б» окремо було б зелене й на читачі, який не
// бачить нічого взагалі, — а верхні два твердження це вже виключили.
{
  const foreign = await ask(inB, '__wsc__site_a');
  assert.strictEqual(foreign.status, 404,
    `сайт А віддав бронь будинку Б (${foreign.status}) — з іменем, поштою і телефоном гостя`);
}
{
  const foreign = await ask(inA, '__wsc__site_b');
  assert.strictEqual(foreign.status, 404, 'сайт Б віддав бронь будинку А');
}
console.log('  ok  чужа бронь — 404, з обох боків');

// ── Легасі-віджет без сайта: відмова, і вона НЕ про обʼєкт ──────────────
//
// `withSite(null)` не має чим назвати ні сайт, ні будинок, тож звужувати там
// нема по чому — обʼєкт лишається як був, а орендаря тримає інша гілка:
// єдина організація або відмова. У цій базі організацій більше однієї
// (фікстура плюс демо-засів), тож правильна відповідь тут — 404.
//
// **Межа сцени названа прямо:** з обох причин відповідь однакова, тож
// відрізнити «відмовили через кількість організацій» від «відмовили через
// моє звуження» вона НЕ вміє. Те, що звуження сюди не дістає, доводиться
// інакше — читанням гілки (`sitePropertyId` є `null`, і `AND r.property_id`
// у запит не потрапляє взагалі) і тим, що на однооргній базі цей шлях
// живий: його щодня ходить `useBookingWidget`, який шле `siteId` лише
// `if (siteId)`. Вигадувати тут зелене твердження, яке нічого не розрізняє,
// гірше, ніж назвати межу.
{
  const legacy = await ask(inA);
  assert.strictEqual(legacy.status, 404,
    'на базі з кількома організаціями віджет без ключа сайта мусить відмовити, а не вгадувати готель');
}
console.log('  ok  легасі-віджет без сайта відмовляє на кількох організаціях (межу сцени названо)');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('widget-reservation.scope: сайт віддає бронь свого будинку, чужу — 404');
