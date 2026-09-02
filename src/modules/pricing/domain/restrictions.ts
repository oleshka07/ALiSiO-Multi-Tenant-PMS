/**
 * Обмеження перебування — одне правило для віджета, бронювання й каналу.
 *
 *   node src/modules/pricing/domain/restrictions.check.ts
 *
 * Читаються з БАЗОВОГО рядка календаря типу номера (`price_calendar`,
 * `rate_plan_id IS NULL`): обмеження в нас живуть на типі й застосовуються до
 * кожного його тарифу (П7 карти сертифікації — грубіша деталізація, не
 * відсутність). Семантика — «arrival», як у менеджера каналів: мінімум і
 * максимум ночей та заборона заїзду — з ночі заїзду; заборона виїзду — з
 * ДАТИ виїзду (це ранок, не ніч); закрита ніч усередині перебування — не
 * продається взагалі, як і неоцінена (інваріант 17).
 */

export interface StayRestrictions {
  /** Мінімум ночей — з ночі заїзду. */
  minStay: number;
  /** Максимум ночей — з ночі заїзду; `null` — без стелі. */
  maxStay: number | null;
  /** Заїзд цього дня заборонений (CTA ночі заїзду). */
  noArrival: boolean;
  /** Виїзд цього дня заборонений (CTD дати виїзду). */
  noDeparture: boolean;
  /** Ночі перебування, які готель закрив. */
  closedNights: string[];
}

export type StayRefusal = 'closed' | 'min_stay' | 'max_stay' | 'no_arrival' | 'no_departure';

/** Чому перебування не продається — або `null`, якщо продається. Закрито — першим. */
export function stayRefusal(r: StayRestrictions, nights: number): StayRefusal | null {
  if (r.closedNights.length > 0) return 'closed';
  if (r.noArrival) return 'no_arrival';
  if (r.noDeparture) return 'no_departure';
  if (nights < Math.max(1, r.minStay)) return 'min_stay';
  if (r.maxStay != null && r.maxStay > 0 && nights > r.maxStay) return 'max_stay';
  return null;
}

export const OPEN_STAY: StayRestrictions = { minStay: 1, maxStay: null, noArrival: false, noDeparture: false, closedNights: [] };
