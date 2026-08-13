import { getSql } from '@core/db/async';
import { ownsProperty, ownsViaProperty, propertyScopeSql } from './tenant-scope';

/**
 * A category's `type` is the hotel's own word for what kind of thing this is.
 *
 * It used to be a closed list — glamping, resort, camping, later facility, area
 * and zone. That is one customer's business vocabulary, in a validator, and it
 * bites the moment a hotel says something else: a German pension entering
 * "Zimmer" or "Ferienwohnung", a hostel entering "dorm", got a 400 telling them
 * their own words are wrong. NAMING.md §9 forbids exactly this, and the
 * database dropped its CHECK already (see the categories rebuild in db.ts);
 * only this list was left, refusing values that provisioning itself writes —
 * every hotel is created with type 'rooms'.
 *
 * So the type is free text now, and the only rules left are the ones that are
 * about storage rather than about business: it must be there, it must be short,
 * and it must be a single token, because it is used as a grouping key.
 */
export type CategoryTypeValue = string;

/**
 * Categories hang off a property and carry no organization_id of their own, so
 * every function here constrains through properties. listCategories returned
 * every tenant's categories, and update/delete acted on whatever id the URL
 * carried.
 */

export async function listCategories(organizationId: string) {
  const sql = getSql();
  return await sql.rows<any>(`
    SELECT
      c.id, c.name, c.type, c.icon, c.color, c.sort_order, c.description,
      c.show_in_tasks, c.show_in_finance, c.show_in_booking,
      COUNT(u.id) as unit_count
    FROM categories c
    LEFT JOIN units u ON u.category_id = c.id AND u.is_active = TRUE
    WHERE ${propertyScopeSql('c')}
    GROUP BY c.id
    ORDER BY c.sort_order
  `, [organizationId]);
}

export interface CreateCategoryInput {
  property_id: string;
  name: string;
  type: CategoryTypeValue;
  description?: string;
  sort_order?: number;
  icon?: string;
  color?: string;
  show_in_tasks?: number;
  show_in_finance?: number;
  show_in_booking?: number;
}

/** A grouping key: present, short, one token. Not a list of allowed businesses. */
export function validateCategoryType(type: string): type is CategoryTypeValue {
  return typeof type === 'string' && /^[\p{L}\p{N}_-]{1,32}$/u.test(type);
}

export async function createCategory(organizationId: string, input: CreateCategoryInput) {
  // property_id arrives in the request body, so it is caller-chosen until
  // proven otherwise: without this a tenant could attach a category to somebody
  // else's property.
  if (!await ownsProperty(organizationId, input.property_id)) return null;

  const sql = getSql();
  const result = await sql.row<any>(
    `
    INSERT INTO categories (property_id, name, type, description, sort_order, icon, color, show_in_tasks, show_in_finance, show_in_booking)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *`,
    [input.property_id, input.name, input.type, input.description ?? null,
    input.sort_order ?? 0, input.icon ?? null, input.color ?? null,
    input.show_in_tasks ?? 1, input.show_in_finance ?? 0,
    input.show_in_booking ?? 1],
  );
  return result;
}

export async function updateCategory(organizationId: string, id: string, fields: Record<string, unknown>) {
  if (!await ownsViaProperty(organizationId, 'categories', id)) return null;

  const sql = getSql();
  const allowed = ['name', 'type', 'description', 'sort_order', 'icon', 'color',
    'show_in_tasks', 'show_in_finance', 'show_in_booking'];
  const updates: string[] = [];
  const values: unknown[] = [];

  for (const field of allowed) {
    if (fields[field] !== undefined) {
      updates.push(`${field} = ?`);
      values.push(fields[field]);
    }
  }

  if (updates.length === 0) return null;

  values.push(id, organizationId);
  // Scoped in the WHERE clause too, not only by the check above: the guard and
  // the write must not be able to drift apart.
  await sql.run(`UPDATE categories SET ${updates.join(', ')}
     WHERE id = ? AND ${propertyScopeSql('categories')}`, [...values]);
  return await sql.row<any>('SELECT * FROM categories WHERE id = ?', [id]);
}

export async function deleteCategory(organizationId: string, id: string): Promise<{ ok: boolean; error?: string }> {
  if (!await ownsViaProperty(organizationId, 'categories', id)) return { ok: false, error: 'Not found' };

  const sql = getSql();
  const unitCount = await sql.row<any>('SELECT COUNT(*) as cnt FROM units WHERE category_id = ?', [id]) as { cnt: number };
  if (unitCount.cnt > 0) {
    return { ok: false, error: `Cannot delete: ${unitCount.cnt} units belong to this category. Delete units first.` };
  }
  await sql.run(`DELETE FROM categories WHERE id = ? AND ${propertyScopeSql('categories')}`, [id, organizationId]);
  return { ok: true };
}
