/**
 * Справжній клієнт, підставлений транспорт, автентичні тіла вендора.
 *
 *   node src/modules/channels/channex/ari-adapter.check.ts
 *
 * ── Сходинка, якої бракувало ────────────────────────────────────────────
 *
 * Домен доводить «помилка звільняє захоплення» на заглушці, яка КИДАЄ. Живий
 * прогін 01.09.2026 не дав `429` узагалі (27 викликів за 8 с — staging не
 * тротлить), а бити далі по спільному акаунту — інваріант 25. Між цими двома
 * є третє: справжній `ChannexClient` → справжній `ariFlush` → справжня черга,
 * і лише `fetch` підставлений, з тілом, яке вендор документує дослівно
 * (`rate-limits.md`). Це перевіряє те, чого не міг жоден із двох:
 * розбір помилки В КЛІЄНТІ і звільнення координати В ЧЕРЗІ — одним шляхом,
 * без жодного виклику до вендора.
 *
 * ── Що саме стверджується ───────────────────────────────────────────────
 *
 *   429   → координата назад у чергу зі спробою й причиною; обʼєкт на паузі
 *           (И10 — ключ зʼєднання); БЕЗ негайного повтору: рівно один виклик,
 *           бо повтор через секунду після «забагато» — це ще один 429;
 *   200 + `meta.warnings`, порожній `data` → теж назад (И4);
 *   200 чистий з задачею → відправлено, черга порожня;
 *   500 → повтори з наростанням усередині клієнта, потім пауза й назад.
 *
 * Без цін і без цінових таблиць навмисно (інваріант 16, `check-price-source`):
 * координата ціни без джерела розвʼязується в «закрито» і їде як
 * `stop_sell: true` — тобто смуга цін тут теж ходить, лише без числа.
 *
 * Перевірка була ЧЕРВОНОЮ — зламом адаптера (`release` → `markSent`): рядок
 * зник із черги замість повернутись. Інваріант 24.
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';

const { runWithOrganization } = await import('@core/auth/tenant-context');
const { getSql } = await import('@core/db/async');
const { ariFlush } = await import('./ari-adapter.ts');
const { ChannexRateLimiter } = await import('./limiter.ts');
const { enqueueChange, queuedChanges, pendingCount, stuckChanges } = await import('../data/outbox.repo.ts');

const sql = getSql();
const ORG = '__ari_adapter__';
const PROP = `${ORG}_prop`;
const UT = `${ORG}_ut`;
const RP = `${ORG}_rp`;
const CONN = `${ORG}_conn`;
const DAY = '2027-03-10';

async function cleanup() {
  await sql.run('DELETE FROM cm_outbox WHERE organization_id = ?', [ORG]);
  await sql.run('DELETE FROM cm_mappings WHERE organization_id = ?', [ORG]);
  await sql.run('DELETE FROM cm_connections WHERE organization_id = ?', [ORG]);
  await sql.run('DELETE FROM rate_plans WHERE property_id = ?', [PROP]);
  await sql.run('DELETE FROM units WHERE property_id = ?', [PROP]);
  await sql.run('DELETE FROM unit_types WHERE property_id = ?', [PROP]);
  await sql.run('DELETE FROM categories WHERE property_id = ?', [PROP]);
  await sql.run('DELETE FROM properties WHERE organization_id = ?', [ORG]);
  await sql.run('DELETE FROM organizations WHERE id = ?', [ORG]);
}

/** Готель із заведеним каталогом: обʼєкт на тому боці, тип і пара в дзеркалі. */
async function seed() {
  await sql.run('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)', [ORG, ORG, ORG]);
  await runWithOrganization(ORG, async () => {
    await sql.run('INSERT INTO properties (id, organization_id, name, slug) VALUES (?, ?, ?, ?)', [PROP, ORG, ORG, PROP]);
    await sql.run('INSERT INTO categories (id, property_id, name, type) VALUES (?, ?, ?, ?)', [`${ORG}_cat`, PROP, 'Rooms', 'rooms']);
    await sql.run(
      `INSERT INTO unit_types (id, property_id, category_id, name, code,
                               max_adults, max_children, max_occupancy, base_occupancy, is_active, bookable_online)
       VALUES (?, ?, ?, ?, ?, 2, 0, 2, 2, TRUE, TRUE)`,
      [UT, PROP, `${ORG}_cat`, 'Double', 'DBL'],
    );
    await sql.run(
      `INSERT INTO units (id, property_id, unit_type_id, category_id, name, code, is_active)
       VALUES (?, ?, ?, ?, ?, ?, TRUE)`,
      [`${ORG}_u1`, PROP, UT, `${ORG}_cat`, '101', '101'],
    );
    await sql.run(
      `INSERT INTO rate_plans (id, property_id, name, code, currency, is_active, is_hidden, priority)
       VALUES (?, ?, ?, ?, 'EUR', TRUE, FALSE, 0)`,
      [RP, PROP, 'Best Available', 'BAR'],
    );
    await sql.run(
      `INSERT INTO cm_connections (id, organization_id, property_id, provider, environment,
                                   webhook_token, webhook_secret, is_enabled, remote_property_id)
       VALUES (?, ?, ?, 'channex', 'staging', ?, ?, TRUE, ?)`,
      [CONN, ORG, PROP, `tok_${ORG}`, `sec_${ORG}`, 'remote-prop'],
    );
    const mirror = [
      ['unit_type', UT, '', 0, 'remote-ut'],
      ['rate_plan', RP, UT, 0, 'remote-rp'],
      ['rate_plan_option', RP, UT, 2, 'remote-rp'],
    ];
    for (const [entityType, localId, unitTypeId, occupancy, remoteId] of mirror) {
      await sql.run(
        `INSERT INTO cm_mappings (id, organization_id, connection_id, entity_type, local_id, unit_type_id, occupancy, remote_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [`${ORG}_m_${entityType}_${occupancy}`, ORG, CONN, entityType, localId, unitTypeId, occupancy, remoteId],
      );
    }
  });
}

/** Тіла — дослівно з документації вендора, не з нашої уяви. */
const BODY_429 = { errors: { code: 'http_too_many_requests', title: 'Too Many Requests' } };
const BODY_WARNINGS = {
  data: [],
  meta: { message: 'Success', warnings: [{ rate_plan_id: 'remote-rp', date: DAY, warning: { rate: ['must be greater than 0'] } }] },
};
const BODY_OK = { data: [{ id: 'task-1', type: 'task' }], meta: { message: 'Success' } };
const BODY_500 = { errors: { code: 'internal_error', title: 'Internal Server Error' } };

/** Транспорт: відповідає з черги, записує кожен виклик. */
function transport(replies: { status: number; body: unknown }[]) {
  const calls: { path: string; body: any }[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ path: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    const reply = replies.shift() ?? { status: 200, body: BODY_OK };
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { calls, fetch: fetch as unknown as typeof globalThis.fetch };
}

await cleanup();
await seed();

try {
  await runWithOrganization(ORG, async () => {
    // ── 1. Автентичний 429 → назад у чергу, обʼєкт на паузі, один виклик ──
    {
      await enqueueChange(CONN, { kind: 'availability', unitTypeId: UT, date: DAY });
      const t = transport([{ status: 429, body: BODY_429 }]);
      const limiter = new ChannexRateLimiter();
      const report = await ariFlush(CONN, 'key', { client: { fetch: t.fetch, limiter, sleep: async () => {} } });

      assert.strictEqual(t.calls.length, 1,
        `після 429 мав бути РІВНО один виклик, а не ${t.calls.length}: повтор через секунду після «забагато» — це ще один 429`);
      assert.strictEqual(report.sent, 0, 'нічого не поїхало — і нічого не має рахуватись відправленим');
      assert.strictEqual(report.failed, 1);
      assert.match(report.errors.join(' | '), /429/, 'звіт мусить назвати 429');

      const back = await queuedChanges(CONN);
      assert.strictEqual(back.length, 1, 'координата не повернулась у чергу — вона не поїде НІКОЛИ');
      assert.strictEqual(back[0].attempts, 1, 'спроба не порахована — вічне коло не видно числом');
      assert.match(String(back[0].lastError), /429/, 'причина мусить бути поруч із рядком, а не в журналі сервера');
      assert.match(String(back[0].lastError), /http_too_many_requests/,
        'код вендора мав дійти до рядка: саме він відрізняє «забагато» від «впав»');
      assert.ok(limiter.pausedFor(CONN) > 0, 'обʼєкт мав стати на паузу — ключем зʼєднання (И10)');
      console.log('  ok  автентичний 429: один виклик, координата назад зі спробою й кодом, обʼєкт на паузі');
    }

    // ── 2. Пауза тримає: наступний прохід не йде в мережу, координата чекає ─
    {
      const t = transport([]);
      const limiter = new ChannexRateLimiter();
      limiter.pause(CONN);
      const report = await ariFlush(CONN, 'key', { client: { fetch: t.fetch, limiter } });
      assert.strictEqual(t.calls.length, 0, 'обʼєкт на паузі — жодного виклику');
      assert.strictEqual(report.failed, 1, 'відмова обмежувача — це теж «не поїхало», а не тиша');
      const back = await queuedChanges(CONN);
      assert.strictEqual(back.length, 1);
      assert.strictEqual(back[0].attempts, 2, 'відмова обмежувача теж рахується — інакше пауза стає вічністю без лічильника');
      console.log('  ok  обʼєкт на паузі: у мережу не йде, координата лишається й рахує спробу');
    }

    // ── 3. 200 + meta.warnings, порожній data → назад (И4) ─────────────────
    {
      const t = transport([{ status: 200, body: BODY_WARNINGS }]);
      const report = await ariFlush(CONN, 'key', { client: { fetch: t.fetch } });
      assert.strictEqual(t.calls.length, 1);
      assert.strictEqual(report.sent, 0, '200 із претензіями позначено відправленим — значення не застосоване, канал продає за старим');
      const back = await queuedChanges(CONN);
      assert.strictEqual(back.length, 1, 'після 200 з warnings координата мала лишитись у черзі');
      assert.match(String(back[0].lastError), /claim|must be greater/, 'претензія вендора мала дійти до рядка');
      console.log('  ok  200 OK з warnings — координата назад, претензія на рядку (И4)');
    }

    // ── 4. 500 → повтори всередині клієнта, потім пауза й назад ────────────
    {
      const t = transport([{ status: 500, body: BODY_500 }, { status: 500, body: BODY_500 }, { status: 500, body: BODY_500 }]);
      const limiter = new ChannexRateLimiter();
      const report = await ariFlush(CONN, 'key', { client: { fetch: t.fetch, limiter, sleep: async () => {}, maxAttempts: 3 } });
      assert.strictEqual(t.calls.length, 3, '5xx мав повторитись із наростанням до стелі клієнта');
      assert.strictEqual(report.failed, 1);
      assert.ok(limiter.pausedFor(CONN) > 0, 'після вичерпаних повторів обʼєкт мав стати на паузу');
      assert.strictEqual((await queuedChanges(CONN)).length, 1, 'координата мала повернутись');
      console.log('  ok  500: повтори в клієнті, потім пауза, координата назад');
    }

    // ── 5. Чистий 200 із задачею → відправлено, черга порожня ─────────────
    //
    // Смуга цін тут теж ходить: пара є в дзеркалі, ціни немає — координата
    // розвʼязується в «закрито» і їде як stop_sell: true без rates.
    {
      await enqueueChange(CONN, { kind: 'rate', unitTypeId: UT, ratePlanId: RP, date: DAY });
      const t = transport([{ status: 200, body: BODY_OK }, { status: 200, body: BODY_OK }]);
      const report = await ariFlush(CONN, 'key', { client: { fetch: t.fetch } });
      assert.strictEqual(t.calls.length, 2, 'наявність і ціни — два повідомлення');
      assert.strictEqual(report.sent, 2);
      assert.strictEqual(report.failed, 0);
      assert.strictEqual(await pendingCount(CONN), 0, 'після чистого 200 черга мала спорожніти');
      assert.deepStrictEqual(await stuckChanges(CONN), []);

      const availability = t.calls.find((c) => c.path.endsWith('/availability'))!;
      assert.strictEqual(availability.body.values[0].room_type_id, 'remote-ut', 'наявність адресована чужим id типу з дзеркала');
      assert.strictEqual(availability.body.values[0].availability, 1, 'один номер — одна вільна одиниця, з availabilityByDay()');
      const rates = t.calls.find((c) => c.path.endsWith('/restrictions'))!;
      assert.strictEqual(rates.body.values[0].rate_plan_id, 'remote-rp', 'тариф адресований парою з дзеркала');
      assert.strictEqual(rates.body.values[0].stop_sell, true, 'ціни немає — ніч закрита, не пропущена (И2)');
      assert.ok(!('rates' in rates.body.values[0]), 'у закриту ніч ціна не пишеться — навіть нуль');
      console.log('  ok  чистий 200: обидві смуги поїхали, тіла адресовані дзеркалом, черга порожня');
    }
  });
} finally {
  await cleanup();
}

console.log('ari-adapter: справжній клієнт із підставленим транспортом — 429, warnings, 500 повертають координату; чистий 200 шле');
