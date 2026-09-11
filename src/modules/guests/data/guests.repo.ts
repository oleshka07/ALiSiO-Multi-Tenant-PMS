/* eslint-disable @typescript-eslint/no-explicit-any */
import { getSql } from '@core/db/async';
import { todayFor } from '@core/hotel-day';
import type { CreateGuestInput } from '../domain/types';
import { propertyScopeFilter, ALL_PROPERTIES } from '@core/property-scope';

/** Фільтри списку гостей. Порожній обʼєкт — увесь список готелю. */
export interface GuestFilters {
  search?: string;
  country?: string;
  /** Є пошта або телефон. */
  hasContacts?: boolean;
  /** Є бронь, що ще не завершилась (за днем готелю). */
  hasUpcoming?: boolean;
  /** Хоч одна бронь виставлена на компанію-платника (0093). */
  hasCompany?: boolean;
}

/**
 * guests carries organization_id, but nothing used it. listGuests started from
 * `WHERE 1=1`, so the search box returned every hotel's guests with their
 * emails, phone numbers and document numbers; get/update/delete acted on
 * whatever id the URL carried; and createGuest filed new guests under
 * `SELECT id FROM organizations LIMIT 1` — whichever tenant happened to be
 * first.
 *
 * The nested aggregates are constrained too. Stay counts and lifetime revenue
 * would otherwise sum reservations across tenants for any guest id appearing in
 * more than one — which is precisely what happens when the same person stays at
 * two hotels running this system.
 */

/**
 * Історія гостя — по РАХУНКУ, і це СКАЗАНО, а не забуто (Д52, рішення власника В11).
 *
 * `guests` має власний `organization_id` і не має `property_id`: гість
 * належить компанії, а не будинку. Гість фізично той самий у двох готелях
 * однієї компанії, і постійний, який у другому виглядає новим, — це втрачена
 * знижка. Тому `total_stays`, `total_revenue`, останній статус і фільтри
 * списку рахуються по ВСІХ обʼєктах рахунку.
 *
 * Ціна вибору названа в Д52 і мітигована на екрані: число підписується «по
 * всіх обʼєктах», інакше портьє обʼєкта А читає «5 перебувань» як своє, не
 * може перевірити і не знає, що не може.
 *
 * Пишеться дверима, а не мовчанням: `ALL_PROPERTIES` видно грепом, і наступний
 * читач бачить рішення, а не відсутність фільтра.
 */
const ACROSS_PROPERTIES = propertyScopeFilter(ALL_PROPERTIES, 'r');

export async function listGuests(
  organizationId: string,
  filters: GuestFilters = {},
  page: number = 1,
  limit: number = 50,
) {
  const sql = getSql();
  // Злиті рядки — сліди від людей, а не люди (INC-300): у списку гостей їх
  // немає, інакше та сама особа й далі показувалась би двічі, і злиття
  // виглядало б так, ніби воно не спрацювало.
  let where = 'WHERE g.organization_id = ? AND g.merged_into IS NULL';
  const params: string[] = [organizationId];

  if (filters.search) {
    where += ` AND (g.first_name LIKE ? OR g.last_name LIKE ? OR (g.first_name || ' ' || g.last_name) LIKE ? OR g.email LIKE ? OR g.phone LIKE ?)`;
    const like = `%${filters.search}%`;
    params.push(like, like, like, like, like);
  }
  if (filters.country) {
    where += ' AND g.country = ?';
    params.push(filters.country);
  }
  // ── Фільтри списку гостей (Блок 4 §2.5, форма — Hoteliera) ──────────────
  //
  // Кожен звужує, а не заміняє попередній: «є контакти» і «є компанія» разом
  // означають обидва, а не останній вибраний.
  if (filters.hasContacts) {
    where += " AND (COALESCE(g.email, '') <> '' OR COALESCE(g.phone, '') <> '')";
  }
  if (filters.hasUpcoming) {
    // «Майбутні» — за днем ГОТЕЛЮ, не за годинником сервера (інваріант
    // hotel-day): гість, що виїжджає сьогодні, ще в домі, і о 23:00 у
    // Празі бронь не має зникати зі списку через UTC.
    where += ` AND EXISTS (
      SELECT 1 FROM reservations r JOIN properties p ON p.id = r.property_id
       WHERE r.guest_id = g.id AND p.organization_id = g.organization_id AND ${ACROSS_PROPERTIES.sql}
         AND r.status NOT IN ('cancelled', 'no_show') AND r.check_out >= ?)`;
    params.push(await todayFor(organizationId));
  }
  if (filters.hasCompany) {
    // Компанія у гостя — це компанія-платник хоч однієї його броні (0093):
    // сам рядок гостя юрособи не знає, і не має знати.
    where += ` AND EXISTS (
      SELECT 1 FROM reservations r JOIN properties p ON p.id = r.property_id
       WHERE r.guest_id = g.id AND p.organization_id = g.organization_id AND ${ACROSS_PROPERTIES.sql}
         AND r.company_id IS NOT NULL)`;
  }

  const countQuery = `SELECT COUNT(*) as total FROM guests g ${where}`;
  const totalRow = await sql.row<{ total: number }>(countQuery, params) ?? { total: 0 };
  const total = totalRow.total;

  const offset = (page - 1) * limit;

  const stay = (expr: string) => `(
    SELECT ${expr} FROM reservations r
    JOIN properties p ON p.id = r.property_id
    WHERE r.guest_id = g.id AND p.organization_id = g.organization_id AND ${ACROSS_PROPERTIES.sql}
  )`;

  const query = `
    SELECT
      g.*,
      ${stay('COUNT(*)')} as total_stays,
      ${stay('SUM(r.total_price)')} as total_revenue,
      ${stay('MAX(r.check_in)')} as last_check_in,
      (SELECT r.status FROM reservations r
        JOIN properties p ON p.id = r.property_id
        WHERE r.guest_id = g.id AND p.organization_id = g.organization_id AND ${ACROSS_PROPERTIES.sql}
        ORDER BY r.check_in DESC LIMIT 1) as last_booking_status
    FROM guests g
    ${where}
    ORDER BY g.last_name, g.first_name
    LIMIT ? OFFSET ?
  `;
  params.push(limit.toString(), offset.toString());
  const data = await sql.rows<any>(query, params);

  return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
}

export async function getGuestWithReservations(organizationId: string, id: string) {
  const sql = getSql();
  const guest = await sql.row<any>(`
    SELECT g.*,
      (SELECT COUNT(*) FROM reservations r
        JOIN properties p ON p.id = r.property_id
        WHERE r.guest_id = g.id AND p.organization_id = g.organization_id AND ${ACROSS_PROPERTIES.sql}) as total_stays,
      (SELECT SUM(r.total_price) FROM reservations r
        JOIN properties p ON p.id = r.property_id
        WHERE r.guest_id = g.id AND p.organization_id = g.organization_id AND ${ACROSS_PROPERTIES.sql}) as total_revenue
    FROM guests g WHERE g.id = ? AND g.organization_id = ?
  `, [id, organizationId]);

  if (!guest) return null;

  const reservations = await sql.rows<any>(`
    SELECT r.id, r.check_in, r.check_out, r.nights, r.adults, r.children,
      r.status, r.payment_status, r.source, r.total_price, r.currency,
      u.name as unit_name, u.code as unit_code,
      c.name as category_name, c.type as category_type
    FROM reservations r
    LEFT JOIN units u ON r.unit_id = u.id
    LEFT JOIN categories c ON u.category_id = c.id
    JOIN properties p ON p.id = r.property_id
    WHERE r.guest_id = ? AND p.organization_id = ?
    ORDER BY r.check_in DESC
  `, [id, organizationId]);

  return { ...(guest as object), reservations };
}

export async function createGuest(organizationId: string, input: CreateGuestInput): Promise<string> {
  const sql = getSql();
  // `g_${Date.now()}` collides when two guests are created in the same
  // millisecond, which an import does routinely. A random suffix removes that.
  const guestId = `g_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  await sql.run(`
    INSERT INTO guests (id, organization_id, first_name, last_name, email, phone, country, city, address, document_type, document_number, date_of_birth, notes, salutation, middle_name, vehicle_plate)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [guestId, organizationId, input.firstName, input.lastName,
    input.email ?? null, input.phone ?? null, input.country ?? null,
    input.city ?? null, input.address ?? null,
    input.documentType ?? null, input.documentNumber ?? null,
    input.dateOfBirth ?? null, input.notes ?? null,
    input.salutation ?? null, input.middleName ?? null, input.vehiclePlate ?? null]);

  return guestId;
}

export async function updateGuest(organizationId: string, id: string, body: Record<string, any>): Promise<boolean> {
  const sql = getSql();
  const fieldMap: Record<string, string> = {
    firstName: 'first_name', lastName: 'last_name', email: 'email', phone: 'phone',
    country: 'country', city: 'city', address: 'address',
    documentType: 'document_type', documentNumber: 'document_number',
    dateOfBirth: 'date_of_birth', whatsapp: 'whatsapp', language: 'language', notes: 'notes',
    // Поля картки (С76). Ключ, якого тут немає, зникає МОВЧКИ: форма
    // каже «збережено», колонка лишається старою. Саме це й сталось при
    // першому прогоні `guest-flags.check`.
    salutation: 'salutation', middleName: 'middle_name', vehiclePlate: 'vehicle_plate',
  };

  // Прапорців тут НЕМАЄ свідомо: рядок нижче кладе `body[jsKey] || null`,
  // тож `false` став би NULL — у `NOT NULL` колонку `is_vip`. VIP і чорний
  // список пише `guest-flags.repo`, і в нього ще й правила (причина блокування).

  const sets: string[] = [];
  const values: (string | null)[] = [];

  for (const [jsKey, dbCol] of Object.entries(fieldMap)) {
    if (body[jsKey] !== undefined) {
      sets.push(`${dbCol} = ?`);
      values.push(body[jsKey] || null);
    }
  }

  if (sets.length === 0) return false;

  sets.push("updated_at = CURRENT_TIMESTAMP");
  values.push(id, organizationId);
  const res = await sql.run(`UPDATE guests SET ${sets.join(', ')} WHERE id = ? AND organization_id = ?`, [...values]);
  return res.changes > 0;
}

export async function deleteGuest(organizationId: string, id: string): Promise<{ ok: boolean; error?: string }> {
  const sql = getSql();
  const owned = await sql.row<any>('SELECT 1 FROM guests WHERE id = ? AND organization_id = ?', [id, organizationId]);
  if (!owned) return { ok: false, error: 'Not found' };

  const count = await sql.row<any>(`
    SELECT COUNT(*) as cnt FROM reservations r
    JOIN properties p ON p.id = r.property_id
    WHERE r.guest_id = ? AND p.organization_id = ?
  `, [id, organizationId]) as { cnt: number };
  if (count.cnt > 0) {
    return { ok: false, error: `Неможливо видалити гостя — є ${count.cnt} пов'язаних бронювань. Спочатку видаліть або перепризначте бронювання.` };
  }
  await sql.run('DELETE FROM guests WHERE id = ? AND organization_id = ?', [id, organizationId]);
  return { ok: true };
}
