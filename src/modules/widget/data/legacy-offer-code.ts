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
