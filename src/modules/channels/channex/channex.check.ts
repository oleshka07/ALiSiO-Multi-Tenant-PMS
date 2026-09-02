/**
 * Клієнт Channex поводиться правильно на двох відповідях, які виглядають як успіх.
 *
 *   node src/modules/channels/channex/channex.check.ts
 *
 * Це приймання фази 2 (docs/CHANNEX-INTEGRATION.md §9): «мок відповідає 429
 * і 200 з warnings — клієнт поводиться правильно на обох». Обидві відповіді
 * небезпечні тим, що їх легко порахувати нормою: перша має код помилки, але
 * означає «зачекай», а не «зламалось»; друга має код успіху, але означає, що
 * ціни не застосувались.
 *
 * Проти СПРАВЖНЬОГО HTTP, а не підміненого fetch: перевіряємо, що ми
 * правильно ЧИТАЄМО відповідь, а не що правильно її склали.
 *
 * Час тут — вхідні дані, тому перевірка не спить: годинник лімітера
 * рухається рукою, а сон клієнта підмінений лічильником.
 */
import assert from 'node:assert';
// Аліаси й розширення для голого node — модулі імпортують одне одного без
// `.ts`, і без цього хука node їх не знаходить. Спершу хук, потім усе інше.
import '../../../../scripts/lib/module-aliases.mjs';

const { startMockChannex } = await import('./mock-server.ts');
const { ChannexClient, ChannexError, ChannexPaused } = await import('./client.ts');
const { ChannexRateLimiter } = await import('./limiter.ts');
const { availabilityValues, rateValues } = await import('./ari-payload.ts');

const mock = await startMockChannex();
const KEY = 'conn-1';
const PROP = 'remote-prop';

/** Дзеркало пар «наш тариф × наш тип → їхній тариф» — як його бачить `rateValues`. */
const pairMap = (rows: [string, string, string][]) => {
  const m = new Map(rows.map(([rp, ut, id]) => [`${rp}|${ut}`, id]));
  return { get: (rp: string, ut: string) => m.get(`${rp}|${ut}`) };
};


/** Клієнт із керованим часом і без справжнього сну. */
function makeClient(over: Partial<{ maxAttempts: number }> = {}) {
  let clock = 1_000_000;
  const slept: number[] = [];
  const limiter = new ChannexRateLimiter({ now: () => clock });
  const client = new ChannexClient({
    apiKey: 'test-key',
    baseUrl: mock.url,
    limiter,
    now: () => clock,
    sleep: async (ms) => { slept.push(ms); },
    maxAttempts: over.maxAttempts ?? 3,
  });
  return { client, limiter, slept, advance: (ms: number) => { clock += ms; }, at: () => clock };
}

/**
 * Чистий стенд для кожного розділу.
 *
 * Черга відповідей мока — спільна, і залишок від попереднього розділу
 * з'їдається наступним: саме так розділ «не-JSON» одного разу отримав чужий
 * `200` і мовчки пройшов, нічого не перевіривши.
 */
function reset() {
  mock.queue.length = 0;
  mock.calls.length = 0;
}

// ── 1. Ключ їде в заголовку, і саме з тим іменем ─────────────────────────
{
  reset();
  const { client } = makeClient();
  mock.calls.length = 0;
  await client.publishAvailability(KEY, [{ property_id: PROP, room_type_id: 'rt', date: '2026-11-22', availability: 3 }]);
  assert.strictEqual(mock.calls.length, 1, 'виклик не дійшов до сервера');
  assert.strictEqual(mock.calls[0].apiKey, 'test-key', 'ключ не в заголовку user-api-key');
  assert.strictEqual(mock.calls[0].path, '/availability', 'наявність пішла не на свій маршрут');
}

// ── 2. 200 із warnings — це ПОМИЛКА, і видно, що не застосувалось ────────
{
  reset();
  const { client } = makeClient();
  mock.calls.length = 0;
  mock.queue.push({
    kind: 'warnings',
    warnings: [{
      property_id: PROP,
      rate_plan_id: 'rp',
      date: '2026-11-22',
      warning: { rate: ['must be greater than 0'] },
    }],
  });

  const res = await client.publishRestrictions(KEY, [{ property_id: PROP, rate_plan_id: 'rp', date: '2026-11-22', rate: 0 }]);

  assert.strictEqual(res.warnings.length, 1, 'warnings при 200 загубились — саме так ціни зникають мовчки');
  assert.strictEqual(res.taskIds.length, 0, 'порожній data мав означати «не застосовано нічого»');
  assert.strictEqual(res.warnings[0].rate_plan_id, 'rp', 'координати претензії втрачені — нічого повернути в чергу');
}

// ── 3. Часткове застосування відрізняється від повного провалу ───────────
{
  reset();
  const { client } = makeClient();
  mock.queue.push({ kind: 'warnings', warnings: [{ rate_plan_id: 'bad' }], taskIds: ['task-partial'] });
  const res = await client.publishRestrictions(KEY, [{ property_id: PROP, rate_plan_id: 'rp', date: '2026-11-22', rate: 100 }]);
  assert.strictEqual(res.taskIds.length, 1, 'часткове застосування прочиталось як повний провал');
  assert.strictEqual(res.warnings.length, 1, 'частина, яку відкинули, лишилась непоміченою');
}

// ── 4. 429: об'єкт на хвилину, БЕЗ негайного повтору ─────────────────────
//
// Повтор через секунду після «забагато запитів» дає ще один 429 і добиває
// квоту, яка й так вичерпана. Channex просить протилежного: «pause updates
// for the property for 1 minute and try again».
{
  reset();
  const { client, limiter, slept } = makeClient();
  mock.calls.length = 0;
  mock.queue.push({ kind: 'rateLimited' }, { kind: 'ok', taskIds: ['must-not-be-reached'] });

  await assert.rejects(
    () => client.publishAvailability(KEY, [{ property_id: PROP, room_type_id: 'rt', date: '2026-11-22', availability: 1 }]),
    (e: unknown) => e instanceof ChannexError && e.status === 429 && e.retryable,
    '429 мав долетіти нагору як тимчасова помилка — рядки лишаються в черзі',
  );
  assert.strictEqual(mock.calls.length, 1, '429 був повторений одразу — це другий 429 і згоріла квота');
  assert.deepStrictEqual(slept, [], 'після 429 клієнт спав усередині виклику замість паузи на об\'єкт');
  assert.strictEqual(limiter.pausedFor(KEY), 60_000, 'об\'єкт не став на хвилинну паузу');
}

// ── 4b. 5xx: коротке наростання тут-таки, бо це блимання ─────────────────
{
  reset();
  const { client, slept } = makeClient();
  mock.calls.length = 0;
  mock.queue.push({ kind: 'serverError' }, { kind: 'serverError' }, { kind: 'ok', taskIds: ['after-5xx'] });

  const res = await client.publishAvailability(KEY, [{ property_id: PROP, room_type_id: 'rt', date: '2026-11-22', availability: 1 }]);
  assert.deepStrictEqual(res.taskIds, ['after-5xx'], 'тимчасова помилка сервера не була повторена');
  assert.deepStrictEqual(slept, [1000, 2000], 'наростання відступу не подвоюється');
  assert.strictEqual(mock.calls.length, 3, 'очікувалось три спроби');
}

// ── 5. 401 не повторюється: вдруге буде те саме ──────────────────────────
{
  reset();
  const { client } = makeClient();
  mock.calls.length = 0;
  mock.queue.push({ kind: 'unauthorized' }, { kind: 'ok' });

  await assert.rejects(
    () => client.publishAvailability(KEY, [{ property_id: PROP, room_type_id: 'rt', date: '2026-11-22', availability: 1 }]),
    (e: unknown) => e instanceof ChannexError && e.status === 401 && !e.retryable,
    'поганий ключ мав впасти одразу',
  );
  assert.strictEqual(mock.calls.length, 1, 'постійна помилка була повторена — це витрата квоти намарно');
}

// ── 6. Не-JSON перед API не валить процес ────────────────────────────────
{
  reset();
  const { client } = makeClient({ maxAttempts: 1 });
  mock.queue.push({ kind: 'garbage' });
  await assert.rejects(
    () => client.publishAvailability(KEY, [{ property_id: PROP, room_type_id: 'rt', date: '2026-11-22', availability: 1 }]),
    (e: unknown) => e instanceof ChannexError && e.code === 'invalid_json',
    'сторінка проксі замість JSON мала стати зрозумілою помилкою',
  );
}

// ── 7. Помилка ставить ОБ'ЄКТ на паузу, і це видно ───────────────────────
{
  reset();
  const { client, limiter } = makeClient({ maxAttempts: 1 });
  mock.queue.push({ kind: 'serverError' });
  await assert.rejects(() => client.publishAvailability(KEY, [{ property_id: PROP, room_type_id: 'rt', date: '2026-11-22', availability: 1 }]));

  assert.ok(limiter.pausedFor(KEY) > 0, 'після помилки об\'єкт не став на паузу');
  assert.strictEqual(limiter.pausedFor('other-conn'), 0, 'пауза одного об\'єкта зупинила інший — ліміт не на акаунт');

  await assert.rejects(
    () => client.publishAvailability(KEY, [{ property_id: PROP, room_type_id: 'rt', date: '2026-11-23', availability: 1 }]),
    (e: unknown) => e instanceof ChannexPaused && e.reason === 'paused',
    'на паузі клієнт усе одно пішов у мережу',
  );
}

// ── 8. Ліміт: десять на смугу, смуги незалежні, вікно рухається ──────────
{
  reset();
  let clock = 5_000_000;
  const limiter = new ChannexRateLimiter({ now: () => clock });

  for (let i = 0; i < 10; i++) {
    assert.ok(limiter.take(KEY, 'availability').ok, `наявність №${i + 1} мала пройти`);
  }
  const over = limiter.take(KEY, 'availability');
  assert.ok(!over.ok && over.reason === 'window', 'одинадцятий запит наявності мав упертись у вікно');

  assert.ok(limiter.take(KEY, 'rates').ok, 'ціни мають свою квоту — вичерпана наявність їх не блокує');
  assert.ok(limiter.take('conn-2', 'availability').ok, 'квота іншого об\'єкта з\'їдена чужою — ліміт на об\'єкт, не на акаунт');

  clock += 60_001;
  assert.ok(limiter.take(KEY, 'availability').ok, 'вікно не зрушило через хвилину');
}

// ── 9. Стиснення діапазонів: пів року одним записом ──────────────────────
{
  reset();
  const ids = pairMap([['rp-local', 'ut', 'rp-remote']]);
  const changes = [];
  for (let d = new Date(Date.UTC(2026, 11, 1)); d <= new Date(Date.UTC(2027, 4, 1)); d.setUTCDate(d.getUTCDate() + 1)) {
    changes.push({ ratePlanId: 'rp-local', unitTypeId: 'ut', date: d.toISOString().slice(0, 10),
      prices: [{ occupancy: 2, priceMinor: 43200 }], minStay: 2 });
  }
  assert.strictEqual(changes.length, 152, 'очікувалось 152 ночі — тест 8 сертифікації');

  const { values } = rateValues(PROP, changes, ids);
  assert.strictEqual(values.length, 1, `152 ночі з однією ціною мали стиснутись в один запис, вийшло ${values.length}`);
  assert.strictEqual(values[0].date_from, '2026-12-01');
  assert.strictEqual(values[0].date_to, '2027-05-01');
  assert.deepStrictEqual(values[0].rates, [{ occupancy: 2, rate: 43200 }],
    'ціна мала піти масивом заселеностей, цілим у мінорних одиницях');
  assert.strictEqual(values[0].date, undefined, 'діапазон не має нести ще й одиночну дату');
}

// ── 10. Різні обмеження — різні діапазони, а не одне склеєне ─────────────
{
  reset();
  const ids = pairMap([['rp', 'ut', 'rp-remote']]);
  const { values } = rateValues(PROP, [
    { ratePlanId: 'rp', unitTypeId: 'ut', date: '2026-11-01', prices: [{ occupancy: 2, priceMinor: 10000 }], minStay: 1 },
    { ratePlanId: 'rp', unitTypeId: 'ut', date: '2026-11-02', prices: [{ occupancy: 2, priceMinor: 10000 }], minStay: 1 },
    { ratePlanId: 'rp', unitTypeId: 'ut', date: '2026-11-03', prices: [{ occupancy: 2, priceMinor: 10000 }], minStay: 3 },
  ], ids);
  assert.strictEqual(values.length, 2, 'та сама ціна з іншим min_stay мала лишитись окремим діапазоном');
  assert.strictEqual(values[0].date_to, '2026-11-02');
  assert.strictEqual(values[1].date, '2026-11-03', 'одиночна дата мала піти як date, не date_from/date_to');
  // Явне поле, не «віртуальне» `min_stay`: вендор ігнорує віртуальне, коли
  // `min_stay_type` обʼєкта = `both` — а саме такими наш майстер обʼєкти й
  // заводить (живе 02.09.2026, Test Property: слали 2, назад 1/1).
  assert.strictEqual(values[1].min_stay_arrival, 3, 'мінімум ночей їде явним полем min_stay_arrival');
  assert.ok(!('min_stay' in values[1]), 'віртуального min_stay в тілі немає — на обʼєкті з min_stay_type=both воно мовчки ігнорується');
}

// ── 11. Розрив у датах не склеюється ─────────────────────────────────────
{
  reset();
  const ids = new Map([['rt', 'rt-remote']]);
  const { values } = availabilityValues(PROP, [
    { unitTypeId: 'rt', date: '2026-11-01', free: 2 },
    { unitTypeId: 'rt', date: '2026-11-02', free: 2 },
    { unitTypeId: 'rt', date: '2026-11-04', free: 2 },
  ], ids);
  assert.strictEqual(values.length, 2, 'пропущений день склеївся в діапазон — 3 листопада отримало б чуже число');
  assert.strictEqual(values[0].date_from, '2026-11-01');
  assert.strictEqual(values[0].date_to, '2026-11-02');
  assert.strictEqual(values[1].date, '2026-11-04');
}

// ── 12. Нуль вільних їде як нуль, а не зникає ────────────────────────────
{
  reset();
  const ids = new Map([['rt', 'rt-remote']]);
  const { values } = availabilityValues(PROP, [{ unitTypeId: 'rt', date: '2026-11-01', free: 0 }], ids);
  assert.strictEqual(values.length, 1, 'нуль вільних не поїхав — канал продовжить продавати за старим числом');
  assert.strictEqual(values[0].availability, 0);
}

// ── 13. Порожніх полів у тілі немає ──────────────────────────────────────
{
  reset();
  const ids = pairMap([['rp', 'ut', 'rp-remote']]);
  const { values } = rateValues(PROP, [{ ratePlanId: 'rp', unitTypeId: 'ut', date: '2026-11-01', closed: true }], ids);
  assert.strictEqual(values[0].stop_sell, true);
  assert.ok(!('rates' in values[0]), 'ціна, якої не міняли, поїхала полем — Channex відповів би претензією');
  assert.ok(!('min_stay_arrival' in values[0]) && !('min_stay' in values[0]), 'обмеження, якого не міняли, поїхало полем');
}

// ── 13.1 И12: ціна їде через `rates[]`, ніколи голим `rate` ──────────────
//
// Виміряно на живому API 01.09.2026: голий `rate` рухає ЛИШЕ основну опцію
// заселеності, решта лишаються зі старою ціною, а відповідь при цьому чиста —
// `200 OK` без попереджень. Тобто помилка не має жодного зовнішнього прояву,
// доки хтось не забронює на двох.
//
// Тому тіло мусить нести `rates[]` навіть тоді, коли заселеність одна: рівно
// в цьому випадку спокуса написати голий ключ найбільша, а різниця невидима.
{
  reset();
  const ids = pairMap([['rp', 'ut', 'rp-remote']]);
  const { values } = rateValues(PROP, [{
    ratePlanId: 'rp', unitTypeId: 'ut', date: '2026-11-01',
    prices: [{ occupancy: 1, priceMinor: 9000 }, { occupancy: 2, priceMinor: 11000 }],
  }], ids);
  assert.deepStrictEqual(values[0].rates,
    [{ occupancy: 1, rate: 9000 }, { occupancy: 2, rate: 11000 }],
    'ціни по заселеностях мали піти масивом rates[]');
  assert.ok(!('rate' in values[0]),
    'голий rate рухає лише основну заселеність — решта лишиться зі старою ціною, і мовчки');
}
{
  reset();
  const ids = pairMap([['rp', 'ut', 'rp-remote']]);
  const { values } = rateValues(PROP, [{
    ratePlanId: 'rp', unitTypeId: 'ut', date: '2026-11-01', prices: [{ occupancy: 2, priceMinor: 11000 }],
  }], ids);
  assert.deepStrictEqual(values[0].rates, [{ occupancy: 2, rate: 11000 }],
    'навіть одна заселеність їде масивом — саме тут спокуса написати голий ключ');
  assert.ok(!('rate' in values[0]), 'одна заселеність не привід повертатись до голого rate');
}

// ── 13.2 Різні ціни по заселеностях — різні діапазони ────────────────────
//
// Стиснення порівнює ВЕСЬ набір цін, а не одне число: діапазон, у якому ціна
// для двох та сама, а для трьох інша, — це два діапазони. Склеїти їх означало
// б тихо переписати ціну третьої особи.
{
  reset();
  const ids = pairMap([['rp', 'ut', 'rp-remote']]);
  const { values } = rateValues(PROP, [
    { ratePlanId: 'rp', unitTypeId: 'ut', date: '2026-11-01', prices: [{ occupancy: 1, priceMinor: 9000 }, { occupancy: 2, priceMinor: 11000 }] },
    { ratePlanId: 'rp', unitTypeId: 'ut', date: '2026-11-02', prices: [{ occupancy: 1, priceMinor: 9000 }, { occupancy: 2, priceMinor: 11000 }] },
    { ratePlanId: 'rp', unitTypeId: 'ut', date: '2026-11-03', prices: [{ occupancy: 1, priceMinor: 9000 }, { occupancy: 2, priceMinor: 12000 }] },
  ], ids);
  assert.strictEqual(values.length, 2, 'інша ціна для двох мала розірвати діапазон');
  assert.strictEqual(values[0].date_to, '2026-11-02');
  assert.strictEqual(values[1].date, '2026-11-03');
}

// ── 14. Незмаплене не вигадується ────────────────────────────────────────
{
  reset();
  const { values, unmapped } = availabilityValues(PROP, [
    { unitTypeId: 'known', date: '2026-11-01', free: 1 },
    { unitTypeId: 'stranger', date: '2026-11-01', free: 1 },
  ], new Map([['known', 'known-remote']]));
  assert.strictEqual(values.length, 1, 'незмаплений тип поїхав у канал');
  assert.deepStrictEqual(unmapped, [{ unitTypeId: 'stranger' }], 'про незмаплений тип ніхто не дізнався');
}

// ── 14.1 Вісь ПАРИ (Ц10): один наш тариф на двох типах — два їхні тарифи ──
//
// Тариф на тому боці створюється на КОЖЕН тип номера окремо (дзеркало
// ключується парою — 0056). Тіло, яке адресує його самим лише нашим
// `ratePlanId`, або поклало б обидві ціни на один їхній тариф, або не знало
// б, який із двох обрати. Незмаплена ПАРА називається парою: «тариф rp» без
// типу оператору нічого не каже, бо на трьох інших типах той самий rp
// змаплений.
{
  reset();
  const pairs = pairMap([['rp', 'DBL', 'rp-on-dbl'], ['rp', 'SGL', 'rp-on-sgl']]);
  const { values, unmapped } = rateValues(PROP, [
    { ratePlanId: 'rp', unitTypeId: 'DBL', date: '2026-11-01', prices: [{ occupancy: 2, priceMinor: 20000 }], closed: false },
    { ratePlanId: 'rp', unitTypeId: 'SGL', date: '2026-11-01', prices: [{ occupancy: 1, priceMinor: 15000 }], closed: false },
    { ratePlanId: 'rp', unitTypeId: 'TWN', date: '2026-11-01', prices: [{ occupancy: 2, priceMinor: 20000 }], closed: false },
  ], pairs);
  assert.deepStrictEqual(values.map((v) => v.rate_plan_id).sort(), ['rp-on-dbl', 'rp-on-sgl'],
    'той самий наш тариф на двох типах мав піти на ДВА їхні тарифи, кожен зі своєю ціною');
  assert.strictEqual(values.find((v) => v.rate_plan_id === 'rp-on-sgl')?.rates?.[0]?.rate, 15000,
    'ціна SGL мала лягти на тариф SGL, а не на сусідній');
  assert.deepStrictEqual(unmapped, [{ ratePlanId: 'rp', unitTypeId: 'TWN' }],
    'незмаплена ПАРА має бути названа парою — сам «rp» оператору нічого не каже');
}

// ── 15. Порожня пачка не витрачає квоту ──────────────────────────────────
{
  reset();
  const { client } = makeClient();
  mock.calls.length = 0;
  const res = await client.publishAvailability(KEY, []);
  assert.deepStrictEqual(res, { taskIds: [], warnings: [] });
  assert.strictEqual(mock.calls.length, 0, 'порожня пачка пішла в мережу і з\'їла квоту');
}

// ── 16. Стрічка: об'єкт названо, порядок попрошено ───────────────────────
//
// Дві дрібниці в рядку запиту, кожна з ціною.
//
// БЕЗ `filter[property_id]` стрічка віддає ревізії ВСІХ об'єктів акаунта
// одним списком — тобто броні чужого орендаря приїдуть у транзакцію цього.
// Це не косметика запиту, це межа орендаря, винесена в query string.
//
// БЕЗ `order[inserted_at]=asc` порядок не гарантований, а дві ревізії одного
// бронювання, застосовані навпаки, дають скасовану бронь як активну.
{
  reset();
  const { client } = makeClient();
  mock.queue.push({ kind: 'feed', revisions: [] });
  await client.fetchBookingRevisions(KEY, PROP);

  assert.strictEqual(mock.calls.length, 1);
  const url = new URL(`http://x${mock.calls[0].path}`);
  assert.ok(url.pathname.endsWith('/booking_revisions/feed'), `не той шлях: ${url.pathname}`);
  assert.strictEqual(url.searchParams.get('filter[property_id]'), PROP,
    'стрічку попрошено без обʼєкта — приїдуть броні всіх готелів акаунта');
  assert.strictEqual(url.searchParams.get('order[inserted_at]'), 'asc',
    'порядок не попрошено — скасована бронь може стати активною');
  assert.strictEqual(mock.calls[0].method, 'GET');
}

// ── 17. Ревізії лежать у JSON:API конверті ───────────────────────────────
//
// Кожен запис стрічки — це `{ type, id, attributes: {…} }`, і корисне лежить
// у `attributes`. Клієнт, який віддасть конверт як є, дасть маперу об'єкт
// без жодного знайомого поля: кожна ревізія стане «зіпсованою», стрічка —
// порожньою, і жодної помилки при цьому не буде.
{
  reset();
  const { client } = makeClient();
  mock.queue.push({ kind: 'feed', revisions: [
    { id: 'rev-a', system_id: 'sys-a', booking_id: 'bkg-a', status: 'new' },
    { id: 'rev-b', system_id: 'sys-b', booking_id: 'bkg-b', status: 'modified' },
  ] });
  const page = await client.fetchBookingRevisions(KEY, PROP);
  assert.strictEqual(page.revisions.length, 2, 'конверт не розгорнуто');
  assert.strictEqual(page.revisions[0].system_id, 'sys-a', 'attributes не розгорнуто');
  assert.strictEqual(page.revisions[0].id, 'rev-a', 'id ревізії загублено — підтвердити її буде нічим');
}

// ── 18. Стрічка посторінкова, і сторінки треба дочитати ──────────────────
//
// `meta` віддає `total`, `page`, `limit`; типова сторінка — 10 записів, межа
// сторінки — 100. Клієнт, який читає лише першу, у завантажений день мовчки
// губить одинадцяту броню: помилки немає, звіт зелений, гість не заїде.
{
  reset();
  const { client } = makeClient();
  const many = (n: number, from: number) => Array.from({ length: n }, (_, i) => ({
    id: `rev-${from + i}`, system_id: `sys-${from + i}`, booking_id: `bkg-${from + i}`, status: 'new',
  }));
  mock.queue.push({ kind: 'feed', revisions: many(100, 0), total: 130, page: 1, limit: 100 });
  mock.queue.push({ kind: 'feed', revisions: many(30, 100), total: 130, page: 2, limit: 100 });

  const all = await client.fetchAllBookingRevisions(KEY, PROP);
  assert.strictEqual(all.length, 130, `дочитано лише ${all.length} зі 130 — решта броней зникла мовчки`);
  assert.strictEqual(all[0].system_id, 'sys-0');
  assert.strictEqual(all[129].system_id, 'sys-129', 'порядок сторінок переплутано');
  assert.strictEqual(mock.calls.length, 2, 'сторінок прочитано не дві');
  const p2 = new URL(`http://x${mock.calls[1].path}`);
  assert.strictEqual(p2.searchParams.get('pagination[page]'), '2');
  assert.strictEqual(p2.searchParams.get('pagination[limit]'), '100',
    'сторінку попрошено меншу за максимум — зайві виклики на порожньому місці');
}

// ── 19. Дочитування має стелю ────────────────────────────────────────────
//
// Стрічка віддає лише НЕПІДТВЕРДЖЕНІ ревізії, тож сервер, який завжди
// відповідає «є ще», перетворив би цикл на нескінченний. Стеля — це не
// оптимізація, а те, що відрізняє повільний крон від процесу, який не
// завершується ніколи.
{
  reset();
  const { client } = makeClient();
  for (let i = 0; i < 40; i++) {
    mock.queue.push({ kind: 'feed', revisions: [{ id: `r${i}`, system_id: `s${i}`, booking_id: 'b', status: 'new' }],
      total: 999999, page: i + 1, limit: 1 });
  }
  // Сторінка ПОВНА щоразу — саме так виглядає сервер, який завжди каже «є
  // ще». Неповна сторінка означала б останню, і цикл спинився б сам.
  const all = await client.fetchAllBookingRevisions(KEY, PROP, { maxPages: 3, limit: 1 });
  assert.strictEqual(mock.calls.length, 3, 'стеля сторінок не тримає — це нескінченний цикл у кроні');
  assert.strictEqual(all.length, 3);
}

// ── 20. Підтвердження йде за `id` ревізії, і це POST ─────────────────────
{
  reset();
  const { client } = makeClient();
  mock.queue.push({ kind: 'ackOk' });
  await client.ackBookingRevision(KEY, 'rev-uuid-1');
  assert.strictEqual(mock.calls.length, 1);
  assert.strictEqual(mock.calls[0].path, '/booking_revisions/rev-uuid-1/ack',
    `не той шлях підтвердження: ${mock.calls[0].path}`);
  assert.strictEqual(mock.calls[0].method, 'POST');
  assert.strictEqual(mock.calls[0].apiKey, 'test-key');
}

// ── 21. Читання не їсть квоту ARI ────────────────────────────────────────
//
// Ліміт 10+10 на хвилину належить ОНОВЛЕННЯМ ARI. Порахувати читання стрічки
// в ту саму смугу означає, що активний обмін бронями душить оновлення цін —
// і навпаки: пачка цін перестає пускати броні в готель.
{
  reset();
  const { client, limiter } = makeClient();
  for (let i = 0; i < 12; i++) mock.queue.push({ kind: 'feed', revisions: [] });
  for (let i = 0; i < 12; i++) await client.fetchBookingRevisions(KEY, PROP);
  assert.strictEqual(limiter.take(KEY, 'availability').ok, true,
    'читання стрічки зʼїло квоту наявності — застаріле число продає номер, якого немає');
  assert.strictEqual(limiter.take(KEY, 'rates').ok, true, 'читання стрічки зʼїло квоту цін');
}

// ── 22. Помилки стрічки: 401 постійна, 429 ставить обʼєкт на паузу ───────
{
  reset();
  const { client } = makeClient({ maxAttempts: 1 });
  mock.queue.push({ kind: 'unauthorized' });
  await assert.rejects(() => client.fetchBookingRevisions(KEY, PROP), (e: unknown) => {
    assert.ok(e instanceof ChannexError, 'помилка стрічки приїхала не розібраною');
    assert.strictEqual(e.status, 401);
    return true;
  });
}
{
  reset();
  const { client, limiter } = makeClient({ maxAttempts: 1 });
  mock.queue.push({ kind: 'rateLimited' });
  await assert.rejects(() => client.fetchBookingRevisions(KEY, PROP), ChannexError);
  assert.ok(limiter.pausedFor(KEY) > 0,
    '429 на стрічці не поставив обʼєкт на паузу — наступний запит дасть той самий 429');
}

// ── 23. Підтвердження неіснуючої ревізії — 404, і це видно ───────────────
//
// Саме так виглядає підміна ключа підтвердження ключем дедуплікації. Мовчки
// проковтнути 404 означало б рахувати підтвердженим те, що назавжди
// лишилось у стрічці.
{
  reset();
  const { client } = makeClient({ maxAttempts: 1 });
  mock.queue.push({ kind: 'notFound' });
  await assert.rejects(() => client.ackBookingRevision(KEY, 'sys-not-a-uuid'), (e: unknown) => {
    assert.ok(e instanceof ChannexError);
    assert.strictEqual(e.status, 404, 'ack у нікуди не назвався помилкою');
    return true;
  });
}

// ── 24. Майстер підключення: ключ, разовий токен, канали ─────────────────
//
// Ключ перевіряється одним GET одразу після вставки: помилковий мусить
// впасти в полі вводу, а не тихо через добу на першому проході крона.
// Разовий токен кується на сервері, і ключ у браузер не потрапляє —
// адреса вікна складається тут, з відповіді вендора, а не на клієнті.
{
  reset();
  const { client } = makeClient();
  mock.queue.push({ kind: 'list', data: [{ id: 'p1', type: 'property', attributes: { title: 'X' } }] });
  assert.strictEqual(await client.probeKey('test-key'), true, 'справжній ключ — один GET, і відповідь «так»');
  const probe = mock.calls.at(-1)!;
  assert.strictEqual(probe.method, 'GET');
  assert.ok(probe.path.startsWith('/properties'), 'перевірка ключа — найдешевше читання, список обʼєктів');

  mock.queue.push({ kind: 'unauthorized' });
  assert.strictEqual(await client.probeKey('wrong-key'), false, 'чужий ключ — «ні», а не виняток і не тиша');

  mock.queue.push({ kind: 'serverError' }, { kind: 'serverError' }, { kind: 'serverError' });
  await assert.rejects(() => client.probeKey('test-key'), 'простій вендора — це не «ключ неправильний»: виняток, не false');
}
{
  reset();
  const { client } = makeClient();
  mock.queue.push({ kind: 'token', token: 'one-time-abc' });
  const url = await client.channelsFrameUrl('test-key', 'prop-remote', { username: 'owner@hotel.test', lng: 'de' });
  const call = mock.calls.at(-1)!;
  assert.strictEqual(call.method, 'POST');
  assert.strictEqual(call.path, '/auth/one_time_token');
  assert.deepStrictEqual(call.body, { one_time_token: { property_id: 'prop-remote', username: 'owner@hotel.test' } },
    'тіло токена — обʼєкт і імʼя користувача, дослівно з документації');
  assert.ok(url.startsWith(`${mock.url.replace(/\/api\/v1$/, '')}/auth/exchange?oauth_session_key=one-time-abc`),
    `адреса вікна складається з токена на СЕРВЕРІ вендора, не з /api/v1: ${url}`);
  assert.ok(url.includes('app_mode=headless') && url.includes('redirect_to=%2Fchannels') && url.includes('property_id=prop-remote') && url.includes('lng=de'),
    'вбудований режим, екран каналів, обʼєкт і мова — усі в адресі');
  assert.ok(!url.includes('test-key'), 'ключ API в адресі вікна — тихий витік');
}
{
  reset();
  const { client } = makeClient();
  mock.queue.push({ kind: 'list', data: [
    { id: 'c1', type: 'channel', attributes: { title: 'Booking', channel: 'BDC', is_active: true, rate_plans: [{ id: 'm1', rate_plan_id: 'r-1' }] } },
    { id: 'c2', type: 'channel', attributes: { title: 'Expedia', channel: 'EXP', is_active: false, rate_plans: [] } },
  ] });
  const channels = await client.listChannels('test-key', 'prop-remote');
  assert.ok(mock.calls.at(-1)!.path.includes('filter[property_id]=prop-remote'), 'канали — ЛИШЕ цього обʼєкта (И11)');
  assert.deepStrictEqual(channels, [
    { id: 'c1', title: 'Booking', isActive: true, remoteRatePlanIds: ['r-1'] },
    { id: 'c2', title: 'Expedia', isActive: false, remoteRatePlanIds: [] },
  ]);
}
console.log('  ok  ключ перевіряється одним GET, токен кується на сервері, канали читаються по обʼєкту');


await mock.close();
console.log('channex: all checks passed');
