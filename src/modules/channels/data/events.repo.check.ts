/**
 * Сирі події вендора: записати, побачити своє, позначити обробленим — і не чуже.
 *
 *   node src/modules/channels/data/events.repo.check.ts
 *
 * Рядок `cm_events` — це і журнал, і черга: вебхук кладе, прохід стрічки
 * знімає booking-події, решта чекає ока оператора. Тип події — непрозорий
 * текст (імена — справа адаптера, И1); тут він лише ключ групування.
 *
 * Перевірка написана ДО коду і була червоною (інваріант 24).
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';

const { runWithOrganization } = await import('@core/auth/tenant-context');
const { getSql } = await import('@core/db/async');
const { recordEvent, unprocessedEvents, markEventsProcessed } = await import('./events.repo.ts');

const sql = getSql();
const A = '__events__a';
const B = '__events__b';
const CONN = (org: string) => `${org}_conn`;

async function cleanup() {
  for (const org of [A, B]) {
    await sql.run('DELETE FROM cm_events WHERE organization_id = ?', [org]);
    await sql.run('DELETE FROM cm_connections WHERE organization_id = ?', [org]);
    await sql.run('DELETE FROM properties WHERE organization_id = ?', [org]);
    await sql.run('DELETE FROM organizations WHERE id = ?', [org]);
  }
}
async function seed(org: string) {
  await sql.run('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)', [org, org, org]);
  await sql.run('INSERT INTO properties (id, organization_id, name, slug) VALUES (?, ?, ?, ?)', [`${org}_prop`, org, org, `${org}_prop`]);
  await sql.run(
    `INSERT INTO cm_connections (id, organization_id, property_id, provider, environment, webhook_token, webhook_secret, is_enabled)
     VALUES (?, ?, ?, 'probe', 'staging', ?, ?, FALSE)`,
    [CONN(org), org, `${org}_prop`, `tok_${org}`, `sec_${org}`],
  );
}

await cleanup();
await seed(A);
await seed(B);

try {
  // ── Запис іде під названим орендарем; читає лише він ───────────────────
  const ids: string[] = [];
  await runWithOrganization(A, async () => {
    ids.push(await recordEvent({ connectionId: CONN(A), organizationId: A, eventType: 'kind_x', payload: { n: 1 } }));
    ids.push(await recordEvent({ connectionId: CONN(A), organizationId: A, eventType: 'kind_x', payload: { n: 2 } }));
    ids.push(await recordEvent({ connectionId: CONN(A), organizationId: A, eventType: 'kind_y', payload: { n: 3 } }));
  });
  assert.strictEqual(new Set(ids).size, 3, 'три різні ідентифікатори');

  const mine = await runWithOrganization(A, () => unprocessedEvents(CONN(A)));
  assert.strictEqual(mine.length, 3);
  assert.deepStrictEqual(mine.map((e) => e.eventType).sort(), ['kind_x', 'kind_x', 'kind_y']);
  assert.ok(mine.every((e) => typeof e.payload === 'string' && e.payload.includes('"n"')), 'корисне навантаження — сирим рядком JSON');
  assert.ok(mine.every((e) => e.receivedAt), 'час отримання є');
  assert.ok(mine.every((e) => e.processedAt === null), 'нове — необроблене');

  const foreign = await runWithOrganization(B, () => unprocessedEvents(CONN(A)));
  assert.strictEqual(foreign.length, 0, 'чужий орендар не бачить чужих подій навіть за id зʼєднання');
  console.log('  ok  запис під орендарем, читає лише він');

  // ── Позначити обробленим: за типом, за id, і ніколи чуже ────────────────
  const foreignMark = await runWithOrganization(B, () => markEventsProcessed(CONN(A), { eventTypes: ['kind_x'] }));
  assert.strictEqual(foreignMark, 0, 'чужий орендар не позначає чужого');
  assert.strictEqual((await runWithOrganization(A, () => unprocessedEvents(CONN(A)))).length, 3, 'після чужої спроби все як було');

  const byType = await runWithOrganization(A, () => markEventsProcessed(CONN(A), { eventTypes: ['kind_x'] }));
  assert.strictEqual(byType, 2, 'за типом позначено рівно два');
  const left = await runWithOrganization(A, () => unprocessedEvents(CONN(A)));
  assert.deepStrictEqual(left.map((e) => e.eventType), ['kind_y'], 'лишився інший тип');

  const byId = await runWithOrganization(A, () => markEventsProcessed(CONN(A), { ids: [left[0].id] }));
  assert.strictEqual(byId, 1);
  assert.strictEqual((await runWithOrganization(A, () => unprocessedEvents(CONN(A)))).length, 0, 'усе оброблено');

  const again = await runWithOrganization(A, () => markEventsProcessed(CONN(A), { eventTypes: ['kind_x'] }));
  assert.strictEqual(again, 0, 'оброблене вдруге не позначається — лічильник чесний');

  const nothing = await runWithOrganization(A, () => markEventsProcessed(CONN(A), {}));
  assert.strictEqual(nothing, 0, 'порожній фільтр не позначає нічого — «все» треба назвати явно');
  console.log('  ok  позначення за типом і за id, чуже — нуль, повторно — нуль');

  console.log('events: сирий журнал вендора — записаний під орендарем, знятий лише ним');
} finally {
  await cleanup();
}
