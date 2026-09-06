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
  totals?: { charged?: number | string | null; balance?: number | string | null } | null;
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
  const charged = Number(summary?.totals?.charged ?? 0);
  const balance = Number(summary?.totals?.balance ?? 0);
  if (!(charged > 0) || balance > 0) return false;
  return (summary?.folios ?? []).some((f) => (f.items ?? []).some((i) => i.kind === 'lodging'));
}
