/**
 * Слово броні з фоліо і борг без фоліо — ЧИСТІ твердження, без бази.
 *
 *   node src/modules/bookings/domain/folio-payment.check.ts
 *
 * Доти обидві функції трималися на одному гейті з живою базою
 * (`folio-book.check.ts`), і це надто крихко для двох правил, які вирішують,
 * скільки гість винен на виході. Тут вони перевіряються самі по собі, а
 * жива сцена лишається про те, що ці правила справді викликаються.
 *
 * Осі (інваріант 26), кожна з двома значеннями:
 *   нарахування  — є / немає;
 *   проживання   — є рядок `lodging` / лише послуга;
 *   гроші        — прийшли / не приходили;
 *   борг         — лишився / закритий.
 *
 * Числа не діляться навпіл навмисно: 5000 нараховано, 3000 сплачено, 2000
 * лишилось — три різні числа, тож «половина», «уся сума» і «решта» не
 * збігаються між собою.
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';

const { statusFromFolio, folioSettlesStay } = await import('./folio-payment.ts');
const { balanceFromReservation } = await import('./checkout-balance.ts');

const lodging = { items: [{ kind: 'lodging' }] };
const service = { items: [{ kind: 'service' }] };

// ── statusFromFolio ────────────────────────────────────────────────────────

assert.strictEqual(
  statusFromFolio({ totals: { charged: 5000, paid: 3000, balance: 2000 }, folios: [lodging] }),
  'partial', 'нараховано проживання, прийшла частина — «частково»');

assert.strictEqual(
  statusFromFolio({ totals: { charged: 5000, paid: 5000, balance: 0 }, folios: [lodging] }),
  'paid', 'нараховано проживання, борг закритий — «оплачено»');

// Нараховано, грошей немає — це НЕ мовчання, це «не оплачено». Мовчання тут
// лишало застаріле слово: після видалення платежу зустрічний рядок обнуляв
// фоліо, а бронь далі стояла `paid` (Р8.7) — гроші зникли з обох книг, а
// слово про них лишилось.
assert.strictEqual(
  statusFromFolio({ totals: { charged: 5000, paid: 0, balance: 5000 }, folios: [lodging] }),
  'unpaid', 'нараховано, грошей немає — «не оплачено», а не мовчання');

// Гроші є, а проживання ще не нараховане: рецепція взяла завдаток і не
// натискала «нарахувати». Слово `paid` тут було б брехнею — варта заселення
// пустила б гостя, який за ніч не платив, — а от «частково» правда, і саме
// його бракувало: у найчастішому потоці бронь не потрапляла у фільтр.
assert.strictEqual(
  statusFromFolio({ totals: { charged: 0, paid: 3000, balance: -3000 }, folios: [] }),
  'partial', 'завдаток без нарахування — «частково», а не мовчання');

// Оплачена лише послуга (вода), проживання не нараховане: НЕ «оплачено».
assert.strictEqual(
  statusFromFolio({ totals: { charged: 200, paid: 200, balance: 0 }, folios: [service] }),
  'partial', 'вода сплачена, проживання не нараховане — бронь не закрита');

// А от ПОРОЖНЯ книга (нічого не нараховано і нічого не сплачено) справді не
// каже нічого: рецепція ще не відкривала вкладку, і слово броні лишається.
assert.strictEqual(
  statusFromFolio({ totals: { charged: 0, paid: 0, balance: 0 }, folios: [] }),
  null, 'порожня книга не каже нічого');

assert.strictEqual(statusFromFolio(null), null, 'книги немає — нічого не кажемо');

// `folioSettlesStay` — та сама функція, вужче питання.
assert.strictEqual(
  folioSettlesStay({ totals: { charged: 200, paid: 200, balance: 0 }, folios: [service] }),
  false, 'сплачена вода бронь не закриває');
assert.strictEqual(
  folioSettlesStay({ totals: { charged: 5000, paid: 5000, balance: 0 }, folios: [lodging] }),
  true, 'сплачене проживання — закриває');
console.log('  ok  слово з фоліо: «оплачено» вимагає проживання, «частково» — лише грошей');

// ── balanceFromReservation ─────────────────────────────────────────────────

assert.strictEqual(balanceFromReservation('paid', 5000), 0);
assert.strictEqual(balanceFromReservation('prepaid', 5000), 0);
assert.strictEqual(balanceFromReservation('unpaid', 5000), 5000);
assert.strictEqual(balanceFromReservation('payment_requested', 5000), 5000);
// `partial` знає, що частина прийшла, і НЕ знає скільки: вигадане число на
// екрані гірше за відсутнє — за ним рецепція вимагає грошей, яких гість не
// винен. `null` тут не «нуль боргу», а «числа немає».
assert.strictEqual(balanceFromReservation('partial', 5000), null,
  '«частково» не має права оголошувати весь total_price');
assert.notStrictEqual(balanceFromReservation('partial', 5000), 0,
  'і нулем воно теж не є — боржника не можна випускати мовчки');
console.log('  ok  борг без фоліо: слово, яке не знає суми, повертає «числа немає»');

console.log('folio-payment: правила слова й боргу тримаються самі, без бази');
