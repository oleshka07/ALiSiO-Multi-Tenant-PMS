/* eslint-disable @typescript-eslint/no-explicit-any */
import { getDb } from '@core/db';
import type { CreateGuestInput } from '../domain/types';

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

export function listGuests(
  organizationId: string,
  filters: { search?: string; country?: string } = {},
  page: number = 1,
  limit: number = 50,
) {
  const db = getDb();
  let where = 'WHERE g.organization_id = ?';
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

  const countQuery = `SELECT COUNT(*) as total FROM guests g ${where}`;
  const totalRow = db.prepare(countQuery).get(...params) as { total: number };
  const total = totalRow.total;

  const offset = (page - 1) * limit;

  const stay = (expr: string) => `(
    SELECT ${expr} FROM reservations r
    JOIN properties p ON p.id = r.property_id
    WHERE r.guest_id = g.id AND p.organization_id = g.organization_id
  )`;

  const query = `
    SELECT
      g.*,
      ${stay('COUNT(*)')} as total_stays,
      ${stay('SUM(r.total_price)')} as total_revenue,
      ${stay('MAX(r.check_in)')} as last_check_in,
      (SELECT r.status FROM reservations r
        JOIN properties p ON p.id = r.property_id
        WHERE r.guest_id = g.id AND p.organization_id = g.organization_id
        ORDER BY r.check_in DESC LIMIT 1) as last_booking_status
    FROM guests g
    ${where}
    ORDER BY g.last_name, g.first_name
    LIMIT ? OFFSET ?
  `;
  params.push(limit.toString(), offset.toString());
  const data = db.prepare(query).all(...params);

  return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
}

export function getGuestWithReservations(organizationId: string, id: string) {
  const db = getDb();
  const guest = db.prepare(`
    SELECT g.*,
      (SELECT COUNT(*) FROM reservations r
        JOIN properties p ON p.id = r.property_id
        WHERE r.guest_id = g.id AND p.organization_id = g.organization_id) as total_stays,
      (SELECT SUM(r.total_price) FROM reservations r
        JOIN properties p ON p.id = r.property_id
        WHERE r.guest_id = g.id AND p.organization_id = g.organization_id) as total_revenue
    FROM guests g WHERE g.id = ? AND g.organization_id = ?
  `).get(id, organizationId);

  if (!guest) return null;

  const reservations = db.prepare(`
    SELECT r.id, r.check_in, r.check_out, r.nights, r.adults, r.children,
      r.status, r.payment_status, r.source, r.total_price, r.currency,
      u.name as unit_name, u.code as unit_code,
      c.name as category_name, c.type as category_type
    FROM reservations r
    JOIN units u ON r.unit_id = u.id
    JOIN categories c ON u.category_id = c.id
    JOIN properties p ON p.id = r.property_id
    WHERE r.guest_id = ? AND p.organization_id = ?
    ORDER BY r.check_in DESC
  `).all(id, organizationId);

  return { ...(guest as object), reservations };
}

export function createGuest(organizationId: string, input: CreateGuestInput): string {
  const db = getDb();
  // `g_${Date.now()}` collides when two guests are created in the same
  // millisecond, which an import does routinely. A random suffix removes that.
  const guestId = `g_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  db.prepare(`
    INSERT INTO guests (id, organization_id, first_name, last_name, email, phone, country, city, address, document_type, document_number, date_of_birth, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    guestId, organizationId, input.firstName, input.lastName,
    input.email ?? null, input.phone ?? null, input.country ?? null,
    input.city ?? null, input.address ?? null,
    input.documentType ?? null, input.documentNumber ?? null,
    input.dateOfBirth ?? null, input.notes ?? null,
  );

  return guestId;
}

export function updateGuest(organizationId: string, id: string, body: Record<string, any>): boolean {
  const db = getDb();
  const fieldMap: Record<string, string> = {
    firstName: 'first_name', lastName: 'last_name', email: 'email', phone: 'phone',
    country: 'country', city: 'city', address: 'address',
    documentType: 'document_type', documentNumber: 'document_number',
    dateOfBirth: 'date_of_birth', whatsapp: 'whatsapp', language: 'language', notes: 'notes',
  };

  const sets: string[] = [];
  const values: (string | null)[] = [];

  for (const [jsKey, dbCol] of Object.entries(fieldMap)) {
    if (body[jsKey] !== undefined) {
      sets.push(`${dbCol} = ?`);
      values.push(body[jsKey] || null);
    }
  }

  if (sets.length === 0) return false;

  sets.push("updated_at = datetime('now')");
  values.push(id, organizationId);
  const res = db
    .prepare(`UPDATE guests SET ${sets.join(', ')} WHERE id = ? AND organization_id = ?`)
    .run(...values);
  return res.changes > 0;
}

export function deleteGuest(organizationId: string, id: string): { ok: boolean; error?: string } {
  const db = getDb();
  const owned = db
    .prepare('SELECT 1 FROM guests WHERE id = ? AND organization_id = ?')
    .get(id, organizationId);
  if (!owned) return { ok: false, error: 'Not found' };

  const count = db.prepare(`
    SELECT COUNT(*) as cnt FROM reservations r
    JOIN properties p ON p.id = r.property_id
    WHERE r.guest_id = ? AND p.organization_id = ?
  `).get(id, organizationId) as { cnt: number };
  if (count.cnt > 0) {
    return { ok: false, error: `Неможливо видалити гостя — є ${count.cnt} пов'язаних бронювань. Спочатку видаліть або перепризначте бронювання.` };
  }
  db.prepare('DELETE FROM guests WHERE id = ? AND organization_id = ?').run(id, organizationId);
  return { ok: true };
}
