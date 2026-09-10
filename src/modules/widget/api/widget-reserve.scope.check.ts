/**
 * Сайт продає номер СВОГО будинку — навіть якщо його список каже інакше.
 *
 *   node src/modules/widget/api/widget-reserve.scope.check.ts
 *
 * ── Чому це не дубль INC-201/INC-202 ────────────────────────────────────
 *
 * Ті двоє — про ЧИТАЧІВ: аналітика рахувала чужу бронь, календар показував
 * чужий фонд. Обидва обороняли рядки `site_listings`, записані ДО INC-034
 * (писач звіряє будинок від 09.09.2026, але старих рядків жодна міграція не
 * переглядала).
 *
 * Тут — ПИСАЧ, і це те місце, де такий рядок ще може народити нову чужу
 * бронь. `widget-reserve` перевіряє, що номер є в списку сайта
 * (`site_listings WHERE site_id = ? AND unit_id = ?`), і на цьому спиняється:
 * чи цей номер у будинку сайта, він не питає. Тобто спадковий рядок списку —
 * не лише крива статистика, а **проданий номер, якого за цією адресою
 * немає**: гість платить, лист приходить, а на рецепції будинку А про цю
 * кімнату не знають.
 *
 * Полагодити читачів і лишити писача означало б і далі створювати те, від
 * чого читачі обороняються.
 *
 * ── Чому 404, а не 403, і чому я спершу чекала іншого ───────────────────
 *
 * Перша редакція цієї сцени чекала 403 — за аналогією з сусідньою перевіркою
 * «номер не в списку цього сайта», яка відповідає саме так. Прогін дав 404, і
 * праве тут НЕ моє очікування: номер чужого будинку — для цього сайта чужий
 * id, а чужий id це **404, не 403** (інваріант 5). Перевірка списку поруч
 * стверджує інше — «номер твій, але цей сайт його не продає», — і 403 там
 * доречний. Два різні стани, дві різні відповіді.
 *
 * ── Числа фікстури (інваріант 26) ───────────────────────────────────────
 *
 * Два будинки, по номеру в кожному, ОБИДВА в списку одного сайта — другий
 * спадковим рядком. Свій номер має забронюватись (інакше сцена була б зелена
 * й на коді, що відмовляє всім), чужий — ні. Два різні статуси, 201 і 404,
 * а не два числа.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-reserve-scope-'));
process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { runWithOrganization } = await import('@core/auth/tenant-context.ts');
const { seedTwoProperties } = await import('@core/fixtures/two-properties.ts');
const { createWidgetReservation } = await import('./widget-reserve.handlers.ts');

const sql = getSql();
const fx = await seedTwoProperties();

const SITE = '__wrs__site';
const OWN_UNIT = fx.a.unitIds[0];
const ALIEN_UNIT = fx.b.unitIds[0];

await runWithOrganization(fx.organizationId, async () => {
  await sql.run(
    `INSERT INTO booking_sites (id, organization_id, property_id, name, slug, status)
     VALUES (?, ?, ?, 'Scope', 'scope-site', 'active')`,
    [SITE, fx.organizationId, fx.a.id]);
  // Обидва в списку: другий — рядок спадку, якого писач уже не пише (INC-034).
  for (const [i, unitId] of [OWN_UNIT, ALIEN_UNIT].entries()) {
    await sql.run(
      'INSERT INTO site_listings (id, site_id, unit_id, price_override) VALUES (?, ?, ?, 1000)',
      [`${SITE}_l_${i}`, SITE, unitId]);
  }
});

let seq = 0;
const handshake = async () => {
  const token = `__wrs__hs_${++seq}`;
  await runWithOrganization(fx.organizationId, async () => {
    await sql.run(
      `INSERT INTO widget_handshakes (token, organization_id, site_id, expires_at)
       VALUES (?, ?, ?, '2099-01-01T00:00:00Z')`,
      [token, fx.organizationId, SITE]);
  });
  return token;
};

const reserve = async (unitId: string, who: string) => {
  const hs = await handshake();
  const res = await createWidgetReservation({
    json: async () => ({
      unitId, checkIn: '2027-05-01', checkOut: '2027-05-03',
      adults: 2, children: 0, firstName: who, lastName: 'Guest',
      email: `${who.toLowerCase()}@example.test`, phone: '+420700000009',
      siteId: SITE,
    }),
    headers: {
      get: (name: string) => (name.toLowerCase() === 'x-handshake-token' ? hs : null),
    },
  } as never);
  return { status: res.status, body: await res.json() as any };
};

try {
  // Контроль: свій номер продається. Без нього все нижче зелене й на коді,
  // який відмовляє кожному бронюванню.
  const own = await reserve(OWN_UNIT, 'Own');
  assert.strictEqual(own.status, 201, `свій номер мав забронюватись: ${JSON.stringify(own.body)}`);
  console.log('  ok  сайт продає номер свого будинку (контроль)');

  const alien = await reserve(ALIEN_UNIT, 'Alien');
  assert.strictEqual(alien.status, 404,
    `сайт будинку А продав номер будинку Б (${alien.status}) — гість заплатив за кімнату, `
    + `якої за цією адресою немає: ${JSON.stringify(alien.body)}`);

  const created = await sql.row<any>(
    'SELECT COUNT(*) AS n FROM reservations WHERE organization_id = ? AND property_id = ?',
    [fx.organizationId, fx.b.id]) as any;
  assert.strictEqual(Number(created.n), fx.b.reservationIds.length,
    'відмова не має лишати броні в чужому будинку');
  console.log('  ok  номер сусіднього будинку зі спадкового рядка списку — 404, і жодної броні');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('widget-reserve.scope: сайт продає номер свого будинку (INC-203)');
