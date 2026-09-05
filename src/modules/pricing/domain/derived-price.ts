import { money } from '@core/money';
import type { RateAdjustment } from './types';

/**
 * Ціна похідного тарифу з ціни бази (Ц28): база ± відсоток або сума,
 * округлена як гроші (`money`, інваріант 9). Ціна, якої не стало (нуль чи
 * менше), — `null`: ніч без ціни, не ціна нуль (Ц24, інваріант 17).
 * `null` на вході — `null` на виході: похідний не вигадує ціни там, де
 * база мовчить.
 */
export function derivedPrice(base: number | null | undefined, adjustment: RateAdjustment): number | null {
  if (base == null || !Number.isFinite(Number(base))) return null;
  const b = Number(base);
  const sign = adjustment.direction === 'decrease' ? -1 : 1;
  const delta = adjustment.kind === 'percent' ? b * (adjustment.value / 100) : adjustment.value;
  const out = money(b + sign * delta);
  return out > 0 ? out : null;
}
