/**
 * Статуси оплати броні — один словник на всі екрани.
 *
 * Тут вони жили розкиданими: свій `PAYMENT_STATUS_MAP` у списку броней, свій
 * список у формі броні, окремі порівняння в картці й планері. Поки колонка не
 * мінялась, розбіжності не було видно; щойно фінансовий модуль почав писати
 * пʼяте значення, список броней показав операторові сирий токен `partial`
 * замість слова, а фільтр не мав чим його вибрати.
 *
 * Тому набір значень — ЗДЕСЬ, і сцена `data/payment-status.check.ts` звіряє
 * його з тим, що дозволяє CHECK колонки. Нове значення в базі без слова тут
 * валить перевірку: інакше воно тихо доїде до екрана як `partial`.
 *
 * Кольори — токенами теми (`check-ui-tokens`), не літералами.
 */
export const PAYMENT_STATUS_VALUES = ['unpaid', 'payment_requested', 'partial', 'prepaid', 'paid'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUS_VALUES)[number];

export interface PaymentStatusLook {
  /** Слово оператора; через `t()` на екрані, не тут. */
  label: string;
  color: string;
  bg: string;
}

export const PAYMENT_STATUS_MAP: Record<PaymentStatus, PaymentStatusLook> = {
  unpaid: { label: 'Не оплачено', color: 'var(--accent-danger)', bg: 'var(--accent-danger-light)' },
  payment_requested: { label: 'Запит на оплату', color: 'var(--accent-warning)', bg: 'var(--accent-warning-light)' },
  // «Частково» — гроші вже прийшли, але не всі: не червоне і не зелене.
  // Пише його фінансовий модуль (`recalcReservationPaymentStatus`) і
  // `POST /api/payments` з `type: deposit|partial`.
  partial: { label: 'Частково оплачено', color: 'var(--accent-warning)', bg: 'var(--accent-warning-light)' },
  prepaid: { label: 'Передплата', color: 'var(--accent-info)', bg: 'var(--accent-info-light)' },
  paid: { label: 'Оплачено', color: 'var(--accent-success)', bg: 'var(--accent-success-light)' },
};

/** Невідоме значення повертає себе, а не порожнечу: краще токен, ніж нічого. */
export function paymentStatusLabel(value: string | null | undefined): string {
  const key = String(value ?? '') as PaymentStatus;
  return PAYMENT_STATUS_MAP[key]?.label ?? String(value ?? '');
}

export function paymentStatusLook(value: string | null | undefined): PaymentStatusLook {
  const key = String(value ?? '') as PaymentStatus;
  return PAYMENT_STATUS_MAP[key] ?? { label: String(value ?? ''), color: 'var(--text-tertiary)', bg: 'var(--bg-tertiary)' };
}

/** Бронь, за яку заплачено не все: саме її шукає фільтр «частково». */
export function isPartlyPaid(value: string | null | undefined): boolean {
  return value === 'partial';
}
