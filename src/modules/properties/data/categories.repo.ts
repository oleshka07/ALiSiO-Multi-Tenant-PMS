import { getDb } from '@core/db';
import { ownsProperty, ownsViaProperty, propertyScopeSql } from './tenant-scope';

const VALID_TYPES = ['glamping', 'resort', 'camping', 'facility', 'area', 'zone'] as const;
export type CategoryTypeValue = typeof VALID_TYPES[number];

/**
 * Categories hang off a property and carry no organization_id of their own, so
 * every function here constrains through properties. listCategories returned
 * every tenant's categories, and update/delete acted on whatever id the URL
 * carried.
 */

export function listCategories(organizationId: string) {
  return getDb().prepare(`
    SELECT
      c.id, c.name, c.type, c.icon, c.color, c.sort_order, c.description,
      c.show_in_tasks, c.show_in_finance, c.show_in_booking, c.show_in_investor,
      COUNT(u.id) as unit_count
    FROM categories c
    LEFT JOIN units u ON u.category_id = c.id AND u.is_active = 1
    WHERE ${propertyScopeSql('c')}
    GROUP BY c.id
    ORDER BY c.sort_order
  `).all(organizationId);
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
  show_in_investor?: number;
}

export function validateCategoryType(type: string): type is CategoryTypeValue {
  return VALID_TYPES.includes(type as CategoryTypeValue);
}

export function createCategory(organizationId: string, input: CreateCategoryInput) {
  // property_id arrives in the request body, so it is caller-chosen until
  // proven otherwise: without this a tenant could attach a category to somebody
  // else's property.
  if (!ownsProperty(organizationId, input.property_id)) return null;

  const db = getDb();
  const result = db.prepare(`
    INSERT INTO categories (property_id, name, type, description, sort_order, icon, color, show_in_tasks, show_in_finance, show_in_booking, show_in_investor)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.property_id, input.name, input.type, input.description ?? null,
    input.sort_order ?? 0, input.icon ?? null, input.color ?? null,
    input.show_in_tasks ?? 1, input.show_in_finance ?? 0,
    input.show_in_booking ?? 1, input.show_in_investor ?? 0,
  );
  return db.prepare('SELECT * FROM categories WHERE rowid = ?').get(result.lastInsertRowid);
}

export function updateCategory(organizationId: string, id: string, fields: Record<string, unknown>) {
  if (!ownsViaProperty(organizationId, 'categories', id)) return null;

  const db = getDb();
  const allowed = ['name', 'type', 'description', 'sort_order', 'icon', 'color',
    'show_in_tasks', 'show_in_finance', 'show_in_booking', 'show_in_investor'];
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
  db.prepare(
    `UPDATE categories SET ${updates.join(', ')}
     WHERE id = ? AND ${propertyScopeSql('categories')}`,
  ).run(...values);
  return db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
}

export function deleteCategory(organizationId: string, id: string): { ok: boolean; error?: string } {
  if (!ownsViaProperty(organizationId, 'categories', id)) return { ok: false, error: 'Not found' };

  const db = getDb();
  const unitCount = db.prepare('SELECT COUNT(*) as cnt FROM units WHERE category_id = ?').get(id) as { cnt: number };
  if (unitCount.cnt > 0) {
    return { ok: false, error: `Cannot delete: ${unitCount.cnt} units belong to this category. Delete units first.` };
  }
  db.prepare(`DELETE FROM categories WHERE id = ? AND ${propertyScopeSql('categories')}`).run(id, organizationId);
  return { ok: true };
}
