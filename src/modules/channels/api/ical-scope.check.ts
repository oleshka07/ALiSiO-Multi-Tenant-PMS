/**
 * iCal-канал живе в ОДНОМУ будинку — і номер, і бронь, і список на екрані.
 *
 *   node src/modules/channels/api/ical-scope.check.ts
 *
 * ── Той самий рід, що INC-040, тільки в другому вхідному шляху ──────────
 *
 * Каналів у нас два: менеджер каналів (Channex) і простий iCal-фід, який
 * готель бере в OTA сам. Обидва створюють броні, обидва прив'язані до
 * ОДНОГО будинку (`ical_channels.property_id`), і обидва мали ту саму
 * помилку в основі: ланцюжок доводив, що зʼєднання НАШЕ, і на цьому
 * зупинявся — а «наше» це рахунок, не будинок.
 *
 * ── Три речі, які через це ламались ─────────────────────────────────────
 *
 * **1. Канал заводився на номер сусіднього будинку.** `createIcalChannel`
 * бере `property_id` і `unit_id` окремими полями тіла і не звіряє їх між
 * собою. Далі синк питає `SELECT property_id FROM units WHERE id = ?` і кладе
 * бронь у будинок НОМЕРА — тобто канал будинку А наповнював календар будинку
 * Б. А `export_token` цього ж рядка — перепустка до фіда: хто має посилання,
 * читає заїзди, виїзди й імена гостей без жодної сесії.
 *
 * **2. Синк писав по `external_uid` і по `id` без орендаря взагалі.**
 * `SELECT … FROM reservations WHERE external_uid = ?` і `UPDATE reservations
 * SET check_in = … WHERE id = ?` — ні орендаря, ні будинку. На Postgres чуже
 * ховає політика; на SQLite не ховає ніщо, а SQLite — це вся розробка і
 * майже весь гейт-парк (рід INC-014).
 *
 * **3. Список каналів на екрані показував ОБИДВА будинки.** Разом із
 * токенами експорту і адресами імпорту, які готель отримав у своїх OTA.
 *
 * ── Числа фікстури ──────────────────────────────────────────────────────
 *
 * Два будинки, по номеру в кожному, канал — лише в А. Дати фіда
 * (2026-12-01 → 12-03) і дати планової броні будинку Б (2026-11-01 → 11-03)
 * не мають спільних днів: «не чіпали» і «переписали» — різні числа, а не
 * однакові. Позитивний контроль стоїть першим.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-ical-scope-'));
process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { runWithOrganization } = await import('@core/auth/tenant-context.ts');
const { seedTwoProperties } = await import('@core/fixtures/two-properties.ts');
const { syncChannel } = await import('./ical-sync.handlers.ts');
const { icalChannelsInScope } = await import('./ical-channels.handlers.ts');
const { ALL_PROPERTIES, oneProperty } = await import('@core/property-scope.ts');

const sql = getSql();
const fx = await seedTwoProperties();

/** Номер у кожному будинку: канал чіпляється саме за номер. */
const unitIn = async (propertyId: string, id: string, name: string) => {
  const cat = `${id}_cat`;
  const type = `${id}_type`;
  await runWithOrganization(fx.organizationId, async () => {
    await sql.run('INSERT INTO categories (id, property_id, name, type) VALUES (?, ?, ?, ?)',
      [cat, propertyId, 'Rooms', 'room']);
    await sql.run('INSERT INTO unit_types (id, property_id, category_id, name, code) VALUES (?, ?, ?, ?, ?)',
      [type, propertyId, cat, name, name]);
    await sql.run(
      `INSERT INTO units (id, property_id, unit_type_id, category_id, name, code, is_active)
       VALUES (?, ?, ?, ?, ?, ?, TRUE)`,
      [id, propertyId, type, cat, name, name]);
  });
  return id;
};

const UNIT_A = await unitIn(fx.a.id, '__ics__unit_a', 'A9');
const UNIT_B = await unitIn(fx.b.id, '__ics__unit_b', 'B9');

/** Канал рядком у базі: сцена перевіряє СИНК, а не форму заведення. */
const channel = async (id: string, propertyId: string, unitId: string) => {
  await runWithOrganization(fx.organizationId, async () => {
    await sql.run(
      `INSERT INTO ical_channels (id, organization_id, property_id, channel_type, unit_id,
                                  source_code, ical_url, export_token, sync_interval_minutes, is_active)
       VALUES (?, ?, ?, 'unit', ?, 'airbnb', 'https://probe.invalid/feed.ics', ?, 15, TRUE)`,
      [id, fx.organizationId, propertyId, unitId, `${id}_token`]);
  });
  return { id, property_id: propertyId, unit_id: unitId, channel_type: 'unit',
    source_code: 'airbnb', ical_url: 'https://probe.invalid/feed.ics' };
};

/** Фід замість мережі: справжній клієнт, підставлений транспорт (AGENTS §27). */
const feed = (uid: string, from: string, to: string) => [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT',
  `UID:${uid}`, `DTSTART;VALUE=DATE:${from.replace(/-/g, '')}`,
  `DTEND;VALUE=DATE:${to.replace(/-/g, '')}`, 'SUMMARY:CLOSED - Not available',
  'END:VEVENT', 'END:VCALENDAR',
].join('\r\n');

const realFetch = globalThis.fetch;
const serve = (text: string) => {
  globalThis.fetch = (async () => new Response(text, { status: 200 })) as typeof fetch;
};

const bookingsIn = async (propertyId: string) => Number(((await sql.row<any>(
  'SELECT COUNT(*) AS n FROM reservations WHERE organization_id = ? AND property_id = ?',
  [fx.organizationId, propertyId])) as any).n);

try {
  // ── Контроль: канал свого будинку працює ─────────────────────────────
  //
  // Першим. Без нього все нижче лишалось би зеленим на синку, який не
  // імпортує нічого взагалі.
  const before = { a: await bookingsIn(fx.a.id), b: await bookingsIn(fx.b.id) };
  {
    const own = await channel('__ics__ch_a', fx.a.id, UNIT_A);
    serve(feed('own-1', '2026-12-01', '2026-12-03'));
    const out = await runWithOrganization(fx.organizationId,
      async () => await syncChannel(own, fx.organizationId));
    assert.strictEqual(out.status, 'success', `свій канал мав синкнутись: ${JSON.stringify(out)}`);
    assert.strictEqual(out.events_created, 1, 'подія фіда мала стати бронню');
    assert.strictEqual(await bookingsIn(fx.a.id), before.a + 1, 'бронь мала лягти в будинок А');
    assert.strictEqual(await bookingsIn(fx.b.id), before.b, 'у будинку Б не мало зʼявитись нічого');
  }
  console.log('  ok  канал свого будинку імпортує в свій будинок (контроль)');

  // ── Канал будинку А з номером будинку Б ──────────────────────────────
  //
  // До правки синк питав `SELECT property_id FROM units WHERE id = ?` без
  // будь-якої осі і клав бронь у будинок НОМЕРА: канал А наповнював
  // календар Б.
  {
    const crossed = await channel('__ics__ch_cross', fx.a.id, UNIT_B);
    serve(feed('cross-1', '2026-12-05', '2026-12-07'));
    const mark = { a: await bookingsIn(fx.a.id), b: await bookingsIn(fx.b.id) };
    const out = await runWithOrganization(fx.organizationId,
      async () => await syncChannel(crossed, fx.organizationId));
    assert.strictEqual(out.status, 'error',
      `канал із номером ЧУЖОГО будинку мав відмовити, а не імпортувати: ${JSON.stringify(out)}`);
    assert.match(String((out as any).error), /обʼєкт|будин|property/i,
      `причина відмови має називати будинок: ${JSON.stringify(out)}`);
    assert.strictEqual(await bookingsIn(fx.b.id), mark.b,
      'канал будинку А створив бронь у будинку Б');
    assert.strictEqual(await bookingsIn(fx.a.id), mark.a,
      'і в А теж нічого не мало зʼявитись — відмова не лишає половини');
  }
  console.log('  ok  канал із номером сусіднього будинку — відмова, і жодної броні');

  // ── Зміна дат по `external_uid` не дістає до чужого будинку ──────────
  //
  // `SELECT … WHERE external_uid = ?` і `UPDATE … WHERE id = ?` не мали ні
  // орендаря, ні будинку. Сцена кладе бронь будинку Б з тим `external_uid`,
  // який побудує канал будинку А, і питає, чи вона лишиться цілою.
  {
    const crossed = await channel('__ics__ch_uid', fx.a.id, UNIT_A);
    const uid = `ical_${crossed.id}_shared-1`;
    await runWithOrganization(fx.organizationId, async () => {
      await sql.run(
        `INSERT INTO reservations (id, organization_id, property_id, unit_id, guest_id,
                                   check_in, check_out,
                                   nights, adults, children, status, payment_status, source,
                                   total_price, currency, external_uid)
         VALUES (?, ?, ?, ?, '__two_props__guest', '2026-11-01', '2026-11-03', 2, 2, 0,
                 'confirmed', 'unpaid', 'direct', 500, 'EUR', ?)`,
        ['__ics__res_b', fx.organizationId, fx.b.id, UNIT_B, uid]);
    });

    serve(feed('shared-1', '2026-12-10', '2026-12-12'));
    await runWithOrganization(fx.organizationId,
      async () => await syncChannel(crossed, fx.organizationId));

    const b = await sql.row<any>(
      'SELECT check_in, check_out, property_id FROM reservations WHERE id = ?', ['__ics__res_b']) as any;
    assert.strictEqual(String(b.check_in).slice(0, 10), '2026-11-01',
      'канал будинку А переписав дати броні будинку Б за збігом external_uid');
    assert.strictEqual(String(b.check_out).slice(0, 10), '2026-11-03', 'і дату виїзду теж');
    assert.strictEqual(String(b.property_id), fx.b.id, 'і бронь лишається в своєму будинку');
  }
  console.log('  ok  збіг external_uid у сусідньому будинку не дає переписати чужу бронь');

  // ── Список каналів — обраного будинку, а не рахунку ──────────────────
  //
  // Разом із рядком їде `export_token`: перепустка до фіда, яка сесії не
  // питає. Тому число тут не просто «зайве на екрані».
  {
    await channel('__ics__ch_list_b', fx.b.id, UNIT_B);
    const own = await runWithOrganization(fx.organizationId,
      async () => await icalChannelsInScope(fx.organizationId, oneProperty(fx.a.id)));
    const foreign = own.filter((c: any) => String(c.property_id) !== fx.a.id);
    assert.strictEqual(foreign.length, 0,
      `у списку будинку А канали будинку Б (${foreign.length}), разом із їхніми export_token`);
    assert.ok(own.length >= 3, `канали будинку А мали лишитись у списку, знайдено ${own.length}`);

    const all = await runWithOrganization(fx.organizationId,
      async () => await icalChannelsInScope(fx.organizationId, ALL_PROPERTIES));
    assert.ok(all.length > own.length,
      `«усі обʼєкти» мали дати більше за один будинок: ${all.length} проти ${own.length}`);
  }
  console.log('  ok  список каналів — обраного будинку; «усі» дає більше');
} finally {
  globalThis.fetch = realFetch;
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('ical-scope: канал, номер і бронь — в одному будинку (INC-029)');
