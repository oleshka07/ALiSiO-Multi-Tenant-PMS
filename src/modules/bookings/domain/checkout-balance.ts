/**
 * Виселення з боргом — правило обʼєкта, не коду.
 *
 * `properties.checkout_balance_policy` (0091): `none` — баланс не дивимось,
 * `warning` — виселяємо, але відповідь несе прапорець, `blocking` — 422 з
 * назвою причини. Дефолт колонки — `warning`. Джерело форми — Hoteliera,
 * General settings («перевірка балансу при виїзді»).
 *
 * Борг рахується двома способами, і перший має перевагу:
 *   - з фоліо броні: усе нараховане (не сторноване) мінус усе оплачене;
 *   - без фоліо — зі статусу оплати самої броні: `paid`/`prepaid` — нуль,
 *     інакше вся сума. Це те саме слово, за яким варта заселення пускає
 *     гостя в номер, тож виселення читає його так само.
 *
 * Чисті функції без бази: `checkout-balance.check.ts` поруч.
 */
import { money, sumMoney } from '@core/money';

export const CHECKOUT_BALANCE_POLICIES = ['none', 'warning', 'blocking'] as const;
export type CheckoutBalancePolicy = (typeof CHECKOUT_BALANCE_POLICIES)[number];

export interface CheckoutDecision {
  /** Чи можна виселити. */
  allowed: boolean;
  /** Прапорець у відповідь, коли виселяємо з боргом під `warning`. */
  warning: 'unpaid_balance' | null;
  /** Борг, про який ішлося (додатний = гість винен). */
  balance: number;
}

/**
 * Значення з бази → політика. Порожнє — дефолт колонки. Невідоме слово
 * читається як НАЙСУВОРІШЕ (інваріант 13): рядок, якого читач не розуміє,
 * не має відкривати двері.
 */
export function readCheckoutPolicy(value: unknown): CheckoutBalancePolicy {
  if (value === null || value === undefined || value === '') return 'warning';
  const s = String(value);
  return (CHECKOUT_BALANCE_POLICIES as readonly string[]).includes(s)
    ? (s as CheckoutBalancePolicy)
    : 'blocking';
}

export function checkoutDecision(policy: CheckoutBalancePolicy, balance: number): CheckoutDecision {
  const owed = money(balance);
  if (owed <= 0 || policy === 'none') return { allowed: true, warning: null, balance: owed };
  if (policy === 'warning') return { allowed: true, warning: 'unpaid_balance', balance: owed };
  return { allowed: false, warning: null, balance: owed };
}

/** Борг з фоліо: нараховане мінус оплачене, до копійки. */
export function openBalance(charges: readonly number[], payments: readonly number[]): number {
  return money(sumMoney(charges) - sumMoney(payments));
}

/**
 * Борг без фоліо: зі статусу оплати броні — і лише там, де слово ЗНАЄ суму.
 *
 * `null` означає «числа немає»: воно повертається для `partial`, бо це слово
 * каже, що частина грошей прийшла, і НЕ каже, скільки. Раніше тут стояв увесь
 * `total_price`, і виселення показувало повний борг броні, за яку вже
 * заплатили три тисячі з пʼяти (В3). Вигадане число на екрані гірше за
 * відсутнє: за ним рецепція вимагає в гостя гроші, яких він не винен.
 *
 * Після В3 такий стан майже не досяжний: гроші за бронь лягають у фоліо, тож
 * `partial` без фоліо — це або спадок (його перераховує міграція 0095), або
 * слово, поставлене руками. Політика вирішує, що робити з невідомим боргом,
 * і `blocking` при цьому не пускає — інваріант 13.
 */
export function balanceFromReservation(
  paymentStatus: string | null | undefined,
  totalPrice: number,
): number | null {
  if (paymentStatus === 'paid' || paymentStatus === 'prepaid') return 0;
  if (paymentStatus === 'partial') return null;
  return money(Number(totalPrice) || 0);
}
