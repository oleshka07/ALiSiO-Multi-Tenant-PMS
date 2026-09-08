/**
 * Двері вебхука: токен → орендар, секрет → 401, запис → 200, мережі — нуль.
 *
 *   node src/modules/channels/api/webhook.check.ts
 *
 * ── Чому вебхук — сигнал, а не дані ─────────────────────────────────────
 *
 * Підпису у вендора немає (webhook-collection.md: «do not include a built-in
 * HMAC signature»), лише власний секретний заголовок. Тому тіло вебхука
 * ніколи не є джерелом броні: двері пишуть сирий рядок у `cm_events`,
 * відповідають одразу, а після відповіді будять ТОЙ САМИЙ прохід стрічки,
 * що й крон. Підроблений вебхук з правильним секретом коштує одного зайвого
 * опитування; без секрету — нічого (401, жодної роботи).
 *
 * ── Що тут стверджується ────────────────────────────────────────────────
 *
 *   невідомий токен            → 404, рядка немає
 *   без секрету / чужий секрет → 401, рядка немає, пробудження немає
 *   тіло без `event`           → 400, рядка немає (4xx — вендор не повторює)
 *   усе на місці               → 200 одразу, рядок під ЦИМ орендарем,
 *                                пробудження відкладене ПІСЛЯ відповіді
 *   до відповіді               → жодного виклику fetch (И7)
 *   токен готелю А             → ніколи не дає рядка готелю Б
 *
 * Перевірка написана ДО коду і була червоною (інваріант 24). На Postgres
 * (`npm run check:pg`, роль без суперправ) вона ж доводить, що політика
 * `cm_connections` відкриває рядок за `app.public_token` (міграція 0060):
 * без неї «усе на місці» дає 404 — саме так ця перевірка була червоною.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import '../../../../scripts/lib/module-aliases.mjs';

const { runWithOrganization } = await import('@core/auth/tenant-context');
const { getSql } = await import('@core/db/async');
const { makeWebhookReceiver } = await import('./webhook.handlers.ts');
const { unprocessedEvents } = await import('../data/events.repo.ts');

const sql = getSql();

const A = '__webhook__a';
const B = '__webhook__b';
const CONN = (org: string) => `${org}_conn`;
const TOKEN = (org: string) => `tok_${org}_0123456789abcdef0123456789abcdef`;
const SECRET = (org: string) => `sec_${org}_fedcba9876543210fedcba9876543210`;

/**
 * Той самий `sql`, але завжди в контексті орендаря — як у застосунку.
 *
 * Прямий `sql.*` без орендаря під роллю застосунку (`alisio_app`, FORCE RLS)
 * або відхиляється політикою (запис), або мовчки бачить порожньо (читання):
 * твердження лишається зеленим, нічого не перевіривши (INC-014). Місця, де
 * сцена свідомо стає ІНШИМ орендарем, лишаються явними
 * `runWithOrganization(…)`.
 */
const asOrg = {
  run: (q: string, params?: unknown[]) => runWithOrganization(A, () => sql.run(q, params as any)),
  row: (q: string, params?: unknown[]) => runWithOrganization(A, () => sql.row<any>(q, params as any)),
  rows: (q: string, params?: unknown[]) => runWithOrganization(A, () => sql.rows<any>(q, params as any)),
};

/**
 * Засів і прибирання — В КОНТЕКСТІ ОРЕНДАРЯ, як це робить застосунок.
 *
 * Під роллю застосунку (`alisio_app`, FORCE RLS) запис без орендаря на
 * зʼєднанні політика відхиляє, а видалення мовчки чіпає НУЛЬ рядків — і
 * наступний `DELETE` падає вже на чужому ключі. Під суперкористувачем
 * проходить і те, і те, тому гейт був зелений і про політики не свідчив
 * (INC-014). Рядок `organizations` лишається поза контекстом: ця таблиця
 * орендаря НАЗИВАЄ, політики на ній немає за побудовою.
 */
async function cleanup() {
  for (const org of [A, B]) {
    await runWithOrganization(org, async () => {
      await sql.run('DELETE FROM cm_events WHERE organization_id = ?', [org]);
      await sql.run('DELETE FROM cm_connections WHERE organization_id = ?', [org]);
      await sql.run('DELETE FROM properties WHERE organization_id = ?', [org]);
    });
    await sql.run('DELETE FROM organizations WHERE id = ?', [org]);
  }
}

async function seed(org: string) {
  await sql.run('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)', [org, org, org]);
  await runWithOrganization(org, async () => {
    await sql.run('INSERT INTO properties (id, organization_id, name, slug) VALUES (?, ?, ?, ?)', [`${org}_prop`, org, org, `${org}_prop`]);
    await sql.run(
      `INSERT INTO cm_connections (id, organization_id, property_id, provider, environment, remote_property_id, webhook_token, webhook_secret, is_enabled)
       VALUES (?, ?, ?, 'probe', 'staging', ?, ?, ?, TRUE)`,
      [CONN(org), org, `${org}_prop`, `remote-${org}`, TOKEN(org), SECRET(org)],
    );
  });
}

await cleanup();
await seed(A);
await seed(B);

// ── Двері з підставленими «після відповіді» і «пробудити» ────────────────
const deferred: (() => void | Promise<void>)[] = [];
const woken: { connectionId: string; organizationId: string }[] = [];
const receive = makeWebhookReceiver({
  defer: (fn) => { deferred.push(fn); },
  wake: async (connectionId, organizationId) => { woken.push({ connectionId, organizationId }); },
});

// И7: до відповіді мережі немає. Будь-який fetch тут — провал, і гучний.
const realFetch = globalThis.fetch;
let fetchCalls = 0;
globalThis.fetch = (async () => { fetchCalls++; throw new Error('webhook handler must not touch the network'); }) as typeof fetch;

const AUTHENTIC = { event: 'booking', property_id: 'remote-a', user_id: null, timestamp: '2026-09-02T10:00:00.000Z' };

function post(token: string, options: { secret?: string; body?: unknown; raw?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.secret !== undefined) headers['x-webhook-secret'] = options.secret;
  // `'body' in options`, не `??`: тіло `null` — це теж тіло, і саме його тут шлють.
  const body = options.raw ?? JSON.stringify('body' in options ? options.body : AUTHENTIC);
  return receive(
    new Request(`http://pms.test/api/webhooks/channel-manager/${token}`, { method: 'POST', headers, body }),
    { params: Promise.resolve({ token }) },
  );
}

async function eventsUnder(org: string, connectionId: string) {
  return runWithOrganization(org, () => unprocessedEvents(connectionId));
}

try {
  // ── 1. Невідомий токен — не наш обʼєкт: 404, і хай вендор не повторює ──
  {
    const res = await post('tok_nobody_0000000000000000000000000000', { secret: SECRET(A) });
    assert.strictEqual(res.status, 404, 'невідомий токен — 404');
    assert.strictEqual((await eventsUnder(A, CONN(A))).length, 0);
    assert.strictEqual((await eventsUnder(B, CONN(B))).length, 0);
    assert.strictEqual(woken.length, 0, 'невідомий токен нікого не будить');
  }
  console.log('  ok  невідомий токен → 404, рядка немає');

  // ── 2. Секрет: відсутній, чужий, майже правильний — 401 і жодної роботи ─
  {
    for (const secret of [undefined, SECRET(B), SECRET(A).slice(0, -1), `${SECRET(A)}x`, '']) {
      const res = await post(TOKEN(A), { secret });
      assert.strictEqual(res.status, 401, `секрет «${secret}» мусить дати 401`);
    }
    assert.strictEqual((await eventsUnder(A, CONN(A))).length, 0, 'без секрету рядок не пишеться');
    assert.strictEqual(woken.length, 0, 'без секрету ніхто не прокидається');
    assert.strictEqual(deferred.length, 0, 'без секрету нічого не відкладається на «після відповіді»');
  }
  console.log('  ok  секрет відсутній або чужий → 401, жодної роботи');

  // ── 3. Тіло без події — 400: вендор 4xx не повторює, і правильно ────────
  {
    for (const body of [{}, { event: 42 }, [], null]) {
      const res = await post(TOKEN(A), { secret: SECRET(A), body });
      assert.strictEqual(res.status, 400, `тіло ${JSON.stringify(body)} мусить дати 400`);
    }
    const res = await post(TOKEN(A), { secret: SECRET(A), raw: '<html>not json' });
    assert.strictEqual(res.status, 400, 'не-JSON — 400');
    assert.strictEqual((await eventsUnder(A, CONN(A))).length, 0, 'криве тіло не пишеться');
    assert.strictEqual(woken.length, 0);
  }
  console.log('  ok  тіло без події або не JSON → 400, рядка немає');

  // ── 4. Усе на місці: 200 одразу, рядок під А, пробудження — після ───────
  {
    const res = await post(TOKEN(A), { secret: SECRET(A) });
    assert.strictEqual(res.status, 200, 'справжній вебхук — 200');
    assert.deepStrictEqual(await res.json(), { ok: true });

    const underA = await eventsUnder(A, CONN(A));
    assert.strictEqual(underA.length, 1, 'один рядок під орендарем А');
    assert.strictEqual(underA[0].eventType, 'booking');
    assert.ok(underA[0].payload.includes('remote-a'), 'сирий рядок збережено як є');
    assert.strictEqual((await eventsUnder(B, CONN(B))).length, 0, 'у Б нічого');

    assert.strictEqual(woken.length, 0, 'до відповіді ніхто не прокидається — робота йде ПІСЛЯ');
    assert.strictEqual(deferred.length, 1, 'рівно одне «після відповіді»');
    await deferred.shift()!();
    assert.deepStrictEqual(woken, [{ connectionId: CONN(A), organizationId: A }],
      'після відповіді будиться прохід стрічки САМЕ цього зʼєднання, під його орендарем');
    assert.strictEqual(fetchCalls, 0, 'И7: двері не ходили в мережу жодного разу');
  }
  console.log('  ok  усе на місці → 200 одразу, рядок під орендарем, прохід стрічки після відповіді');

  // ── 4а. Дані гостя в тілі — у журнал не потрапляють ──────────────────
  //
  // `send_data: false` — наше налаштування в ЧУЖІЙ панелі. Двері на нього не
  // покладаються: зберігається лише конверт сигналу, а те, що вендор прислав
  // понад нього, відкидається і називається.
  {
    const res = await post(TOKEN(A), { secret: SECRET(A), body: {
      ...AUTHENTIC,
      payload: { booking_id: 'b-1', customer: { name: 'Olena Guest', mail: 'olena.guest@example.test', phone: '+420000000000' } },
    } });
    assert.strictEqual(res.status, 200);
    // Не `.at(-1)`: два рядки в одну секунду впорядковані лише за випадковим id.
    // Шукається рядок, у якому відкинуте названо, — і перевіряються ВСІ рядки.
    const all = await eventsUnder(A, CONN(A));
    const stripped = all.find((e) => e.payload.includes('dropped_fields'));
    assert.ok(stripped, 'відкинуте названо — видно, що вендор шле більше, ніж просили');
    assert.ok(stripped.payload.includes('"payload"'), 'названо саме те поле, яке відкинуто');
    for (const e of all) {
      for (const pii of ['Olena', 'olena.guest@example.test', '+420000000000', 'b-1']) {
        assert.ok(!e.payload.includes(pii), `у журналі не має бути «${pii}»: конверт сигналу — і нічого поза ним`);
      }
    }
    assert.ok(stripped.payload.includes('remote-a') && stripped.payload.includes('"event":"booking"'), 'конверт лишився');
    await deferred.shift()!();
  }
  console.log('  ok  дані гостя в тілі відкидаються і називаються; журнал тримає лише конверт');

  // ── 5. Повторна доставка — другий рядок: журнал сирий, дедуплікація — у стрічці
  {
    await post(TOKEN(A), { secret: SECRET(A) });
    assert.strictEqual((await eventsUnder(A, CONN(A))).length, 3, 'повтор доставки — ще один сирий рядок, не помилка');
    await deferred.shift()!();
  }
  console.log('  ok  повторна доставка лягає другим сирим рядком');

  // ── 6. Токен Б з секретом Б — рядок Б; токен А ніколи не пише в Б ───────
  {
    const res = await post(TOKEN(B), { secret: SECRET(B), body: { event: 'booking', property_id: 'remote-b', user_id: null, timestamp: '2026-09-02T10:01:00.000Z' } });
    assert.strictEqual(res.status, 200);
    const underB = await eventsUnder(B, CONN(B));
    assert.strictEqual(underB.length, 1, 'рядок Б під орендарем Б');
    assert.strictEqual((await eventsUnder(A, CONN(A))).length, 3, 'у А як було');
    // Чужий id зʼєднання під чужим орендарем не читається взагалі.
    assert.strictEqual((await eventsUnder(B, CONN(A))).length, 0, 'події А під орендарем Б — порожньо');
    assert.strictEqual((await eventsUnder(A, CONN(B))).length, 0, 'події Б під орендарем А — порожньо');
    await deferred.shift()!();
    assert.strictEqual(woken.at(-1)!.organizationId, B);
  }
  console.log('  ok  токен готелю Б будить Б; чужі події не читаються');

  // ── 7. И7 статично: файл дверей імпортує лише те, чому мережа не потрібна
  //
  // Дозволений список замість забороненого: ядро, node, каркас, дані модуля
  // і прохід стрічки (він і є «після відповіді»). Адаптер вендора і шов
  // провайдерів сюди не входять — і ніяке нове імʼя не проскочить мовчки.
  {
    const src = fs.readFileSync(new URL('./webhook.handlers.ts', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const allowed = [/^node:/, /^next\//, /^@core\//, /^\.\.\/data\//, /^\.\/pull-cron\.handlers$/];
    const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    assert.ok(imports.length >= 5, `імпорти дверей не розібрались: ${imports.join(', ')}`);
    for (const spec of imports) {
      assert.ok(allowed.some((re) => re.test(spec)), `двері імпортують «${spec}» — це не дані і не ядро; мережа дверям не потрібна`);
    }
    assert.ok(!/\bfetch\s*\(/.test(src), 'у дверях немає fetch(');
  }
  console.log('  ok  И7 статично: двері імпортують лише ядро, дані модуля і прохід стрічки');

  console.log('webhook: сигнал, не дані — токен відкриває рядок, секрет відкриває двері, робота йде після відповіді');
} finally {
  globalThis.fetch = realFetch;
  await cleanup();
}
