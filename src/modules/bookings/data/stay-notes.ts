import type { Sql } from '@core/db/async';
import { noteAvailabilityChanged, lastNight } from '@channels/outbox';

/**
 * Ночі броні → координата наявності для каналів.
 *
 * Кожен писач `reservations` у цьому модулі кличе це ДО і ПІСЛЯ зміни, яка
 * рухає ночі (номер, дати, статус): стан «до» звільняє старі ночі, стан
 * «після» займає нові. Тип номера — із броні (бронь із каналу знає лише
 * тип, CP3) або з її номера. Без дат чи без типу — нема що казати.
 *
 * Той самий `t`, що пише бронь: черга, яка поповнюється окремим кроком,
 * розходиться зі станом при першому ж падінні між ними; зовнішній `getSql()`
 * усередині `sql.tx` на Postgres — це інше зʼєднання (інваріант 11).
 */
export interface StayRow {
  property_id?: string | null;
  unit_id?: string | null;
  unit_type_id?: string | null;
  check_in?: string | null;
  check_out?: string | null;
}

export async function noteStay(t: Sql, stay: StayRow | null | undefined): Promise<number> {
  if (!stay?.check_in || !stay?.check_out) return 0;
  let unitTypeId = stay.unit_type_id ? String(stay.unit_type_id) : null;
  let propertyId = stay.property_id ? String(stay.property_id) : null;
  if ((!unitTypeId || !propertyId) && stay.unit_id) {
    const unit = await t.row<any>('SELECT unit_type_id, property_id FROM units WHERE id = ?', [stay.unit_id]);
    unitTypeId = unitTypeId ?? (unit?.unit_type_id ? String(unit.unit_type_id) : null);
    propertyId = propertyId ?? (unit?.property_id ? String(unit.property_id) : null);
  }
  if (!unitTypeId || !propertyId) return 0;
  return noteAvailabilityChanged(t, {
    propertyId, unitTypeId,
    from: String(stay.check_in).slice(0, 10),
    to: lastNight(String(stay.check_out).slice(0, 10)),
  });
}

/** Чи рухає тіло PATCH ночі броні — номер, дати, статус. */
export function movesStay(body: Record<string, unknown>): boolean {
  return ['unit_id', 'check_in', 'check_out', 'nights', 'status'].some((k) => body[k] !== undefined);
}

const STAY_COLUMNS = 'SELECT id, property_id, unit_id, unit_type_id, check_in, check_out FROM reservations';

export async function stayById(t: Sql, id: string): Promise<StayRow | undefined> {
  return t.row<any>(`${STAY_COLUMNS} WHERE id = ?`, [id]);
}

export async function staysOfParent(t: Sql, parentId: string): Promise<StayRow[]> {
  return t.rows<any>(`${STAY_COLUMNS} WHERE parent_id = ?`, [parentId]);
}
