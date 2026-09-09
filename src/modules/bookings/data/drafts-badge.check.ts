/**
 * Бейдж чернеток показує те саме число, що й сторінка за кліком.
 *
 *   node src/modules/bookings/data/drafts-badge.check.ts
 *
 * ── Що ламалося ─────────────────────────────────────────────────────────
 *
 * `/api/booking/drafts-count` рахував по ВСЬОМУ рахунку, а сторінка
 * `/app/bookings?status=draft`, куди веде клік, узяла вісь обʼєкта. Готель із
 * двома будинками бачив «7» у бічному меню і три рядки на екрані.
 *
 * Ламала твердження шапки того файла («рахується те саме, що показує сторінка
 * за кліком») не чиясь помилка, а переведення самої сторінки — тобто ця ж
 * робота. Тому лічильник і список живуть в одному файлі й перевіряються одним
 * твердженням.
 *
 * ── Числа ───────────────────────────────────────────────────────────────
 *
 * Чернетки: 2 в А, 3 в Б (сума 5). Жодна сума не дорівнює доданку (§26).
 * Плюс ОДНА чернетка «OTA block» у Б — названий виняток: бейдж її не рахує,
 * сторінка показує. Тому в Б бейдж 3, а список 4: числа РІЗНІ навмисно, і
 * якби виняток зник, обидва стали б 4 — сцена це побачить.
 *
 * Осі тут дві, і кожна має свою пару: область (А проти Б проти «усіх») і
 * виняток (є проти немає). Твердження «бейдж = список» зелене і з віссю, і без
 * неї, якщо перевіряти лише «усі обʼєкти», — тому перевіряються всі три
 * області, і числа в них різні.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-drafts-badge-'));
process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { runWithOrganization } = await import('@core/auth/tenant-context.ts');
const { seedTwoProperties, seedNeighbourOrganization } = await import('@core/fixtures/two-properties.ts');
const { ALL_PROPERTIES, oneProperty } = await import('@core/property-scope.ts');
const { countDraftsOf, listReservationRows } = await import('./lists.repo.ts');

const sql = getSql();
const fx = await seedTwoProperties();
const neighbour = await seedNeighbourOrganization();

const guest = async (id: string, organizationId: string, first: string, last: string) =>
  sql.run('INSERT INTO guests (id, organization_id, first_name, last_name) VALUES (?, ?, ?, ?)',
    [id, organizationId, first, last]);
await guest('d_guest', fx.organizationId, 'Draft', 'Guest');
await guest('d_block', fx.organizationId, 'OTA', 'Block');
await guest('n_guest', neighbour.organizationId, 'N', 'N');

const draft = async (id: string, organizationId: string, propertyId: string, unitId: string, guestId: string) =>
  sql.run(
    `INSERT INTO reservations (id, organization_id, property_id, unit_id, guest_id,
                               check_in, check_out, nights, adults, status, currency)
     VALUES (?, ?, ?, ?, ?, '2026-12-01', '2026-12-02', 1, 2, 'draft',
             (SELECT default_currency FROM organizations WHERE id = ?))`,
    [id, organizationId, propertyId, unitId, guestId, organizationId],
  );

// А — 2 чернетки, Б — 3, і ОДНА фальшива з каналу в Б (гість «OTA Block»).
await draft('dr_a1', fx.organizationId, fx.a.id, fx.a.unitIds[0], 'd_guest');
await draft('dr_a2', fx.organizationId, fx.a.id, fx.a.unitIds[1], 'd_guest');
for (const i of [0, 1, 2]) {
  await draft(`dr_b${i}`, fx.organizationId, fx.b.id, fx.b.unitIds[i], 'd_guest');
}
await draft('dr_b_block', fx.organizationId, fx.b.id, fx.b.unitIds[3], 'd_block');
// Сусід — своя чернетка: без осі орендаря твердження порожнє.
await draft('dr_n1', neighbour.organizationId, neighbour.propertyId, neighbour.unitIds[0], 'n_guest');

const draftsOnPage = async (organizationId: string, scope: Parameters<typeof countDraftsOf>[1]) =>
  (await listReservationRows(organizationId, scope, new URLSearchParams({ status: 'draft' }))).length;

await runWithOrganization(fx.organizationId, async () => {
  const org = fx.organizationId;

  // ─── Бейдж іде тією самою віссю, що й сторінка ───────────────────────────
  for (const [name, scope, badge, page] of [
    ['обʼєкт А', oneProperty(fx.a.id), 2, 2],
    ['обʼєкт Б', oneProperty(fx.b.id), 3, 4],   // 4 — зі сторінки видно й OTA-блок
    ['усі обʼєкти', ALL_PROPERTIES, 5, 6],
  ] as const) {
    assert.strictEqual(await countDraftsOf(org, scope), badge,
      `бейдж для «${name}» мав показати ${badge}`);
    assert.strictEqual(await draftsOnPage(org, scope), page,
      `сторінка для «${name}» мала показати ${page} рядків`);
  }
  console.log('  ok  бейдж 2/3/5 і сторінка 2/4/6 — одна вісь, різниця рівно на названий виняток');

  // ─── Названий виняток — окремим числом ───────────────────────────────────
  //
  // Якби він зник, бейдж обʼєкта Б став би 4 і зрівнявся зі сторінкою; сцена
  // впала б на першому ж рядку вище. Тут стверджується сам виняток: рівно одна
  // чернетка, яку бейдж не рахує, і вона в обʼєкті Б.
  assert.strictEqual(
    (await draftsOnPage(org, oneProperty(fx.b.id))) - (await countDraftsOf(org, oneProperty(fx.b.id))), 1,
    'бейдж мав пропустити рівно одну фальшиву бронь каналу');
  assert.strictEqual(
    (await draftsOnPage(org, oneProperty(fx.a.id))) - (await countDraftsOf(org, oneProperty(fx.a.id))), 0,
    'в обʼєкті А фальшивих броней немає — різниці бути не мало');

  // ─── Чужий обʼєкт нашою організацією — нуль ──────────────────────────────
  assert.strictEqual(await countDraftsOf(org, oneProperty(neighbour.propertyId)), 0,
    'бейдж порахував чернетки чужого обʼєкта');
});

// Вісь орендаря з другого боку.
await runWithOrganization(neighbour.organizationId, async () => {
  assert.strictEqual(await countDraftsOf(neighbour.organizationId, ALL_PROPERTIES), 1,
    'сусід побачив не свої чернетки');
});

console.log('  ok  виняток рівно один і саме в Б; чужий обʼєкт — 0; сусід — 1 своя');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('drafts-badge: бейдж і сторінка рахують одну вісь');
