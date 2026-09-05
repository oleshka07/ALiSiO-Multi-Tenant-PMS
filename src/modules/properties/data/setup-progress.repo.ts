/* eslint-disable @typescript-eslint/no-explicit-any */
import { getSql } from '@core/db/async';
import { todayFor } from '@core/hotel-day';
import { pricedDaysAhead, listRatePlans } from '@pricing';
import { connectionsForProperty } from '@channels';
import { setupProgress, PRICE_COVERAGE_DAYS, type SetupProgress, type SetupSnapshot } from '../domain/setup-progress';

/**
 * Зріз даних для Setup progress одного обʼєкта (MASTER-PLAN §1.4).
 *
 * Обʼєкт спершу доводиться своїм: `WHERE id = ? AND organization_id = ?` —
 * чужий id дає `null`, і маршрут відповідає 404 (інваріант 5). Далі все, що
 * висить на обʼєкті, читається за `property_id` вже доведеного рядка; те, що
 * належить іншим модулям, — через їхні фасади (`@pricing`, `@channels`), а не
 * SQL до їхніх таблиць (check-boundaries).
 *
 * Викликається в контексті орендаря: з маршруту — його ставить `withActor`,
 * з платформи — `runWithOrganization` навколо кожної організації.
 */
export async function setupProgressFor(organizationId: string, propertyId: string): Promise<SetupProgress | null> {
  const sql = getSql();
  const property = await sql.row<any>(
    'SELECT id, country, check_in_time, check_out_time FROM properties WHERE id = ? AND organization_id = ?',
    [propertyId, organizationId],
  );
  if (!property) return null;

  const org = await sql.row<any>('SELECT is_vat_payer, legal_name FROM organizations WHERE id = ?', [organizationId]);

  const unitTypeRows = await sql.rows<any>(
    'SELECT id FROM unit_types WHERE property_id = ? AND COALESCE(max_adults, 0) >= 1',
    [property.id],
  );
  const unitTypeIds = unitTypeRows.map((r) => String(r.id));
  const units = await sql.row<any>('SELECT COUNT(*) AS n FROM units WHERE property_id = ? AND is_active = TRUE', [property.id]);
  const today = await todayFor(organizationId);
  const [pricedDays, ratePlans, connections] = await Promise.all([
    pricedDaysAhead(unitTypeIds, today, PRICE_COVERAGE_DAYS),
    listRatePlans(property.id),
    connectionsForProperty(property.id),
  ]);
  const taxRates = await sql.row<any>('SELECT COUNT(*) AS n FROM fin_tax_rates WHERE organization_id = ?', [organizationId]);
  const reservations = await sql.row<any>(
    `SELECT COUNT(*) AS n FROM reservations WHERE property_id = ? AND organization_id = ? AND status <> 'cancelled'`,
    [property.id, organizationId],
  );
  const sites = await sql.row<any>(
    `SELECT COUNT(*) AS n FROM booking_sites WHERE property_id = ? AND organization_id = ? AND status = 'active'`,
    [property.id, organizationId],
  );

  const snapshot: SetupSnapshot = {
    property: { country: property.country ?? null, checkInTime: property.check_in_time ?? null, checkOutTime: property.check_out_time ?? null },
    unitTypes: unitTypeIds.length,
    units: Number(units?.n ?? 0),
    pricedDaysAhead: pricedDays,
    ratePlans: ratePlans.filter((p) => p.isActive).length,
    taxRates: Number(taxRates?.n ?? 0),
    vatPayer: Boolean(Number(org?.is_vat_payer ?? 0)),
    legalNameSet: !!(org?.legal_name && String(org.legal_name).trim()),
    activeReservations: Number(reservations?.n ?? 0),
    channelEnabled: connections.some((c) => c.isEnabled),
    siteActive: Number(sites?.n ?? 0) > 0,
  };
  return setupProgress(snapshot);
}

/** Перший обʼєкт організації (за створенням) — той, чий прогрес показує платформа. */
export async function firstPropertyId(organizationId: string): Promise<string | null> {
  const row = await getSql().row<any>(
    'SELECT id FROM properties WHERE organization_id = ? ORDER BY created_at, id LIMIT 1',
    [organizationId],
  );
  return row ? String(row.id) : null;
}
