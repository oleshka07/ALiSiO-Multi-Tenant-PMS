import { getSql } from '@core/db/async';
import { likePattern, SEARCH_LIMIT, type SearchHit } from '@core/search-types';

/**
 * Знайти номер за назвою або кодом.
 *
 * ── Чому тут JOIN на properties ─────────────────────────────────────────
 *
 * У `units` НЕМАЄ колонки `organization_id`: номер належить обʼєкту, а обʼєкт
 * — готелю. На Postgres політика проходить цей самий шлях і відсікає чуже
 * сама; на SQLite політик немає, і без JOIN пошук на машині розробника
 * показував би номери всіх готелів. Умова стоїть явно з тієї ж причини, що й
 * скрізь: те, що тримається лише політикою, не тримається на другому двигуні.
 */
/**
 * Пошук номерів — свідомо БЕЗ осі обʼєкта (INC-029).
 *
 * Пошук у шапці шукає по рахунку навмисно: портьє набирає «101», і два
 * будинки можуть мати номер із таким кодом. Звузити пошук областю означало б
 * «не знайдено» на річ, яка є. Тому відповідь НАЗИВАЄ будинок кожного
 * знайденого рядка (`pr.name AS property_name`) — і це умова, за якої вісь тут
 * не потрібна: людина бачить, який це будинок, і не плутає.
 */
export async function searchUnits(term: string, organizationId: string): Promise<SearchHit[]> {
  const sql = getSql();
  const p = likePattern(term);
  const like = sql.dialect.ilike;

  const rows = await sql.rows<any>(`
    SELECT u.id, u.name, u.code, u.floor, u.room_status, u.is_active,
           ut.name AS type_name,
           pr.name AS property_name
    FROM units u
    JOIN properties pr ON pr.id = u.property_id
    LEFT JOIN unit_types ut ON ut.id = u.unit_type_id
    WHERE pr.organization_id = ?
      AND (${like('u.name')} OR ${like('u.code')})
    ORDER BY u.sort_order, u.name
    LIMIT ${SEARCH_LIMIT}
  `, [organizationId, p, p]);

  return rows.map((u: any) => ({
    id: String(u.id),
    title: u.name || u.code || String(u.id),
    subtitle: [
      u.type_name,
      u.floor ? `поверх ${u.floor}` : null,
      u.property_name,
      // Вимкнений номер знаходиться, але каже про це. Ховати його означало б
      // «такого номера немає» — а він є, просто не продається.
      u.is_active === false || u.is_active === 0 ? 'неактивний' : null,
    ].filter(Boolean).join(' · ') || undefined,
    href: '/app/settings/units',
  }));
}
