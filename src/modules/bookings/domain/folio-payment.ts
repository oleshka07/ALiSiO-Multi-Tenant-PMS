/**
 * Оплата з фоліо і бронь: коли рахунок закриває бронь і коли старий
 * (legacy) документ НЕ виписується (рецензія 07.09, п.1).
 *
 * Два шляхи документа жили поруч: оплата з фоліо ставила
 * `payment_status = 'paid'`, а генеричний PATCH на це слово виписував
 * legacy-фактуру серії HOUSE на `total_price`; потім «Виставити документ» з
 * фоліо давав другий номер на ту саму суму. Правило тут одне для обох сторін
 * PATCH-у й перевіряється без бази.
 */

/** Способи оплати, які означають «гроші прийшли через фоліо». */
export const FOLIO_PAYMENT_METHODS = ['folio', 'folio_cash'] as const;

/**
 * Чи має PATCH зі статусом `paid` виписати legacy-документ.
 * Оплата з фоліо — ні: документ виставляє фоліо, і він там рівно один.
 */
export function legacyInvoiceWanted(body: { payment_status?: unknown; payment_method?: unknown }): boolean {
  if (body.payment_status !== 'paid') return false;
  return !(FOLIO_PAYMENT_METHODS as readonly string[]).includes(String(body.payment_method ?? ''));
}

export interface SettleSummary {
  totals?: {
    charged?: number | string | null;
    paid?: number | string | null;
    balance?: number | string | null;
  } | null;
  folios?: { items?: { kind?: string | null }[] }[] | null;
}

/**
 * Чи закриває фоліо бронь як оплачену.
 *
 * Не лише «залишок ≤ 0»: без рядка проживання (`lodging`) оплата за воду
 * закрила б бронь як `paid` — і варта заселення пустила б гостя, який за
 * ніч не платив. Отже: є що платити, є нарахування проживання, і борг нуль.
 */
export function folioSettlesStay(summary: SettleSummary | null | undefined): boolean {
  return statusFromFolio(summary) === 'paid';
}

/**
 * Статус оплати броні З ФОЛІО — одна функція для всіх, хто його рахує (В3).
 *
 * Фоліо — єдина книга проживання: скільки за бронь заплачено, знає воно, а не
 * слово в `reservations.payment_status` і не сума `fin_operations` поруч. Дві
 * книги, які не знають одна про одну, вже дали видиму розбіжність: бронь,
 * оплачена половиною через фоліо, у фільтр «частково» не потрапляла взагалі,
 * а бронь зі станом `partial` показувала на виселенні ПОВНИЙ борг.
 *
 * Три відповіді, і `null` — теж відповідь:
 *   - `paid`    — нараховано проживання і борг нуль;
 *   - `partial` — нараховано проживання, гроші прийшли, але не всі;
 *   - `null`    — не нам вирішувати: нема рядка проживання (оплата за воду до
 *                 нарахування не закриває бронь — варта заселення пустила б
 *                 гостя, який за ніч не платив) або грошей не було зовсім.
 *
 * `null` НЕ означає «не оплачено»: він означає «фоліо не має що сказати», і
 * писач лишає слово, яке стояло.
 */
export function statusFromFolio(summary: SettleSummary | null | undefined): 'paid' | 'partial' | null {
  const charged = Number(summary?.totals?.charged ?? 0);
  const balance = Number(summary?.totals?.balance ?? 0);
  const paid = Number(summary?.totals?.paid ?? 0);
  if (!(charged > 0)) return null;
  const hasLodging = (summary?.folios ?? []).some((f) => (f.items ?? []).some((i) => i.kind === 'lodging'));
  if (!hasLodging) return null;
  if (balance <= 0) return 'paid';
  return paid > 0 ? 'partial' : null;
}
