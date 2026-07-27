import { getDb } from '@core/db';

export function listProperties() {
  return getDb().prepare(`
    SELECT
      p.*,
      (SELECT COUNT(*) FROM categories c WHERE c.property_id = p.id) as category_count,
      (SELECT COUNT(*) FROM buildings b WHERE b.property_id = p.id) as building_count,
      (SELECT COUNT(*) FROM units u WHERE u.property_id = p.id AND u.is_active = 1) as unit_count,
      (SELECT COUNT(*) FROM unit_types ut WHERE ut.property_id = p.id AND ut.is_active = 1) as unit_type_count
    FROM properties p
    ORDER BY p.created_at
  `).all();
}

export function getPropertyById(id: string) {
  const db = getDb();

  const property = db.prepare('SELECT * FROM properties WHERE id = ?').get(id);
  if (!property) return null;

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

export function createProperty(input: CreatePropertyInput) {
  const db = getDb();
  const org = db.prepare('SELECT id FROM organizations LIMIT 1').get() as { id: string } | undefined;
  if (!org) throw new Error('No organization found');

  const result = db.prepare(`
    INSERT INTO properties (organization_id, name, slug, address, city, country, phone, email, check_in_time, check_out_time)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    org.id, input.name, input.slug,
    input.address ?? null, input.city ?? null, input.country ?? 'CZ',
    input.phone ?? null, input.email ?? null,
    input.check_in_time ?? '15:00', input.check_out_time ?? '10:00'
  );

  return db.prepare('SELECT * FROM properties WHERE rowid = ?').get(result.lastInsertRowid);
}

export function updateProperty(id: string, fields: Record<string, unknown>) {
  const db = getDb();
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
  values.push(id);

  db.prepare(`UPDATE properties SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  return db.prepare('SELECT * FROM properties WHERE id = ?').get(id);
}

export function deleteProperty(id: string): { ok: boolean; error?: string } {
  const db = getDb();
  const count = db.prepare('SELECT COUNT(*) as cnt FROM properties').get() as { cnt: number };
  if (count.cnt <= 1) return { ok: false, error: 'Cannot delete the last property' };
  db.prepare('DELETE FROM properties WHERE id = ?').run(id);
  return { ok: true };
}
