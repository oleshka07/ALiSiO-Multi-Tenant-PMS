/**
 * Чи можна виселити цю бронь — політика обʼєкта проти боргу гостя.
 *
 * Читає дві речі і зводить їх домену (`domain/checkout-balance.ts`):
 *   - `properties.checkout_balance_policy` (0091) — слово обʼєкта;
 *   - борг — з фоліо броні через `@invoicing/kernel` (нараховане мінус
 *     оплачене); коли фоліо ще немає — зі статусу оплати самої броні.
 *
 * Обʼєкта немає — це не «політики немає, отже можна»: рядка без обʼєкта не
 * існує, і відповідь — `notFound` (інваріант 13).
 *
 * Сцена з живою базою — `checkout.repo.check.ts`: політика × борг, борг з
 * фоліо і без нього.
 */
import type { Sql } from '@core/db/async';
import { reservationBalance } from '@invoicing/kernel';
import {
  readCheckoutPolicy, checkoutDecision, balanceFromReservation, type CheckoutDecision,
} from '../domain/checkout-balance';

export async function decideCheckout(sql: Sql, input: {
  organizationId: string;
  propertyId: string;
  reservationId: string;
  /** Статус оплати, який стане чинним разом із виселенням (тіло або рядок). */
  paymentStatus: string | null | undefined;
  totalPrice: number;
}): Promise<CheckoutDecision | 'not_found'> {
  const prop = await sql.row<any>(
    'SELECT checkout_balance_policy FROM properties WHERE id = ? AND organization_id = ?',
    [input.propertyId, input.organizationId]);
  if (!prop) return 'not_found';
  const policy = readCheckoutPolicy(prop.checkout_balance_policy);
  const folio = await reservationBalance(input.reservationId, sql);
  const balance = folio.hasFolio
    ? folio.balance
    : balanceFromReservation(input.paymentStatus, input.totalPrice);
  return checkoutDecision(policy, balance);
}
