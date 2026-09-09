/**
 * Стан прибирання номера і його історія (Блок 4 §2.2, 0092).
 *
 * `units.cleaning_status` належить обʼєкту, тож і єдиний писач стану живе
 * тут, а не в housekeeping: борд, чекліст зміни і виселення броні міняють
 * стан через `setCleaningStatus`, і кожна зміна лягає рядком у
 * `unit_cleaning_log` — тією ж ручкою `t`, що й сама зміна. Падіння запису
 * журналу відкочує зміну стану (і статус броні при виселенні).
 *
 * Читачі борду й історії — тут же: housekeeping не пише SQL до `units`,
 * він питає фасад `@properties`.
 */
import type { Sql } from '@core/db/async';
import { getSql } from '@core/db/async';
import { todayFor } from '@core/hotel-day';
import { propertyScopeFilter, type PropertyScope } from '@core/property-scope';

export const CLEANING_STATUSES = ['clean', 'dirty', 'in_progress'] as const;
export type CleaningStatus = (typeof CLEANING_STATUSES)[number];

export interface CleaningChange {
  unitId: string;
  from: CleaningStatus;
  to: CleaningStatus;
}

/**
 * Перевести номер у новий стан і записати це в журнал — в одній ручці.
 *
 * Чужий або неіснуючий номер — `null` (інваріант 5: викликач відповідає
 * 404). Той самий стан двічі — не помилка й не рядок журналу: чекліст,
 * натиснутий двічі, не має плодити «clean → clean».
 */
export async function setCleaningStatus(t: Sql, input: {
  organizationId: string;
  unitId: string;
  to: CleaningStatus;
  changedBy: string | null;
  source?: 'manual' | 'checkout';
  note?: string | null;
}): Promise<CleaningChange | null> {
  if (!(CLEANING_STATUSES as readonly string[]).includes(input.to)) {
    throw new Error(`cleaning_status must be one of ${CLEANING_STATUSES.join(', ')}`);
  }
  const unit = await t.row<any>(
    `SELECT u.id, u.cleaning_status FROM units u
       JOIN properties p ON p.id = u.property_id
      WHERE u.id = ? AND p.organization_id = ?`,
    [input.unitId, input.organizationId]);
  if (!unit) return null;
  const from = String(unit.cleaning_status || 'clean') as CleaningStatus;
  if (from === input.to) return { unitId: input.unitId, from, to: input.to };

  await t.run(
    `UPDATE units SET cleaning_status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND property_id IN (SELECT id FROM properties WHERE organization_id = ?)`,
    [input.to, input.unitId, input.organizationId]);
  await t.run(
    `INSERT INTO unit_cleaning_log (id, organization_id, unit_id, from_status, to_status, source, changed_by, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [crypto.randomUUID(), input.organizationId, input.unitId, from, input.to,
     input.source ?? 'manual', input.changedBy ?? null, input.note ?? null]);
  return { unitId: input.unitId, from, to: input.to };
}

export interface BoardUnit {
  id: string;
  code: string;
  name: string;
  property_id: string;
  property_name: string;
  unit_type_id: string;
  unit_type_name: string;
  cleaning_status: CleaningStatus;
  room_status: string;
  /** Блокування (ремонт, out of order), що накриває сьогодні. */
  out_of_order: boolean;
  block_reason: string | null;
  /** Хто в номері сьогодні, або хто заїжджає / виїжджає. */
  stay: { reservation_id: string; guest: string; check_in: string; check_out: string; status: string } | null;
  arriving_today: boolean;
  departing_today: boolean;
}

/**
 * Борд прибирання: усі активні номери обʼєкта (або організації) з їхнім
 * станом, блокуванням на сьогодні і тим, хто в номері. Один запит на
 * номери, один на блокування, один на броні — без N+1.
 */
export async function housekeepingBoard(organizationId: string, propertyId: string | null): Promise<{ today: string; units: BoardUnit[] }> {
  const sql = getSql();
  const today = await todayFor(organizationId);
  const scope = propertyId ? 'AND u.property_id = ?' : '';
  const params = propertyId ? [organizationId, propertyId] : [organizationId];

  const units = await sql.rows<any>(
    `SELECT u.id, u.code, u.name, u.property_id, p.name AS property_name,
            u.unit_type_id, ut.name AS unit_type_name, u.cleaning_status, u.room_status, ut.sort_order AS type_order, u.sort_order
       FROM units u
       JOIN properties p ON p.id = u.property_id
       LEFT JOIN unit_types ut ON ut.id = u.unit_type_id
      WHERE p.organization_id = ? ${scope} AND u.is_active = TRUE AND u.is_pool = FALSE
      ORDER BY p.name, ut.sort_order, ut.name, u.sort_order, u.code`,
    params);
  if (units.length === 0) return { today, units: [] };

  const blocks = await sql.rows<any>(
    `SELECT b.unit_id, b.reason FROM availability_blocks b
       JOIN units u ON u.id = b.unit_id
       JOIN properties p ON p.id = u.property_id
      WHERE p.organization_id = ? ${scope} AND b.date_from <= ? AND b.date_to > ?`,
    [...params, today, today]);
  const blocked = new Map<string, string | null>(blocks.map((b: any) => [String(b.unit_id), b.reason ?? null]));

  // У домі сьогодні (check_in <= D < check_out) або заїжджає/виїжджає сьогодні.
  const stays = await sql.rows<any>(
    `SELECT r.id, r.unit_id, r.check_in, r.check_out, r.status, g.first_name, g.last_name
       FROM reservations r
       JOIN properties p ON p.id = r.property_id
       LEFT JOIN guests g ON g.id = r.guest_id
      WHERE p.organization_id = ? ${scope.replace('u.property_id', 'r.property_id')}
        AND r.unit_id IS NOT NULL
        AND r.status IN ('confirmed', 'tentative', 'checked_in')
        AND r.check_in <= ? AND r.check_out >= ?
      ORDER BY r.check_in`,
    [...params, today, today]);
  const byUnit = new Map<string, any[]>();
  for (const s of stays) {
    const k = String(s.unit_id);
    if (!byUnit.has(k)) byUnit.set(k, []);
    byUnit.get(k)!.push(s);
  }
  const day = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10));

  return {
    today,
    units: units.map((u: any): BoardUnit => {
      const list = byUnit.get(String(u.id)) ?? [];
      // Той, хто ще в домі (виїжджає сьогодні або пізніше), важливіший за того,
      // хто лише заїжджає — прибирання дивиться на того, хто спав цієї ночі.
      const inHouse = list.find((s) => s.status === 'checked_in')
        ?? list.find((s) => day(s.check_in) < today && day(s.check_out) >= today)
        ?? list[0] ?? null;
      return {
        id: String(u.id), code: String(u.code), name: String(u.name),
        property_id: String(u.property_id), property_name: String(u.property_name),
        unit_type_id: String(u.unit_type_id ?? ''), unit_type_name: String(u.unit_type_name ?? ''),
        cleaning_status: (u.cleaning_status || 'clean') as CleaningStatus,
        room_status: String(u.room_status || 'available'),
        out_of_order: blocked.has(String(u.id)) || u.room_status === 'maintenance',
        block_reason: blocked.get(String(u.id)) ?? (u.room_status === 'maintenance' ? 'maintenance' : null),
        stay: inHouse ? {
          reservation_id: String(inHouse.id),
          guest: [inHouse.first_name, inHouse.last_name].filter(Boolean).join(' '),
          check_in: day(inHouse.check_in), check_out: day(inHouse.check_out), status: String(inHouse.status),
        } : null,
        arriving_today: list.some((s) => day(s.check_in) === today),
        departing_today: list.some((s) => day(s.check_out) === today),
      };
    }),
  };
}

export interface CleaningLogRow {
  id: string;
  unit_id: string;
  unit_code: string;
  property_name: string;
  from_status: string;
  to_status: string;
  source: string;
  changed_by: string | null;
  changed_by_name: string | null;
  changed_at: string;
  note: string | null;
}

/** Історія прибирання з фільтрами дата / номер / хто. */
export async function cleaningHistory(organizationId: string, filter: {
  propertyId?: string | null;
  unitId?: string | null;
  changedBy?: string | null;
  from?: string | null;
  to?: string | null;
  limit?: number;
}): Promise<CleaningLogRow[]> {
  const sql = getSql();
  const where: string[] = ['l.organization_id = ?'];
  const params: unknown[] = [organizationId];
  if (filter.propertyId) { where.push('u.property_id = ?'); params.push(filter.propertyId); }
  if (filter.unitId) { where.push('l.unit_id = ?'); params.push(filter.unitId); }
  if (filter.changedBy) { where.push('l.changed_by = ?'); params.push(filter.changedBy); }
  // Межі — дні включно; changed_at — момент, тож верхня межа це наступний день.
  if (filter.from) { where.push('l.changed_at >= ?'); params.push(`${filter.from} 00:00:00`); }
  if (filter.to) { where.push('l.changed_at < ?'); params.push(`${nextDay(filter.to)} 00:00:00`); }
  const limit = Math.min(500, Math.max(1, Number(filter.limit) || 200));
  return await sql.rows<CleaningLogRow>(
    `SELECT l.id, l.unit_id, u.code AS unit_code, p.name AS property_name,
            l.from_status, l.to_status, l.source, l.changed_by, a.full_name AS changed_by_name,
            l.changed_at, l.note
       FROM unit_cleaning_log l
       JOIN units u ON u.id = l.unit_id
       JOIN properties p ON p.id = u.property_id
       LEFT JOIN app_users a ON a.id = l.changed_by
      WHERE ${where.join(' AND ')}
      ORDER BY l.changed_at DESC, l.id DESC
      LIMIT ${limit}`,
    params);
}

/** Лічильники для дашборда: усього · брудні · у роботі · чисті · out of order — і останні зміни. */
export async function housekeepingSummary(organizationId: string, propertyId: string | null): Promise<{
  total: number; dirty: number; in_progress: number; clean: number; out_of_order: number;
  recent: CleaningLogRow[];
}> {
  const board = await housekeepingBoard(organizationId, propertyId);
  const count = (s: CleaningStatus) => board.units.filter((u) => u.cleaning_status === s && !u.out_of_order).length;
  const recent = (await cleaningHistory(organizationId, { propertyId, limit: 5 }))
    .filter((r) => String(r.changed_at).slice(0, 10) === board.today);
  return {
    total: board.units.length,
    dirty: count('dirty'), in_progress: count('in_progress'), clean: count('clean'),
    out_of_order: board.units.filter((u) => u.out_of_order).length,
    recent,
  };
}

function nextDay(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Номери, які треба прибрати, — для чекліста зміни (`GET /api/checklists`).
 *
 * ── Що ламалося ─────────────────────────────────────────────────────────
 *
 * Запит жив прямо в маршруті і був такий:
 *
 *   FROM units u JOIN properties p ON p.id = u.property_id
 *    WHERE p.organization_id = ? AND u.cleaning_status IN ('dirty','in_progress')
 *
 * Над ним стояв коментар «Scoped: unqualified this listed every hotel's dirty
 * rooms» — і він правдивий рівно наполовину. Це вісь ОРЕНДАРЯ: чужий рахунок
 * справді не видно, а сусідній ОБʼЄКТ того самого рахунку — видно повністю.
 * Покоївка другого будинку відкриває свій чекліст і бачить кімнати першого.
 *
 * Перший підтверджений випадок класу «вісь орендаря, вдягнена як вісь
 * обʼєкта» — після того, як контролер звузив означення «названо» 09.09.2026
 * (`docs/tasks/2026-09-09-INC-029-tenant-join-list.md`, 137 пар).
 *
 * Область приходить типом і не має значення за замовчуванням; `ALL_PROPERTIES`
 * лишається законним для зведеного екрана, але пишеться словом.
 */
export async function dirtyUnitsForShift(organizationId: string, scope: PropertyScope) {
  const sql = getSql();
  const inScope = propertyScopeFilter(scope, 'u');
  return sql.rows<{
    id: string; code: string; name: string; cleaning_status: CleaningStatus; zone: string | null;
    property_id: string; property_name: string;
  }>(
    `SELECT u.id, u.code, u.name, u.cleaning_status, u.zone, u.property_id, p.name AS property_name
       FROM units u
       JOIN properties p ON p.id = u.property_id
      WHERE p.organization_id = ?
        AND ${inScope.sql}
        AND u.cleaning_status IN ('dirty', 'in_progress')
      ORDER BY p.name, u.code ASC`,
    [organizationId, ...inScope.params],
  );
}
