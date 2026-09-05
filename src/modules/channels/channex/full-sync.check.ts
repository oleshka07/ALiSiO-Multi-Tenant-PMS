/**
 * Повний синк (П5): весь стан — у чергу одним діапазоном на адресата, один
 * прохід, рівно два виклики, дата лише коли все поїхало.
 *
 * Лежить у теці адаптера, бо ганяє СПРАВЖНІЙ клієнт із підставленим
 * транспортом (як `ari-adapter.check.ts`): черга й дата — з `data/full-sync.ts`,
 * виклики — з того боку. Перевірка в `data/` не має права знати вендора (И1).
 *
 *   node src/modules/channels/channex/full-sync.check.ts
 *
 * Що стверджується:
 *
 *   рядки    — один на змаплений тип і один на змаплену пару, від сьогодні до
 *              горизонту (500 ночей); повтор не подвоює (індекс злиття);
 *              незмаплений тип нічого не отримує; каталог не заведено — відмова;
 *   виклики  — справжній клієнт із підставленим транспортом: рівно ДВА
 *              виклики на 2 типи × 2 тарифи × 500 ночей — по одному на смугу,
 *              бо батчер стискає діапазони і тіло вміщає все; розписки — по
 *              одній на смугу; черга після проходу порожня;
 *   дата     — `last_full_sync_at` ставиться лише коли ніщо не повернулось у
 *              чергу: після 429 дата лишається порожньою, рядки — в черзі;
 *   чуже     — інший орендар не робить повний синк чужого зʼєднання.
 *
 * Без цін і без цінових таблиць навмисно (інваріант 16): координата ціни
 * без джерела розвʼязується в «закрито» — смуга цін тут теж ходить, лише без
 * числа. Що з ЦІНАМИ це все одно один виклик на смугу, доводить сцена в
 * `domain/ari-batch.check.ts` (500 ночей, різна ціна щодня).
 *
 * Перевірка була ЧЕРВОНОЮ — зламом `runFullSync` (дата ставилась і при
 * поверненні в чергу). Інваріант 24.
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';

const { runWithOrganization } = await import('@core/auth/tenant-context');
const { getSql } = await import('@core/db/async');
const { enqueueFullSync, runFullSync } = await import('../data/full-sync.ts');
const { ariFlush } = await import('./ari-adapter.ts');
const { ChannexRateLimiter } = await import('./limiter.ts');
const { queuedChanges, pendingCount, OUTBOX_HORIZON_DAYS } = await import('../data/outbox.repo.ts');
const { connectionInTenant } = await import('../data/connections.repo.ts');
const { addDays } = await import('../data/outbox-notes.ts');

const sql = getSql();
const ORG = '__full_sync__';
const OTHER = '__full_sync_other__';
const PROP = `${ORG}_prop`;
const DBL = `${ORG}_dbl`;
const SGL = `${ORG}_sgl`;
const LONE = `${ORG}_lone`;
const BAR = `${ORG}_bar`;
const BB = `${ORG}_bb`;
const CONN = `${ORG}_conn`;
const BARE = `${ORG}_bare`;
const TODAY = '2027-03-01';
const HORIZON = addDays(TODAY, OUTBOX_HORIZON_DAYS - 1);

async function cleanup() {
  await sql.run('DELETE FROM cm_outbox WHERE organization_id IN (?, ?)', [ORG, OTHER]);
  await sql.run('DELETE FROM cm_mappings WHERE organization_id = ?', [ORG]);
  await sql.run('DELETE FROM cm_connections WHERE organization_id = ?', [ORG]);
  await sql.run('DELETE FROM rate_plans WHERE property_id = ?', [PROP]);
  await sql.run('DELETE FROM units WHERE property_id = ?', [PROP]);
  await sql.run('DELETE FROM unit_types WHERE property_id = ?', [PROP]);
  await sql.run('DELETE FROM categories WHERE property_id = ?', [PROP]);
  await sql.run('DELETE FROM properties WHERE organization_id = ?', [ORG]);
  await sql.run('DELETE FROM organizations WHERE id IN (?, ?)', [ORG, OTHER]);
}

/** Два типи з номерами, два тарифи, змаплені пари; третій тип — без дзеркала. */
async function seed() {
  await sql.run('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)', [ORG, ORG, ORG]);
  await sql.run('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)', [OTHER, OTHER, OTHER]);
  await runWithOrganization(ORG, async () => {
    await sql.run('INSERT INTO properties (id, organization_id, name, slug) VALUES (?, ?, ?, ?)', [PROP, ORG, ORG, PROP]);
    await sql.run('INSERT INTO categories (id, property_id, name, type) VALUES (?, ?, ?, ?)', [`${ORG}_cat`, PROP, 'Rooms', 'rooms']);
    const types: [string, string, number, string[]][] = [
      [DBL, 'DBL', 2, ['101', '102']],
      [SGL, 'SGL', 1, ['201']],
      [LONE, 'LONE', 1, ['301']],
    ];
    for (const [id, code, max, units] of types) {
      await sql.run(
        `INSERT INTO unit_types (id, property_id, category_id, name, code,
                                 max_adults, max_children, max_occupancy, base_occupancy, is_active, bookable_online)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, TRUE, TRUE)`,
        [id, PROP, `${ORG}_cat`, code, code, max, max, max],
      );
      for (const u of units) {
        await sql.run(
          `INSERT INTO units (id, property_id, unit_type_id, category_id, name, code, is_active)
           VALUES (?, ?, ?, ?, ?, ?, TRUE)`,
          [`${id}_u${u}`, PROP, id, `${ORG}_cat`, u, u],
        );
      }
    }
    for (const [id, code] of [[BAR, 'BAR'], [BB, 'BB']]) {
      await sql.run(
        `INSERT INTO rate_plans (id, property_id, name, code, currency, is_active, is_hidden, priority)
         VALUES (?, ?, ?, ?, 'EUR', TRUE, FALSE, 0)`,
        [id, PROP, code, code],
      );
    }
    await sql.run(
      `INSERT INTO cm_connections (id, organization_id, property_id, provider, environment,
                                   webhook_token, webhook_secret, is_enabled, remote_property_id)
       VALUES (?, ?, ?, 'channex', 'staging', ?, ?, TRUE, ?)`,
      [CONN, ORG, PROP, `tok_${ORG}`, `sec_${ORG}`, 'remote-prop'],
    );
    // Зʼєднання без обʼєкта на тому боці — каталог ще не заведено.
    await sql.run(
      `INSERT INTO cm_connections (id, organization_id, property_id, provider, environment,
                                   webhook_token, webhook_secret, is_enabled, remote_property_id)
       VALUES (?, ?, ?, 'channex', 'production', ?, ?, TRUE, NULL)`,
      [BARE, ORG, PROP, `tok2_${ORG}`, `sec2_${ORG}`],
    );
    const mirror: [string, string, string, number, string][] = [
      ['unit_type', DBL, '', 0, 'remote-dbl'],
      ['unit_type', SGL, '', 0, 'remote-sgl'],
    ];
    for (const rp of [BAR, BB]) {
      for (const [ut, occ] of [[DBL, 2], [SGL, 1]] as [string, number][]) {
        mirror.push(['rate_plan', rp, ut, 0, `remote-${rp}-${ut}`]);
        mirror.push(['rate_plan_option', rp, ut, occ, `remote-${rp}-${ut}`]);
      }
    }
    for (const [entityType, localId, unitTypeId, occupancy, remoteId] of mirror) {
      await sql.run(
        `INSERT INTO cm_mappings (id, organization_id, connection_id, entity_type, local_id, unit_type_id, occupancy, remote_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [`${CONN}_m_${entityType}_${localId}_${unitTypeId}_${occupancy}`, ORG, CONN, entityType, localId, unitTypeId, occupancy, remoteId],
      );
    }
  });
}

/** Транспорт: відповідь на виклик за шляхом; записує шлях і тіло. */
function transport(reply: (path: string, n: number) => { status: number; body: unknown }) {
  const calls: { path: string; body: any }[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : null });
    const r = reply(path, calls.length);
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
  };
  return { calls, fetch: fetch as unknown as typeof globalThis.fetch };
}
const OK = (n: number) => ({ status: 200, body: { data: [{ id: `task-${n}`, type: 'task' }], meta: { message: 'Success' } } });
const TOO_MANY = { status: 429, body: { errors: { code: 'http_too_many_requests', title: 'Too Many Requests' } } };

await cleanup();
await seed();

try {
  await runWithOrganization(ORG, async () => {
    // ── 1. У чергу: один діапазон на тип і на пару, до горизонту, без подвоєнь ─
    {
      const plan = await enqueueFullSync(CONN, TODAY);
      assert.deepStrictEqual(plan, { from: TODAY, to: HORIZON, unitTypes: 2, pairs: 4 }, 'два змаплені типи, чотири змаплені пари; третій тип без дзеркала — нічого');
      const rows = await queuedChanges(CONN);
      assert.strictEqual(rows.length, 6, 'шість рядків, не 500 × 6 координат');
      assert.ok(rows.every((r) => r.date === TODAY && r.dateTo === HORIZON), 'кожен — від сьогодні до горизонту включно');
      assert.ok(!rows.some((r) => r.unitTypeId === LONE), 'незмаплений тип координати не отримує — нема кому адресувати');
      await enqueueFullSync(CONN, TODAY);
      assert.strictEqual((await queuedChanges(CONN)).length, 6, 'повтор не подвоює — індекс злиття тримає координату');
      console.log('  ok  у чергу — шість діапазонів на 500 ночей, повтор без подвоєнь, незмаплене без рядка');
    }

    // ── 2. Один прохід — рівно два виклики, розписки, дата ──────────────
    {
      const t = transport((_path, n) => OK(n));
      const report = await runFullSync(CONN, (id) => ariFlush(id, 'key', { today: TODAY, client: { fetch: t.fetch, limiter: new ChannexRateLimiter() } }), TODAY);
      assert.strictEqual(t.calls.length, 2, `рівно два виклики на 2 типи × 2 тарифи × 500 ночей, а не ${t.calls.length}`);
      assert.deepStrictEqual(t.calls.map((c) => c.path).sort(), ['/api/v1/availability', '/api/v1/restrictions'], 'по одному на смугу');
      const availability = t.calls.find((c) => c.path.endsWith('/availability'))!.body.values;
      const rates = t.calls.find((c) => c.path.endsWith('/restrictions'))!.body.values;
      assert.strictEqual(availability.length, 2, 'наявність стала — один діапазон на тип');
      assert.strictEqual(rates.length, 4, 'без джерела ціни всі ночі закриті — один діапазон на пару');
      // Блок 0.5 п.2 (лист Channex 05.09, Б2): повний синк без базового рядка
      // мусить нести ВСІ чотири обмеження явними дефолтами — інакше 576/576
      // значень їдуть без них, і вендор відхиляє тест 1.
      for (const v of rates) {
        for (const k of ['min_stay_arrival', 'max_stay', 'closed_to_arrival', 'closed_to_departure']) {
          assert.ok(k in v, `повний синк без базового рядка не несе ${k}: ${JSON.stringify(v)}`);
        }
        assert.strictEqual(v.min_stay_arrival, 1, 'мінімум без рядка — 1 явно');
        assert.strictEqual(v.max_stay, 0, 'максимум без межі — 0, так читає його вендор (live-fields)');
        assert.strictEqual(v.closed_to_arrival, false);
        assert.strictEqual(v.closed_to_departure, false);
      }
      assert.ok(availability.every((v: any) => v.date_from === TODAY && v.date_to === HORIZON), 'діапазон тіла — весь горизонт');
      assert.strictEqual(report.flush.sent, 6);
      assert.strictEqual(report.flush.failed, 0);
      assert.deepStrictEqual(report.receipts.sort(), ['task-1', 'task-2'], 'по одній розписці на смугу');
      assert.ok(report.completedAt, 'усе поїхало — дата завершення є');
      assert.strictEqual((await connectionInTenant(CONN))?.lastFullSyncAt, report.completedAt, 'дата лягла на зʼєднання');
      assert.strictEqual(await pendingCount(CONN), 0, 'черга після повного синку порожня');
      console.log('  ok  один прохід — рівно два виклики, дві розписки, дата завершення на зʼєднанні');
    }

    // ── 3. Щось повернулось — дати немає, рядки в черзі ───────────────────
    {
      await sql.run('UPDATE cm_connections SET last_full_sync_at = NULL WHERE id = ? AND organization_id = ?', [CONN, ORG]);
      const t = transport(() => TOO_MANY);
      const report = await runFullSync(CONN, (id) => ariFlush(id, 'key', { today: TODAY, client: { fetch: t.fetch, limiter: new ChannexRateLimiter(), sleep: async () => {} } }), TODAY);
      assert.ok(report.flush.failed > 0, '429 — координати повернулись');
      assert.strictEqual(report.completedAt, null, 'половина стану — не повний синк: дати немає');
      assert.strictEqual((await connectionInTenant(CONN))?.lastFullSyncAt, null, 'на зʼєднанні дата не зʼявилась');
      assert.strictEqual(await pendingCount(CONN), 6, 'усі шість чекають наступного проходу');
      console.log('  ok  повернуте в чергу не робить синк завершеним — дати немає, рядки чекають');
      await sql.run('DELETE FROM cm_outbox WHERE organization_id = ?', [ORG]);
    }

    // ── 4. Каталог не заведено — відмова, не порожній синк ───────────────
    await assert.rejects(() => enqueueFullSync(BARE, TODAY), /catalog not synced/, 'без обʼєкта на тому боці адресувати нема куди');
    console.log('  ok  зʼєднання без обʼєкта — відмова з назвою');
  });

  // ── 5. Чужий орендар ────────────────────────────────────────────────────
  await runWithOrganization(OTHER, async () => {
    await assert.rejects(() => enqueueFullSync(CONN, TODAY), /connection not found/, 'чуже зʼєднання для іншого орендаря не існує (інваріант 5)');
    console.log('  ok  чужий орендар — «немає такого»');
  });
} finally {
  await cleanup();
}

console.log('full-sync: шість діапазонів на 500 ночей, рівно два виклики, дата лише коли все поїхало');
