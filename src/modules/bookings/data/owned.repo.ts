/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Ownership checks for the bookings module.
 *
 * reservations has no organization_id of its own — the tenant arrives through
 * property_id. Every handler that takes a reservation or unit id from the
 * client answers one question first: does it belong to the caller's
 * organization? Wrong tenant looks exactly like "does not exist": 404.
 */

export function ownedReservation(db: any, organizationId: string, id: string):
  { id: string; property_id: string } | undefined {
  return db.prepare(`
    SELECT r.id, r.property_id FROM reservations r
    JOIN properties p ON r.property_id = p.id
    WHERE r.id = ? AND p.organization_id = ?
  `).get(id, organizationId);
}

export function ownedUnit(db: any, organizationId: string, unitId: string):
  { id: string; property_id: string; category_id: string; is_pool: number } | undefined {
  return db.prepare(`
    SELECT u.id, u.property_id, u.category_id, u.is_pool FROM units u
    JOIN properties p ON u.property_id = p.id
    WHERE u.id = ? AND p.organization_id = ?
  `).get(unitId, organizationId);
}
