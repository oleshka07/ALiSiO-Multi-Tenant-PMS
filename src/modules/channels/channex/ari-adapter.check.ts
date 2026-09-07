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
 * Сцени 1–6 без цін і без цінових таблиць навмисно (інваріант 16,
 * `check-price-source`): координата ціни без джерела розвʼязується в
 * «закрито» і їде як `stop_sell: true` — тобто смуга цін тут теж ходить,
 * лише без числа.
 *
 * Перевірка була ЧЕРВОНОЮ — зламом адаптера (`release` → `markSent`): рядок
 * зник із черги замість повернутись. Інваріант 24.
 *
 * Сцена 7 (INC-016) червоніла на самому коді: пачка з самих цінових
 * координат їхала без `min_stay_arrival`, бо проміжок для читання
 * обмежень знав лише захоплення наявності. Ціни тут Є — базовим рядком
 * через двері `@pricing`, без SQL до цінових таблиць (інваріант 16).
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';

const { runWithOrganization } = await import('@core/auth/tenant-context');
const { getSql } = await import('@core/db/async');
const { ariFlush } = await import('./ari-adapter.ts');
const { ChannexRateLimiter } = await import('./limiter.ts');
const { enqueueChange, queuedChanges, pendingCount, stuckChanges } = await import('../data/outbox.repo.ts');
const { bulkUpdatePrices } = await import('@pricing');

const sql = getSql();

const ORG = '__ari_adapter__';
const PROP = `${ORG}_prop`;
const UT = `${ORG}_ut`;
const RP = `${ORG}_rp`;
const CONN = `${ORG}_conn`;
const CONN2 = `${ORG}_conn2`;
const DAY = '2027-03-10';
const addDays = (iso: string, n: number) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

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
  run: (q: string, params?: unknown[]) => runWithOrganization(ORG, () => sql.run(q, params as any)),
  row: (q: string, params?: unknown[]) => runWithOrganization(ORG, () => sql.row<any>(q, params as any)),
  rows: (q: string, params?: unknown[]) => runWithOrganization(ORG, () => sql.rows<any>(q, params as any)),
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
  await runWithOrganization(ORG, async () => {
    await sql.run('DELETE FROM cm_outbox WHERE organization_id = ?', [ORG]);
    try { await sql.run('DELETE FROM cm_sends WHERE organization_id = ?', [ORG]); } catch { /* таблиці ще немає — гейт червоний нижче */ }
    await sql.run('DELETE FROM cm_mappings WHERE organization_id = ?', [ORG]);
    await sql.run('DELETE FROM cm_connections WHERE organization_id = ?', [ORG]);
    await sql.run('DELETE FROM price_rules WHERE organization_id = ?', [ORG]);
    await sql.run('DELETE FROM units WHERE property_id = ?', [PROP]);
    // Тип першим: календар цін іде за ним каскадом (до цінових таблиць звідси
    // не торкаємось — інваріант 16), і лише тоді тарифи, на які він посилався.
    await sql.run('DELETE FROM unit_types WHERE property_id = ?', [PROP]);
    await sql.run('DELETE FROM rate_plans WHERE property_id = ?', [PROP]);
    await sql.run('DELETE FROM categories WHERE property_id = ?', [PROP]);
    await sql.run('DELETE FROM properties WHERE organization_id = ?', [ORG]);
  });
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
    // Друге зʼєднання того ж обʼєкта — для сцени про бюджет: ліміт ключується
    // зʼєднанням, і вичерпаний бюджет першого не має зачепити решту сцен.
    await sql.run(
      `INSERT INTO cm_connections (id, organization_id, property_id, provider, environment,
                                   webhook_token, webhook_secret, is_enabled, remote_property_id)
       VALUES (?, ?, ?, 'channex', 'production', ?, ?, TRUE, ?)`,
      [CONN2, ORG, PROP, `tok2_${ORG}`, `sec2_${ORG}`, 'remote-prop'],
    );
    const mirror = [
      ['unit_type', UT, '', 0, 'remote-ut'],
      ['rate_plan', RP, UT, 0, 'remote-rp'],
      ['rate_plan_option', RP, UT, 2, 'remote-rp'],
    ];
    for (const conn of [CONN, CONN2]) {
      for (const [entityType, localId, unitTypeId, occupancy, remoteId] of mirror) {
        await sql.run(
          `INSERT INTO cm_mappings (id, organization_id, connection_id, entity_type, local_id, unit_type_id, occupancy, remote_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [`${conn}_m_${entityType}_${occupancy}`, ORG, conn, entityType, localId, unitTypeId, occupancy, remoteId],
        );
      }
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
      await enqueueChange(sql, CONN, { kind: 'availability', unitTypeId: UT, date: DAY });
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
      assert.strictEqual(back[0].attempts, 0, '429 — причина проходу, не рядка: спроба НЕ рахується, інакше простій вендора ставить чергу в «потребує уваги»');
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
      assert.strictEqual(back[0].attempts, 0, 'відмова власного обмежувача — теж причина проходу: лічильник стоїть, причина на рядку');
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
      assert.strictEqual(back[0].attempts, 1, 'претензія до ЗНАЧЕННЯ — це спроба рядка, вона рахується');
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
      await enqueueChange(sql, CONN, { kind: 'rate', unitTypeId: UT, ratePlanId: RP, date: DAY });
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

    // ── 6. Бюджетом обʼєкта володіє ОБʼЄКТ, не прохід ──────────────────────
    //
    // Рецензія 01.09.2026: обмежувач жив у клієнті одного проходу, тож
    // ручний «повторити» і черговий прохід крона в одну хвилину зʼїли б
    // бюджет обʼєкта разом і не помітили б. Тому обмежувач — один на процес,
    // ключований зʼєднанням: одинадцятий виклик за хвилину відмовляється
    // незалежно від того, котрий прохід його зробив. Транспорт тут відповідає
    // лише успіхом — відмовити має НАШ обмежувач, а не вендор.
    {
      const t = transport([]);
      let sent = 0;
      let refused = 0;
      for (let i = 1; i <= 11; i++) {
        await enqueueChange(sql, CONN2, { kind: 'availability', unitTypeId: UT, date: addDays(DAY, 30 + i) });
        const report = await ariFlush(CONN2, 'key', { client: { fetch: t.fetch } });
        sent += report.sent;
        refused += report.failed;
      }
      assert.strictEqual(t.calls.length, 10,
        `одинадцять проходів за хвилину зробили ${t.calls.length} викликів — бюджет обʼєкта рахується на прохід, а не на обʼєкт`);
      assert.strictEqual(sent, 10);
      assert.strictEqual(refused, 1, 'одинадцятий прохід мав відмовитись сам, до мережі');
      const left = await queuedChanges(CONN2);
      assert.strictEqual(left.length, 1, 'відмовлена координата чекає наступної хвилини');
      assert.match(String(left[0].lastError), /throttled|window/, 'причина — вікно обмежувача, і вона на рядку');
      assert.strictEqual(left[0].attempts, 0, 'відмова обмежувача не рахує спроби');
      console.log('  ok  бюджет обʼєкта один на всі проходи: одинадцятий виклик за хвилину відмовляється');
    }

    /** Ніч у тілі цінової смуги — за датою або за діапазоном, у який вона впала. */
    const rateOn = (calls: { path: string; body: any }[], date: string) => {
      const rates = calls.find((c) => c.path.endsWith('/restrictions'));
      assert.ok(rates, 'смуга цін мала поїхати');
      const v = rates!.body.values.find((x: any) => x.date === date || (x.date_from <= date && date <= x.date_to));
      assert.ok(v, `у тілі цін немає ночі ${date}: ${JSON.stringify(rates!.body.values)}`);
      return v;
    };

    // ── 7. Обмеження дня їдуть у пачці БЕЗ наявності — і повз її проміжок ──
    //
    // Живе 03.09.2026 (INC-016): звірка повертала в чергу лише цінові
    // координати, крон слав їх — і `min_stay_arrival` у тілі не було, бо
    // проміжок дат для читання обмежень запамʼятовувався лише при захопленні
    // НАЯВНОСТІ. Пачка з самих цін читала обмеження з порожнього проміжку,
    // і мінімум ночей, CTA/CTD, «закрито» з календаря не доїжджали ніколи;
    // звірка ж рахувала очікуване зі своїм вікном і чекала їх вічно.
    //
    // Дві осі (інваріант 26): два дні з РІЗНИМ мінімумом (3 і 2, другий ще
    // й із забороною заїзду) — інакше константа пройшла б; і наявність у
    // тій самій пачці на ІНШИЙ день, проміжок якої обмеження не покриває.
    // Базові рядки — дверима @pricing (інваріант 16); координати, які кладе
    // сам писач (Ц16), тут прибираються, черга складається явно.
    {
      const D3 = addDays(DAY, 60);
      const D4 = addDays(DAY, 61);
      const D5 = addDays(DAY, 65);

      await asOrg.run('DELETE FROM cm_outbox WHERE organization_id = ?', [ORG]);
      await bulkUpdatePrices({ unitTypeId: UT, dateFrom: D3, dateTo: D3, applyTo: 'all', base_price: 150, min_stay: 3 });
      await bulkUpdatePrices({ unitTypeId: UT, dateFrom: D4, dateTo: D4, applyTo: 'all', base_price: 150, min_stay: 2, cta: true });
      await asOrg.run('DELETE FROM cm_outbox WHERE organization_id = ?', [ORG]);

      // Вісь 1: у пачці лише ціни — жодного рядка наявності.
      await enqueueChange(sql, CONN, { kind: 'rate', unitTypeId: UT, ratePlanId: RP, date: D3 });
      await enqueueChange(sql, CONN, { kind: 'rate', unitTypeId: UT, ratePlanId: RP, date: D4 });
      const only = transport([]);
      const r1 = await ariFlush(CONN, 'key', { client: { fetch: only.fetch } });
      assert.strictEqual(r1.failed, 0, r1.errors.join(' | '));
      assert.strictEqual(only.calls.length, 1, 'лише ціни — одне повідомлення');
      const d3 = rateOn(only.calls, D3);
      const d4 = rateOn(only.calls, D4);
      assert.strictEqual(d3.min_stay_arrival, 3, `пачка без наявності: мінімум ночей D3 не доїхав — ${JSON.stringify(d3)}`);
      assert.strictEqual(d4.min_stay_arrival, 2, `пачка без наявності: мінімум ночей D4 не доїхав — ${JSON.stringify(d4)}`);
      assert.strictEqual(d4.closed_to_arrival, true, 'заборона заїзду з базового рядка D4 мала поїхати');
      assert.strictEqual(d3.closed_to_arrival, false, 'D3 заборони не має — і це явне false з рядка, не відсутність поля');
      assert.strictEqual(d3.stop_sell, false, 'ціна є — ніч відкрита явно (Д2)');
      assert.deepStrictEqual(d3.rates, [{ occupancy: 2, rate: 15000 }], 'ціна базового рядка через priceNights, у мінорних');

      // Вісь 2: наявність у тій самій пачці, але на D5 — її проміжок D3 не покриває.
      await enqueueChange(sql, CONN, { kind: 'availability', unitTypeId: UT, date: D5 });
      await enqueueChange(sql, CONN, { kind: 'rate', unitTypeId: UT, ratePlanId: RP, date: D3 });
      const both = transport([]);
      const r2 = await ariFlush(CONN, 'key', { client: { fetch: both.fetch } });
      assert.strictEqual(r2.failed, 0, r2.errors.join(' | '));
      assert.strictEqual(both.calls.length, 2, 'наявність і ціни — два повідомлення');
      const availability = both.calls.find((c) => c.path.endsWith('/availability'))!;
      assert.strictEqual(availability.body.values[0].date, D5);
      assert.strictEqual(availability.body.values[0].availability, 1, 'наявність D5 — з її власного проміжку');
      assert.strictEqual(rateOn(both.calls, D3).min_stay_arrival, 3,
        'наявність на інший день у тій самій пачці не має красти проміжок обмежень у цін');
      assert.strictEqual(await pendingCount(CONN), 0);
      console.log('  ok  обмеження дня їдуть і без наявності в пачці, і повз її проміжок (INC-016)');
    }

    // ── 8. Тариф знято з продажу → кожна ніч пари їде ЗАКРИТОЮ, без ціни ──
    //
    // Блок 2.1 (BUILD-PLAN): заведений у вендора тариф видалити не можна
    // (`mapped`), а зняти з продажу не було чим — і канал продавав його далі
    // за останньою ціною. Дзеркало лишається (адресат є), джерела ціни для
    // вимкненого тарифу не існує (інваріант 17 — `priceNights` віддає ніч як
    // `missing`), тож координата розвʼязується в «закрито» (И14). Ціна в
    // календарі при цьому ЛЕЖИТЬ — D3 має 150 зі сцени 7: саме це відрізняє
    // «знято з продажу» від «ціни немає». Дві осі (інваріант 26): той самий
    // рядок ціни їде закритим при `is_active = FALSE` і відкритим із 15000
    // при `TRUE` — константа «завжди закрито» чи «завжди відкрито» не пройде.
    // Прапорець ставиться прямо в рядку: писач (`updateRatePlan`) і його
    // координати — справа гейта тарифів; тут — що батчер його ЧУЄ.
    {
      const D3 = addDays(DAY, 60); // та сама ніч із ціною 150, що в сцені 7
      await asOrg.run('DELETE FROM cm_outbox WHERE organization_id = ?', [ORG]);
      await asOrg.run('UPDATE rate_plans SET is_active = FALSE WHERE id = ?', [RP]);
      await enqueueChange(sql, CONN, { kind: 'rate', unitTypeId: UT, ratePlanId: RP, date: D3 });
      const off = transport([]);
      const r1 = await ariFlush(CONN, 'key', { client: { fetch: off.fetch } });
      assert.strictEqual(r1.failed, 0, r1.errors.join(' | '));
      const closed = rateOn(off.calls, D3);
      assert.strictEqual(closed.stop_sell, true,
        `тариф знято з продажу, а ніч поїхала відкритою — канал продає далі за останньою ціною: ${JSON.stringify(closed)}`);
      assert.ok(!('rates' in closed), 'у знятого з продажу тарифу ціна не пишеться — навіть та, що лежить у календарі');
      assert.strictEqual(closed.min_stay_arrival, 3, 'обмеження дня їдуть і в закриту ніч — вони з базового рядка, не з тарифу');

      await asOrg.run('UPDATE rate_plans SET is_active = TRUE WHERE id = ?', [RP]);
      await enqueueChange(sql, CONN, { kind: 'rate', unitTypeId: UT, ratePlanId: RP, date: D3 });
      const on = transport([]);
      const r2 = await ariFlush(CONN, 'key', { client: { fetch: on.fetch } });
      assert.strictEqual(r2.failed, 0, r2.errors.join(' | '));
      const open = rateOn(on.calls, D3);
      assert.strictEqual(open.stop_sell, false, 'повернутий у продаж тариф — ніч відкрита ЯВНО (И14), не «не слати»');
      assert.deepStrictEqual(open.rates, [{ occupancy: 2, rate: 15000 }], 'і та сама ціна з календаря знову їде');
      assert.strictEqual(await pendingCount(CONN), 0);
      console.log('  ok  тариф знято з продажу → stop_sell без ціни на ночі пари; повернуто → та сама ціна знову');
    }

    // ── 9. Маска полів: у тілі лише те, що змінилось (Блок 0.5, лист 05.09) ──
    //
    // Б1 листа Channex: «повідомлення несе весь стан, не дельту». Тест 2
    // чекає в тілі лише `rates`, тест 5 — лише `min_stay_arrival`, тест 6 —
    // лише `stop_sell`, тест 7 — чотири обмеження і нічого іншого. Координата
    // з маскою (`fields`) розвʼязується лише в замасковане; стиснення
    // діапазонів порівнює лише замасковані значення — три сусідні ночі з
    // РІЗНИМ CTA й однаковою ціною під маскою «ціна» їдуть ОДНИМ
    // `date_range` (тест 4: «use date_range syntax»). Базові рядки — дверима
    // `@pricing`; координати самого писача тут прибираються.
    {
      const D6 = addDays(DAY, 70);
      const D7 = addDays(DAY, 71);
      const D8 = addDays(DAY, 72);
      const D3 = addDays(DAY, 60); // 150, мінімум 3, зі сцени 7
      await asOrg.run('DELETE FROM cm_outbox WHERE organization_id = ?', [ORG]);
      await bulkUpdatePrices({ unitTypeId: UT, dateFrom: D6, dateTo: D6, applyTo: 'all', base_price: 150, cta: true });
      await bulkUpdatePrices({ unitTypeId: UT, dateFrom: D7, dateTo: D7, applyTo: 'all', base_price: 150, cta: false });
      await bulkUpdatePrices({ unitTypeId: UT, dateFrom: D8, dateTo: D8, applyTo: 'all', base_price: 150, cta: true });
      await asOrg.run('DELETE FROM cm_outbox WHERE organization_id = ?', [ORG]);

      const bodyKeys = (v: Record<string, unknown>) => Object.keys(v).filter((k) => !['property_id', 'rate_plan_id', 'date', 'date_from', 'date_to'].includes(k)).sort();

      // Тест 2 / 4: лише ціна — і один діапазон попри різний CTA.
      await enqueueChange(sql, CONN, { kind: 'rate', unitTypeId: UT, ratePlanId: RP, date: D6, dateTo: D8, fields: ['prices'] });
      const t2 = transport([]);
      const r2 = await ariFlush(CONN, 'key', { client: { fetch: t2.fetch } });
      assert.strictEqual(r2.failed, 0, r2.errors.join(' | '));
      const values2 = t2.calls.find((c) => c.path.endsWith('/restrictions'))!.body.values;
      assert.strictEqual(values2.length, 1, `три ночі з однаковою ціною й різним CTA під маскою «ціна» мали стиснутись в ОДИН date_range, а не ${values2.length}: ${JSON.stringify(values2)}`);
      assert.strictEqual(values2[0].date_from, D6);
      assert.strictEqual(values2[0].date_to, D8);
      assert.deepStrictEqual(bodyKeys(values2[0]), ['rates'], `тест 2: у тілі лише rates, а не ${bodyKeys(values2[0]).join(',')}`);

      // Тест 5: лише мінімум.
      await enqueueChange(sql, CONN, { kind: 'rate', unitTypeId: UT, ratePlanId: RP, date: D3, fields: ['minStay'] });
      const t5 = transport([]);
      await ariFlush(CONN, 'key', { client: { fetch: t5.fetch } });
      const v5 = rateOn(t5.calls, D3);
      assert.deepStrictEqual(bodyKeys(v5), ['min_stay_arrival'], `тест 5: лише мінімум, а не ${bodyKeys(v5).join(',')}`);
      assert.strictEqual(v5.min_stay_arrival, 3);

      // Тест 6: лише «закрито» — і явне false, коли відкрито.
      await enqueueChange(sql, CONN, { kind: 'rate', unitTypeId: UT, ratePlanId: RP, date: D3, fields: ['closed'] });
      const t6 = transport([]);
      await ariFlush(CONN, 'key', { client: { fetch: t6.fetch } });
      const v6 = rateOn(t6.calls, D3);
      assert.deepStrictEqual(bodyKeys(v6), ['stop_sell'], `тест 6: лише stop_sell, а не ${bodyKeys(v6).join(',')}`);
      assert.strictEqual(v6.stop_sell, false);

      // Тест 7: чотири обмеження, без ціни й без stop_sell; max без межі — 0.
      await enqueueChange(sql, CONN, { kind: 'rate', unitTypeId: UT, ratePlanId: RP, date: D3, fields: ['minStay', 'maxStay', 'noArrival', 'noDeparture'] });
      const t7 = transport([]);
      await ariFlush(CONN, 'key', { client: { fetch: t7.fetch } });
      const v7 = rateOn(t7.calls, D3);
      assert.deepStrictEqual(bodyKeys(v7), ['closed_to_arrival', 'closed_to_departure', 'max_stay', 'min_stay_arrival'], `тест 7: чотири обмеження і нічого іншого, а не ${bodyKeys(v7).join(',')}`);
      assert.strictEqual(v7.max_stay, 0, 'максимум без межі їде нулем — зняте обмеження мусить доїхати');
      assert.strictEqual(await pendingCount(CONN), 0);
      console.log('  ok  маска полів: rates / min_stay_arrival / stop_sell / чотири обмеження — кожне окремо; один date_range попри різний CTA');
    }

    // ── 10. Журнал відправлень з тілом (Блок 0.5 п.4, Hoteliera last_sent) ──
    //
    // Розписка на координаті каже, ЩО поїхало; вона не каже, З ЯКИМИ ПОЛЯМИ.
    // Саме цього бракувало, щоб звірити task id до подання: у листі вендор
    // назвав зайві поля, а ми не мали чим це побачити. Кожен виклик лягає
    // рядком `cm_sends`: смуга, тіло, статус, task id, скільки значень і які
    // ключі. Невдалий виклик — теж рядок, зі статусом і без task id: журнал,
    // у якому видно лише успіхи, — це не журнал.
    {
      const { recentSendLog } = await import('../data/sends.repo.ts');
      const D9 = addDays(DAY, 80);
      await asOrg.run('DELETE FROM cm_sends WHERE organization_id = ?', [ORG]);
      await enqueueChange(sql, CONN, { kind: 'availability', unitTypeId: UT, date: D9 });
      const bad = transport([{ status: 429, body: BODY_429 }]);
      await ariFlush(CONN, 'key', { client: { fetch: bad.fetch, limiter: new ChannexRateLimiter(), sleep: async () => {} } });
      const good = transport([{ status: 200, body: BODY_OK }]);
      await ariFlush(CONN, 'key', { client: { fetch: good.fetch, limiter: new ChannexRateLimiter() } });

      const log = await recentSendLog(CONN);
      assert.strictEqual(log.length, 2, `два виклики — два рядки журналу, а не ${log.length}`);
      // Рядки беруться за ВМІСТОМ, не за позицією. `sent_at` у SQLite має
      // роздільність в одну секунду (`datetime('now')`), а тайбрейкер у
      // `recentSendLog` — `id DESC`, тобто випадковий hex: два виклики, що
      // вклалися в одну секунду (на раннері — завжди), повертаються в
      // довільному порядку. Сцена, яка читала їх позицією, була через це
      // монеткою: 06.09.2026 той самий код дав зелене й червоне на двох
      // сусідніх комітах, які коду не торкались. Порядок «найновіший перший»
      // тут не стверджується — його не з чим розрізняти на однакових
      // мітках; на екрані оператора це косметика.
      const ok = log.find((r) => r.responseStatus === 200)!;
      const failed = log.find((r) => r.responseStatus === 429)!;
      assert.ok(ok && failed, `у журналі мають бути обидва виклики: ${log.map((r) => r.responseStatus).join(', ')}`);
      assert.strictEqual(failed.responseStatus, 429, 'невдалий виклик — рядок зі статусом 429');
      assert.strictEqual(failed.taskId, null, 'і без task id');
      assert.strictEqual(ok.responseStatus, 200);
      assert.strictEqual(ok.taskId, 'task-1', 'task id з відповіді вендора — на рядку журналу');
      assert.strictEqual(ok.lane, 'availability');
      assert.strictEqual(ok.rowsCount, 1);
      assert.deepStrictEqual(ok.summary.fields, ['availability'], 'ключі тіла названі на рядку — це те, що звіряє контролер');
      assert.deepStrictEqual(ok.summary.unitTypeIds, [UT], 'наші координати поруч із тілом');
      assert.strictEqual(ok.summary.from, D9);
      assert.strictEqual(ok.summary.to, D9);
      assert.strictEqual(ok.requestBody.values[0].room_type_id, 'remote-ut', 'тіло — дослівно те, що пішло');
      console.log('  ok  журнал відправлень: кожен виклик рядком з тілом, статусом, task id і ключами');
    }

    // ── 11. Писач календаря ставить маску з того, що СПРАВДІ змінилось ─────
    //
    // Екран редактора дня шле всю форму (мінімум, «закрито», CTA/CTD) щоразу;
    // маска — це різниця з рядком у базі, а не склад запиту. Осі: ціна на
    // ніч БЕЗ ціни — «ціна» + «закрито» (джерело зʼявилось, Ц34 (б)); лише
    // мінімум — «мінімум»; лише «закрито» — «закрито»; лише число ціни —
    // «ціна»; те саме ще раз — координати немає взагалі.
    {
      const D10 = addDays(DAY, 90);
      const { upsertPrices, getPriceMonth } = await import('@pricing');
      const mask = async () => {
        const rows = (await queuedChanges(CONN)).filter((r) => r.kind === 'rate' && r.date === D10);
        return rows.length === 1 ? rows[0].fields : rows.length === 0 ? 'none' : 'many';
      };
      const reset = () => sql.run('DELETE FROM cm_outbox WHERE organization_id = ?', [ORG]);
      await reset();
      await bulkUpdatePrices({ unitTypeId: UT, dateFrom: D10, dateTo: D10, applyTo: 'all', base_price: 150 });
      assert.deepStrictEqual(await mask(), ['prices', 'closed'], 'ціна на ніч без ціни — джерело зʼявилось: ціна І явне відкриття (И14)');
      await reset();
      await bulkUpdatePrices({ unitTypeId: UT, dateFrom: D10, dateTo: D10, applyTo: 'all', min_stay: 2 });
      assert.deepStrictEqual(await mask(), ['minStay'], 'масово лише мінімум — маска «мінімум»');
      await reset();
      await upsertPrices(UT, [{ date: D10, base_price: 150, min_stay: 2, closed: true }]);
      assert.deepStrictEqual(await mask(), ['closed'], 'форма дня з тією ж ціною й мінімумом, змінилось лише «закрито» — маска «закрито»');
      await reset();
      await upsertPrices(UT, [{ date: D10, base_price: 160, min_stay: 2, closed: true }]);
      assert.deepStrictEqual(await mask(), ['prices'], 'змінилось лише число ціни — маска «ціна», без stop_sell (Ц34)');
      await reset();
      await upsertPrices(UT, [{ date: D10, base_price: 160, min_stay: 2, closed: true }]);
      assert.strictEqual(await mask(), 'none', 'нічого не змінилось — координати немає: зайвий виклик із ліміту');
      // Явний `null` ціни (Блок 0.6 B4): маска каже «ціна зникла» — і рядок
      // мусить казати те саме; до того COALESCE лишав 160, і маска брехала.
      await reset();
      await upsertPrices(UT, [{ date: D10, base_price: null }]);
      assert.deepStrictEqual(await mask(), ['prices', 'closed'], 'ціна прибрана — «ціна» + «закрито» (джерело зникло, Ц34 (б))');
      const [y10, m10] = [Number(D10.slice(0, 4)), Number(D10.slice(5, 7))];
      const day10 = (await getPriceMonth(UT, m10, y10)).days.find((d) => d.date === D10)!;
      assert.strictEqual(day10.effective_price, null, `маска сказала «ціна зникла», а в рядку лишилось ${day10.effective_price} — маска бреше`);
      assert.strictEqual(day10.min_stay, 2, 'мінімум, якого в запиті не було, не скинувся');
      console.log('  ok  писач календаря: маска — різниця з рядком, не склад запиту; без зміни — без координати; null прибирає, і рядок каже те саме, що маска');
    }

    // ── 12. Обмеження на ПАРІ: своє їде лише на пару; «на всі тарифи типу» — на кожну, власне не затирається ─
    //
    // Ц32 переглянуто власником 07.09 (тести 5/7/8 сертифікації ставлять різне
    // на тарифи одного типу; Hoteliera і Channex тримають обмеження на
    // тарифі). Ефективне обмеження пари = рядок пари, якщо задано, інакше
    // базовий рядок типу. З вибраним тарифом обмеження лягають у РЯДОК ПАРИ і
    // їдуть лише на її пару; «на всі тарифи типу» (`restrictionsScope: 'type'`)
    // — у базовий рядок, координата на кожну пару, а пара зі своїм значенням
    // тримає його (батчер читає ефективне).
    //
    // Осі (інваріант 26): друга пара на тому ж типі — без неї «на всі пари»
    // і «на вибрану» нерозрізненні; мінімум 3 проти дефолту 1; «закрито»
    // окремо від мінімуму; ціна тарифу — лише його пара; масовий редактор;
    // «на всі тарифи» 5 проти власного 4 пари — тип не затирає власне.
    {
      const RP2 = `${ORG}_rp2`;
      const D12 = addDays(DAY, 100);
      const { upsertPrices, getPriceMonth } = await import('@pricing');
      await asOrg.run(
        `INSERT INTO rate_plans (id, property_id, name, code, currency, is_active, is_hidden, priority)
         VALUES (?, ?, ?, ?, 'EUR', TRUE, FALSE, 0)`,
        [RP2, PROP, 'Bed & Breakfast', 'BB'],
      );
      for (const [entityType, occupancy] of [['rate_plan', 0], ['rate_plan_option', 2]] as const) {
        await asOrg.run(
          `INSERT INTO cm_mappings (id, organization_id, connection_id, entity_type, local_id, unit_type_id, occupancy, remote_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [`${CONN}_m2_${entityType}_${occupancy}`, ORG, CONN, entityType, RP2, UT, occupancy, 'remote-rp2'],
        );
      }
      const reset = () => sql.run('DELETE FROM cm_outbox WHERE organization_id = ?', [ORG]);
      const bodyKeys = (v: Record<string, unknown>) => Object.keys(v).filter((k) => !['property_id', 'rate_plan_id', 'date', 'date_from', 'date_to'].includes(k)).sort();
      const pairOn = (calls: { path: string; body: any }[], remoteRp: string) => {
        const rates = calls.find((c) => c.path.endsWith('/restrictions'));
        return rates?.body.values.find((x: any) => x.rate_plan_id === remoteRp && (x.date === D12 || (x.date_from <= D12 && D12 <= x.date_to)));
      };
      const queued = async () => (await queuedChanges(CONN)).filter((r) => r.kind === 'rate' && r.date === D12).sort((a, b) => String(a.ratePlanId).localeCompare(String(b.ratePlanId)));
      // Що лежить у календарі — дверима `@pricing` (інваріант 16): сітка типу
      // і сітка тарифу; `inherited` — власної ціни тарифу на день немає.
      const [Y12, M12] = [Number(D12.slice(0, 4)), Number(D12.slice(5, 7))];
      const gridDay = async (rp?: string) => (await getPriceMonth(UT, M12, Y12, rp)).days.find((d) => d.date === D12)!;

      await reset();
      await bulkUpdatePrices({ unitTypeId: UT, dateFrom: D12, dateTo: D12, applyTo: 'all', base_price: 150 });
      await reset();

      // Вісь 1: мінімум 3 з вибраним тарифом → рядок ПАРИ, координата лише на неї, лише мінімум у тілі.
      await upsertPrices(UT, [{ date: D12, min_stay: 3 }], { ratePlanId: RP });
      let rows = await queued();
      assert.deepStrictEqual(rows.map((r) => [r.ratePlanId, r.fields]), [[RP, ['minStay']]],
        `обмеження пари — координата лише на ЇЇ пару з маскою «мінімум», а не ${JSON.stringify(rows.map((r) => [r.ratePlanId, r.fields]))}`);
      assert.strictEqual((await gridDay()).min_stay, 1, 'базовий рядок типу не зачеплений — сітка типу показує 1');
      assert.strictEqual((await gridDay(RP)).min_stay, 3, 'сітка тарифу — ефективний мінімум пари 3');
      assert.strictEqual((await gridDay(RP)).restrictionsOwn, true, '…і каже, що він власний');
      assert.strictEqual((await gridDay(RP)).inherited, true, 'ціни тарифу при цьому немає — успадкована');
      assert.strictEqual((await gridDay(RP2)).min_stay, 1, 'сусідня пара не бачить чужого мінімуму');
      // Свій лічильник на кожен прохід: спільний бюджет зʼєднання витрачено попередніми сценами.
      const t1 = transport([]);
      const r1 = await ariFlush(CONN, 'key', { client: { fetch: t1.fetch, limiter: new ChannexRateLimiter() } });
      assert.strictEqual(r1.failed, 0, r1.errors.join(' | '));
      const v1 = pairOn(t1.calls, 'remote-rp');
      assert.ok(v1, `remote-rp: ніч ${D12} мала поїхати`);
      assert.strictEqual(v1.min_stay_arrival, 3, `мінімум 3 пари мав доїхати, поїхало ${JSON.stringify(v1)}`);
      assert.deepStrictEqual(bodyKeys(v1), ['min_stay_arrival'], `у тілі лише мінімум, а не ${bodyKeys(v1).join(',')}`);
      assert.strictEqual(pairOn(t1.calls, 'remote-rp2'), undefined, 'сусідня пара в тілі відсутня — «Unexpected rate plan in update» тесту 5 не буде');

      // Вісь 2: «Закрито» з вибраним тарифом → stop_sell лише на цій парі; тип відкритий.
      await upsertPrices(UT, [{ date: D12, min_stay: 3, closed: true }], { ratePlanId: RP });
      rows = await queued();
      assert.deepStrictEqual(rows.map((r) => [r.ratePlanId, r.fields]), [[RP, ['closed']]], `«закрито» пари — лише її координата з маскою «закрито»: ${JSON.stringify(rows.map((r) => [r.ratePlanId, r.fields]))}`);
      const t2 = transport([]);
      await ariFlush(CONN, 'key', { client: { fetch: t2.fetch, limiter: new ChannexRateLimiter() } });
      const v2 = pairOn(t2.calls, 'remote-rp');
      assert.strictEqual(v2?.stop_sell, true, `stop_sell пари мав бути true, поїхало ${JSON.stringify(v2)}`);
      assert.deepStrictEqual(bodyKeys(v2 ?? {}), ['stop_sell']);
      assert.strictEqual(pairOn(t2.calls, 'remote-rp2'), undefined, 'закрита пара при відкритому типі — сусідня пара не чує нічого');

      // Вісь 3: ціна з вибраним тарифом і «відкрито» — обидва лише на ЙОГО пару,
      // однією координатою зі злитою маскою. (Закриту ніч жодне джерело не
      // цінує — Д2, тож відкриваємо тут же.)
      await upsertPrices(UT, [{ date: D12, base_price: 200, min_stay: 3, closed: false }], { ratePlanId: RP });
      rows = await queued();
      assert.deepStrictEqual(rows.map((r) => [r.ratePlanId, r.fields]), [[RP, ['prices', 'closed']]],
        `ціна й відкриття — лише на пару тарифу: ${JSON.stringify(rows.map((r) => [r.ratePlanId, r.fields]))}`);
      assert.strictEqual((await gridDay(RP)).base_price, 200, 'ціна тарифу — у рядку тарифу');
      assert.strictEqual((await gridDay(RP)).inherited, false);
      assert.strictEqual((await gridDay(RP2)).inherited, true, 'другий тариф власної ціни не отримав — успадковує базову');
      assert.strictEqual((await gridDay(RP2)).base_price, 150);
      const t3 = transport([]);
      const r3 = await ariFlush(CONN, 'key', { client: { fetch: t3.fetch, limiter: new ChannexRateLimiter() } });
      assert.strictEqual(r3.failed, 0, r3.errors.join(' | '));
      const v3a = pairOn(t3.calls, 'remote-rp');
      assert.deepStrictEqual(v3a?.rates, [{ occupancy: 2, rate: 20000 }], `ціна тарифу доїхала на його пару: ${JSON.stringify(v3a)}`);
      assert.strictEqual(v3a?.stop_sell, false, 'і ніч відкрита явно');
      assert.strictEqual(pairOn(t3.calls, 'remote-rp2'), undefined, 'друга пара не в тілі');

      // Вісь 4: масовий редактор з вибраним тарифом — те саме правило (пара).
      await bulkUpdatePrices({ unitTypeId: UT, dateFrom: D12, dateTo: D12, applyTo: 'all', ratePlanId: RP, min_stay: 4 });
      rows = await queued();
      assert.deepStrictEqual(rows.map((r) => [r.ratePlanId, r.fields]), [[RP, ['minStay']]], `масовий: мінімум з тарифом — лише його пара: ${JSON.stringify(rows.map((r) => [r.ratePlanId, r.fields]))}`);
      assert.strictEqual((await gridDay()).min_stay, 1, 'масовий: базовий рядок типу не зачеплений');
      assert.strictEqual((await gridDay(RP)).min_stay, 4, 'масовий: власний мінімум пари 4');
      assert.strictEqual((await gridDay(RP)).base_price, 200, 'масовий: ціна тарифу при цьому не зачеплена');
      await reset();

      // Вісь 5: «на всі тарифи типу» з вибраним тарифом → базовий рядок, координата
      // на кожну пару; власне 4 у RP лишається, RP2 бере 5 від типу.
      await upsertPrices(UT, [{ date: D12, min_stay: 5 }], { ratePlanId: RP, restrictionsScope: 'type' });
      rows = await queued();
      assert.deepStrictEqual(rows.map((r) => [r.ratePlanId, r.fields]), [[RP, ['minStay']], [RP2, ['minStay']]],
        `«на всі тарифи типу» — координата на кожну пару: ${JSON.stringify(rows.map((r) => [r.ratePlanId, r.fields]))}`);
      assert.strictEqual((await gridDay()).min_stay, 5, 'тип — 5');
      assert.strictEqual((await gridDay(RP)).min_stay, 4, 'RP тримає власне 4 — тип не затирає');
      assert.strictEqual((await gridDay(RP2)).min_stay, 5, 'RP2 без свого — 5 від типу');
      const t5 = transport([]);
      await ariFlush(CONN, 'key', { client: { fetch: t5.fetch, limiter: new ChannexRateLimiter() } });
      assert.strictEqual(pairOn(t5.calls, 'remote-rp')?.min_stay_arrival, 4, 'у канал для RP їде ВЛАСНЕ 4, не 5 типу');
      assert.strictEqual(pairOn(t5.calls, 'remote-rp2')?.min_stay_arrival, 5, 'для RP2 — 5 типу');
      // Скинути власне пари → успадкувати: null на парі. «Відкрито» з осі 3 —
      // теж власне значення пари (явне false), скидається так само.
      await upsertPrices(UT, [{ date: D12, min_stay: null }], { ratePlanId: RP });
      assert.strictEqual((await gridDay(RP)).min_stay, 5, 'null на парі — далі як у типу (5)');
      assert.strictEqual((await gridDay(RP)).restrictionsOwn, true, 'явне «відкрито» з осі 3 — ще власне значення пари');
      await upsertPrices(UT, [{ date: D12, closed: null }], { ratePlanId: RP });
      assert.strictEqual((await gridDay(RP)).restrictionsOwn, false, 'усе скинуто — пара без власних обмежень');
      await reset();
      console.log('  ok  обмеження на парі: своє їде лише на пару; «на всі тарифи типу» — на кожну, власне не затирається; null — як у типу');
    }

    // ── 14. Тести 5, 7, 8 сертифікації — по формі листа: різне на різних парах одного типу ─
    //
    // Тест 5: три мінімуми на трьох парах у три дати → три координати, у тілі
    // лише `min_stay_arrival` і лише ці три пари. Тест 7: два діапазони на
    // двох тарифах Twin — кожен лише свої поля, і жодного значення на парах
    // Double. Тест 8: мінімум і ціна на Twin BAR і Double BAR — Double B&B у
    // тілі відсутній. Дати — відносні (не листа), форма — його.
    {
      const TWIN = `${ORG}_twin`;
      const RP2 = `${ORG}_rp2`;
      const { upsertPrices } = await import('@pricing');
      await asOrg.run(
        `INSERT INTO unit_types (id, property_id, category_id, name, code, max_adults, max_children, max_occupancy, base_occupancy, is_active, bookable_online)
         VALUES (?, ?, ?, ?, ?, 2, 0, 2, 2, TRUE, TRUE)`,
        [TWIN, PROP, `${ORG}_cat`, 'Twin', 'TWIN'],
      );
      await asOrg.run(`INSERT INTO units (id, property_id, unit_type_id, category_id, name, code, is_active) VALUES (?, ?, ?, ?, ?, ?, TRUE)`, [`${ORG}_u_twin`, PROP, TWIN, `${ORG}_cat`, '201', '201']);
      const mirror14: [string, string, string, number, string][] = [
        ['unit_type', TWIN, '', 0, 'remote-ut-twin'],
        ['rate_plan', RP, TWIN, 0, 'remote-twin-bar'], ['rate_plan_option', RP, TWIN, 2, 'remote-twin-bar'],
        ['rate_plan', RP2, TWIN, 0, 'remote-twin-bb'], ['rate_plan_option', RP2, TWIN, 2, 'remote-twin-bb'],
      ];
      for (const [entityType, localId, unitTypeId, occupancy, remoteId] of mirror14) {
        await asOrg.run(
          `INSERT INTO cm_mappings (id, organization_id, connection_id, entity_type, local_id, unit_type_id, occupancy, remote_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [`${CONN}_m14_${entityType}_${localId}_${occupancy}`, ORG, CONN, entityType, localId, unitTypeId, occupancy, remoteId],
        );
      }
      const REMOTE = { twinBar: 'remote-twin-bar', twinBb: 'remote-twin-bb', dblBar: 'remote-rp', dblBb: 'remote-rp2' };
      const from = addDays(DAY, 200);
      const to = addDays(DAY, 230);
      // Ціни на всі чотири пари через базові рядки типів — щоб ніч була відкрита і несла лише те, що змінилось.
      await bulkUpdatePrices({ unitTypeId: TWIN, dateFrom: from, dateTo: to, applyTo: 'all', base_price: 100 });
      await bulkUpdatePrices({ unitTypeId: UT, dateFrom: from, dateTo: to, applyTo: 'all', base_price: 120 });
      const reset = () => sql.run('DELETE FROM cm_outbox WHERE organization_id = ?', [ORG]);
      const bodyKeys = (v: Record<string, unknown>) => Object.keys(v).filter((k) => !['property_id', 'rate_plan_id', 'date', 'date_from', 'date_to'].includes(k)).sort();
      const valuesFor = (calls: { path: string; body: any }[], remote: string) =>
        (calls.find((c) => c.path.endsWith('/restrictions'))?.body.values ?? []).filter((x: any) => x.rate_plan_id === remote);
      const flush = async () => {
        const tr = transport([]);
        const r = await ariFlush(CONN, 'key', { client: { fetch: tr.fetch, limiter: new ChannexRateLimiter() } });
        assert.strictEqual(r.failed, 0, r.errors.join(' | '));
        return tr.calls;
      };

      // Тест 5: Twin BAR d+1 = 3; Double BAR d+3 = 2; Double B&B d+5 = 5.
      await reset();
      const [d5a, d5b, d5c] = [addDays(from, 1), addDays(from, 3), addDays(from, 5)];
      await upsertPrices(TWIN, [{ date: d5a, min_stay: 3 }], { ratePlanId: RP });
      await upsertPrices(UT, [{ date: d5b, min_stay: 2 }], { ratePlanId: RP });
      await upsertPrices(UT, [{ date: d5c, min_stay: 5 }], { ratePlanId: RP2 });
      const q5 = (await queuedChanges(CONN)).filter((r) => r.kind === 'rate');
      assert.strictEqual(q5.length, 3, `три пари × три дати — три координати, а не ${q5.length}`);
      const c5 = await flush();
      const all5 = c5.find((c) => c.path.endsWith('/restrictions'))?.body.values ?? [];
      assert.strictEqual(all5.length, 3, `у тілі рівно три значення, а не ${all5.length}: ${JSON.stringify(all5)}`);
      const v5 = (remote: string, date: string) => all5.find((x: any) => x.rate_plan_id === remote && (x.date === date || (x.date_from <= date && date <= x.date_to)));
      assert.strictEqual(v5(REMOTE.twinBar, d5a)?.min_stay_arrival, 3, 'Twin BAR — 3');
      assert.strictEqual(v5(REMOTE.dblBar, d5b)?.min_stay_arrival, 2, 'Double BAR — 2');
      assert.strictEqual(v5(REMOTE.dblBb, d5c)?.min_stay_arrival, 5, 'Double B&B — 5');
      for (const v of all5) assert.deepStrictEqual(bodyKeys(v), ['min_stay_arrival'], `лише мінімум: ${JSON.stringify(v)}`);
      assert.strictEqual(valuesFor(c5, REMOTE.twinBb).length, 0, 'Twin B&B у тілі немає — не «Unexpected rate plan»');

      // Тест 7: Twin BAR d+10..d+19: CTA on, CTD off, max 4, min 1; Twin B&B d+21..d+25: CTA off, CTD on, min 6.
      await reset();
      await bulkUpdatePrices({ unitTypeId: TWIN, dateFrom: addDays(from, 10), dateTo: addDays(from, 19), applyTo: 'all', ratePlanId: RP, cta: true, ctd: false, max_stay: 4, min_stay: 1 });
      await bulkUpdatePrices({ unitTypeId: TWIN, dateFrom: addDays(from, 21), dateTo: addDays(from, 25), applyTo: 'all', ratePlanId: RP2, cta: false, ctd: true, min_stay: 6 });
      const c7 = await flush();
      const bar7 = valuesFor(c7, REMOTE.twinBar);
      const bb7 = valuesFor(c7, REMOTE.twinBb);
      assert.ok(bar7.length >= 1 && bar7.every((v: any) => v.closed_to_arrival === true && v.max_stay === 4 && !('min_stay_arrival' in v && v.min_stay_arrival !== 1)),
        `Twin BAR — лише свої поля (CTA, max 4): ${JSON.stringify(bar7)}`);
      assert.ok(bar7.every((v: any) => !('closed_to_departure' in v) || v.closed_to_departure === false), 'CTD off — незмінне не їде або їде false');
      assert.ok(bb7.length >= 1 && bb7.every((v: any) => v.closed_to_departure === true && v.min_stay_arrival === 6 && !('closed_to_arrival' in v && v.closed_to_arrival === true)),
        `Twin B&B — лише свої поля (CTD, min 6): ${JSON.stringify(bb7)}`);
      assert.ok(bar7.every((v: any) => v.date_to < addDays(from, 21)) && bb7.every((v: any) => v.date_from > addDays(from, 19)), 'діапазони кожен свій, не перетинаються');
      assert.strictEqual(valuesFor(c7, REMOTE.dblBar).length + valuesFor(c7, REMOTE.dblBb).length, 0, 'пари Double у тілі відсутні');

      // Тест 8: Twin BAR d+26..d+30 = 432, CTA off, CTD off, min 2; Double BAR = 342, min 3; Double B&B не чіпати.
      await reset();
      await bulkUpdatePrices({ unitTypeId: TWIN, dateFrom: addDays(from, 26), dateTo: to, applyTo: 'all', ratePlanId: RP, base_price: 432, cta: false, ctd: false, min_stay: 2 });
      await bulkUpdatePrices({ unitTypeId: UT, dateFrom: addDays(from, 26), dateTo: to, applyTo: 'all', ratePlanId: RP, base_price: 342, min_stay: 3 });
      const c8 = await flush();
      const bar8 = valuesFor(c8, REMOTE.twinBar);
      const dbar8 = valuesFor(c8, REMOTE.dblBar);
      assert.ok(bar8.length >= 1 && bar8.every((v: any) => v.min_stay_arrival === 2 && v.rates?.[0]?.rate === 43200), `Twin BAR: 432 і мінімум 2: ${JSON.stringify(bar8)}`);
      assert.ok(dbar8.length >= 1 && dbar8.every((v: any) => v.min_stay_arrival === 3 && v.rates?.[0]?.rate === 34200), `Double BAR: 342 і мінімум 3: ${JSON.stringify(dbar8)}`);
      assert.strictEqual(valuesFor(c8, REMOTE.dblBb).length, 0, 'Double B&B не чіпали — його в тілі немає');
      assert.strictEqual(valuesFor(c8, REMOTE.twinBb).length, 0, 'Twin B&B теж');
      await reset();
      console.log('  ok  тести 5/7/8: різні обмеження на різних парах одного типу — кожна пара несе лише своє, сусідні в тілі відсутні');
    }

    // ── 13. Опція без джерела ціни НЕ закриває пару (Блок 0.6 B1) ──────────
    //
    // `pricesAt` на одній `missing` заселеності віддавав `null` — і батчер
    // закривав усю пару `stop_sell: true`. Дзеркало тримає опції 1..max_adults
    // з часів, коли каталог їх так і заводив; після e29e063 (Ц26 (б)) ніч без
    // рядка матриці на цю кількість дорослих — без ціни, тож живий `per_person`
    // тариф із матрицею не на всі кількості після деплою й 0067 закрився б на
    // всі ночі. Тепер: цінуються ті опції, на які ціна є; опція без джерела в
    // тіло не входить; пара закривається лише коли ціни немає на ЖОДНУ опцію.
    //
    // Осі (інваріант 26): три опції в дзеркалі, ціна на дві (1 і 2 — різні
    // числа, 120 і 150: «усі однакові» не пройде), третя без рядка матриці;
    // окремо — ніч без ціни взагалі, яка таки закривається.
    {
      const UT3 = `${ORG}_ut3`;
      const D13 = addDays(DAY, 110);
      const D14 = addDays(DAY, 111);
      const { createOccupancyRow, upsertPrices } = await import('@pricing');
      await asOrg.run(
        `INSERT INTO unit_types (id, property_id, category_id, name, code,
                                 max_adults, max_children, max_occupancy, base_occupancy, is_active, bookable_online)
         VALUES (?, ?, ?, ?, ?, 3, 0, 3, 2, TRUE, TRUE)`,
        [UT3, PROP, `${ORG}_cat`, 'Triple', 'TRP'],
      );
      await asOrg.run(
        `INSERT INTO units (id, property_id, unit_type_id, category_id, name, code, is_active) VALUES (?, ?, ?, ?, ?, ?, TRUE)`,
        [`${ORG}_u3`, PROP, UT3, `${ORG}_cat`, '301', '301'],
      );
      const mirror3: [string, string, string, number, string][] = [
        ['unit_type', UT3, '', 0, 'remote-ut3'],
        ['rate_plan', RP, UT3, 0, 'remote-rp-ut3'],
        // Опції — зі своїми id, як у вендора (первинна + вторинні; дзеркало
        // тримає UNIQUE на remote_id у межах зʼєднання).
        ['rate_plan_option', RP, UT3, 1, 'remote-rp-ut3-o1'],
        ['rate_plan_option', RP, UT3, 2, 'remote-rp-ut3'],
        ['rate_plan_option', RP, UT3, 3, 'remote-rp-ut3-o3'],
      ];
      for (const [entityType, localId, unitTypeId, occupancy, remoteId] of mirror3) {
        await asOrg.run(
          `INSERT INTO cm_mappings (id, organization_id, connection_id, entity_type, local_id, unit_type_id, occupancy, remote_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [`${CONN}_m3_${entityType}_${occupancy}`, ORG, CONN, entityType, localId, unitTypeId, occupancy, remoteId],
        );
      }
      await bulkUpdatePrices({ unitTypeId: UT3, dateFrom: D13, dateTo: D13, applyTo: 'all', base_price: 150 });
      // Ціна ТАРИФУ на дату: саме на ній надбавка йде з матриці, і заселеність
      // без рядка — без ціни (Ц26 (б)); базовий рядок типу цінує будь-яку
      // кількість дорослих однаково і цієї осі не має.
      await upsertPrices(UT3, [{ date: D13, base_price: 150 }], { ratePlanId: RP });
      await createOccupancyRow(PROP, { unit_type_id: UT3, persons: 2, price_gross: 150 });
      await createOccupancyRow(PROP, { unit_type_id: UT3, persons: 1, price_gross: 120 });
      await asOrg.run('DELETE FROM cm_outbox WHERE organization_id = ?', [ORG]);

      await enqueueChange(sql, CONN, { kind: 'rate', unitTypeId: UT3, ratePlanId: RP, date: D13 });
      const t13 = transport([]);
      const r13 = await ariFlush(CONN, 'key', { client: { fetch: t13.fetch, limiter: new ChannexRateLimiter() } });
      assert.strictEqual(r13.failed, 0, r13.errors.join(' | '));
      const v13 = t13.calls.find((c) => c.path.endsWith('/restrictions'))?.body.values.find((x: any) => x.rate_plan_id === 'remote-rp-ut3' && x.date === D13);
      assert.ok(v13, 'ніч пари мала поїхати');
      assert.strictEqual(v13.stop_sell, false, `дві опції з ціною, одна без — пара НЕ закривається, а поїхало ${JSON.stringify(v13)}`);
      assert.deepStrictEqual(v13.rates, [{ occupancy: 1, rate: 12000 }, { occupancy: 2, rate: 15000 }],
        `у тілі — лише опції з ціною, кожна зі своїм числом: ${JSON.stringify(v13.rates)}`);

      // Ніч без ціни на жодну опцію — закривається, як і раніше. Матриця без
      // дат цінує будь-яку ніч, тож «без ціни взагалі» тут — закритий день:
      // закриту ніч не цінує жодне джерело (Д2).
      await bulkUpdatePrices({ unitTypeId: UT3, dateFrom: D14, dateTo: D14, applyTo: 'all', closed: true });
      await asOrg.run('DELETE FROM cm_outbox WHERE organization_id = ?', [ORG]);
      await enqueueChange(sql, CONN, { kind: 'rate', unitTypeId: UT3, ratePlanId: RP, date: D14 });
      const t14 = transport([]);
      await ariFlush(CONN, 'key', { client: { fetch: t14.fetch, limiter: new ChannexRateLimiter() } });
      const v14 = t14.calls.find((c) => c.path.endsWith('/restrictions'))?.body.values.find((x: any) => x.rate_plan_id === 'remote-rp-ut3' && x.date === D14);
      assert.strictEqual(v14?.stop_sell, true, `ціни немає на жодну опцію — ніч закрита: ${JSON.stringify(v14)}`);
      assert.ok(!('rates' in (v14 ?? {})), 'і без цін');
      assert.strictEqual(await pendingCount(CONN), 0);
      console.log('  ok  опція без джерела ціни випадає з тіла, пара лишається відкритою; без ціни на жодну — закрита');
    }

    // ── 15. У канал не їдуть правила, які на добовій координаті брешуть ────
    //
    // Рецензія 07.09 раунд 2, правка 4.2. Батчер цінує кожну дату як окрему
    // поїздку на ОДНУ ніч (`nights: 1`, `checkIn: date`). Умови, які
    // говорять про поїздку цілком, на такій координаті означають не те:
    //
    //   * `max_los` — правило «1–2 ночі +30 %» проходить умову на КОЖНІЙ
    //     даті, тож гість OTA з семи ночей платив коротку надбавку сім
    //     разів, а напряму — жодного;
    //   * `period_of_checkin` — «заїзд у ці дні» діяло поночі: ціна кожної
    //     ночі всередині вікна, хоч гість заїхав до нього;
    //   * `period_of_checkout` — те саме зі зсувом на добу (`date + 1`);
    //   * `min_los` — мовчки не їхало ніколи (1 < мінімуму).
    //
    // Тепер вони відсікаються ЯВНО, як і дата бронювання. Ціна в канал —
    // та, що не залежить від тривалості й від того, чия це ніч у поїздці.
    //
    // Осі (інваріант 26): три дати з ОДНАКОВОЮ базою 200,00 і різними
    // правилами — з `max_los` (26000, якби їхало), з `period_of_checkin`
    // (15000, якби їхало) і з правилом на період проживання, яке їхати
    // МУСИТЬ (15000 ≠ 20000). Без третьої дати «нічого не їде» лишалось би
    // зеленим і на коді, який просто вимкнув правила в каналі.
    {
      const { upsertPrices } = await import('@pricing');
      const D15 = addDays(DAY, 200);
      const D16 = addDays(DAY, 201);
      const D17 = addDays(DAY, 202);
      for (const d of [D15, D16, D17]) await upsertPrices(UT, [{ date: d, base_price: 200 }], { ratePlanId: RP });

      // Правила сіються прямим `INSERT` навмисно: писач правил живе в
      // `@pricing/data`, і кликати його звідси означало б пробити межу
      // модуля заради фікстури. Орендар названий явно (інваріант 12).
      const rules: [string, string, string, string, number, string, number | null][] = [
        [`${ORG}_r_los`, 'Коротко +30 %', D15, 'increase', 30, 'percent', 2],
        [`${ORG}_r_in`, 'Заїзд у ці дні −50', D16, 'decrease', 50, 'fixed', null],
        [`${ORG}_r_stay`, 'Проживання −25 %', D17, 'decrease', 25, 'percent', null],
      ];
      const conditionOf = (id: string) => (id.endsWith('_in') ? 'period_of_checkin' : 'period_of_stay');
      for (const [id, name, date, action, value, valueKind, maxLos] of rules) {
        await sql.run(
          `INSERT INTO price_rules (id, organization_id, property_id, name, kind, condition_kind,
                                    date_from, date_to, max_los, action, value, value_kind, priority, is_active)
           VALUES (?, ?, ?, ?, 'rule', ?, ?, ?, ?, ?, ?, ?, 10, TRUE)`,
          [id, ORG, PROP, name, conditionOf(id), date, date, maxLos, action, value, valueKind],
        );
      }

      await sql.run('DELETE FROM cm_outbox WHERE organization_id = ?', [ORG]);
      for (const d of [D15, D16, D17]) await enqueueChange(sql, CONN, { kind: 'rate', unitTypeId: UT, ratePlanId: RP, date: d });
      const t15 = transport([]);
      const r15 = await ariFlush(CONN, 'key', { client: { fetch: t15.fetch, limiter: new ChannexRateLimiter() } });
      assert.strictEqual(r15.failed, 0, r15.errors.join(' | '));
      const sent = t15.calls.filter((c) => c.path.endsWith('/restrictions')).flatMap((c) => c.body.values);
      // Однакові числа сусідніх дат батчер зливає в один `date_range`, тож
      // шукати треба по відрізку, а не по полю `date`.
      const rateOn = (d: string) => sent.find((x: any) => x.rate_plan_id === 'remote-rp'
        && String(x.date_from ?? x.date) <= d && d <= String(x.date_to ?? x.date))?.rates?.[0]?.rate;

      assert.strictEqual(rateOn(D15), 20000,
        `правило з max_los у канал не їде: на добовій координаті воно спрацювало б на кожній ночі, а поїхало ${rateOn(D15)}`);
      assert.strictEqual(rateOn(D16), 20000,
        `правило «період заїзду» у канал не їде: ніч усередині вікна — не обовʼязково ніч заїзду, а поїхало ${rateOn(D16)}`);
      assert.strictEqual(rateOn(D17), 15000,
        `а правило на період ПРОЖИВАННЯ їде: воно про саму ніч, і 200,00 − 25 % = 150,00, а поїхало ${rateOn(D17)}`);

      await sql.run('DELETE FROM price_rules WHERE organization_id = ?', [ORG]);
      await sql.run('DELETE FROM cm_outbox WHERE organization_id = ?', [ORG]);
      console.log('  ok  у канал їдуть лише правила, вирішувані на одній ночі; max_los і вікна заїзду/виїзду — ні');
    }
  });
} finally {
  await cleanup();
}

console.log('ari-adapter: справжній клієнт із підставленим транспортом — 429, warnings, 500 повертають координату; чистий 200 шле');
