import { getSql } from '@core/db/async';

/**
 * «Is this unit type this hotel's?» — asked in SQL, for the pricing module.
 *
 * `unitTypeId` arrives in a query string or a request body, and the price
 * calendar is keyed by it alone: `price_calendar` has no organization column,
 * it reaches the tenant through `unit_types → properties`. So a handler that
 * only checked for a session — or even for `manage_pricing` — would read and
 * overwrite another hotel's rates for an id it was simply handed.
 *
 * On Postgres the policy hides it; on SQLite there is no policy, and that is
 * where development, demos and the .check.ts files run. Two mechanisms,
 * deliberately — the same reason `modules/finance/data/owned.repo.ts` exists.
 *
 * Undefined reads as «does not exist», so the caller answers 404 and never
 * tells the difference between a foreign id and a missing one.
 */
export async function ownedUnitType(
  unitTypeId: string,
  organizationId: string,
): Promise<{ id: string } | undefined> {
  return await getSql().row<{ id: string }>(
    `SELECT ut.id
       FROM unit_types ut
       JOIN properties p ON p.id = ut.property_id
      WHERE ut.id = ? AND p.organization_id = ?`,
    [unitTypeId, organizationId],
  );
}
