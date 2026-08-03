import { getSql } from '@core/db/async';

/**
 * Ownership checks for everything hanging off a property.
 *
 * categories, buildings, unit_types and units carry no organization_id — they
 * reach one through property_id. That is a fine schema, but it means a query
 * constrained only by the row's own id isolates nothing: the id comes from the
 * URL, and any tenant can type any id. These helpers turn "this id" into "this
 * id, and it is ours".
 *
 * Everything returns a boolean rather than throwing, so callers can answer 404
 * and avoid confirming that another tenant's row exists.
 */

/** Does this property belong to the organization? */
export async function ownsProperty(organizationId: string, propertyId: string): Promise<boolean> {
  const sql = getSql();
  return !!await sql.row<any>('SELECT 1 FROM properties WHERE id = ? AND organization_id = ?', [propertyId, organizationId]);
}

/**
 * Does a row in a property-owned table belong to the organization?
 * One join, so the check cannot drift from the schema the way a copied
 * `WHERE property_id IN (...)` would.
 */
export async function ownsViaProperty(
  organizationId: string,
  table: 'categories' | 'buildings' | 'unit_types' | 'units',
  id: string,
): Promise<boolean> {
  const sql = getSql();
  return !!await sql.row<any>(`SELECT 1 FROM ${table} t
       JOIN properties p ON p.id = t.property_id
       WHERE t.id = ? AND p.organization_id = ?`, [id, organizationId]);
}

/** All property ids owned by the organization — for list queries. */
export async function propertyIdsOf(organizationId: string): Promise<string[]> {
  const sql = getSql();
  return (await sql.rows<any>('SELECT id FROM properties WHERE organization_id = ?', [organizationId]) as { id: string }[]).map((r) => r.id);
}

/**
 * A SQL fragment restricting `alias` to the organization's properties.
 * Used where building the id list separately would mean a second round trip
 * inside an already-complex query.
 */
export function propertyScopeSql(alias: string): string {
  return `${alias}.property_id IN (SELECT id FROM properties WHERE organization_id = ?)`;
}
