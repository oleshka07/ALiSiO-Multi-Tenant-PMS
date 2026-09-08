/**
 * «Розширені ціни»: скільки екран цін показує цій ОРГАНІЗАЦІЇ.
 *
 * Стан належить організації, не браузеру (міграція 0112): інакше другий
 * адміністратор відкриває той самий екран і бачить інший набір полів. Дефолт
 * — простий режим: «Ціна» і «Мін. ночей», решта за перемикачем.
 *
 * Саме ОРГАНІЗАЦІЇ, не обʼєкту: один прапорець на всі обʼєкти оренди. Для
 * готелю на 1–15 номерів організація і є готель, тож різниці сьогодні немає
 * (рішення контролера, Р9.6); перенесення на `properties` — у LATER, коли
 * зʼявиться оренда з кількома обʼєктами і різними операторами.
 *
 * Шапка міграції 0112 і далі каже «перемикач готелю». Її НЕ виправлено
 * навмисно: `check-deployed-db.mjs` звіряє відбитки накочених міграцій, і
 * правка тексту зробила б відбиток іншим — тобто зламала б перевірку, яка
 * ловить пропущену міграцію. Чинне формулювання — тут і в Ц44.
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
 * Потрібне рівно в одному місці: коли організація ВИМИКАЄ розширений режим
 * (рецензія раунду 9, Р9.5). Дані в мить перемикання не гинуть, але вона
 * переходить у режим, де кожна правка ціни витирає невидиме число — і доти
 * про це не було сказано ніде, а заводити ціни вихідних можна й повз цей
 * екран (сезони). Тому перемикання називає число: «на 14 днях стоїть окрема
 * ціна вихідних».
 *
 * Минулі дати не рахуються: правку ціни на вчора ніхто не робить, а число,
 * яке включає торішні дні, лякає без причини.
 */
export async function weekendPriceDayCount(organizationId: string, from: string): Promise<number> {
  // COUNT(DISTINCT date), не COUNT(*): у `price_calendar` рядки ДВОХ родів —
  // базовий рядок типу і власний рядок тарифу на ту саму дату, — тож `*`
  // рахував би один день стільки разів, скільки тарифів на ньому має ціну
  // вихідних, і повідомлення «стоїть на N днях» називало б чуже число.
  // Той самий клас, що INC-027, лише слабший: там рядок підмінявся, тут
  // подвоювався. Знайдено обходом усіх читачів `price_calendar` після
  // INC-027 (доручення контролера, раунд 10).
  const row = await getSql().row<{ n?: unknown }>(`
    SELECT COUNT(DISTINCT pc.date) AS n
    FROM price_calendar pc
    JOIN unit_types ut ON pc.unit_type_id = ut.id
    JOIN properties p ON ut.property_id = p.id
    WHERE p.organization_id = ? AND pc.date >= ? AND pc.weekend_price IS NOT NULL AND pc.weekend_price > 0
  `, [organizationId, from]);
  return Number(row?.n ?? 0) || 0;
}
