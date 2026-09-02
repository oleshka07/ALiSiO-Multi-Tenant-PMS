/**
 * Батчер ARI: що саме поїде в канал, і що станеться, коли не поїде.
 *
 *   node src/modules/channels/domain/ari-batch.check.ts
 *
 * Перевірка написана ДО батчера і була червоною (інваріант 24).
 *
 * ── Три речі, заради яких вона існує ────────────────────────────────────
 *
 * 1. **Помилка мусить ЗВІЛЬНИТИ захоплення.** Рядок черги, який лишився з
 *    виставленим `claimed_at` і порожнім `sent_at`, не забере вже ніхто:
 *    його не видно ні як відправлений, ні як такий, що чекає. Зміна не
 *    поїде НІКОЛИ — і це рівно та катастрофа, від якої будувалась уся черга
 *    (0054), тільки заходить вона не через злиття в рядок у польоті, а
 *    через шлях помилки, якого тоді ще не існувало.
 *
 * 2. **Кожна координата розвʼязується в одне з ДВОХ:** «ціни + відкрито» або
 *    «закрито». Ніколи в «нічого не слати». Тиха ніч зі старою ціною гірша
 *    за закриту: канал продовжує продавати за числом, якого готель більше не
 *    називає, і дізнаються про це з рахунку гостя.
 *
 * 3. **Пачка ріжеться за РОЗМІРОМ тіла, не за кількістю рядків.** Ліміт
 *    вендора — 10 МБ на виклик; кількість значень усередині не обмежена
 *    («a full sync would be 2 API calls»). Різати за рядками означає або
 *    слати вдесятеро більше викликів, ніж треба, або одного разу впертись у
 *    межу тілом, зібраним із «безпечної» кількості рядків.
 */
import assert from 'node:assert';
import { flushOutbox, type FlushDeps } from './ari-batch.ts';
import type { RateChange } from '../port.ts';

const DAY = '2026-11-10';

/** Черга в памʼяті: рівно та поведінка, яку дає `cm_outbox`. */
function queue(rows: { id: string; kind: 'availability' | 'rate'; unitTypeId?: string; ratePlanId?: string; date: string; dateTo?: string; attempts?: number }[]) {
  const claimed = new Set<string>();
  const sent = new Set<string>();
  const released: { ids: string[]; reason: string; transient: boolean }[] = [];
  return {
    released,
    /** Координата вільна, якщо вона не відправлена і не захоплена. */
    free: () => rows.filter((r) => !sent.has(r.id) && !claimed.has(r.id)).map((r) => r.id),
    inFlight: () => [...claimed].filter((id) => !sent.has(id)),
    deps: {
      claim: async (kind: 'availability' | 'rate') => {
        const take = rows.filter((r) => r.kind === kind && !sent.has(r.id) && !claimed.has(r.id));
        for (const r of take) claimed.add(r.id);
        return take.map((r) => ({ ...r }));
      },
      markSent: async (ids: string[]) => { for (const id of ids) sent.add(id); },
      release: async (ids: string[], reason: string, transient = false) => {
        for (const id of ids) claimed.delete(id);
        released.push({ ids, reason, transient });
      },
    },
  };
}

const base = (over: Partial<FlushDeps> = {}): FlushDeps => ({
  claim: async () => [],
  availabilityAt: async () => 3,
  pricesAt: async () => [{ occupancy: 2, priceMinor: 11000 }],
  send: async () => ({ warnings: [] }),
  markSent: async () => {},
  release: async () => {},
  retire: async () => {},
  ...over,
});

// ── 1. Помилка звільняє захоплення ───────────────────────────────────────
{
  const q = queue([{ id: 'r1', kind: 'rate', unitTypeId: 'ut', ratePlanId: 'rp', date: DAY }]);
  const report = await flushOutbox(base({
    ...q.deps,
    send: async () => { throw Object.assign(new Error('429'), { status: 429 }); },
  }));

  assert.deepStrictEqual(q.free(), ['r1'],
    'після 429 координата мусить знову бути вільною — інакше вона не поїде НІКОЛИ');
  assert.deepStrictEqual(q.inFlight(), [],
    'рядок лишився захопленим і невідправленим: його не видно ні як зроблений, ні як такий, що чекає');
  assert.strictEqual(q.released.length, 1, 'звільнення мало статись рівно раз');
  assert.match(q.released[0].reason, /429/, 'причина мала дійти до рядка, а не зникнути');
  assert.strictEqual(report.failed, 1);
  assert.strictEqual(report.sent, 0, 'нічого не поїхало — і нічого не має рахуватись відправленим');
}
console.log('  ok  429 звільняє захоплення, а не споживає його');

// ── 2. `200 OK` з warnings — теж помилка (И4) ────────────────────────────
{
  const q = queue([{ id: 'r1', kind: 'rate', unitTypeId: 'ut', ratePlanId: 'rp', date: DAY }]);
  await flushOutbox(base({
    ...q.deps,
    send: async () => ({ warnings: [{ warning: { rate: ['must be greater than 0'] }, date: DAY }] }),
  }));
  assert.deepStrictEqual(q.free(), ['r1'],
    'успіх із претензіями — це НЕ успіх: значення не застосоване, координата має лишитись у черзі');
}
console.log('  ok  200 з warnings повертає координату в чергу, а не позначає відправленою');

// ── 3. Кожна координата — «ціни + відкрито» або «закрито» ────────────────
{
  const sentValues: Record<string, unknown>[] = [];
  const q = queue([
    { id: 'a', kind: 'rate', unitTypeId: 'ut', ratePlanId: 'has-price', date: DAY },
    { id: 'b', kind: 'rate', unitTypeId: 'ut', ratePlanId: 'no-price', date: DAY },
  ]);
  await flushOutbox(base({
    ...q.deps,
    pricesAt: async (_unitTypeId: string, ratePlanId: string) =>
      (ratePlanId === 'has-price' ? [{ occupancy: 2, priceMinor: 11000 }] : null),
    send: async (_kind, values) => { sentValues.push(...values); return { warnings: [] }; },
  }));

  assert.strictEqual(sentValues.length, 2,
    'ніч без ціни мовчки пропущена — канал лишився зі старою ціною і продасть за нею');
  const withPrice = sentValues.find((v) => v.ratePlanId === 'has-price')!;
  const without = sentValues.find((v) => v.ratePlanId === 'no-price')!;

  assert.deepStrictEqual(withPrice.prices, [{ occupancy: 2, priceMinor: 11000 }]);
  assert.strictEqual(withPrice.closed, false,
    'ціна без явного відкриття лишає тариф закритим назавжди: прапорець у шапці ЛИПКИЙ (И14)');
  assert.strictEqual(without.closed, true, 'ніч без ціни закривається, а не пропускається (И2, інваріант 17)');
  assert.strictEqual(without.prices, undefined, 'у закриту ніч ціна не пишеться — навіть нуль');
}
console.log('  ok  кожна координата розвʼязується в ціну+відкрито або в закрито');

// ── 4. Пачка ріжеться за РОЗМІРОМ тіла ───────────────────────────────────
{
  const rows = Array.from({ length: 40 }, (_, i) => ({
    id: `r${i}`, kind: 'rate' as const, unitTypeId: 'ut', ratePlanId: `rp${i}`, date: DAY,
  }));
  const q = queue(rows);
  const calls: number[] = [];
  await flushOutbox(base({
    ...q.deps,
    // Крихітна стеля: 40 координат мусять розкластись на кілька викликів.
    maxBodyBytes: 400,
    send: async (_kind, values) => { calls.push(values.length); return { warnings: [] }; },
  }));

  assert.ok(calls.length > 1, 'сорок координат при стелі 400 байт поїхали одним викликом — розмір не рахується');
  assert.ok(calls.every((n) => n > 0), 'порожній виклик — це витрачена квота обʼєкта ні на що');
  assert.strictEqual(calls.reduce((s, n) => s + n, 0), 40, 'жодна координата не має загубитись між пачками');
  assert.deepStrictEqual(q.free(), [], 'усе поїхало — у черзі не має лишитись нічого');
}
console.log('  ok  пачка ріжеться за розміром тіла, і жодна координата не губиться');

// ── 5. Одна велика координата їде сама, а не зависає навічно ─────────────
{
  const q = queue([{ id: 'big', kind: 'rate', unitTypeId: 'ut', ratePlanId: 'rp', date: DAY }]);
  const calls: number[] = [];
  await flushOutbox(base({
    ...q.deps,
    maxBodyBytes: 1,   // менше за будь-яке значення
    send: async (_kind, values) => { calls.push(values.length); return { warnings: [] }; },
  }));
  assert.deepStrictEqual(calls, [1],
    'координата, більша за стелю, мусить поїхати сама — інакше вона не поїде ніколи, '
    + 'і це та сама вічність, що з незвільненим захопленням');
  assert.deepStrictEqual(q.free(), []);
}
console.log('  ok  координата, більша за стелю, їде сама, а не зависає');

// ── 6. Смуги нарізно: наявність не чекає на ціни ─────────────────────────
{
  const q = queue([
    { id: 'a1', kind: 'availability', unitTypeId: 'ut', date: DAY },
    { id: 'r1', kind: 'rate', unitTypeId: 'ut', ratePlanId: 'rp', date: DAY },
  ]);
  const kinds: string[] = [];
  await flushOutbox(base({
    ...q.deps,
    send: async (kind) => { kinds.push(kind); return { warnings: [] }; },
  }));
  assert.deepStrictEqual(kinds, ['availability', 'rate'],
    'наявність і ціни мусять їхати ОКРЕМИМИ повідомленнями: у них різні відра ліміту, '
    + 'і застаріла наявність продає номер, якого немає');
}
console.log('  ok  наявність і ціни — окремі повідомлення, наявність перша');

// ── 7. Провал однієї смуги не забирає з собою другу ──────────────────────
{
  const q = queue([
    { id: 'a1', kind: 'availability', unitTypeId: 'ut', date: DAY },
    { id: 'r1', kind: 'rate', unitTypeId: 'ut', ratePlanId: 'rp', date: DAY },
  ]);
  await flushOutbox(base({
    ...q.deps,
    send: async (kind) => {
      if (kind === 'availability') throw new Error('boom');
      return { warnings: [] };
    },
  }));
  assert.deepStrictEqual(q.free(), ['a1'], 'наявність мала повернутись у чергу');
  assert.ok(!q.free().includes('r1'), 'ціни не мали постраждати від чужої смуги');
}
console.log('  ok  провал однієї смуги не спиняє другу');

// ── 8. Пʼять джерел, яких «уже немає» — і ТРИ різні правильні відповіді ──
//
// План називав пʼять випадків одним словом «закрито». Прогін показав, що це
// правда лише для двох: у решти «закрито» було б або брехнею, або вічним
// колом. Розкладка тут, і кожен рядок нижче — окреме твердження.
//
//   тариф видалено          → ЗАКРИТО   (адресувати можемо, продавати нічого)
//   тип номера видалено     → ЗАКРИТО   (те саме; наявність — нуль)
//   мапінг знято            → ГУЧНА ВІДМОВА, рядок лишається в черзі
//   зʼєднання вимкнено      → НЕ СЛАТИ НІЧОГО, черга ціла
//   дата за горизонтом      → ЗНЯТИ З ЧЕРГИ, бо вона не поїде НІКОЛИ

// 8а. Джерела немає, але координата адресується — закрито.
{
  const q = queue([
    { id: 'r1', kind: 'rate', unitTypeId: 'ut', ratePlanId: 'gone', date: DAY },
    { id: 'a1', kind: 'availability', unitTypeId: 'gone', date: DAY },
  ]);
  const values: any[] = [];
  await flushOutbox(base({
    ...q.deps,
    pricesAt: async () => null,          // тарифу вже немає
    availabilityAt: async () => null,    // типу вже немає
    send: async (_k, v) => { values.push(...v); return { warnings: [] }; },
  }));
  assert.strictEqual(values.find((v) => v.ratePlanId === 'gone')?.closed, true,
    'видалений тариф мусить закритись, а не зникнути з повідомлення');
  assert.strictEqual(values.find((v) => v.unitTypeId === 'gone')?.free, 0,
    'видалений тип номера мусить віддати нуль вільних, а не промовчати');
  assert.deepStrictEqual(q.free(), [], 'обидві координати відпрацювали');
}
console.log('  ok  видалене джерело закривається, а не пропускається');

// 8б. Мапінг знято — координату НЕМА ЧИМ адресувати.
//
// Це не «закрито»: закрити ми якраз не можемо, бо не знаємо, що саме
// закривати на тому боці. Тариф там лишається живим і продається далі.
// Позначити такий рядок відправленим означало б доповісти про успіх там, де
// не пішло нічого — і осиротити живий тариф у каналі назавжди.
{
  const q = queue([{ id: 'r1', kind: 'rate', unitTypeId: 'ut', ratePlanId: 'orphan', date: DAY }]);
  const report = await flushOutbox(base({
    ...q.deps,
    // Незмаплена ПАРА, не сам тариф: на сусідньому типі той самий тариф
    // може бути змаплений (Ц10).
    send: async () => ({ warnings: [], unmapped: [{ ratePlanId: 'orphan', unitTypeId: 'ut' }] }),
  }));
  assert.deepStrictEqual(q.free(), ['r1'],
    'незмаплена координата позначена відправленою — у каналі лишився живий тариф, яким ніхто не керує');
  assert.strictEqual(report.sent, 0, 'нічого не пішло — і нічого не має рахуватись відправленим');
  assert.ok(q.released[0]?.reason.includes('unmapped'),
    'причина мусить називати саме мапінг, інакше оператор шукатиме її в мережі');
}
console.log('  ok  знятий мапінг — гучна відмова, а не тихий успіх');

// 8в. Зʼєднання вимкнено — не слати нічого, черги не чіпати.
//
// Готель вимкнув канал; штовхати в нього ціни означає продавати там, де він
// продавати перестав. Але й викидати чергу не можна: вимкнення буває
// тимчасовим, і після вмикання канал має отримати поточний стан.
{
  const q = queue([
    { id: 'a1', kind: 'availability', unitTypeId: 'ut', date: DAY },
    { id: 'r1', kind: 'rate', unitTypeId: 'ut', ratePlanId: 'rp', date: DAY },
  ]);
  let calls = 0;
  const report = await flushOutbox(base({
    ...q.deps,
    isEnabled: async () => false,
    send: async () => { calls++; return { warnings: [] }; },
  }));
  assert.strictEqual(calls, 0, 'вимкнене зʼєднання не має витрачати жодного виклику');
  assert.deepStrictEqual(q.free().sort(), ['a1', 'r1'],
    'черга вимкненого зʼєднання мусить лишитись цілою — вмикання поверне канал у поточний стан');
  assert.strictEqual(report.sent, 0);
  assert.strictEqual(report.failed, 0, 'вимкнено — це не провал, і алерту з нього бути не має');
}
console.log('  ok  вимкнене зʼєднання нічого не шле і черги не втрачає');

// 8г. Дата за горизонтом — зняти, бо вона не поїде НІКОЛИ.
//
// Вендор минулі дати не приймає взагалі. Повертати такий рядок у чергу —
// це вічне коло: він падатиме щопроходу, рахуватиме спроби й забиватиме
// смугу собі подібними. Це той самий рід вічності, що з незвільненим
// захопленням, тільки шумний замість тихого.
{
  const q = queue([
    { id: 'old', kind: 'rate', unitTypeId: 'ut', ratePlanId: 'rp', date: '2020-01-01' },
    { id: 'now', kind: 'rate', unitTypeId: 'ut', ratePlanId: 'rp', date: DAY },
  ]);
  const values: any[] = [];
  const report = await flushOutbox(base({
    ...q.deps,
    today: '2026-11-01',
    send: async (_k, v) => { values.push(...v); return { warnings: [] }; },
  }));
  assert.strictEqual(values.length, 1, 'минула дата поїхала в тіло — вендор відхилив би весь виклик');
  assert.strictEqual(values[0].date, DAY);
  assert.deepStrictEqual(q.free(), [],
    'минула дата лишилась у черзі — вона падатиме щопроходу й забиватиме смугу');
  assert.strictEqual(report.retired, 1, 'знята координата мусить бути ПОРАХОВАНА, а не зникнути тихо');
}
console.log('  ok  дата за горизонтом знімається з черги, а не крутиться вічно');

// ── 9. Ц7: точка збуту ЗСУВАЄ базу — і зсуває саме своя ──────────────────
//
// Найлегше місце для хибно-зеленої перевірки в усій фазі. Таблиця модифікаторів
// на проді порожня, дефолт — нуль, а при нулі число зі зсувом і без зсуву
// ОДНАКОВЕ. Перевірка, написана на наявних даних, була б зеленою і тоді, коли
// батчер модифікатор застосовує, і тоді, коли його забули застосувати: рішення
// Ц7 виявилось би записаним, але не виконаним, і побачив би це перший готель,
// який поставить знижку й отримає її на Booking замість прямого каналу.
//
// Та сама сліпота, що з `DBL`/`TRI` (не розрізняли дорослу й загальну
// місткість) і з однією ніччю (не розрізняла «за ніч» і «за перебування»).
// Тому обидва твердження стоять на НЕНУЛЬОВОМУ модифікаторі й арифметично
// несумісні з його відсутністю.
{
  const q = queue([{ id: 'r1', kind: 'rate', unitTypeId: 'ut', ratePlanId: 'rp', date: DAY }]);
  const values: any[] = [];
  await flushOutbox(base({
    ...q.deps,
    pricesAt: async () => [{ occupancy: 1, priceMinor: 10000 }, { occupancy: 2, priceMinor: 20000 }],
    priceModifierPercent: 10,
    send: async (_k, v) => { values.push(...v); return { warnings: [] }; },
  }));
  assert.deepStrictEqual(values[0].prices,
    [{ occupancy: 1, priceMinor: 11000 }, { occupancy: 2, priceMinor: 22000 }],
    'зсув точки збуту не застосований — Ц7 записане, але не виконане');
  assert.notDeepStrictEqual(values[0].prices,
    [{ occupancy: 1, priceMinor: 10000 }, { occupancy: 2, priceMinor: 20000 }],
    'це база без зсуву: рівно те число, яким хибно-зелена перевірка виглядала б правильною');
}
console.log('  ok  зʼєднання отримує СВІЙ модифікатор, і це видно на ненульовому');

// І другий бік того самого, без якого «прямо дешевше» не існує: модифікатор
// САЙТУ в канал не їде. Якби він доїхав, знижка прямого каналу опинилась би
// на OTA — тобто рівно навпаки до того, заради чого Ц7 ухвалювалось.
{
  const q = queue([{ id: 'r1', kind: 'rate', unitTypeId: 'ut', ratePlanId: 'rp', date: DAY }]);
  const values: any[] = [];
  await flushOutbox(base({
    ...q.deps,
    pricesAt: async () => [{ occupancy: 2, priceMinor: 10000 }],
    priceModifierPercent: 10,      // зсув ЗʼЄДНАННЯ
    send: async (_k, v) => { values.push(...v); return { warnings: [] }; },
  }));
  const got = values[0].prices[0].priceMinor;
  assert.strictEqual(got, 11000, 'канал мав отримати базу, зсунуту СВОЇМ модифікатором');
  assert.notStrictEqual(got, 8000, 'канал отримав знижку сайту (−20%) — «прямо дешевше» перевернулось навиворіт');
  assert.notStrictEqual(got, 8800, 'модифікатори склались: сайтовий протік у канал поверх власного');
}
console.log('  ok  модифікатор сайту в канал не потрапляє — інакше знижка прямого каналу опиниться на OTA');

// Округлення: зсув дає копійки, і вони мусять лягти на ціле мінорне число.
// Дробова копійка по дорозі через JSON — це те, як ціна стає 24.999999.
{
  const q = queue([{ id: 'r1', kind: 'rate', unitTypeId: 'ut', ratePlanId: 'rp', date: DAY }]);
  const values: any[] = [];
  await flushOutbox(base({
    ...q.deps,
    pricesAt: async () => [{ occupancy: 2, priceMinor: 3333 }],
    priceModifierPercent: -7.5,
    send: async (_k, v) => { values.push(...v); return { warnings: [] }; },
  }));
  const got = values[0].prices[0].priceMinor;
  assert.ok(Number.isInteger(got), `зсунута ціна мусить бути цілою в мінорних одиницях, вийшло ${got}`);
  assert.strictEqual(got, 3083, '3333 мінус 7.5% це 3083.025 — округлення до цілої копійки');
}
console.log('  ok  зсунута ціна лишається цілим числом мінорних одиниць');

// ── 10. Межа спроб: гучна відмова через тиждень така ж тиха, як мовчання ─
//
// Рецензія 01.09.2026: «рядок лишається в черзі» для незмапленого — це нова
// вічність. Координата, яка падає щопроходу, після сотого разу нічим не
// відрізняється від тієї, про яку забули: журнал повний однакових рядків,
// які ніхто не читає. Тому межа — і стан «потребує уваги», видимий
// оператору, а не лише лічильник у колонці.
//
// Домен не веде лічильник (його рахує черга при звільненні), але він знає,
// СКІЛЬКИ разів координата вже падала, і мусить сказати вголос, коли це
// падіння — останнє дозволене. Звільнення при цьому все одно стається: саме
// воно робить рядок видимим як застряглий, а не вічно захопленим.
{
  const q = queue([{ id: 'r1', kind: 'rate', unitTypeId: 'ut', ratePlanId: 'rp', date: DAY, attempts: 4 }]);
  const report = await flushOutbox(base({
    ...q.deps,
    maxAttempts: 5,
    send: async () => { throw new Error('boom'); },
  }));
  assert.strictEqual(report.needsAttention, 1,
    'координата впала вп\'яте з пʼяти дозволених — звіт мусить назвати її такою, що потребує уваги');
  assert.ok(report.errors.some((e) => /attention/i.test(e)),
    'звіт мусить сказати це словами, а не лише числом: число в кроні ніхто не читає');
  assert.deepStrictEqual(q.free(), ['r1'],
    'звільнення все одно мусить статись — саме воно робить рядок видимим оператору, а не вічно захопленим');
  assert.strictEqual(report.failed, 1, 'це й далі провал, а не третій стан');
}
{
  // Перша невдача — ще не привід. Інакше кожен 429 ставав би «увагою».
  const q = queue([{ id: 'r1', kind: 'rate', unitTypeId: 'ut', ratePlanId: 'rp', date: DAY, attempts: 0 }]);
  const report = await flushOutbox(base({
    ...q.deps,
    maxAttempts: 5,
    send: async () => { throw new Error('429'); },
  }));
  assert.strictEqual(report.needsAttention, 0, 'перша невдача з пʼяти — це ще не «потребує уваги»');
}
console.log('  ok  межа спроб: остання дозволена невдача названа вголос, перша — ні');

// ── 11. Вісь ПАРИ у смузі цін (Ц10) ──────────────────────────────────────
//
// Знайдено читанням перед живим прогоном, а не самим прогоном — але саме
// прогін зробив би це видимим першим: один наш тариф на двох типах номерів
// це ДВА тарифи на тому боці, кожен зі своєю ціною (ціна ночі належить типу
// номера, а тариф її лише модифікує). Координата «тариф + дата» без типу
// не має чим ні цінуватись, ні адресуватись.
{
  const q = queue([
    { id: 'a', kind: 'rate', unitTypeId: 'DBL', ratePlanId: 'rp', date: DAY },
    { id: 'b', kind: 'rate', unitTypeId: 'SGL', ratePlanId: 'rp', date: DAY },
  ]);
  const asked: string[] = [];
  const values: any[] = [];
  await flushOutbox(base({
    ...q.deps,
    pricesAt: async (unitTypeId: string) => {
      asked.push(unitTypeId);
      return unitTypeId === 'DBL'
        ? [{ occupancy: 2, priceMinor: 20000 }]
        : [{ occupancy: 1, priceMinor: 15000 }];
    },
    send: async (_k, v) => { values.push(...v); return { warnings: [] }; },
  }));
  assert.deepStrictEqual([...asked].sort(), ['DBL', 'SGL'],
    'ціну питали без типу номера — а ціна ночі належить типу, тариф її лише зсуває');
  assert.strictEqual(values.find((v) => v.unitTypeId === 'DBL')?.prices?.[0]?.priceMinor, 20000,
    'значення для DBL мусить нести свій тип і свою ціну');
  assert.strictEqual(values.find((v) => v.unitTypeId === 'SGL')?.prices?.[0]?.priceMinor, 15000,
    'значення для SGL мусить нести свій тип і свою ціну');
}
// Координата ціни без типу не адресується — вона знімається й РАХУЄТЬСЯ, а
// не пропускається мовчки (третьої відповіді «не слати» не існує).
{
  const q = queue([{ id: 'x', kind: 'rate', ratePlanId: 'rp', date: DAY }]);
  const retired: string[] = [];
  let calls = 0;
  const report = await flushOutbox(base({
    ...q.deps,
    retire: async (ids: string[], reason: string) => { retired.push(...ids); assert.match(reason, /unit type/); },
    send: async () => { calls++; return { warnings: [] }; },
  }));
  assert.deepStrictEqual(retired, ['x'],
    'координата ціни без типу номера мовчки пропущена — вона лишиться в черзі назавжди і ніде не буде названа');
  assert.strictEqual(report.retired, 1);
  assert.strictEqual(calls, 0, 'нема чого слати — і нічого не має бути надіслано');
}
console.log('  ok  вісь пари: один тариф на двох типах — дві ціни, два адресати; координата без типу знімається вголос');

// ── 12. Діапазон: одна координата — багато дат, і рядок їде лише ЦІЛИМ ────
//
// Форма з Ц13: запис матриці без дат — це «кожна майбутня ніч», і черга
// тримає його одним рядком, а не тисячею. Батчер розкладає діапазон по
// датах сам: значення читається на КОЖНУ (черга тримає координату, не
// число), а стиснення в тілі повідомлення збере однакові назад.
{
  const q = queue([{ id: 'r1', kind: 'availability', unitTypeId: 'ut', date: '2026-11-10', dateTo: '2026-11-14' }]);
  const asked: string[] = [];
  const values: any[] = [];
  await flushOutbox(base({
    ...q.deps,
    availabilityAt: async (_ut: string, date: string) => { asked.push(date); return 2; },
    send: async (_k, v) => { values.push(...v); return { warnings: [] }; },
  }));
  assert.deepStrictEqual(asked, ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14'],
    'діапазон мусить розкластись по датах — значення читається на кожну, інакше поїде одна ніч із пʼяти');
  assert.strictEqual(values.length, 5);
  assert.deepStrictEqual(q.free(), [], 'рядок, що поїхав цілим, мусить бути позначений відправленим');
}
// Діапазон, що починається в минулому, обрізається сьогоднішнім днем, а не
// знімається: майбутні ночі в ньому справжні.
{
  const q = queue([{ id: 'r1', kind: 'rate', unitTypeId: 'ut', ratePlanId: 'rp', date: '2026-10-30', dateTo: '2026-11-02' }]);
  const asked: string[] = [];
  const report = await flushOutbox(base({
    ...q.deps,
    today: '2026-11-01',
    pricesAt: async (_ut: string, _rp: string, date: string) => { asked.push(date); return [{ occupancy: 2, priceMinor: 11000 }]; },
  }));
  assert.deepStrictEqual(asked, ['2026-11-01', '2026-11-02'], 'минулі ночі діапазону не питаються — вендор їх не приймає; майбутні мусять поїхати');
  assert.strictEqual(report.retired, 0, 'діапазон із майбутніми ночами не знімається');
  assert.deepStrictEqual(q.free(), []);
}
// А діапазон, що весь у минулому, — знімається, як і одна минула дата.
{
  const q = queue([{ id: 'old', kind: 'rate', unitTypeId: 'ut', ratePlanId: 'rp', date: '2026-10-01', dateTo: '2026-10-05' }]);
  const report = await flushOutbox(base({ ...q.deps, today: '2026-11-01' }));
  assert.strictEqual(report.retired, 1, 'діапазон цілком у минулому мусить бути знятий і порахований');
}
// Рядок, частина якого не поїхала, повертається ЦІЛИМ. Дати одного діапазону
// можуть розкластись на кілька пачок за розміром; успіх першої пачки не
// робить рядок відправленим — інакше друга половина не поїде ніколи, а
// журнал казатиме «слали».
{
  const q = queue([{ id: 'r1', kind: 'rate', unitTypeId: 'ut', ratePlanId: 'rp', date: '2026-11-10', dateTo: '2026-11-19' }]);
  let calls = 0;
  const report = await flushOutbox(base({
    ...q.deps,
    maxBodyBytes: 250,   // десять ночей не вміщаються в одну пачку
    send: async () => { calls++; if (calls === 2) throw new Error('boom'); return { warnings: [] }; },
  }));
  assert.ok(calls >= 2, `десять ночей при стелі 250 байт мали піти кількома пачками, пішло ${calls}`);
  assert.deepStrictEqual(q.free(), ['r1'],
    'рядок, у якого впала друга пачка, позначено відправленим за першою — друга половина не поїде ніколи');
  assert.strictEqual(report.sent, 0, 'частково відправлений рядок не рахується відправленим');
  assert.strictEqual(report.failed, 1, 'і рахується одним провалом, не десятьма');
  assert.strictEqual(q.released.length, 1, 'звільнення — один раз на рядок, не на пачку');
}
console.log('  ok  діапазон розкладається по датах, обрізається сьогоднішнім днем, і їде лише цілим');

// ── 13. Транспортна невдача — про прохід, не про рядок: спроба не рахується ──
//
// Межа спроб (Ц14) існує, щоб координата, яка падає СВОЄЮ причиною
// (незмаплена, відхилена вендором), стала видимою. Простій вендора, 429 і
// власна пауза обмежувача — причини проходу: крон раз на хвилину зʼїв би
// десять спроб за десять хвилин звичайного простою і поставив би ВСЮ чергу
// в «потребує уваги» — той самий шум, від якого межа мала рятувати. Тому
// адаптер позначає такі помилки `transient`, домен звільняє рядок без
// лічильника, і «уваги» з них не буває.
{
  const q = queue([{ id: 'r1', kind: 'rate', unitTypeId: 'ut', ratePlanId: 'rp', date: DAY, attempts: 9 }]);
  const report = await flushOutbox(base({
    ...q.deps,
    maxAttempts: 10,
    send: async () => { throw Object.assign(new Error('vendor 429 too many requests'), { transient: true }); },
  }));
  assert.deepStrictEqual(q.free(), ['r1'], 'координата має повернутись у чергу');
  assert.strictEqual(q.released[0]?.transient, true, 'звільнення мусить сказати черзі, що спробу НЕ рахувати');
  assert.strictEqual(report.needsAttention, 0,
    'простій вендора не робить координату «потребує уваги» — межа спроб про рядок, а не про прохід');
  assert.strictEqual(report.failed, 1, 'але це й далі «не поїхало», а не тиша');
}
{
  // А відповідь ВЕНДОРА про координату — рахується, як і раніше.
  const q = queue([{ id: 'r1', kind: 'rate', unitTypeId: 'ut', ratePlanId: 'rp', date: DAY, attempts: 9 }]);
  const report = await flushOutbox(base({
    ...q.deps,
    maxAttempts: 10,
    send: async () => ({ warnings: [{ warning: { rate: ['must be greater than 0'] } }] }),
  }));
  assert.strictEqual(q.released[0]?.transient, false, 'претензія вендора до значення — спроба рядка');
  assert.strictEqual(report.needsAttention, 1, 'десята відмова вендора — «потребує уваги»');
}
console.log('  ok  транспортна невдача не рахує спроби; відмова вендора рахує');

console.log('ari-batch: помилка звільняє чергу, ніч без ціни закривається, пачка ріжеться за розміром');

// ── Д1/Д2: обмеження й «закрито» їдуть у канал разом із ціною ────────────
//
// До 02.09 батчер знав лише ціну: `closed` означало «ціни немає». Тепер
// «закрито» з календаря — це `closed: true` ПРИ наявній ціні (И14: заборона
// продажу у вендора липка, ціна її не знімає, тож і ми шлемо обидва), а мінімум,
// максимум, заборони заїзду й виїзду — поля значення. Дві дати з РІЗНИМ
// мінімумом і відкрита поруч із закритою (інваріант 26).
{
  const q = queue([
    { id: 'a', kind: 'rate', unitTypeId: 'ut', ratePlanId: 'rp', date: '2026-11-10', dateTo: '2026-11-12' },
  ]);
  const sent: RateChange[] = [];
  const byDate: Record<string, { minStay: number; maxStay: number | null; noArrival: boolean; noDeparture: boolean; closed: boolean }> = {
    '2026-11-10': { minStay: 2, maxStay: null, noArrival: true, noDeparture: false, closed: false },
    '2026-11-11': { minStay: 3, maxStay: 7, noArrival: false, noDeparture: true, closed: true },
    '2026-11-12': { minStay: 1, maxStay: null, noArrival: false, noDeparture: false, closed: false },
  };
  await flushOutbox(base({
    ...q.deps,
    restrictionsAt: async (_ut: string, date: string) => byDate[date],
    send: async (_kind, values) => { sent.push(...(values as RateChange[])); return { warnings: [] }; },
  }));
  const at = (d: string) => sent.find((v) => v.date === d)!;
  assert.strictEqual(at('2026-11-10').minStay, 2, 'мінімум ночі заїзду їде як min_stay');
  assert.strictEqual(at('2026-11-11').minStay, 3, 'і сусідній день — своє число, не скопійоване');
  assert.strictEqual(at('2026-11-10').noArrival, true);
  assert.strictEqual(at('2026-11-11').noDeparture, true);
  assert.strictEqual(at('2026-11-11').maxStay, 7);
  assert.strictEqual(at('2026-11-11').closed, true, '«закрито» в календарі — заборона продажу, навіть коли ціна є');
  assert.ok(Array.isArray(at('2026-11-11').prices) && at('2026-11-11').prices!.length > 0, 'ціна при закритті ЛИШАЄТЬСЯ: липка заборона продажу знімається наступним відкриттям разом із ціною (И14)');
  assert.strictEqual(at('2026-11-10').closed, false);
  assert.strictEqual(at('2026-11-12').closed, false);
  assert.strictEqual(at('2026-11-12').minStay, 1);
}
console.log('  ok  обмеження й «закрито» з календаря їдуть у канал разом із ціною (Д1/Д2)');

// ── П6: розписка вендора лягає на відправлену координату ─────────────────
//
// Channex приймає ціну як ЗАДАЧУ: `200` і task id не означають «застосовано».
// Без збереженої розписки асинхронний провал невидимий. Тому `send` віддає
// розписку, а `markSent` отримує її разом із рядками — по одній на пачку;
// рядок-діапазон, що поїхав двома пачками, несе ОБИДВІ, через кому.
{
  const receipts: { ids: string[]; receipt: string | null }[] = [];
  let n = 0;
  const q = queue([
    { id: 'small', kind: 'rate', unitTypeId: 'ut', ratePlanId: 'rp', date: '2026-11-10' },
    { id: 'wide', kind: 'rate', unitTypeId: 'ut', ratePlanId: 'rp', date: '2026-11-11', dateTo: '2026-11-13' },
  ]);
  await flushOutbox(base({
    ...q.deps,
    markSent: async (ids: string[], receipt?: string | null) => { await q.deps.markSent(ids); receipts.push({ ids: [...ids].sort(), receipt: receipt ?? null }); },
    // Одне значення на пачку: діапазон з трьох ночей їде трьома пачками.
    sizeOf: () => 1,
    maxBodyBytes: 1,
    send: async () => ({ warnings: [], receipt: `task-${++n}` }),
  }));
  assert.deepStrictEqual(q.free(), [], 'усе поїхало');
  const forSmall = receipts.find((r) => r.ids.includes('small'))!;
  assert.strictEqual(forSmall.receipt, 'task-1', 'одна пачка — одна розписка на рядок');
  const forWide = receipts.find((r) => r.ids.includes('wide'))!;
  assert.strictEqual(forWide.receipt, 'task-2,task-3,task-4', 'рядок-діапазон із трьох пачок несе всі три розписки');
  assert.ok(!receipts.some((r) => r.ids.includes('small') && r.ids.includes('wide')), 'різні розписки — різні виклики markSent');
}
// Друга вісь: діапазон, що поїхав ОДНІЄЮ пачкою, несе одну розписку, а не
// по одній на ніч — живий прохід 02.09 показав `id,id,id` на три ночі.
{
  const receipts: { ids: string[]; receipt: string | null }[] = [];
  let n = 0;
  const q = queue([
    { id: 'wide', kind: 'rate', unitTypeId: 'ut', ratePlanId: 'rp', date: '2026-11-11', dateTo: '2026-11-13' },
  ]);
  await flushOutbox(base({
    ...q.deps,
    markSent: async (ids: string[], receipt?: string | null) => { await q.deps.markSent(ids); receipts.push({ ids: [...ids].sort(), receipt: receipt ?? null }); },
    send: async () => ({ warnings: [], receipt: `task-${++n}` }),
  }));
  assert.strictEqual(n, 1, 'три ночі однієї пари — одна пачка, один виклик');
  assert.strictEqual(receipts.find((r) => r.ids.includes('wide'))?.receipt, 'task-1', 'одна пачка — одна розписка, не по одній на ніч');
}
console.log('  ok  розписка вендора лягає на відправлену координату, діапазон — усі свої, і лише різні');

// ── П5: повний синк — 500 ночей, різне число щодня, рівно ДВА виклики ─────
//
// Вендор: «a full sync would be 2 API calls» (rate-limits.md). Повний синк —
// це один діапазон на тип і на пару (Ц15), а батчер розкладає по ночах,
// читає числа й стискає в діапазони; тіло вміщає все (10 МБ), тож смуга —
// один виклик, хоч би скільки різних значень у ній було. Ціна щодня інша
// (парна/непарна ніч) — стиснення НЕ склеює ночей, і виклик усе одно один.
{
  const FROM = '2027-06-01';
  const addDays = (iso: string, n: number) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
  const TO = addDays(FROM, 499); // 500 ночей включно
  const calls: { kind: string; values: number }[] = [];
  const q = queue([
    { id: 'a-dbl', kind: 'availability', unitTypeId: 'DBL', date: FROM, dateTo: TO },
    { id: 'a-sgl', kind: 'availability', unitTypeId: 'SGL', date: FROM, dateTo: TO },
    { id: 'r-bar-dbl', kind: 'rate', unitTypeId: 'DBL', ratePlanId: 'BAR', date: FROM, dateTo: TO },
    { id: 'r-bb-dbl', kind: 'rate', unitTypeId: 'DBL', ratePlanId: 'BB', date: FROM, dateTo: TO },
  ]);
  const parity = (date: string) => Number(date.slice(-2)) % 2;
  const report = await flushOutbox(base({
    ...q.deps,
    today: FROM,
    availabilityAt: async (_ut, date) => 3 + parity(date),
    pricesAt: async (_ut, _rp, date) => [{ occupancy: 2, priceMinor: 11000 + 1000 * parity(date) }],
    send: async (kind, values) => { calls.push({ kind, values: values.length }); return { warnings: [], receipt: `task-${calls.length}` }; },
  }));
  assert.strictEqual(report.sent, 4, 'усі чотири діапазони поїхали');
  assert.strictEqual(report.calls, 2, `500 ночей × (2 типи + 2 пари) — рівно два виклики, а не ${report.calls}`);
  assert.deepStrictEqual(calls.map((c) => c.kind).sort(), ['availability', 'rate'], 'по одному на смугу');
  // Домен віддає адаптеру по значенню на ніч — 500 × 2 пари; у діапазони їх
  // стискає адаптер (`ari-payload.ts`), і це доведено на моку. Тут головне:
  // тисяча різних значень у смузі — і все одно ОДИН виклик, бо тіло вміщає.
  const rate = calls.find((c) => c.kind === 'rate')!;
  assert.strictEqual(rate.values, 1000, 'ціна щодня інша — 500 значень на кожну пару в одному виклику');
  assert.strictEqual(calls.find((c) => c.kind === 'availability')!.values, 1000, 'те саме для наявності на два типи');
  assert.deepStrictEqual(q.free(), [], 'черга порожня');
}
console.log('  ok  повний синк: 500 ночей із різним числом щодня — рівно два виклики (П5)');

