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
  // Фоліо відповідає, ЛИШЕ коли в ньому щось нараховано.
  //
  // `hasFolio` істинний від самої НАЯВНОСТІ рядка, і порожня книга давала
  // борг 0: боржник із `unpaid` на всю суму виходив у двері під `blocking`.
  // Порожнє фоліо буває частіше, ніж здається — рецепція відкрила вкладку й
  // нічого не нарахувала; місток завів книгу, а фіскальна варта відмовила
  // (німецький обʼєкт без TSE). Порожня книга не каже «нічого не винен» —
  // вона не каже нічого, і це різні речі (той самий закон, що `null` у
  // `statusFromFolio`).
  const folio = await reservationBalance(input.reservationId, sql);
  if (folio.hasFolio && folio.charged > 0) return checkoutDecision(policy, folio.balance);

  // Фоліо немає — питаємо слово, і воно не завжди знає суму. `partial` без
  // фоліо каже «частина прийшла» і не каже скільки (В3): доти сюди йшов увесь
  // `total_price`, і рецепція бачила повний борг на броні з депозитом.
  // Невідомий борг не показується числом: під `none` виселяємо, під рештою —
  // як борг без суми (інваріант 13: не знаємо — не відчиняємо).
  const known = balanceFromReservation(input.paymentStatus, input.totalPrice);
  if (known !== null) return checkoutDecision(policy, known);
  if (policy === 'none') return { allowed: true, warning: null, balance: 0 };
  return {
    allowed: policy !== 'blocking',
    warning: policy === 'warning' ? 'unpaid_balance' : null,
    balance: 0,
  };
}
