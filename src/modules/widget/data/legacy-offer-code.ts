/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Sql } from '@core/db/async';

/**
 * Один код — одне джерело знижки (Блок 2 крок 4, Ц31).
 *
 * У віджеті гість вводить один «промокод». Сьогодні його читають два світи:
 * старі `coupons` / пакети `gift_card_bundles` (сайти, послуги) і нові промо в
 * `price_rules` (ціна ночі). Той самий код в обох дав би знижку двічі. Тому
 * код, який знає стара таблиця, до правил цін не доходить: він лишається
 * купоном, як і був. Міграція купонів у промо — окремий крок зі своїм гейтом
 * (docs/MASTER-PLAN.md §2.5); до неї межа проходить тут.
 */
export async function isLegacyOfferCode(sql: Sql, code: string, organizationId: string): Promise<boolean> {
  const normalized = String(code).toUpperCase().trim();
  if (!normalized) return false;
  const coupon = await sql.row<any>('SELECT id FROM coupons WHERE code = ? AND organization_id = ?', [normalized, organizationId]);
  if (coupon) return true;
  const bundle = await sql.row<any>(
    `SELECT b.id FROM gift_card_bundles b JOIN booking_sites s ON s.id = b.site_id
      WHERE b.coupon_code = ? AND s.organization_id = ?`, [normalized, organizationId]);
  return Boolean(bundle);
}

/** Код для правил цін: названий гостем і НЕ відомий старим таблицям. */
export async function promoCodeFor(sql: Sql, code: string | null | undefined, organizationId: string | null | undefined): Promise<string | null> {
  const c = String(code ?? '').trim();
  if (!c || !organizationId) return null;
  return (await isLegacyOfferCode(sql, c, organizationId)) ? null : c;
}

/**
 * Купон або пакет за кодом — ЛИШЕ цієї організації.
 *
 * Один читач на всі місця, де код перетворюється на гроші. До 07.09 їх було
 * три однакових `SELECT` у `widget-reserve.handlers.ts`, і жоден не називав
 * організацію (рецензія 07.09 раунд 2, правка 4.4): код, який належить
 * купону ЧУЖОГО готелю, знаходився, віднімав знижку і піднімав чужий
 * `current_uses`. Маршрут публічний, тобто підібрати код міг будь-хто ззовні.
 *
 * Пакет скоупується через `booking_sites`, як і в `isLegacyOfferCode` вище:
 * своєї колонки організації в `gift_card_bundles` немає.
 *
 * Умови дат перевіряються тут же — це той самий запит, і винести їх окремо
 * означало б знову дати шанс розійтися.
 */
export interface OfferLookup {
  offer: Record<string, unknown> | null;
  isBundle: boolean;
}

export async function offerForCode(
  sql: Sql,
  code: string,
  organizationId: string,
  window: { checkIn: string; checkOut: string },
): Promise<OfferLookup> {
  const normalized = String(code).toUpperCase().trim();
  if (!normalized || !organizationId) return { offer: null, isBundle: false };

  const coupon = await sql.row<any>(`
    SELECT * FROM coupons
     WHERE code = ? AND organization_id = ? AND is_active = TRUE
       AND (valid_from IS NULL OR valid_from <= ?)
       AND (valid_until IS NULL OR valid_until >= ?)
       AND (max_uses IS NULL OR current_uses < max_uses)
  `, [normalized, organizationId, window.checkOut, window.checkIn]);
  if (coupon) return { offer: coupon, isBundle: false };

  const bundle = await sql.row<any>(`
    SELECT b.* FROM gift_card_bundles b
      JOIN booking_sites s ON s.id = b.site_id
     WHERE b.coupon_code = ? AND s.organization_id = ? AND b.is_active = TRUE
       AND (b.redemption_limit IS NULL OR b.current_uses < b.redemption_limit)
  `, [normalized, organizationId]);
  return { offer: bundle ?? null, isBundle: Boolean(bundle) };
}
