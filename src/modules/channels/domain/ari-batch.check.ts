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

console.log('ari-batch: помилка звільняє чергу, ніч без ціни закривається, пачка ріжеться за розміром');
