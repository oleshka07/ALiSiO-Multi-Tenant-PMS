/* eslint-disable @typescript-eslint/no-explicit-any */
import { getDb } from '@core/db';

/**
 * The guest registry (evidenční kniha): names, dates of birth, nationality,
 * document type and number, address. reservation_guests reaches an
 * organization through its reservation's property, and none of these queries
 * used that — the month view, the CSV export and every mutation acted on every
 * hotel's guests at once. Combined with the route being public, that was the
 * whole registry of every customer, readable and exportable by anyone.
 *
 * Every read is constrained by the organization, and every mutation is a
 * no-op unless the row belongs to it.
 */

/** Constrain reservation_guests rg / reservations r to one organization. */
const ORG_SCOPE = 'r.property_id IN (SELECT id FROM properties WHERE organization_id = ?)';

// ─── Types ────────────────────────────────────────────

export interface RegistryFilters {
  month: string;               // YYYY-MM
  foreignersOnly?: boolean;
  unregisteredOnly?: boolean;
  search?: string;
  propertyId?: string;
}

export interface RegistryEntry {
  id: string;
  first_name: string;
  last_name: string;
  date_of_birth: string | null;
  nationality: string | null;
  document_type: string | null;
  document_number: string | null;
  address: string | null;
  visa_number: string | null;
  purpose_of_stay: string | null;
  is_foreigner: number;
  fee_amount: number;
  fee_exempt: number;
  fee_exempt_reason: string | null;
  police_reported: number;
  police_reported_at: string | null;
  police_report_ref: string | null;
  check_in: string;
  check_out: string;
  nights: number;
  unit_name: string;
  unit_code: string;
  reservation_id: string;
  guest_id: string | null;
}

export interface RegistrySummary {
  totalGuests: number;
  foreigners: number;
  registeredPolice: number;
  unregisteredPolice: number;
  totalFees: number;
  exemptGuests: number;
}

// ─── Helpers ──────────────────────────────────────────

/** Given 'YYYY-MM', return the first day of the next month in 'YYYY-MM-DD' format */
function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m, 1); // month is 0-based, so `m` = next month
  const ny = d.getFullYear();
  const nm = String(d.getMonth() + 1).padStart(2, '0');
  return `${ny}-${nm}-01`;
}

// ─── Queries ──────────────────────────────────────────

export function getRegistryEntries(organizationId: string, filters: RegistryFilters): RegistryEntry[] {
  const monthStart = `${filters.month}-01`;
  const monthEnd = nextMonth(filters.month);

  let query = `
    SELECT
      rg.id,
      rg.first_name,
      rg.last_name,
      rg.date_of_birth,
      rg.nationality,
      rg.document_type,
      rg.document_number,
      rg.address,
      rg.visa_number,
      COALESCE(rg.purpose_of_stay, 'Tourism') as purpose_of_stay,
      CASE WHEN rg.nationality IS NOT NULL AND rg.nationality != 'CZ' THEN 1 ELSE 0 END as is_foreigner,
      CASE WHEN COALESCE(rg.fee_exempt, 0) = 1 THEN 0 ELSE r.nights * 20 END as fee_amount,
      COALESCE(rg.fee_exempt, 0) as fee_exempt,
      rg.fee_exempt_reason,
      COALESCE(rg.police_reported, 0) as police_reported,
      rg.police_reported_at,
      rg.police_report_ref,
      r.check_in,
      r.check_out,
      r.nights,
      u.name as unit_name,
      u.code as unit_code,
      r.id as reservation_id,
      rg.guest_id
    FROM reservation_guests rg
    JOIN reservations r ON rg.reservation_id = r.id
    JOIN units u ON r.unit_id = u.id
    WHERE ${ORG_SCOPE} AND r.check_in >= ? AND r.check_in < ?
  `;
  const params: (string | number)[] = [organizationId, monthStart, monthEnd];

  if (filters.propertyId) {
    query += ' AND r.property_id = ?';
    params.push(filters.propertyId);
  }

  if (filters.foreignersOnly) {
    query += " AND rg.nationality != 'CZ' AND rg.nationality IS NOT NULL";
  }

  if (filters.unregisteredOnly) {
    query += " AND COALESCE(rg.police_reported, 0) = 0 AND rg.nationality != 'CZ'";
  }

  if (filters.search) {
    query += " AND (rg.first_name || ' ' || rg.last_name) LIKE ?";
    params.push(`%${filters.search}%`);
  }

  query += ' AND COALESCE(rg.is_hidden, 0) = 0';

  query += ' ORDER BY r.check_in, rg.last_name, rg.first_name';

  return getDb().prepare(query).all(...params) as RegistryEntry[];
}

export function getRegistrySummary(organizationId: string, filters: { month: string; propertyId?: string }): RegistrySummary {
  const monthStart = `${filters.month}-01`;
  const monthEnd = nextMonth(filters.month);

  let query = `
    SELECT
      COUNT(*) as totalGuests,
      SUM(CASE WHEN rg.nationality IS NOT NULL AND rg.nationality != 'CZ' THEN 1 ELSE 0 END) as foreigners,
      SUM(CASE WHEN rg.police_reported = 1 THEN 1 ELSE 0 END) as registeredPolice,
      SUM(CASE WHEN COALESCE(rg.police_reported, 0) = 0 AND rg.nationality IS NOT NULL AND rg.nationality != 'CZ' THEN 1 ELSE 0 END) as unregisteredPolice,
      SUM(CASE WHEN COALESCE(rg.fee_exempt, 0) = 1 THEN 0 ELSE r.nights * 20 END) as totalFees,
      SUM(CASE WHEN rg.fee_exempt = 1 THEN 1 ELSE 0 END) as exemptGuests
    FROM reservation_guests rg
    JOIN reservations r ON rg.reservation_id = r.id
    WHERE ${ORG_SCOPE} AND r.check_in >= ? AND r.check_in < ?
  `;
  const params: (string | number)[] = [organizationId, monthStart, monthEnd];

  if (filters.propertyId) {
    query += ' AND r.property_id = ?';
    params.push(filters.propertyId);
  }

  query += ' AND COALESCE(rg.is_hidden, 0) = 0';

  const row = getDb().prepare(query).get(...params) as any;

  return {
    totalGuests: row?.totalGuests ?? 0,
    foreigners: row?.foreigners ?? 0,
    registeredPolice: row?.registeredPolice ?? 0,
    unregisteredPolice: row?.unregisteredPolice ?? 0,
    totalFees: row?.totalFees ?? 0,
    exemptGuests: row?.exemptGuests ?? 0,
  };
}

// ─── Mutations ────────────────────────────────────────

/** The row, if this organization owns it through the reservation's property. */
function owns(organizationId: string, id: string): boolean {
  return !!getDb().prepare(`
    SELECT 1 FROM reservation_guests rg
    JOIN reservations r ON r.id = rg.reservation_id
    WHERE rg.id = ? AND ${ORG_SCOPE}
  `).get(id, organizationId);
}

export function markPoliceReported(organizationId: string, id: string, ref?: string): boolean {
  if (!owns(organizationId, id)) return false;
  getDb().prepare(`
    UPDATE reservation_guests
    SET police_reported = 1,
        police_reported_at = datetime('now'),
        police_report_ref = ?
    WHERE id = ?
  `).run(ref ?? null, id);
  return true;
}

export function unmarkPoliceReported(organizationId: string, id: string): boolean {
  if (!owns(organizationId, id)) return false;
  getDb().prepare(`
    UPDATE reservation_guests
    SET police_reported = 0,
        police_reported_at = NULL,
        police_report_ref = NULL
    WHERE id = ?
  `).run(id);
  return true;
}

export function updateFee(organizationId: string, id: string, data: { feeAmount: number; feeExempt: boolean; feeExemptReason?: string }): boolean {
  if (!owns(organizationId, id)) return false;
  getDb().prepare(`
    UPDATE reservation_guests
    SET fee_amount = ?,
        fee_exempt = ?,
        fee_exempt_reason = ?
    WHERE id = ?
  `).run(data.feeAmount, data.feeExempt ? 1 : 0, data.feeExemptReason ?? null, id);
  return true;
}

export function calculateFees(organizationId: string, month: string, feePerNight: number): number {
  const db = getDb();
  const monthStart = `${month}-01`;
  const monthEnd = nextMonth(month);

  // Fetch all non-exempt guests for the month
  const rows = db.prepare(`
    SELECT rg.id, r.nights
    FROM reservation_guests rg
    JOIN reservations r ON rg.reservation_id = r.id
    WHERE ${ORG_SCOPE} AND r.check_in >= ? AND r.check_in < ?
      AND COALESCE(rg.fee_exempt, 0) = 0
  `).all(organizationId, monthStart, monthEnd) as { id: string; nights: number }[];

  let total = 0;
  const update = db.prepare('UPDATE reservation_guests SET fee_amount = ? WHERE id = ?');

  db.transaction(() => {
    for (const row of rows) {
      const fee = row.nights * feePerNight;
      update.run(fee, row.id);
      total += fee;
    }
  })();

  return total;
}

export function hideRegistryEntry(organizationId: string, id: string): boolean {
  if (!owns(organizationId, id)) return false;
  getDb().prepare('UPDATE reservation_guests SET is_hidden = 1 WHERE id = ?').run(id);
  return true;
}

export function unhideRegistryEntry(organizationId: string, id: string): boolean {
  if (!owns(organizationId, id)) return false;
  getDb().prepare('UPDATE reservation_guests SET is_hidden = 0 WHERE id = ?').run(id);
  return true;
}
