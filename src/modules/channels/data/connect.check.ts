/**
 * Майстер підключення: перервали й повернулись — і нічого не подвоїлось.
 *
 *   node src/modules/channels/data/connect.check.ts
 *
 * ── Чому перше твердження саме про перерву ──────────────────────────────
 *
 * Готельєр закриє вкладку посеред процесу — це не виняток, це звичайна
 * поведінка (рецензія власника 01.09.2026). Тому кожен крок або завершений
 * і записаний, або його ніби не було; повторний вхід ПРОДОВЖУЄ, а не
 * починає заново і не створює других сутностей у чужому акаунті. Стан
 * майстра не живе в браузері й не живе в окремій таблиці: він виводиться
 * з того, що вже записано — ключ, зʼєднання, обʼєкт на тому боці,
 * увімкнення.
 *
 * Ключ тут не перевіряється по вендору (це справа адаптера й живого
 * прогону); перевіряється, що стан майстра читає його НАЯВНІСТЬ, а не
 * значення, і що значення ніколи не повертається.
 *
 * Перевірка написана ДО коду і була червоною (інваріант 24).
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';

// Облікові дані запечатуються цим ключем; без нього сховище відмовляє. Тут
// ключ перевірки, як у CI, — рядки цієї перевірки прибираються наприкінці.
process.env.APP_SECRET_KEY ??= '0'.repeat(64);

const { runWithOrganization } = await import('@core/auth/tenant-context');
const { getSql } = await import('@core/db/async');
const { saveIntegrationCredentials } = await import('@core/integration-credentials');
const { ensureConnection, setupState, setConnectionEnabled } = await import('./connect.ts');

const sql = getSql();
const A = '__connect__a';
const B = '__connect__b';
const PROP = (org: string) => `${org}_prop`;

/**
 * Засів і прибирання — В КОНТЕКСТІ ОРЕНДАРЯ, як це робить застосунок.
 *
 * Під роллю застосунку (`alisio_app`, FORCE RLS) запис без орендаря на
 * зʼєднанні політика відхиляє, а видалення мовчки чіпає нуль рядків. Під
 * суперкористувачем проходить і те, і те — тому гейт був зелений і про
 * політики не свідчив (INC-014). Рядок `organizations` — поза контекстом:
 * ця таблиця орендаря НАЗИВАЄ, тож політики на ній немає за побудовою.
 */
async function cleanup() {
  for (const org of [A, B]) {
    await runWithOrganization(org, async () => {
      await sql.run('DELETE FROM cm_outbox WHERE organization_id = ?', [org]);
      await sql.run('DELETE FROM cm_mappings WHERE organization_id = ?', [org]);
      await sql.run('DELETE FROM cm_connections WHERE organization_id = ?', [org]);
      await sql.run('DELETE FROM channel_credentials WHERE organization_id = ?', [org]);
      await sql.run('DELETE FROM properties WHERE organization_id = ?', [org]);
    });
    await sql.run('DELETE FROM organizations WHERE id = ?', [org]);
  }
}

async function seed(org: string) {
  await sql.run('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)', [org, org, org]);
  await runWithOrganization(org, () =>
    sql.run('INSERT INTO properties (id, organization_id, name, slug) VALUES (?, ?, ?, ?)', [PROP(org), org, org, PROP(org)]));
}

await cleanup();
await seed(A);
await seed(B);

try {
  await runWithOrganization(A, async () => {
    // ── Крок 0: нічого не зроблено — стан каже «потрібен ключ» ──────────
    const empty = await setupState(PROP(A));
    assert.strictEqual(empty.step, 'key', 'без ключа майстер починається з ключа');
    assert.strictEqual(empty.hasKey, false);
    assert.strictEqual(empty.connection, null);
    assert.ok(!('apiKey' in empty) && !JSON.stringify(empty).includes('secret'),
      'стан майстра ніколи не несе значення ключа');

    // ── Крок 1: ключ збережено, вкладку закрили ─────────────────────────
    await saveIntegrationCredentials(A, 'channel_manager', { accessToken: 'probe-key-a' });
    const withKey = await setupState(PROP(A));
    assert.strictEqual(withKey.hasKey, true, 'збережений ключ мусить бути видний як НАЯВНІСТЬ');
    assert.strictEqual(withKey.step, 'connection', 'після ключа — зʼєднання, а не знову ключ');
    assert.ok(!JSON.stringify(withKey).includes('probe-key-a'), 'значення ключа не повертається');

    // ── Крок 2: зʼєднання — двічі, бо повернулись ────────────────────────
    const first = await ensureConnection({ propertyId: PROP(A), provider: 'probe', environment: 'staging' });
    const second = await ensureConnection({ propertyId: PROP(A), provider: 'probe', environment: 'staging' });
    assert.strictEqual(second.id, first.id, 'повторний вхід мусить повернути ТЕ САМЕ зʼєднання, а не друге');
    const rows = await sql.rows('SELECT id FROM cm_connections WHERE organization_id = ?', [A]);
    assert.strictEqual(rows.length, 1, 'у базі одне зʼєднання, скільки б разів не заходили');
    assert.strictEqual(first.isEnabled, false, 'нове зʼєднання вимкнене, доки майстер не дійшов до кінця');

    const withConn = await setupState(PROP(A));
    assert.strictEqual(withConn.step, 'catalog', 'зʼєднання є, обʼєкта на тому боці немає — далі каталог');
    assert.strictEqual(withConn.connection?.id, first.id);

    // ── Крок 3: каталог заведено (обʼєкт на тому боці записано) ─────────
    await sql.run('UPDATE cm_connections SET remote_property_id = ? WHERE id = ?', ['remote-a', first.id]);
    const withCatalog = await setupState(PROP(A));
    assert.strictEqual(withCatalog.step, 'mapping', 'обʼєкт на тому боці є — далі мапінг у вікні вендора');

    // ── Крок 4: увімкнули ────────────────────────────────────────────────
    await setConnectionEnabled(first.id, true);
    const done = await setupState(PROP(A));
    assert.strictEqual(done.step, 'done');
    assert.strictEqual(done.connection?.isEnabled, true);
    await setConnectionEnabled(first.id, false);
    assert.strictEqual((await setupState(PROP(A))).step, 'mapping', 'вимкнене повертає майстер на звірку, не на початок');
    console.log('  ok  стан виводиться з записаного: перервали й повернулись — продовжили, нічого не подвоїлось');

    // ── Чужий обʼєкт — не наш: 404, не зʼєднання в чужому готелі ────────
    await assert.rejects(
      () => ensureConnection({ propertyId: PROP(B), provider: 'probe', environment: 'staging' }),
      /not found/i,
      'зʼєднання на ЧУЖИЙ обʼєкт — це готель А, який штовхає ціни в обʼєкт готелю Б',
    );
    const foreign = await setupState(PROP(B));
    assert.strictEqual(foreign.property, null, 'чужий обʼєкт для майстра не існує');
    console.log('  ok  чужий обʼєкт не підключається і не читається');
  });

  // ── Другий орендар не бачить і не вмикає чужого ───────────────────────
  //
  // Ідентифікатор чужого зʼєднання береться в контексті А і ПЕРЕДАЄТЬСЯ сюди
  // руками. Раніше він читався запитом уже в контексті B — і під роллю
  // застосунку той запит чесно повертає порожньо, тобто перевірка падала на
  // `undefined.id`, так і не спитавши головного. Тепер питань два, і друге
  // сильніше: маючи ЧУЖИЙ ідентифікатор на руках, B все одно не вмикає.
  const connAId = await runWithOrganization(A, async () =>
    (await sql.rows('SELECT id FROM cm_connections WHERE organization_id = ?', [A]))[0] as { id: string });
  // Чи є тут узагалі вісь ПОЛІТИК — питається, а не припускається.
  //
  // «Сусід не бачить рядка» доводить політику лише там, де політики діють:
  // на SQLite їх немає за побудовою, а суперкористувач Postgres обходить їх
  // (`rolbypassrls`) — і те саме твердження стало б хибним не тому, що щось
  // зламано. Тому воно або перевіряється, або ЧЕСНО КАЖЕ, що не перевіряється
  // (INC-014: мовчання гейта — не доведеність).
  const policiesInForce = await (async () => {
    try {
      const forced = await sql.row<any>("SELECT relforcerowsecurity AS f FROM pg_class WHERE relname = 'cm_connections'");
      const me = await sql.row<any>('SELECT rolbypassrls AS b FROM pg_roles WHERE rolname = current_user');
      return !!forced?.f && !me?.b;
    } catch { return false; }
  })();

  await runWithOrganization(B, async () => {
    if (policiesInForce) {
      const seen = await sql.rows('SELECT id FROM cm_connections WHERE organization_id = ?', [A]);
      assert.strictEqual(seen.length, 0, 'зʼєднання сусіда видно другому орендарю попри політику');
    } else {
      console.log('  ··  осі політик тут немає (SQLite або роль з обходом RLS) — рядок сусіда не питаємо');
    }
    await assert.rejects(() => setConnectionEnabled(connAId.id, true), /not found/i, 'чужий орендар увімкнув чуже зʼєднання');
    assert.strictEqual((await setupState(PROP(A))).property, null);
    console.log('  ok  чужий орендар не бачить чужого зʼєднання і не вмикає його навіть за ідентифікатором');
  });
} finally {
  await cleanup();
}

console.log('connect: майстер відновлюваний, ключ видно лише як наявність, чуже не підключається');
