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

/** Борг без фоліо: зі статусу оплати броні. */
export function balanceFromReservation(paymentStatus: string | null | undefined, totalPrice: number): number {
  if (paymentStatus === 'paid' || paymentStatus === 'prepaid') return 0;
  return money(Number(totalPrice) || 0);
}
