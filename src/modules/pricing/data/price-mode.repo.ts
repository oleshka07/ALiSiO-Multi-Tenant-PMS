/**
 * «Розширені ціни»: скільки екран цін показує цьому готелю.
 *
 * Стан належить ГОТЕЛЮ, не браузеру (міграція 0112): інакше другий
 * адміністратор відкриває той самий екран і бачить інший набір полів. Дефолт
 * — простий режим: «Ціна» і «Мін. ночей», решта за перемикачем.
 */
import { getSql } from '@core/db/async';

export async function pricingAdvanced(organizationId: string): Promise<boolean> {
  const row = await getSql().row<{ pricing_advanced?: unknown }>(
    'SELECT pricing_advanced FROM organizations WHERE id = ?', [organizationId]);
  // Немає рядка — простий режим: показати менше безпечніше, ніж показати
  // поле, яке мовчки перебиває ціну.
  return row ? Boolean(Number(row.pricing_advanced ?? 0)) : false;
}

export async function setPricingAdvanced(organizationId: string, advanced: boolean): Promise<void> {
  await getSql().run(
    'UPDATE organizations SET pricing_advanced = ? WHERE id = ?', [advanced, organizationId]);
}

/**
 * Скільки МАЙБУТНІХ днів мають окрему ціну вихідних.
 *
 * Потрібне рівно в одному місці: коли готель ВИМИКАЄ розширений режим
 * (рецензія раунду 9, Р9.5). Дані в мить перемикання не гинуть, але готель
 * переходить у режим, де кожна правка ціни витирає невидиме число — і доти
 * про це не було сказано ніде, а заводити ціни вихідних можна й повз цей
 * екран (сезони). Тому перемикання називає число: «на 14 днях стоїть окрема
 * ціна вихідних».
 *
 * Минулі дати не рахуються: правку ціни на вчора ніхто не робить, а число,
 * яке включає торішні дні, лякає без причини.
 */
export async function weekendPriceDayCount(organizationId: string, from: string): Promise<number> {
  const row = await getSql().row<{ n?: unknown }>(`
    SELECT COUNT(*) AS n
    FROM price_calendar pc
    JOIN unit_types ut ON pc.unit_type_id = ut.id
    JOIN properties p ON ut.property_id = p.id
    WHERE p.organization_id = ? AND pc.date >= ? AND pc.weekend_price IS NOT NULL AND pc.weekend_price > 0
  `, [organizationId, from]);
  return Number(row?.n ?? 0) || 0;
}
