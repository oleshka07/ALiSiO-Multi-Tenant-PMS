/**
 * Перетягування броні в планері: куди вона лягає і чи можна її туди класти
 * (Блок 4 §2.4). Чисті функції — щоб правило можна було ЗАПУСТИТИ
 * (`drag.check.ts`), як і `lanes.ts`.
 *
 * Сервер лишається суддею: PATCH броні відмовляє 409, коли номер зайнятий
 * або закритий. Клієнт лише не пропонує заздалегідь програшний хід і не
 * малює оптимістичну картинку, яку сервер одразу відкотить.
 */
import type { LaneBooking, LaneBlock } from './lanes';

/** Дата ± n днів у форматі YYYY-MM-DD, без зсувів від часових поясів. */
export function shiftDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number);
  const t = Date.UTC(y, m - 1, d + days);
  return new Date(t).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.slice(0, 10).split('-').map(Number);
  const [ty, tm, td] = to.slice(0, 10).split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

export interface DropTarget {
  unit_id: string;
  check_in: string;
  check_out: string;
  nights: number;
}

/**
 * Куди лягає бронь, кинута на клітинку `(unitId, dropDate)`, якщо її взяли
 * за день `grabOffset` від заїзду (0 — за перший день смуги).
 *
 * Кількість ночей не міняється: перетягування — це перенесення, не
 * розтягування. Дата в минулому не заборонена тут — це рішення сервера й
 * рецепції (перенести вчорашній заїзд буває треба).
 */
export function dropTarget(booking: LaneBooking, unitId: string, dropDate: string, grabOffset: number): DropTarget {
  const nights = Math.max(1, daysBetween(booking.check_in, booking.check_out));
  const checkIn = shiftDate(dropDate, -grabOffset);
  return { unit_id: unitId, check_in: checkIn, check_out: shiftDate(checkIn, nights), nights };
}

/** Кинули туди ж, де й було — нема що зберігати. */
export function isSamePlace(booking: LaneBooking, target: DropTarget): boolean {
  return booking.unit_id === target.unit_id && booking.check_in === target.check_in && booking.check_out === target.check_out;
}

export type LocalConflict =
  | { kind: 'booking'; id: string }
  | { kind: 'block'; unit_id: string; date_from: string; date_to: string }
  | null;

/**
 * Що заважає покласти бронь у ціль — з того, що планер уже завантажив.
 * Півінтервал [заїзд, виїзд): виїзд 12-го і заїзд 12-го не перетинаються.
 * Скасовані й no-show викликач відфільтровує сам (планер їх і так не малює).
 */
export function localConflict(
  bookings: readonly LaneBooking[], blocks: readonly LaneBlock[], target: DropTarget, excludeId: string,
): LocalConflict {
  for (const b of bookings) {
    if (b.id === excludeId || b.unit_id !== target.unit_id) continue;
    if (b.check_in < target.check_out && b.check_out > target.check_in) return { kind: 'booking', id: b.id };
  }
  for (const blk of blocks) {
    if (blk.unit_id !== target.unit_id) continue;
    if (blk.date_from < target.check_out && blk.date_to > target.check_in) {
      return { kind: 'block', unit_id: blk.unit_id, date_from: blk.date_from, date_to: blk.date_to };
    }
  }
  return null;
}

export type MoveKind = 'same_unit' | 'same_type' | 'other_type' | 'assign';

/**
 * Що означає цей хід для рецепції: та сама кімната (лише дати), інша кімната
 * того ж типу (тихо), інша кімната ІНШОГО типу (підтвердження — гість платив
 * за інший тип), або призначення номера безномерній броні.
 */
export function moveKind(
  from: { unit_id: string | null; unit_type_id: string | null },
  to: { unit_id: string; unit_type_id: string | null },
): MoveKind {
  if (from.unit_id === null) return 'assign';
  if (from.unit_id === to.unit_id) return 'same_unit';
  if (from.unit_type_id && to.unit_type_id && from.unit_type_id === to.unit_type_id) return 'same_type';
  return 'other_type';
}

/** Статуси, за яких смуга не перетягується: бронь уже минула або звільнила номер. */
export const IMMOVABLE_STATUSES = ['checked_out', 'cancelled', 'no_show'] as const;
export function isMovable(status: string): boolean {
  return !(IMMOVABLE_STATUSES as readonly string[]).includes(status);
}
