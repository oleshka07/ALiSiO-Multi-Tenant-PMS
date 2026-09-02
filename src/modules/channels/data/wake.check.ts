/**
 * Пробудження проходу стрічки: один прохід на зʼєднання за раз, і ще один — якщо просили під час.
 *
 *   node src/modules/channels/data/wake.check.ts
 *
 * Вебхуки приходять пачками: десять броней за секунду — десять сигналів. Десять
 * паралельних проходів однієї стрічки — це десять читань тієї самої сторінки й
 * бюджет обʼєкта, спалений на дублікати (И10). Тому засувка: прохід іде один;
 * сигнал під час проходу означає «після цього — ще раз», і скільки б їх не
 * прийшло, буде рівно один додатковий. Інше зʼєднання — інша засувка.
 * Прохід, що впав, засувку відпускає — інакше одна помилка глушить сигнали
 * назавжди.
 *
 * Перевірка написана ДО коду і була червоною (інваріант 24).
 */
import assert from 'node:assert';
import { createWaker } from './wake.ts';

const errors: unknown[] = [];
const waker = createWaker({ onError: (e) => { errors.push(e); } });

function gate() {
  let release!: () => void;
  let fail!: (e: Error) => void;
  const done = new Promise<void>((resolve, reject) => { release = resolve; fail = reject; });
  return { done, release, fail };
}
const tick = () => new Promise<void>((r) => setImmediate(r));

// ── Один прохід за раз; сигнали під час — один додатковий прохід ─────────
{
  const runs: string[] = [];
  const g1 = gate();
  const g2 = gate();
  const gates = [g1, g2];
  const run = async () => { runs.push('A'); await gates.shift()!.done; };

  assert.strictEqual(waker.request('conn-A', run), true, 'вільна засувка — прохід починається зараз');
  await tick();
  assert.deepStrictEqual(runs, ['A'], 'іде один прохід');
  assert.strictEqual(waker.request('conn-A', run), false, 'під час проходу сигнал лише запамʼятовується');
  assert.strictEqual(waker.request('conn-A', run), false, 'і другий, і третій — те саме');
  assert.strictEqual(waker.request('conn-A', run), false);
  await tick();
  assert.deepStrictEqual(runs, ['A'], 'паралельного проходу немає');

  g1.release();
  await tick(); await tick();
  assert.deepStrictEqual(runs, ['A', 'A'], 'після проходу — рівно один додатковий, не три');
  assert.strictEqual(waker.inFlight('conn-A'), true);

  g2.release();
  await tick(); await tick();
  assert.deepStrictEqual(runs, ['A', 'A'], 'без нових сигналів третього проходу немає');
  assert.strictEqual(waker.inFlight('conn-A'), false, 'засувка відпущена');
}
console.log('  ok  один прохід за раз; пачка сигналів під час — один додатковий');

// ── Інше зʼєднання — незалежна засувка ───────────────────────────────────
{
  const runs: string[] = [];
  const gA = gate();
  const gB = gate();
  assert.strictEqual(waker.request('conn-A', async () => { runs.push('A'); await gA.done; }), true);
  assert.strictEqual(waker.request('conn-B', async () => { runs.push('B'); await gB.done; }), true, 'сусіднє зʼєднання не чекає на це');
  await tick();
  assert.deepStrictEqual(runs.sort(), ['A', 'B']);
  gA.release(); gB.release();
  await tick(); await tick();
  assert.strictEqual(waker.inFlight('conn-A'), false);
  assert.strictEqual(waker.inFlight('conn-B'), false);
}
console.log('  ok  зʼєднання не чекають одне на одного');

// ── Прохід упав — засувка відпущена, помилка названа, наступний сигнал працює
{
  const runs: number[] = [];
  assert.strictEqual(waker.request('conn-C', async () => { runs.push(1); throw new Error('feed down'); }), true);
  await tick(); await tick();
  assert.strictEqual(errors.length, 1, 'помилка проходу доходить до onError, а не губиться');
  assert.strictEqual(waker.inFlight('conn-C'), false, 'падіння відпускає засувку');
  assert.strictEqual(waker.request('conn-C', async () => { runs.push(2); }), true, 'наступний сигнал знову йде');
  await tick(); await tick();
  assert.deepStrictEqual(runs, [1, 2]);
}
console.log('  ok  падіння проходу не глушить наступні сигнали');

// ── Сигнал під час проходу, який потім упав, — додатковий прохід усе одно йде
{
  const runs: number[] = [];
  const g = gate();
  assert.strictEqual(waker.request('conn-D', async () => { runs.push(1); await g.done; }), true);
  await tick();
  assert.strictEqual(waker.request('conn-D', async () => { runs.push(2); }), false);
  g.fail(new Error('boom'));
  await tick(); await tick(); await tick();
  assert.deepStrictEqual(runs, [1, 2], 'обіцяний додатковий прохід іде навіть після падіння першого');
  assert.strictEqual(errors.length, 2);
}
console.log('  ok  обіцяний додатковий прохід не губиться через падіння попереднього');

console.log('wake: сигнал будить один прохід, пачка — один додатковий, падіння — не назавжди');
