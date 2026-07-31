import { getDb } from '@core/db';

/**
 * Every function here takes the caller's organization and constrains on it.
 *
 * None of them did before: listProperties returned every tenant's properties,
 * get/update/deleteProperty acted on whatever id the URL carried, createProperty
 * attached the new row to `SELECT id FROM organizations LIMIT 1` — whichever
 * tenant happened to be first — and the "cannot delete the last property" guard
 * counted across all tenants, so one customer's second property unlocked
 * deleting another customer's only one.
 *
 * A wrong-tenant id returns null rather than throwing, so callers answer 404 and
 * never confirm that someone else's row exists.
 */

export function listProperties(organizationId: string) {
  return getDb().prepare(`
    SELECT
      p.*,
      (SELECT COUNT(*) FROM categories c WHERE c.property_id = p.id) as category_count,
      (SELECT COUNT(*) FROM buildings b WHERE b.property_id = p.id) as building_count,
      (SELECT COUNT(*) FROM units u WHERE u.property_id = p.id AND u.is_active = 1) as unit_count,
      (SELECT COUNT(*) FROM unit_types ut WHERE ut.property_id = p.id AND ut.is_active = 1) as unit_type_count
    FROM properties p
    WHERE p.organization_id = ?
    ORDER BY p.created_at
  `).all(organizationId);
}

/** True when the property exists *and* belongs to this organization. */
function owns(db: any, organizationId: string, id: string): boolean {
  return !!db.prepare('SELECT 1 FROM properties WHERE id = ? AND organization_id = ?').get(id, organizationId);
}

export function getPropertyById(organizationId: string, id: string) {
  const db = getDb();

  const property = db
    .prepare('SELECT * FROM properties WHERE id = ? AND organization_id = ?')
    .get(id, organizationId);
  if (!property) return null;

  // The children below are reached through property_id, which the lookup above
  // has already tied to this organization.
  const categories = db.prepare(`
    SELECT c.*, COUNT(u.id) as unit_count
    FROM categories c
    LEFT JOIN units u ON u.category_id = c.id AND u.is_active = 1
    WHERE c.property_id = ?
    GROUP BY c.id
    ORDER BY c.sort_order
  `).all(id);

  const buildings = db.prepare(`
    SELECT b.*, COUNT(u.id) as unit_count
    FROM buildings b
    LEFT JOIN units u ON u.building_id = b.id AND u.is_active = 1
    WHERE b.property_id = ?
    GROUP BY b.id
    ORDER BY b.sort_order
  `).all(id);

  const unitTypes = db.prepare(`
    SELECT ut.*, COUNT(u.id) as unit_count
    FROM unit_types ut
    LEFT JOIN units u ON u.unit_type_id = ut.id AND u.is_active = 1
    WHERE ut.property_id = ? AND ut.is_active = 1
    GROUP BY ut.id
    ORDER BY ut.sort_order
  `).all(id);

  const units = db.prepare(`
    SELECT u.*,
      ut.name as unit_type_name, ut.code as unit_type_code,
      c.name as category_name, c.type as category_type, c.icon as category_icon, c.color as category_color,
      b.name as building_name, b.code as building_code
    FROM units u
    JOIN unit_types ut ON u.unit_type_id = ut.id
    JOIN categories c ON u.category_id = c.id
    LEFT JOIN buildings b ON u.building_id = b.id
    WHERE u.property_id = ?
    ORDER BY c.sort_order, b.sort_order, ut.sort_order, u.sort_order
  `).all(id);

  return { property, categories, buildings, unitTypes, units };
}

export interface CreatePropertyInput {
  name: string;
  slug: string;
  address?: string;
  city?: string;
  country?: string;
  phone?: string;
  email?: string;
  check_in_time?: string;
  check_out_time?: string;
}

export function createProperty(organizationId: string, input: CreatePropertyInput) {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO properties (organization_id, name, slug, address, city, country, phone, email, check_in_time, check_out_time)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    organizationId, input.name, input.slug,
    input.address ?? null, input.city ?? null, input.country ?? 'CZ',
    input.phone ?? null, input.email ?? null,
    input.check_in_time ?? '15:00', input.check_out_time ?? '11:00',
  );
  return db.prepare('SELECT * FROM properties WHERE rowid = ?').get(result.lastInsertRowid);
}

export function updateProperty(organizationId: string, id: string, fields: Record<string, unknown>) {
  const db = getDb();
  if (!owns(db, organizationId, id)) return null;

  const allowed = ['name', 'slug', 'address', 'city', 'country', 'phone', 'email', 'check_in_time', 'check_out_time', 'is_active'];
  const updates: string[] = [];
  const values: unknown[] = [];

  for (const field of allowed) {
    if (fields[field] !== undefined) {
      updates.push(`${field} = ?`);
      values.push(fields[field]);
    }
  }

  if (updates.length === 0) return null;

  updates.push("updated_at = datetime('now')");
  values.push(id, organizationId);

  // organization_id is repeated in the WHERE clause, not left to the check
  // above alone: the guard and the write must not be able to drift apart.
  db.prepare(`UPDATE properties SET ${updates.join(', ')} WHERE id = ? AND organization_id = ?`).run(...values);
  return db.prepare('SELECT * FROM properties WHERE id = ? AND organization_id = ?').get(id, organizationId);
}

export function deleteProperty(organizationId: string, id: string): { ok: boolean; error?: string } {
  const db = getDb();
  if (!owns(db, organizationId, id)) return { ok: false, error: 'Not found' };

  const count = db
    .prepare('SELECT COUNT(*) as cnt FROM properties WHERE organization_id = ?')
    .get(organizationId) as { cnt: number };
  if (count.cnt <= 1) return { ok: false, error: 'Cannot delete the last property' };

  db.prepare('DELETE FROM properties WHERE id = ? AND organization_id = ?').run(id, organizationId);
  return { ok: true };
}
