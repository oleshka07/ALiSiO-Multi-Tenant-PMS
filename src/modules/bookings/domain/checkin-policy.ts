/**
 * Кого пускають у номер — і за чиїм словом.
 *
 * Чисті функції: жодного запиту, жодного `Request`. Факти приносить
 * `data/checkin.repo.ts`, рішення ухвалюється тут, і саме тому воно
 * перевіряється сценою без бази (`checkin-policy.check.ts`).
 *
 * ── Чому це взагалі окремий файл ────────────────────────────────────────
 *
 * Доти правило заселення жило числом у тілі `PATCH /api/bookings/[id]`
 * (`reservation.handlers.ts:194`): «оплата ∈ paid|prepaid, інакше 422». Поки
 * заселяла лише рецепція, це було видно з одного місця. Кіоск додає ДРУГОГО
 * писача, і копія правила в ньому означала б рівно те, від чого існує
 * інваріант 16: два джерела однієї відповіді, які розходяться мовчки —
 * рецепція пускає, термінал ні, і навпаки.
 *
 * ── Три речі, які тут вирішуються ───────────────────────────────────────
 *
 *   оплата        — за політикою ОБʼЄКТА (`checkin_payment_policy`, 0410):
 *                   `prepaid` — як було; `allow_pay_later` — пускає без
 *                   оплати (К1: на кіоску оплати немає, платять уранці);
 *   реєстрація    — обовʼязкова ЗАВЖДИ, у будь-якої політики і будь-якого
 *                   писача. Це не про гроші, це про книгу гостей;
 *   брудний номер — рецепції ПОПЕРЕДЖЕННЯ (Блок 4 §2.2: людина бачить і
 *                   вирішує сама), терміналу ВІДМОВА (§3.1). Різниця не в
 *                   суворості, а в тому, що біля терміналу нема кому
 *                   вирішувати: гість отримав би код від кімнати, у якій ще
 *                   не прибрано, і дізнався б про це, відчинивши двері.
 */

/** Слово обʼєкта про оплату при заселенні (0410). */
export const CHECKIN_PAYMENT_POLICIES = ['prepaid', 'allow_pay_later'] as const;
export type CheckinPaymentPolicy = typeof CHECKIN_PAYMENT_POLICIES[number];

/** Чия книга головна (0410): чужа система на час дзеркала — чи наша. */
export const SYSTEMS_OF_RECORD = ['external', 'alisio'] as const;
export type SystemOfRecord = typeof SYSTEMS_OF_RECORD[number];

/** Хто заселяє: людина на стійці чи термінал у холі. */
export type CheckinActorKind = 'reception' | 'device';

/**
 * Слово обʼєкта, приведене до відомого. Невідоме або порожнє → `prepaid`.
 *
 * Найсуворіше з двох, і це інваріант 13, а не обережність: рядка обʼєкта
 * немає, колонка порожня, значення чуже — усе це «ми не знаємо, чи можна
 * пускати без оплати», а не «можна». Порожній контекст орендаря на Postgres
 * дає рівно цю картину: `SELECT` без орендаря повертає нуль рядків, і
 * найм'якший дефолт відчинив би двері саме там, де орендар невідомий.
 */
export function readCheckinPolicy(raw: unknown): CheckinPaymentPolicy {
  return raw === 'allow_pay_later' ? 'allow_pay_later' : 'prepaid';
}

/**
 * Чия книга. Невідоме → `alisio`, і це НЕ те саме міркування, що вище.
 *
 * Тут найсуворіше значення взагалі не визначене: `external` не «слабше»
 * за `alisio`, воно інше. Дефолт має збігатися з тим, що було до колонки, а
 * до неї головними були завжди ми — інакше готель, який ні про яке дзеркало
 * не чув, раптом перестав би отримувати фактури.
 */
export function readSystemOfRecord(raw: unknown): SystemOfRecord {
  return raw === 'external' ? 'external' : 'alisio';
}

/** Статуси оплати, які політика `prepaid` вважає оплатою. Той самий перелік, що стояв у PATCH. */
const PAID = ['paid', 'prepaid'];

export interface CheckinFacts {
  policy: CheckinPaymentPolicy;
  paymentStatus: string | null | undefined;
  registrationStatus: string | null | undefined;
  /** Стан прибирання ПРИЗНАЧЕНОГО номера; `null` — номера в броні ще немає. */
  cleaningStatus: string | null | undefined;
  actor: CheckinActorKind;
}

export type CheckinRefusal =
  | 'payment_required'
  | 'not_registered'
  | 'unit_dirty'
  | 'no_unit';

export type CheckinDecision =
  | { allowed: true; warning: 'unit_dirty' | null }
  | { allowed: false; refusal: CheckinRefusal };

/**
 * Пускати чи ні. Порядок відмов — той самий, що був у PATCH (оплата, потім
 * реєстрація): рецепція звикла до цих двох текстів у цьому порядку, і
 * переставляти їх заради охайності означало б змінити поведінку екрана
 * заодно з правилом.
 */
export function checkinDecision(f: CheckinFacts): CheckinDecision {
  if (f.policy === 'prepaid' && !PAID.includes(String(f.paymentStatus ?? ''))) {
    return { allowed: false, refusal: 'payment_required' };
  }
  if (f.registrationStatus !== 'registered') {
    return { allowed: false, refusal: 'not_registered' };
  }

  // Номера немає. Рецепції це не заважає — вона заселяє «в тип», а кімнату
  // назве ввечері, і так було до кіоска. Терміналу заважає: уся його
  // остання сцена — «Номер 214, код скриньки 4871» (§3.2 крок 5), і
  // заселення без номера скінчилось би порожнім екраном замість ключа.
  if (f.cleaningStatus === null || f.cleaningStatus === undefined) {
    return f.actor === 'device'
      ? { allowed: false, refusal: 'no_unit' }
      : { allowed: true, warning: null };
  }

  if (f.cleaningStatus !== 'clean') {
    return f.actor === 'device'
      ? { allowed: false, refusal: 'unit_dirty' }
      : { allowed: true, warning: 'unit_dirty' };
  }

  return { allowed: true, warning: null };
}
