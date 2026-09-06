/**
 * Звірка П6 — справжній клієнт, підставлений транспорт, календар у ЖИВІЙ формі.
 *
 *   node src/modules/channels/channex/verify-adapter.check.ts
 *
 * Що стверджується:
 *
 *   И13    — календар читається через ОПЦІЇ заселеності: неосновна опція має
 *            власний ключ, і розбіжність на ній видима; звірка, яка шукала б
 *            `rate_plan_id`, бачила б лише основну;
 *   форма  — ціна рядком `"150.00"`, прапорець продажу, наявність поруч —
 *            як у живій відповіді (INVENTORY §4.5), а не як у нашій уяві;
 *   назад  — розбіжне повертається в чергу ОДНІЄЮ координатою на пару × дату
 *            з причиною `verify: …` на рядку; збіг нічого не кладе;
 *   молоде — відправлене менш як хвилину тому не звіряється, а рахується;
 *   немає  — ніч, якої вендор не віддав, — «не звірено», не в чергу;
 *   межа   — один виклик на вікно, з обʼєктом і датами в рядку запиту;
 *   чуже   — інший орендар не звіряє чуже зʼєднання.
 *
 * Без цін і без цінових таблиць навмисно (інваріант 16): координата ціни
 * без джерела розвʼязується в «закрито», тож звірка тут порівнює «закрито»
 * і наявність — обидві осі мають по два значення (інваріант 26). Єдиний
 * виняток — остання сцена (мінімум ночей): базовий рядок сіється ДВЕРИМА
 * `@pricing`, не SQL, і лишається до `cleanup()`.
 *
 * Перевірка була ЧЕРВОНОЮ — зламом мапи опцій (наявність і ціна читались
 * за ідентифікатором тарифу): неосновна опція стала «немає ночі». Інваріант 24.
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';

const { runWithOrganization } = await import('@core/auth/tenant-context');
const { getSql } = await import('@core/db/async');
const { verifySends } = await import('./verify-adapter.ts');
const { queuedChanges } = await import('../data/outbox.repo.ts');
// Ціна й обмеження сіються ДВЕРИМА модуля цін, не рядком у таблицю: інваріант
// 16 тримає гейт `check-price-source` і для перевірок.
const { bulkUpdatePrices, upsertPrices } = await import('@pricing');

const sql = getSql();
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

const ORG = '__verify_adapter__';
const OTHER = '__verify_adapter_other__';
const PROP = `${ORG}_prop`;
const UT = `${ORG}_ut`;
const RP = `${ORG}_rp`;
// Другий тариф того самого типу: без нього сцена 10 не розрізняє «ефективне
// пари» і «ефективне типу» — з одним тарифом обидва прочитання дають те саме
// число (рецензія 07.09 раунд 2, правка 2).
const RP2 = `${ORG}_rp2`;
const CONN = `${ORG}_conn`;
const DAY = '2027-03-10';
const DAY2 = '2027-03-11';
const TODAY = '2027-03-01';
const NOW = Date.parse('2027-03-01T12:00:00Z');
const OLD = '2027-02-28 10:00:00';
const FRESH = '2027-03-01 11:59:30';

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
    await sql.run('DELETE FROM cm_outbox WHERE organization_id IN (?, ?)', [ORG, OTHER]);
    await sql.run('DELETE FROM cm_mappings WHERE organization_id = ?', [ORG]);
    await sql.run('DELETE FROM cm_connections WHERE organization_id = ?', [ORG]);
    // Тип перед тарифами: рядки календаря (у т. ч. рядок ПАРИ з власним
    // обмеженням, сцена 10) ідуть за типом каскадом і посилаються на тариф.
    await sql.run('DELETE FROM units WHERE property_id = ?', [PROP]);
    await sql.run('DELETE FROM unit_types WHERE property_id = ?', [PROP]);
    await sql.run('DELETE FROM rate_plans WHERE property_id = ?', [PROP]);
    await sql.run('DELETE FROM categories WHERE property_id = ?', [PROP]);
    await sql.run('DELETE FROM properties WHERE organization_id = ?', [ORG]);
  });
  await sql.run('DELETE FROM organizations WHERE id IN (?, ?)', [ORG, OTHER]);
}

/** Готель із двома номерами одного типу, тарифом на дві заселеності й зʼєднанням. */
async function seed() {
  await sql.run('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)', [ORG, ORG, ORG]);
  await sql.run('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)', [OTHER, OTHER, OTHER]);
  await runWithOrganization(ORG, async () => {
    await sql.run('INSERT INTO properties (id, organization_id, name, slug) VALUES (?, ?, ?, ?)', [PROP, ORG, ORG, PROP]);
    await sql.run('INSERT INTO categories (id, property_id, name, type) VALUES (?, ?, ?, ?)', [`${ORG}_cat`, PROP, 'Rooms', 'rooms']);
    await sql.run(
      `INSERT INTO unit_types (id, property_id, category_id, name, code,
                               max_adults, max_children, max_occupancy, base_occupancy, is_active, bookable_online)
       VALUES (?, ?, ?, ?, ?, 2, 0, 2, 2, TRUE, TRUE)`,
      [UT, PROP, `${ORG}_cat`, 'Double', 'DBL'],
    );
    for (const n of ['101', '102']) {
      await sql.run(
        `INSERT INTO units (id, property_id, unit_type_id, category_id, name, code, is_active)
         VALUES (?, ?, ?, ?, ?, ?, TRUE)`,
        [`${ORG}_u${n}`, PROP, UT, `${ORG}_cat`, n, n],
      );
    }
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
    // Основна опція носить id самого тарифу, неосновна — свій (INVENTORY §3.1).
    const mirror = [
      ['unit_type', UT, '', 0, 'remote-ut'],
      ['rate_plan', RP, UT, 0, 'remote-rp'],
      ['rate_plan_option', RP, UT, 2, 'remote-rp'],
      ['rate_plan_option', RP, UT, 1, 'remote-rp-occ1'],
    ];
    for (const [entityType, localId, unitTypeId, occupancy, remoteId] of mirror) {
      await sql.run(
        `INSERT INTO cm_mappings (id, organization_id, connection_id, entity_type, local_id, unit_type_id, occupancy, remote_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [`${CONN}_m_${entityType}_${occupancy}`, ORG, CONN, entityType, localId, unitTypeId, occupancy, remoteId],
      );
    }
  });
}

/** Відправлений рядок черги — з розпискою і часом відправлення. */
async function sent(id: string, kind: 'availability' | 'rate', date: string, dateTo: string | null, sentAt: string) {
  await sql.run(
    `INSERT INTO cm_outbox (id, organization_id, connection_id, kind, unit_type_id, rate_plan_id, stay_date, stay_date_to, sent_at, receipt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, ORG, CONN, kind, UT, kind === 'rate' ? RP : null, date, dateTo, sentAt, `task-${id}`],
  );
}

/** Клітинка ЖИВОЇ форми (INVENTORY §4.5): ціна рядком, прапорець, наявність, обмеження порожні. */
const cell = (rate: string, stopSell: boolean, availability: number) => ({
  rate, stop_sell: stopSell, availability, min_stay_arrival: null, min_stay_through: null, max_stay: null,
  closed_to_arrival: false, closed_to_departure: false, unavailable_reasons: [],
});

/** Транспорт: одна відповідь, записує кожен виклик. */
function transport(body: unknown, status = 200) {
  const calls: { url: string; method: string }[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET' });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  return { calls, fetch: fetch as unknown as typeof globalThis.fetch };
}

await cleanup();
await seed();

try {
  await runWithOrganization(ORG, async () => {
    await sent('r1', 'rate', DAY, DAY2, OLD);
    await sent('a1', 'availability', DAY, null, OLD);
    await sent('a2', 'availability', DAY2, null, FRESH);

    // ── 1. Розбіжність ЛИШЕ на неосновній опції — назад у чергу ──────────
    // Джерела ціни немає — обидві опції мали бути закриті; наявність — 2.
    // Основна опція на DAY2 закрита, неосновна — відкрита: звірка за
    // ідентифікатором тарифу побачила б лише основну і сказала б «збігається».
    {
      const t = transport({
        data: {
          'remote-rp': { [DAY]: cell('150.00', true, 2), [DAY2]: cell('150.00', true, 2) },
          'remote-rp-occ1': { [DAY]: cell('120.00', true, 2), [DAY2]: cell('120.00', false, 2) },
        },
      });
      const r = await verifySends(CONN, 'key', { today: TODAY, now: () => NOW, client: { fetch: t.fetch } });
      assert.strictEqual(t.calls.length, 1, 'один виклик на вікно');
      assert.strictEqual(t.calls[0].method, 'GET');
      assert.match(t.calls[0].url, /filter%5Bproperty_id%5D=remote-prop|filter\[property_id\]=remote-prop/, 'межа орендаря в рядку запиту');
      assert.match(t.calls[0].url, new RegExp(`gte%5D=${DAY}|gte\\]=${DAY}`), 'вікно від першої відправленої ночі');
      assert.match(t.calls[0].url, new RegExp(`lte%5D=${DAY2}|lte\\]=${DAY2}`), 'до останньої');
      assert.strictEqual(r.sends, 3);
      assert.strictEqual(r.fresh, 1, 'відправлене пів хвилини тому ще застосовується — не звіряється');
      assert.deepStrictEqual(r.window, { from: DAY, to: DAY2 });
      // DAY: обидві опції закриті, наявність 2 — збіг. DAY2: основна закрита — збіг, неосновна відкрита — розбіжність;
      // наявність DAY2 не слалась, але ніч ціни звіряє наявність свого типу з тієї самої клітинки — збіг.
      // Блок 0.5: без базового рядка очікуване несе ЯВНІ дефолти обмежень
      // (як повний синк) — заборони заїзду/виїзду false збігаються з живою
      // клітинкою (+8: дві опції × дві ночі × два прапорці); мінімум і
      // максимум той бік віддає null — «не звірено», не збіг і не розбіжність.
      assert.strictEqual(r.matched, 13, '«закрито» ×2 на DAY, «закрито» основної на DAY2, наявність на DAY і DAY2, заборони заїзду/виїзду ×8');
      assert.deepStrictEqual(r.mismatches.map((m) => [m.date, m.occupancy, m.field, m.ours, m.theirs]), [
        [DAY2, 1, 'closed', 'true', 'false'],
      ], 'неосновна опція (заселеність 1) звірена ВЛАСНИМ ключем — И13; за ідентифікатором тарифу її не видно');
      assert.strictEqual(r.requeued, 1);
      const back = await queuedChanges(CONN);
      assert.strictEqual(back.length, 1, 'у черзі рівно повернута координата');
      assert.strictEqual(back[0].kind, 'rate');
      assert.strictEqual(back[0].date, DAY2);
      assert.strictEqual(back[0].ratePlanId, RP);
      assert.strictEqual(String(back[0].lastError), 'verify: closed@1 true ≠ false', 'причина на рядку — оператор бачить, чому знову в черзі');
      // Рядка календаря немає — очікуване без маски несе дефолти (Блок 0.5,
      // як повний синк): мінімум 1 і максимум 0 названі, а той бік віддає
      // null — «не звірено» по 4 (дві опції × дві ночі), не збіг і не
      // розбіжність. Вісь «не віддане» окремо — `domain/verify.check.ts`.
      assert.deepStrictEqual(r.unverified, [{ field: 'minStay', count: 4 }, { field: 'maxStay', count: 4 }], 'дефолти названі, той бік мовчить — не звірено, не розбіжність');
      assert.strictEqual(back[0].fields, null, 'повернуте звіркою їде ВСІМ станом — маски немає');
      console.log('  ok  розбіжність на неосновній опції видима (И13), назад у чергу однією координатою з причиною');
      await asOrg.run('DELETE FROM cm_outbox WHERE organization_id = ? AND sent_at IS NULL', [ORG]);
    }

    // ── 2. Усе збігається — нічого не повертається ──────────────────────
    {
      const t = transport({
        data: {
          'remote-rp': { [DAY]: cell('150.00', true, 2), [DAY2]: cell('150.00', true, 2) },
          'remote-rp-occ1': { [DAY]: cell('120.00', true, 2), [DAY2]: cell('120.00', true, 2) },
        },
      });
      const r = await verifySends(CONN, 'key', { today: TODAY, now: () => NOW, client: { fetch: t.fetch } });
      assert.strictEqual(r.mismatches.length, 0);
      assert.strictEqual(r.matched, 14, '«закрито» ×2 на дві ночі, наявність на обидві, і заборони заїзду/виїзду ×8 (дефолти без рядка — Блок 0.5)');
      assert.strictEqual(r.requeued, 0);
      assert.strictEqual((await queuedChanges(CONN)).length, 0, 'збіг нічого не кладе в чергу');
      console.log('  ok  збіг — черга порожня');
    }

    // ── 2б. Нуль наявності на тому боці панує над прапорцем ─────────────
    // Живе 02.09.2026: вендор тримає stop-прапорець, поки наявність нуль.
    // У нас два номери вільні, там нуль і «закрито»: розбіжність — НАЯВНІСТЬ,
    // назад у чергу йде смуга наявності, а не ціна; прапорець не звіряється.
    {
      const t = transport({
        data: {
          'remote-rp': { [DAY]: cell('150.00', true, 0), [DAY2]: cell('150.00', true, 0) },
          'remote-rp-occ1': { [DAY]: cell('120.00', true, 0), [DAY2]: cell('120.00', true, 0) },
        },
      });
      const r = await verifySends(CONN, 'key', { today: TODAY, now: () => NOW, client: { fetch: t.fetch } });
      assert.deepStrictEqual(r.mismatches.map((m) => [m.kind, m.date, m.field, m.ours, m.theirs]).sort(), [
        ['availability', DAY, 'free', '2', '0'],
        ['availability', DAY2, 'free', '2', '0'],
      ], 'розбіжність названа наявністю; «закрито» при нулі там не стверджується');
      const back = await queuedChanges(CONN);
      assert.deepStrictEqual(back.map((b) => [b.kind, b.date]).sort(), [['availability', DAY], ['availability', DAY2]],
        'у чергу йде наявність — те, що знімає прапорець; ціна не крутиться вічно');
      assert.match(String(back[0].lastError), /^verify: free 2 ≠ 0$/);
      console.log('  ok  нуль наявності на тому боці: назад у чергу йде наявність, не ціна');
      await asOrg.run('DELETE FROM cm_outbox WHERE organization_id = ? AND sent_at IS NULL', [ORG]);
    }

    // ── 3. Ночі немає на тому боці — не звірено, не в чергу ─────────────
    {
      const t = transport({
        data: {
          'remote-rp': { [DAY]: cell('150.00', true, 2), [DAY2]: cell('150.00', true, 2) },
          'remote-rp-occ1': { [DAY]: cell('120.00', true, 2) },
        },
      });
      const r = await verifySends(CONN, 'key', { today: TODAY, now: () => NOW, client: { fetch: t.fetch } });
      assert.deepStrictEqual(r.unverified.find((u) => u.field === 'night'), { field: 'night', count: 1 });
      assert.deepStrictEqual(r.mismatches.map((m) => [m.date, m.occupancy, m.field]), [[DAY2, 1, 'night']]);
      assert.strictEqual(r.requeued, 0, 'пересилання ніч у вендора не створить');
      assert.strictEqual((await queuedChanges(CONN)).length, 0);
      console.log('  ok  відсутня ніч — не звірено, видима, не повертається');
    }

    // ── 4. Молоде відправлення без старих — нема чого читати, викликів нуль ─
    {
      await asOrg.run('DELETE FROM cm_outbox WHERE organization_id = ?', [ORG]);
      await sent('a3', 'availability', DAY, null, FRESH);
      const t = transport({ data: {} });
      const r = await verifySends(CONN, 'key', { today: TODAY, now: () => NOW, client: { fetch: t.fetch } });
      assert.strictEqual(t.calls.length, 0, 'нема чого звіряти — у мережу не йдемо');
      assert.strictEqual(r.fresh, 1);
      assert.strictEqual(r.window, null);
      console.log('  ok  лише молоде — жодного виклику, звіт каже «ще застосовується»');
    }
  });

  // ── 5. Чужий орендар не звіряє чуже зʼєднання ─────────────────────────
  await runWithOrganization(OTHER, async () => {
    const t = transport({ data: {} });
    await assert.rejects(
      () => verifySends(CONN, 'key', { today: TODAY, now: () => NOW, client: { fetch: t.fetch } }),
      /connection not found/,
      'чуже зʼєднання для іншого орендаря не існує (інваріант 5)',
    );
    assert.strictEqual(t.calls.length, 0);
    console.log('  ok  чужий орендар — «немає такого», без жодного виклику');

  });

  // ── 9. Мінімум ночей звіряється полем ЗАЇЗДУ, не «наскрізним» ───────
  // Остання сцена навмисно: базовий рядок ціни на DAY лишається до кінця
  // (SQL до цінових таблиць звідси не пишеться — інваріант 16; його
  // прибирає каскад від unit_types у cleanup()).
  // Живе 02.09.2026 (INC-015): обʼєкт із `min_stay_type = both` ігнорує
  // віртуальне `min_stay`, тому шлемо `min_stay_arrival` — і назад
  // читаємо його ж. Дві осі (інваріант 26): клітинка з arrival 2 /
  // through 1 збігається з нашими 2, клітинка з arrival 1 / through 2 —
  // ні. Звірка, що читає through першим, провалює обидві.
  // Власний контекст орендаря: сцена стоїть після блоку «чуже», що бігає
  // під іншою організацією.
  await runWithOrganization(ORG, async () => {
    // Своя черга: попередні сцени її переписали. Одне старе відправлення
    // ціни на DAY — рівно та ніч, про яку йдеться.
    await asOrg.run('DELETE FROM cm_outbox WHERE organization_id = ?', [ORG]);
    await sent('r9', 'rate', DAY, null, OLD);
    // Базовий рядок типу на DAY: ціна 150, мінімум 2 ночі. Писач кладе
    // координату в чергу (Ц16) — вона тут не потрібна, прибирається.
    await bulkUpdatePrices({ unitTypeId: UT, dateFrom: DAY, dateTo: DAY, applyTo: 'all', base_price: 150, min_stay: 2 });
    await asOrg.run('DELETE FROM cm_outbox WHERE organization_id = ? AND sent_at IS NULL', [ORG]);
    const open = (arrival: number, through: number) => ({
      ...cell('150.00', false, 2), min_stay_arrival: arrival, min_stay_through: through,
    });
    const agree = transport({
      data: {
        'remote-rp': { [DAY]: open(2, 1), [DAY2]: cell('150.00', true, 2) },
        'remote-rp-occ1': { [DAY]: open(2, 1), [DAY2]: cell('120.00', true, 2) },
      },
    });
    const a = await verifySends(CONN, 'key', { today: TODAY, now: () => NOW, client: { fetch: agree.fetch } });
    assert.deepStrictEqual(a.mismatches.filter((m) => m.field === 'minStay'), [],
      'arrival 2 / through 1 при наших 2 — збіг: читається поле заїзду');
    await asOrg.run('DELETE FROM cm_outbox WHERE organization_id = ? AND sent_at IS NULL', [ORG]);

    const differ = transport({
      data: {
        'remote-rp': { [DAY]: open(1, 2), [DAY2]: cell('150.00', true, 2) },
        'remote-rp-occ1': { [DAY]: open(1, 2), [DAY2]: cell('120.00', true, 2) },
      },
    });
    const d = await verifySends(CONN, 'key', { today: TODAY, now: () => NOW, client: { fetch: differ.fetch } });
    assert.deepStrictEqual(
      d.mismatches.filter((m) => m.field === 'minStay').map((m) => [m.date, m.occupancy, m.ours, m.theirs]).sort(),
      [[DAY, 1, '2', '1'], [DAY, 2, '2', '1']],
      'arrival 1 / through 2 при наших 2 — розбіжність на кожній опції: through не рятує',
    );
    await asOrg.run('DELETE FROM cm_outbox WHERE organization_id = ? AND sent_at IS NULL', [ORG]);
    console.log('  ok  мінімум ночей звіряється полем заїзду по обох осях');

    // ── 10. Розбіжність на рівні ПАРИ не «лагодиться» значенням типу (Ц32 переглянуто 07.09) ─
    // Пара BAR має власний мінімум 3 при типу 2. Той бік віддає 2 (значення
    // типу) — це РОЗБІЖНІСТЬ для пари: очікуване рахується ефективним
    // обмеженням пари, не типу. Віддає 3 — збіг. Осі: власне 3 проти типу 2.
    // Другий тариф того самого типу — СВОЄЇ ціни й свого обмеження не має:
    // його очікуване мусить лишитись значенням типу (2), поки перший тримає
    // власні 3. Осі сцени: два тарифи однієї пари типу, 3 проти 2 на одну
    // дату; з одним тарифом ця сцена була зелена й на коді до 0072.
    await runWithOrganization(ORG, async () => {
      await asOrg.run(
        `INSERT INTO rate_plans (id, property_id, name, code, currency, is_active, is_hidden, priority)
         VALUES (?, ?, ?, ?, 'EUR', TRUE, FALSE, 1)`,
        [RP2, PROP, 'Bed & Breakfast', 'BB'],
      );
      for (const [entityType, occupancy, remoteId] of [
        ['rate_plan', 0, 'remote-rp2'], ['rate_plan_option', 2, 'remote-rp2'], ['rate_plan_option', 1, 'remote-rp2-occ1'],
      ] as [string, number, string][]) {
        await asOrg.run(
          `INSERT INTO cm_mappings (id, organization_id, connection_id, entity_type, local_id, unit_type_id, occupancy, remote_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [`${CONN}_m2_${entityType}_${occupancy}`, ORG, CONN, entityType, RP2, UT, occupancy, remoteId],
        );
      }
      await asOrg.run(
        `INSERT INTO cm_outbox (id, organization_id, connection_id, kind, unit_type_id, rate_plan_id, stay_date, stay_date_to, sent_at, receipt)
         VALUES (?, ?, ?, 'rate', ?, ?, ?, NULL, ?, ?)`,
        [`${ORG}_s_rp2`, ORG, CONN, UT, RP2, DAY, '2027-03-01T11:00:00Z', 'task-rp2'],
      );
    });
    await upsertPrices(UT, [{ date: DAY, min_stay: 3 }], { ratePlanId: RP });
    await asOrg.run('DELETE FROM cm_outbox WHERE organization_id = ? AND sent_at IS NULL', [ORG]);
    const typeValue = transport({
      data: {
        'remote-rp': { [DAY]: open(2, 1), [DAY2]: cell('150.00', true, 2) },
        'remote-rp-occ1': { [DAY]: open(2, 1), [DAY2]: cell('120.00', true, 2) },
        // Другий тариф: той бік тримає 2 — для НЬОГО це збіг, бо своїх
        // обмежень у пари немає і ефективне для неї — значення типу.
        'remote-rp2': { [DAY]: open(2, 1) },
        'remote-rp2-occ1': { [DAY]: open(2, 1) },
      },
    });
    const tv = await verifySends(CONN, 'key', { today: TODAY, now: () => NOW, client: { fetch: typeValue.fetch } });
    assert.deepStrictEqual(
      tv.mismatches.filter((m) => m.ratePlanId === RP && m.field === 'minStay').map((m) => [m.date, m.occupancy, m.ours, m.theirs]).sort(),
      [[DAY, 1, '3', '2'], [DAY, 2, '3', '2']],
      'той бік тримає значення типу (2), а пара має своє (3) — розбіжність, тип пару не рятує',
    );
    assert.deepStrictEqual(
      tv.mismatches.filter((m) => m.ratePlanId === RP2 && m.field === 'minStay'), [],
      'а другий тариф того самого типу власного обмеження не має — його очікуване лишається значенням ТИПУ (2), і 2 на тому боці для нього збіг',
    );
    await asOrg.run('DELETE FROM cm_outbox WHERE organization_id = ? AND sent_at IS NULL', [ORG]);
    const pairValue = transport({
      data: {
        'remote-rp': { [DAY]: open(3, 1), [DAY2]: cell('150.00', true, 2) },
        'remote-rp-occ1': { [DAY]: open(3, 1), [DAY2]: cell('120.00', true, 2) },
        // Те саме число на другому тарифі — для НЬОГО це вже розбіжність.
        'remote-rp2': { [DAY]: open(3, 1) },
        'remote-rp2-occ1': { [DAY]: open(3, 1) },
      },
    });
    const pv = await verifySends(CONN, 'key', { today: TODAY, now: () => NOW, client: { fetch: pairValue.fetch } });
    assert.deepStrictEqual(
      pv.mismatches.filter((m) => m.ratePlanId === RP && m.field === 'minStay'), [],
      'той бік тримає власне значення пари (3) — збіг',
    );
    assert.deepStrictEqual(
      pv.mismatches.filter((m) => m.ratePlanId === RP2 && m.field === 'minStay').map((m) => [m.occupancy, m.ours, m.theirs]).sort(),
      [[1, '2', '3'], [2, '2', '3']],
      'і навпаки: 3 на другому тарифі — розбіжність, бо його очікуване 2; інакше сцена стверджувала б про вісь, якої у фікстурі немає',
    );
    await asOrg.run('DELETE FROM cm_outbox WHERE organization_id = ? AND sent_at IS NULL', [ORG]);
    console.log('  ok  звірка порівнює з ефективним обмеженням ПАРИ — значення типу розбіжність не лагодить');
  });
} finally {
  await cleanup();
}

console.log('verify-adapter: календар назад через опції (И13), розбіжне в чергу з причиною, молоде й не віддане названо');
