/**
 * Реєстрація вебхука у вендора: тіло дослівне, прочитане назад, ідемпотентне.
 *
 *   node src/modules/channels/channex/webhook-adapter.check.ts
 *
 * ── Три факти з webhook-collection.md, і кожен тут твердження ────────────
 *
 *   1. Підпису немає — лише власний заголовок у `headers`. Отже `send_data:
 *      false`: вебхук — сигнал, а не дані; тіло броні не приймається на віру.
 *   2. `is_active` і `send_data` за замовчуванням `false`. Створений без
 *      явного `is_active: true` існує і мовчить. Тому твердження — на
 *      ПРОЧИТАНЕ НАЗАД значення, не на факт створення; мовчазний вебхук
 *      адаптер лагодить PUT-ом, а якщо й після цього мовчить — відмовляє.
 *   3. `POST /webhooks/test` — вендор сам стукає в наші двері і віддає наш
 *      код і тіло: читання назад для И27 без справжньої броні.
 *
 * Плюс вимоги власника (02.09.2026): ідемпотентність через
 * `remote_webhook_id`; секрет на зʼєднання, довгий, змінюваний (спершу
 * вендор, потім база — інакше база впевнена в секреті, якого вендор не знає);
 * видалення прибирає вебхук у вендора, щоб в акаунті готельєра не збирались
 * мертві виклики. І `ari` у масці немає: власна луна (И9) сюди не ходить.
 *
 * Перевірка написана ДО коду і була червоною (інваріант 24).
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';
import { startMockChannex } from './mock-server.ts';

const { runWithOrganization } = await import('@core/auth/tenant-context');
const { getSql } = await import('@core/db/async');
const { ensureWebhook, rotateWebhookSecret, removeWebhook, testWebhook, classifyEvent, WEBHOOK_EVENT_MASK } = await import('./webhook-adapter.ts');

const sql = getSql();
const mock = await startMockChannex();
const A = '__whadapter__a';
const B = '__whadapter__b';
const CONN = `${A}_conn`;
const TOKEN = 'tok_a_0123456789abcdef0123456789abcdef';
const SECRET = 'sec_a_fedcba9876543210fedcba9876543210';
const KEY = 'api-key-a';
const client = { baseUrl: mock.url, maxAttempts: 1, sleep: async () => {} };

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
}
await cleanup();
await seed(A);
await seed(B);
await sql.run(
  `INSERT INTO cm_connections (id, organization_id, property_id, provider, environment, remote_property_id, webhook_token, webhook_secret, is_enabled)
   VALUES (?, ?, ?, 'channex', 'staging', 'remote-a', ?, ?, FALSE)`,
  [CONN, A, `${A}_prop`, TOKEN, SECRET],
);

const reset = () => { mock.calls.length = 0; mock.queue.length = 0; };
const remoteId = async () => (await sql.row<any>('SELECT remote_webhook_id AS id FROM cm_connections WHERE id = ?', [CONN]))?.id ?? null;
const storedSecret = async () => String((await sql.row<any>('SELECT webhook_secret AS s FROM cm_connections WHERE id = ?', [CONN]))?.s);
const record = (id: string, over: Record<string, unknown> = {}) => ({
  kind: 'record' as const,
  data: { id, type: 'webhook', attributes: {
    id, callback_url: `https://pms.test/api/webhooks/channel-manager/${TOKEN}`, event_mask: WEBHOOK_EVENT_MASK,
    headers: { 'X-Webhook-Secret': SECRET }, is_active: true, send_data: false, protected: false, is_global: false, ...over,
  } },
});

const savedAppUrl = process.env.APP_URL;
try {
  // ── 0. Без адреси нашого сервера реєструвати нема куди — відмова, не виклик
  {
    reset();
    delete process.env.APP_URL;
    await runWithOrganization(A, () => assert.rejects(() => ensureWebhook(CONN, KEY, { client }), /app url|APP_URL/i,
      'без APP_URL адреса зворотного виклику була б відносною — відмова з назвою'));
    assert.strictEqual(mock.calls.length, 0, 'і жодного виклику до вендора');
  }
  console.log('  ok  без адреси сервера — відмова до першого виклику');
  process.env.APP_URL = 'https://pms.test/';

  // ── 1. Перше створення: тіло дослівне, прочитане назад, id записано ──────
  {
    reset();
    mock.queue.push({ kind: 'webhook', id: 'wh-1' }, record('wh-1'));
    const state = await runWithOrganization(A, () => ensureWebhook(CONN, KEY, { client }));

    const create = mock.calls[0];
    assert.strictEqual(create.method, 'POST');
    assert.strictEqual(create.path, '/webhooks');
    assert.strictEqual(create.apiKey, KEY, 'ключем готелю');
    const w = create.body.webhook as Record<string, unknown>;
    assert.strictEqual(w.property_id, 'remote-a', 'вебхук на ОБʼЄКТ, не глобальний (§3.3)');
    assert.ok(!w.is_global, 'is_global не піднімається');
    assert.strictEqual(w.callback_url, `https://pms.test/api/webhooks/channel-manager/${TOKEN}`, 'адреса — наші двері з токеном зʼєднання, без імені вендора');
    assert.deepStrictEqual(w.headers, { 'X-Webhook-Secret': SECRET }, 'секрет зʼєднання — у заголовку, як просить документація');
    assert.strictEqual(w.is_active, true, 'is_active ЯВНО true — за замовчуванням false, і вебхук мовчав би');
    assert.strictEqual(w.send_data, false, 'send_data false: сигнал, не дані — тіло броні на віру не береться');
    const mask = String(w.event_mask).split(';');
    for (const must of ['booking', 'booking_unmapped_room', 'booking_unmapped_rate', 'non_acked_booking', 'message', 'sync_error']) {
      assert.ok(mask.includes(must), `у масці мусить бути ${must}`);
    }
    assert.ok(!mask.includes('ari'), 'ari у масці — власна луна на кожну нашу відправку (И9)');
    assert.ok(!mask.includes('*'), 'зірочка — це «все, що вендор вигадає потім»');

    assert.strictEqual(mock.calls.length, 2, 'створення і читання назад — рівно два виклики');
    const readBack = mock.calls[1];
    assert.strictEqual(readBack.method, 'GET');
    assert.strictEqual(readBack.path, '/webhooks/wh-1', 'після створення — читання назад, не віра у відповідь POST');

    assert.strictEqual(await remoteId(), 'wh-1', 'remote_webhook_id записано');
    assert.deepStrictEqual(
      { created: state.created, isActive: state.isActive, sendData: state.sendData, remoteWebhookId: state.remoteWebhookId },
      { created: true, isActive: true, sendData: false, remoteWebhookId: 'wh-1' },
    );
  }
  console.log('  ok  створення: обʼєкт, наші двері з токеном, секрет у заголовку, active/send_data явно, без ari; прочитано назад');

  // ── 2. Повторний вхід: лише читання, жодного другого вебхука ─────────────
  {
    reset();
    mock.queue.push(record('wh-1'));
    const state = await runWithOrganization(A, () => ensureWebhook(CONN, KEY, { client }));
    assert.deepStrictEqual(mock.calls.map((c) => `${c.method} ${c.path}`), ['GET /webhooks/wh-1'], 'є id — лише перевірка, POST-а немає');
    assert.strictEqual(state.created, false);
    assert.strictEqual(await remoteId(), 'wh-1');
  }
  console.log('  ok  повторний вхід — читання, не другий вебхук');

  // ── 3. Мовчазний вебхук: прочитано назад «неактивний» → полагоджено PUT-ом і перечитано
  {
    reset();
    mock.queue.push(record('wh-1', { is_active: false, send_data: true }), { kind: 'webhook', id: 'wh-1' }, record('wh-1'));
    const state = await runWithOrganization(A, () => ensureWebhook(CONN, KEY, { client }));
    assert.deepStrictEqual(mock.calls.map((c) => `${c.method} ${c.path}`), ['GET /webhooks/wh-1', 'PUT /webhooks/wh-1', 'GET /webhooks/wh-1'],
      'неактивний або з даними — лагодиться PUT-ом і перечитується');
    const put = mock.calls[1].body.webhook as Record<string, unknown>;
    assert.strictEqual(put.is_active, true);
    assert.strictEqual(put.send_data, false);
    assert.deepStrictEqual(put.headers, { 'X-Webhook-Secret': SECRET });
    assert.strictEqual(state.isActive, true);
    assert.strictEqual(state.sendData, false);

    reset();
    mock.queue.push(record('wh-1', { is_active: false }), { kind: 'webhook', id: 'wh-1' }, record('wh-1', { is_active: false }));
    await runWithOrganization(A, () => assert.rejects(() => ensureWebhook(CONN, KEY, { client }), /inactive|мовч/i,
      'якщо й після лагодження вендор віддає неактивний — відмова, а не «зареєстровано»'));
  }
  console.log('  ok  прочитане назад «мовчить» лагодиться, а невиліковне — відмова');

  // ── 4. Застарілий id: вендор каже 404 → створити заново, id оновити ─────
  {
    reset();
    mock.queue.push({ kind: 'notFound' }, { kind: 'webhook', id: 'wh-2' }, record('wh-2'));
    const state = await runWithOrganization(A, () => ensureWebhook(CONN, KEY, { client }));
    assert.deepStrictEqual(mock.calls.map((c) => `${c.method} ${c.path}`), ['GET /webhooks/wh-1', 'POST /webhooks', 'GET /webhooks/wh-2']);
    assert.strictEqual(state.created, true);
    assert.strictEqual(await remoteId(), 'wh-2', 'id оновлено на новий');
  }
  console.log('  ok  зниклий у вендора вебхук створюється заново');

  // ── 5. Заміна секрету: спершу вендор, потім база ─────────────────────────
  {
    reset();
    mock.queue.push({ kind: 'webhook', id: 'wh-2' });
    await runWithOrganization(A, () => rotateWebhookSecret(CONN, KEY, { client }));
    assert.deepStrictEqual(mock.calls.map((c) => `${c.method} ${c.path}`), ['PUT /webhooks/wh-2']);
    const sent = (mock.calls[0].body.webhook as { headers: Record<string, string> }).headers['X-Webhook-Secret'];
    const stored = await storedSecret();
    assert.notStrictEqual(stored, SECRET, 'секрет справді змінився');
    assert.strictEqual(sent, stored, 'вендор і база тримають той самий новий секрет');
    assert.ok(stored.length >= 32, 'довгий');

    reset();
    mock.queue.push({ kind: 'serverError' });
    await runWithOrganization(A, () => assert.rejects(() => rotateWebhookSecret(CONN, KEY, { client })));
    assert.strictEqual(await storedSecret(), stored, 'вендор не взяв — база не міняється: інакше база впевнена в секреті, якого вендор не знає');
  }
  console.log('  ok  заміна секрету: вендор першим, база — лише після нього');

  // ── 6. Пробна доставка: вендор стукає в наші двері і віддає наш код і тіло
  {
    reset();
    mock.queue.push({ kind: 'testResult', statusCode: 200, body: '{"ok":true}' });
    const result = await runWithOrganization(A, () => testWebhook(CONN, KEY, { client }));
    assert.strictEqual(mock.calls[0].method, 'POST');
    assert.strictEqual(mock.calls[0].path, '/webhooks/test');
    const w = mock.calls[0].body.webhook as Record<string, unknown>;
    assert.strictEqual(w.callback_url, `https://pms.test/api/webhooks/channel-manager/${TOKEN}`);
    assert.strictEqual((w.headers as Record<string, string>)['X-Webhook-Secret'], await storedSecret(), 'проба йде з ЧИННИМ секретом');
    assert.deepStrictEqual(result, { statusCode: 200, body: '{"ok":true}' });
  }
  console.log('  ok  пробна доставка — читання назад через самого вендора (И27)');

  // ── 7. Прибирання: DELETE у вендора, id стерто; 404 — теж прибрано ────────
  {
    reset();
    mock.queue.push({ kind: 'ackOk' });
    const removed = await runWithOrganization(A, () => removeWebhook(CONN, KEY, { client }));
    assert.deepStrictEqual(mock.calls.map((c) => `${c.method} ${c.path}`), ['DELETE /webhooks/wh-2']);
    assert.strictEqual(removed.existed, true);
    assert.strictEqual(await remoteId(), null, 'після прибирання id порожній');

    reset();
    const again = await runWithOrganization(A, () => removeWebhook(CONN, KEY, { client }));
    assert.strictEqual(mock.calls.length, 0, 'без id прибирати нема чого — і виклику немає');
    assert.strictEqual(again.existed, false);

    await sql.run('UPDATE cm_connections SET remote_webhook_id = ? WHERE id = ?', ['wh-gone', CONN]);
    reset();
    mock.queue.push({ kind: 'notFound' });
    const gone = await runWithOrganization(A, () => removeWebhook(CONN, KEY, { client }));
    assert.strictEqual(gone.existed, false, 'вендор уже не має — це не помилка');
    assert.strictEqual(await remoteId(), null, 'і слід у базі стерто');
  }
  console.log('  ok  прибирання видаляє у вендора і стирає id; зниклий — не помилка');

  // ── 8. Чужий орендар не реєструє, не пробує і не прибирає чужого ─────────
  {
    reset();
    for (const fn of [() => ensureWebhook(CONN, KEY, { client }), () => testWebhook(CONN, KEY, { client }), () => removeWebhook(CONN, KEY, { client })]) {
      await runWithOrganization(B, () => assert.rejects(fn, /not found/i));
    }
    assert.strictEqual(mock.calls.length, 0, 'чужий орендар — жодного виклику до вендора');
  }
  console.log('  ok  чужий орендар — 404 і тиша');

  // ── 9. Класифікація подій — справа адаптера, домен імен не знає ──────────
  {
    for (const t of ['booking', 'booking_new', 'booking_modification', 'booking_cancellation']) assert.strictEqual(classifyEvent(t), 'booking', t);
    for (const t of ['message', 'message_thread_booking_assigned', 'inquiry']) assert.strictEqual(classifyEvent(t), 'message', t);
    for (const t of ['booking_unmapped_room', 'booking_unmapped_rate', 'non_acked_booking', 'sync_error', 'rate_error', 'disconnect_channel', 'deactivate_channel', 'channel_removal_warning', 'property_removal_warning']) {
      assert.strictEqual(classifyEvent(t), 'attention', t);
    }
    for (const t of ['ari', 'new_channel', 'updated_channel', 'activate_channel', 'sync_warning', 'review', 'updated_review']) assert.strictEqual(classifyEvent(t), 'ignore', t);
    assert.strictEqual(classifyEvent('something_vendor_adds_next_year'), 'attention', 'невідоме — комусь треба подивитись, а не мовчати');
  }
  console.log('  ok  події класифіковані: бронь будить стрічку, увага — оператору, луна — нікому');

  console.log('webhook-adapter: реєстрація дослівна, прочитана назад, ідемпотентна; секрет змінюваний; прибирання за собою');
} finally {
  if (savedAppUrl === undefined) delete process.env.APP_URL; else process.env.APP_URL = savedAppUrl;
  await mock.close();
  await cleanup();
}
