/**
 * Календар сайту рахує фонд СВОГО будинку — і день без вільних кімнат зайнятий.
 *
 *   node src/modules/widget/api/widget-calendar.scope.check.ts
 *
 * ── Що ламалося ─────────────────────────────────────────────────────────
 *
 * Публічний календар віджета бере фонд із `site_listings` — списку номерів,
 * які продає цей сайт, — і рахує статус дня як «скільки з фонду зайнято».
 * Обʼєкт при цьому визначався **першим номером списку**:
 *
 *     const u = await sql.row('SELECT property_id FROM units WHERE id = ?',
 *                             [siteUnitIds[0]]);
 *
 * Тобто на списку з двох будинків будинок календаря вирішував ПОРЯДОК рядків
 * — рівно те, про що AGENTS §7: «твердження про рядок, якого може бути
 * кілька, пишеться про КІЛЬКІСТЬ, а не про значення першого знайденого».
 *
 * **І наслідок не косметичний.** Фонд у `totalCount` теж брався зі всього
 * списку. Сайт будинку А, у чиєму списку лежить номер будинку Б, показує
 * гостю фонд ДВА — і в день, коли єдиний номер цього сайта вже проданий,
 * календар малює «частково вільно». Гість бачить вільний день там, де
 * продавати нема чого.
 *
 * ── Звідки в списку взагалі чужий номер ─────────────────────────────────
 *
 * Сьогодні — нізвідки: писач (`booking-sites/[id]/listings`) звіряє
 * `u.property_id = site.property_id` від INC-034, а `booking_sites.property_id`
 * не міняє жоден `UPDATE`. Але рядки, записані ДО INC-034 (09.09.2026), у
 * базі лежать, і жодна міграція їх не переглядала. Саме їх і обороняє вісь у
 * читачі; фікстура кладе такий рядок прямо, бо саме так він і виглядає.
 *
 * ── Числа фікстури (інваріант 26) ───────────────────────────────────────
 *
 * Один номер у будинку А, один у будинку Б, і **чужий стоїть у списку
 * ПЕРШИМ** — інакше «беремо перший» і «беремо будинок сайта» дали б той
 * самий результат, і сцена була б зелена в обох світах.
 *
 * Свій номер зайнятий на 2027-04-10. Правильна відповідь на цей день —
 * `booked` (1 з 1), неправильна — `partial` (1 з 2). Два різні слова, а не
 * два різні числа: підмінити одне одним не можна.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-widget-cal-'));
process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { runWithOrganization } = await import('@core/auth/tenant-context.ts');
const { seedTwoProperties } = await import('@core/fixtures/two-properties.ts');
const { getWidgetCalendar } = await import('./widget-calendar-public.handlers.ts');

const sql = getSql();
const fx = await seedTwoProperties();

const SITE = '__wc__site';
const OWN_UNIT = fx.a.unitIds[0];
const ALIEN_UNIT = fx.b.unitIds[0];
const DAY = '2027-04-10';

await runWithOrganization(fx.organizationId, async () => {
  await sql.run(
    `INSERT INTO booking_sites (id, organization_id, property_id, name, slug, status)
     VALUES (?, ?, ?, 'Cal', 'cal-site', 'active')`,
    [SITE, fx.organizationId, fx.a.id]);

  // ЧУЖИЙ ПЕРШИМ: так рядок ляже раніше і його підхопить «беремо перший».
  // Це рядок спадку — писач такого вже не пише (INC-034).
  for (const [i, unitId] of [ALIEN_UNIT, OWN_UNIT].entries()) {
    await sql.run(
      'INSERT INTO site_listings (id, site_id, unit_id, sort_order) VALUES (?, ?, ?, ?)',
      [`${SITE}_l_${i}`, SITE, unitId, i]);
  }

  // Єдиний номер, який цей сайт справді продає, — зайнятий.
  await sql.run(
    `INSERT INTO reservations (id, organization_id, property_id, unit_id, guest_id,
                               check_in, check_out, nights, adults, status, payment_status,
                               source, total_price, currency)
     VALUES (?, ?, ?, ?, '__two_props__guest', ?, '2027-04-12', 2, 2, 'confirmed', 'unpaid',
             'direct', 1000, 'EUR')`,
    ['__wc__res', fx.organizationId, fx.a.id, OWN_UNIT, DAY]);
});

/** Календар як його бачить гість: рядок запиту, без сесії. */
const calendar = async (query: string) => {
  const res = await getWidgetCalendar(
    { url: `http://probe/api/widget/calendar?${query}` } as never);
  return await res.json() as { days?: { date: string; status: string }[]; error?: string };
};

try {
  const body = await calendar(`siteId=${SITE}&month=2027-04`);
  assert.ok(body.days, `календар не відповів: ${JSON.stringify(body)}`);
  const day = body.days!.find((d) => d.date === DAY);
  assert.ok(day, `у відповіді немає ${DAY}`);

  assert.strictEqual(day!.status, 'booked',
    `єдиний номер цього сайта зайнятий, тож день мав бути 'booked'; '${day!.status}' означає, `
    + 'що у фонд сайта порахували номер СУСІДНЬОГО будинку');
  console.log('  ok  фонд сайта — лише його будинок: зайнятий день є зайнятим');

  // Дзеркало: сусідній день вільний. Без нього твердження вище було б зелене
  // й на реалізації, яка малює 'booked' кожен день.
  const free = body.days!.find((d) => d.date === '2027-04-20');
  assert.strictEqual(free?.status, 'available',
    `день без броней мав лишитись вільним, а не '${free?.status}'`);
  console.log('  ok  день без броней лишається вільним (контроль)');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('widget-calendar.scope: календар сайту рахує фонд свого будинку');
