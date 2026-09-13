/**
 * Платіжний шлагбаум гостьової сторінки: стоїть за словом ОБʼЄКТА (INC-211).
 *
 * ── Вісь, якої тут раніше не було ───────────────────────────────────────
 *
 * Стверджується не «шлагбаум працює», а «шлагбаум РОЗРІЗНЯЄ два готелі». Тому
 * фікстура не вироджена по жодній з трьох осей (інваріант 26): політика має
 * чотири різні значення (`prepaid`, `allow_pay_later` і двоє невідомих),
 * оплаченість — два, секція — два. Таблиця істинності повна: 2 × 2 × 4.
 *
 * Виродженість тут коштувала б рівно того, що сталося в проді. Сцена з одним
 * готелем на `prepaid` була б зелена і на коді, який політики не читає
 * взагалі, — бо для `prepaid` правильна відповідь збігається зі старою.
 */
import assert from 'node:assert';
// Резолвер аліасів: сам предмет перевірки ходить у `@bookings/checkin-policy`,
// і без цього рядка сцена впала б на імпорті, а не на твердженні.
import '../../../../scripts/lib/module-aliases.mjs';

const { paymentGateStands } = await import('./payment-gate.ts') as {
  paymentGateStands: (f: {
    isPaid: boolean; paymentsSectionOn: boolean; checkinPaymentPolicy: unknown;
  }) => boolean;
};

let ok = 0;
const is = (got: boolean, want: boolean, what: string) => {
  assert.strictEqual(got, want, `${what}: чекали ${want}, отримали ${got}`);
  console.log(`  ok  ${what}`);
  ok += 1;
};

// ── 1. Готель, який вимагає оплати ДО заселення ─────────────────────────
// Поведінка дослівно та, що була до цієї зміни.
is(paymentGateStands({ isPaid: false, paymentsSectionOn: true, checkinPaymentPolicy: 'prepaid' }),
  true, 'prepaid + винен + секція є → шлагбаум СТОЇТЬ');
is(paymentGateStands({ isPaid: true, paymentsSectionOn: true, checkinPaymentPolicy: 'prepaid' }),
  false, 'prepaid + сплачено → шлагбаума немає');
is(paymentGateStands({ isPaid: false, paymentsSectionOn: false, checkinPaymentPolicy: 'prepaid' }),
  false, 'prepaid + секцію вимкнено → шлагбаума немає (старий спосіб його зняти)');
is(paymentGateStands({ isPaid: true, paymentsSectionOn: false, checkinPaymentPolicy: 'prepaid' }),
  false, 'prepaid + сплачено + секції немає → шлагбаума немає');

// ── 2. Готель, який бере гроші на стійці ────────────────────────────────
// Рядок, заради якого все це існує: винен, секція увімкнена — і все одно
// проходить далі. На старому коді ця клітинка була `true`.
is(paymentGateStands({ isPaid: false, paymentsSectionOn: true, checkinPaymentPolicy: 'allow_pay_later' }),
  false, 'allow_pay_later + винен + секція є → шлагбаума НЕМАЄ (INC-211)');
is(paymentGateStands({ isPaid: true, paymentsSectionOn: true, checkinPaymentPolicy: 'allow_pay_later' }),
  false, 'allow_pay_later + сплачено → шлагбаума немає');
is(paymentGateStands({ isPaid: false, paymentsSectionOn: false, checkinPaymentPolicy: 'allow_pay_later' }),
  false, 'allow_pay_later + секції немає → шлагбаума немає');
is(paymentGateStands({ isPaid: true, paymentsSectionOn: false, checkinPaymentPolicy: 'allow_pay_later' }),
  false, 'allow_pay_later + сплачено + секції немає → шлагбаума немає');

// ── 3. Пара, яка доводить, що вісь ЧИТАЄТЬСЯ ────────────────────────────
//
// Дві клітинки, що різняться ЛИШЕ політикою і мають різні відповіді. Це і є
// несумісність з альтернативним прочитанням (друга половина інваріанта 26):
// код, який політики не бачить, не може дати тут два різні значення.
const sameExceptPolicy = { isPaid: false, paymentsSectionOn: true } as const;
assert.notStrictEqual(
  paymentGateStands({ ...sameExceptPolicy, checkinPaymentPolicy: 'prepaid' }),
  paymentGateStands({ ...sameExceptPolicy, checkinPaymentPolicy: 'allow_pay_later' }),
  'дві клітинки, що різняться лише політикою, дали однакову відповідь — вісь не читається',
);
console.log('  ok  вісь політики справді змінює відповідь, а не супроводжує її');
ok += 1;

// ── 4. Невідоме слово — найсуворіше (інваріант 13) ──────────────────────
//
// Два РІЗНИХ невідомих, не одне: сцена з єдиним `null` була б зелена і на
// коді, який перевіряє саме `null`, а не «усе, що не allow_pay_later».
for (const unknown of [null, undefined, '', 'lunar', 'PREPAID', 'allow_pay_later ']) {
  is(paymentGateStands({ isPaid: false, paymentsSectionOn: true, checkinPaymentPolicy: unknown }),
    true, `невідоме слово обʼєкта (${JSON.stringify(unknown)}) → шлагбаум стоїть`);
}

console.log(`payment-gate: шлагбаум читає слово обʼєкта, ${ok} тверджень`);
