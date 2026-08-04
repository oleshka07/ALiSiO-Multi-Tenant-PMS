/* eslint-disable @typescript-eslint/no-explicit-any */
import { getSql } from '@core/db/async';

/**
 * Ownership checks for the bookings module.
 *
 * reservations has no organization_id of its own — the tenant arrives through
 * property_id. Every handler that takes a reservation or unit id from the
 * client answers one question first: does it belong to the caller's
 * organization? Wrong tenant looks exactly like "does not exist": 404.
 */

export async function ownedReservation(organizationId: string, id: string): Promise<{ id: string; property_id: string } | undefined> {
  const sql = getSql();
  return await sql.row<any>(`
    SELECT r.id, r.property_id FROM reservations r
    JOIN properties p ON r.property_id = p.id
    WHERE r.id = ? AND p.organization_id = ?
  `, [id, organizationId]);
}

export async function ownedUnit(organizationId: string, unitId: string): Promise<{ id: string; property_id: string; category_id: string; is_pool: number } | undefined> {
  const sql = getSql();
  return await sql.row<any>(`
    SELECT u.id, u.property_id, u.category_id, u.is_pool FROM units u
    JOIN properties p ON u.property_id = p.id
    WHERE u.id = ? AND p.organization_id = ?
  `, [unitId, organizationId]);
}
