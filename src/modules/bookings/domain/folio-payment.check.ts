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

const { statusFromFolio, folioSettlesStay, legacyInvoiceWanted } = await import('./folio-payment.ts');
const { balanceFromReservation } = await import('./checkout-balance.ts');

const lodging = { items: [{ kind: 'lodging' }], payments: [{ amount: 1 }] };
const service = { items: [{ kind: 'service' }], payments: [{ amount: 1 }] };
/** Нарахування є, а рядків оплати не було жодного — книга про гроші мовчить. */
const lodgingNoPayments = { items: [{ kind: 'lodging' }], payments: [] as unknown[] };
/** Нарахування є, платіж БУВ і його зняли зустрічним рядком — сума нуль. */
const lodgingReversed = { items: [{ kind: 'lodging' }], payments: [{ amount: 5000 }, { amount: -5000 }] };

// ── statusFromFolio ────────────────────────────────────────────────────────

assert.strictEqual(
  statusFromFolio({ totals: { charged: 5000, paid: 3000, balance: 2000 }, folios: [lodging] }),
  'partial', 'нараховано проживання, прийшла частина — «частково»');

assert.strictEqual(
  statusFromFolio({ totals: { charged: 5000, paid: 5000, balance: 0 }, folios: [lodging] }),
  'paid', 'нараховано проживання, борг закритий — «оплачено»');

// Гроші в книзі БУЛИ і їх не стало — це НЕ мовчання, це «не оплачено».
// Мовчання тут лишало застаріле слово: після видалення платежу зустрічний
// рядок обнуляв фоліо, а бронь далі стояла `paid` (Р8.7) — гроші зникли з
// обох книг, а слово про них лишилось.
assert.strictEqual(
  statusFromFolio({ totals: { charged: 5000, paid: 0, balance: 5000 }, folios: [lodgingReversed] }),
  'unpaid', 'платіж зняли зустрічним рядком — «не оплачено», а не мовчання');

// А ТЕ САМЕ ЧИСЛО без жодного рядка оплати мовчить (Р10.9). Вісь тут — не
// сума (вона в обох випадках нуль), а сам РУХ: нараховане проживання без
// жодного платежу — нормальний стан половини системи. Бронь, якій виставили
// рахунок і чекають переказу, має слово `payment_requested`, поставлене
// людиною; німецький обʼєкт без TSE не тримає у фоліо готівки ВЗАГАЛІ, тож
// там це стан постійний. `unpaid` тут стирав би те, що сказала людина, і
// робив би це на кожному дотику до броні.
assert.strictEqual(
  statusFromFolio({ totals: { charged: 5000, paid: 0, balance: 5000 }, folios: [lodgingNoPayments] }),
  null, 'нараховано, а грошей у книзі не було ніколи — книга мовчить');

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

// ── folioSettlesStay ───────────────────────────────────────────────────────
//
// Та сама функція, вужче питання — і власний набір тверджень, а не два рядки
// на згадку. Ці шість були в дереві до 07.09 і зникли разом зі старим текстом
// файла (Р10.7); повернуті з ЯВНИМ `paid`. Стара фікстура називала лише
// `charged` і `balance`, а це вироджено по осі, про яку твердження й говорить:
// «борг нуль» без сказаного «скільки прийшло» читається і як «сплачено все», і
// як «не сплачено нічого» — саме та неоднозначність, яку ловить інваріант 26.
const lodgingItem = { kind: 'lodging' };
const waterItem = { kind: 'service' };
const pay = (n: number) => ({ payments: [{ amount: n }] });
assert.strictEqual(
  folioSettlesStay({ totals: { charged: 3600, paid: 3600, balance: 0 }, folios: [{ items: [lodgingItem, waterItem], ...pay(3600) }] }),
  true, 'проживання нараховано, борг нуль — закриває');
assert.strictEqual(
  folioSettlesStay({ totals: { charged: 3600, paid: 3700, balance: -100 }, folios: [{ items: [lodgingItem], ...pay(3700) }] }),
  true, 'переплата — теж закриває');
assert.strictEqual(
  folioSettlesStay({ totals: { charged: 45, paid: 45, balance: 0 }, folios: [{ items: [waterItem], ...pay(45) }] }),
  false, 'лише вода, без проживання — НЕ закриває');
assert.strictEqual(
  folioSettlesStay({ totals: { charged: 3600, paid: 2400, balance: 1200 }, folios: [{ items: [lodgingItem], ...pay(2400) }] }),
  false, 'борг — не закриває');
assert.strictEqual(
  folioSettlesStay({ totals: { charged: 0, paid: 0, balance: 0 }, folios: [] }),
  false, 'порожнє фоліо — не закриває');
// Єдина вісь про КІЛЬКА фоліо в дереві: рахунок поділили, проживання лягло на
// другого платника. Без неї «є проживання» можна було читати як «є в першому».
assert.strictEqual(
  folioSettlesStay({ totals: { charged: 3600, paid: 3600, balance: 0 }, folios: [{ items: [waterItem], ...pay(600) }, { items: [lodgingItem], ...pay(3000) }] }),
  true, 'проживання на ДРУГОМУ платнику — рахується');
assert.strictEqual(folioSettlesStay(null), false, 'книги немає — не закриває');
assert.strictEqual(
  folioSettlesStay({ totals: { charged: 200, paid: 200, balance: 0 }, folios: [service] }),
  false, 'сплачена вода бронь не закриває');
assert.strictEqual(
  folioSettlesStay({ totals: { charged: 5000, paid: 5000, balance: 0 }, folios: [lodging] }),
  true, 'сплачене проживання — закриває');
console.log('  ok  бронь закривається лише з нарахованим проживанням і нульовим боргом');

// ── legacyInvoiceWanted ────────────────────────────────────────────────────
//
// Ці шість теж зникли разом зі старим текстом файла (Р10.7), а функція жива:
// `bookings/api/reservation.handlers.ts` вирішує нею, чи виписувати ДРУГИЙ
// юридичний документ на ту саму суму. Два шляхи документа вже жили поруч —
// оплата з фоліо ставила `paid`, генеричний PATCH на це слово виписував
// legacy-фактуру серії HOUSE на `total_price`, а «Виставити документ» із фоліо
// давав другий номер. Осі: спосіб оплати (фоліо / готівка через фоліо / ручна
// готівка / без способу) і саме слово статусу.
assert.strictEqual(legacyInvoiceWanted({ payment_status: 'paid', payment_method: 'folio' }),
  false, 'оплата з фоліо — документ виставляє фоліо');
assert.strictEqual(legacyInvoiceWanted({ payment_status: 'paid', payment_method: 'folio_cash' }),
  false, 'готівка через фоліо — те саме');
assert.strictEqual(legacyInvoiceWanted({ payment_status: 'paid', payment_method: 'cash' }),
  true, 'ручна готівка без фоліо — старий шлях лишається');
assert.strictEqual(legacyInvoiceWanted({ payment_status: 'paid' }),
  true, 'ручне «оплачено» без способу — старий шлях');
assert.strictEqual(legacyInvoiceWanted({ payment_status: 'prepaid', payment_method: 'cash' }),
  false, 'не paid — нічого не виписується');
assert.strictEqual(legacyInvoiceWanted({ payment_method: 'folio' }),
  false, 'без статусу — нічого не виписується');
console.log('  ok  legacy-документ не виписується на оплату з фоліо; ручне «оплачено» — як було');
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
