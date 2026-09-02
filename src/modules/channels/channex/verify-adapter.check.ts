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
 * і наявність — обидві осі мають по два значення (інваріант 26).
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

const sql = getSql();
const ORG = '__verify_adapter__';
const OTHER = '__verify_adapter_other__';
const PROP = `${ORG}_prop`;
const UT = `${ORG}_ut`;
const RP = `${ORG}_rp`;
const CONN = `${ORG}_conn`;
const DAY = '2027-03-10';
const DAY2 = '2027-03-11';
const TODAY = '2027-03-01';
const NOW = Date.parse('2027-03-01T12:00:00Z');
const OLD = '2027-02-28 10:00:00';
const FRESH = '2027-03-01 11:59:30';

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
      assert.strictEqual(r.matched, 5, '«закрито» ×2 на DAY, «закрито» основної на DAY2, наявність на DAY і DAY2');
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
      // Обмежень ми не називали (рядка календаря немає) — то й не звірених
      // немає: порівнюється лише сказане. Вісь «не віддане» доведена в
      // `domain/verify.check.ts`, де очікуване називає minStay.
      assert.deepStrictEqual(r.unverified, [], 'неназване не рахується ні збігом, ні не звіреним');
      console.log('  ok  розбіжність на неосновній опції видима (И13), назад у чергу однією координатою з причиною');
      await sql.run('DELETE FROM cm_outbox WHERE organization_id = ? AND sent_at IS NULL', [ORG]);
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
      assert.strictEqual(r.matched, 6, '«закрито» ×2 на дві ночі і наявність на обидві');
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
      await sql.run('DELETE FROM cm_outbox WHERE organization_id = ? AND sent_at IS NULL', [ORG]);
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
      await sql.run('DELETE FROM cm_outbox WHERE organization_id = ?', [ORG]);
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
} finally {
  await cleanup();
}

console.log('verify-adapter: календар назад через опції (И13), розбіжне в чергу з причиною, молоде й не віддане названо');
