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
