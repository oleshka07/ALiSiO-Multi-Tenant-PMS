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

const DAY = '2026-11-10';

/** Черга в памʼяті: рівно та поведінка, яку дає `cm_outbox`. */
function queue(rows: { id: string; kind: 'availability' | 'rate'; unitTypeId?: string; ratePlanId?: string; date: string }[]) {
  const claimed = new Set<string>();
  const sent = new Set<string>();
  const released: { ids: string[]; reason: string }[] = [];
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
      release: async (ids: string[], reason: string) => {
        for (const id of ids) claimed.delete(id);
        released.push({ ids, reason });
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
  const q = queue([{ id: 'r1', kind: 'rate', ratePlanId: 'rp', date: DAY }]);
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
  const q = queue([{ id: 'r1', kind: 'rate', ratePlanId: 'rp', date: DAY }]);
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
    { id: 'a', kind: 'rate', ratePlanId: 'has-price', date: DAY },
    { id: 'b', kind: 'rate', ratePlanId: 'no-price', date: DAY },
  ]);
  await flushOutbox(base({
    ...q.deps,
    pricesAt: async (ratePlanId: string) =>
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
    id: `r${i}`, kind: 'rate' as const, ratePlanId: `rp${i}`, date: DAY,
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
  const q = queue([{ id: 'big', kind: 'rate', ratePlanId: 'rp', date: DAY }]);
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
    { id: 'r1', kind: 'rate', ratePlanId: 'rp', date: DAY },
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
    { id: 'r1', kind: 'rate', ratePlanId: 'rp', date: DAY },
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
    { id: 'r1', kind: 'rate', ratePlanId: 'gone', date: DAY },
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
  const q = queue([{ id: 'r1', kind: 'rate', ratePlanId: 'orphan', date: DAY }]);
  const report = await flushOutbox(base({
    ...q.deps,
    send: async () => ({ warnings: [], unmapped: ['orphan'] }),
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
    { id: 'r1', kind: 'rate', ratePlanId: 'rp', date: DAY },
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
    { id: 'old', kind: 'rate', ratePlanId: 'rp', date: '2020-01-01' },
    { id: 'now', kind: 'rate', ratePlanId: 'rp', date: DAY },
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
  const q = queue([{ id: 'r1', kind: 'rate', ratePlanId: 'rp', date: DAY }]);
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
  const q = queue([{ id: 'r1', kind: 'rate', ratePlanId: 'rp', date: DAY }]);
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
  const q = queue([{ id: 'r1', kind: 'rate', ratePlanId: 'rp', date: DAY }]);
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

console.log('ari-batch: помилка звільняє чергу, ніч без ціни закривається, пачка ріжеться за розміром');
