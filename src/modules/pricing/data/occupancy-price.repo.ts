/**
 * Reading and writing the price matrix.
 *
 * The arithmetic is in ../domain/occupancy-price.ts and stays there — this file
 * only fetches rows and hands them over, so the calendar, the widget and the
 * channel export all quote from the same function rather than from three
 * queries that drifted apart.
 *
 * Every write names `organization_id` explicitly. AGENTS §3.12 allows a scoped
 * INSERT to leave it out, but that DEFAULT is a Postgres mechanism (migration
 * 0005) and SQLite — which every developer machine runs — has no equivalent:
 * omitting it there wrote rows with a NULL tenant, the INSERT answered 201 and
 * the list came back empty.
 */
import { getSql } from '@core/db/async';
import { requireOrganizationId, requirePropertyId } from '@core/auth/tenant-context';
import type { PriceRow, LosTier } from '../domain/occupancy-price';

export interface OccupancyPriceRecord extends PriceRow {
  id: string;
  label?: string | null;
}

export interface LosTierRecord extends LosTier {
  id: string;
  label?: string | null;
}

export interface Matrix {
  property_id: string;
  prices: OccupancyPriceRecord[];
  tiers: LosTierRecord[];
}

/**
 * Everything needed to quote a stay in this property.
 *
 * Both lists come back whole rather than filtered by unit type and date. The
 * matrix is a rate card — tens of rows, not thousands — and which row applies
 * is a decision the domain makes; making it twice, once in SQL and once in
 * TypeScript, is how the two start disagreeing.
 */
export async function loadMatrix(propertyId?: string | null): Promise<Matrix> {
  const organizationId = await requireOrganizationId();
  const property = await requirePropertyId(propertyId);
  const sql = getSql();

  const prices = await sql.rows<any>(
    `SELECT id, unit_type_id, persons, price_gross, valid_from, valid_to, label
       FROM price_occupancy
      WHERE organization_id = ? AND property_id = ?
      ORDER BY unit_type_id, persons, valid_from`,
    [organizationId, property],
  );
  const tiers = await sql.rows<any>(
    `SELECT id, unit_type_id, min_nights, adjustment_gross, persons, label
       FROM price_los_tiers
      WHERE organization_id = ? AND property_id = ?
      ORDER BY min_nights, persons`,
    [organizationId, property],
  );

  return {
    property_id: property,
    // Postgres returns NUMERIC as a string — 119.00 arrives as '119.00'. The
    // domain multiplies and adds, and '119.00' + 0 is '119.000'. Converted
    // once, here, rather than at every call site that forgets.
    prices: prices.map((r) => ({
      id: r.id,
      unit_type_id: r.unit_type_id ?? null,
      persons: Number(r.persons),
      price_gross: Number(r.price_gross),
      valid_from: day(r.valid_from),
      valid_to: day(r.valid_to),
      label: r.label ?? null,
    })),
    tiers: tiers.map((r) => ({
      id: r.id,
      unit_type_id: r.unit_type_id ?? null,
      min_nights: Number(r.min_nights),
      adjustment_gross: Number(r.adjustment_gross),
      persons: r.persons == null ? null : Number(r.persons),
      label: r.label ?? null,
    })),
  };
}

export interface PriceInput {
  unit_type_id?: string | null;
  persons: number;
  price_gross: number;
  valid_from?: string | null;
  valid_to?: string | null;
  label?: string | null;
}

/** Add a price. Returns null when an identical row already exists. */
export async function createPrice(propertyId: string | null | undefined, input: PriceInput): Promise<string | null> {
  const organizationId = await requireOrganizationId();
  const property = await requirePropertyId(propertyId);
  const sql = getSql();

  // Asked before inserting rather than caught afterwards: the unique index
  // reports a constraint name, and "idx_price_occupancy_row" is not a sentence
  // to show an operator.
  const clash = await sql.row<any>(
    `SELECT id FROM price_occupancy
      WHERE organization_id = ? AND property_id = ?
        AND COALESCE(unit_type_id, '') = COALESCE(?, '')
        AND persons = ?
        AND COALESCE(valid_from, '0001-01-01') = COALESCE(?, '0001-01-01')
        AND COALESCE(valid_to, '9999-12-31') = COALESCE(?, '9999-12-31')`,
    [organizationId, property, input.unit_type_id ?? null, input.persons,
     input.valid_from ?? null, input.valid_to ?? null],
  );
  if (clash) return null;

  const id = crypto.randomUUID();
  await sql.run(
    `INSERT INTO price_occupancy
       (id, organization_id, property_id, unit_type_id, persons, price_gross, valid_from, valid_to, label)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, organizationId, property, input.unit_type_id ?? null, input.persons,
     input.price_gross, input.valid_from ?? null, input.valid_to ?? null, input.label ?? null],
  );
  return id;
}

/**
 * Change a price.
 *
 * Only the amount and the label. Moving a row to a different occupancy or a
 * different season is not an edit — it is a different price, and offering it
 * as one turns a typo into a silent repricing of everything already quoted at
 * the old coordinates.
 */
export async function updatePrice(id: string, priceGross: number, label?: string | null): Promise<boolean> {
  const organizationId = await requireOrganizationId();
  const res = await getSql().run(
    'UPDATE price_occupancy SET price_gross = ?, label = ?, updated_at = ? WHERE id = ? AND organization_id = ?',
    [priceGross, label ?? null, nowIso(), id, organizationId],
  );
  return res.changes > 0;
}

export async function deletePrice(id: string): Promise<boolean> {
  const organizationId = await requireOrganizationId();
  const res = await getSql().run(
    'DELETE FROM price_occupancy WHERE id = ? AND organization_id = ?', [id, organizationId]);
  return res.changes > 0;
}

export interface TierInput {
  unit_type_id?: string | null;
  min_nights: number;
  adjustment_gross: number;
  persons?: number | null;
  label?: string | null;
}

/** Add a length-of-stay tier. Returns null when an identical one exists. */
export async function createTier(propertyId: string | null | undefined, input: TierInput): Promise<string | null> {
  const organizationId = await requireOrganizationId();
  const property = await requirePropertyId(propertyId);
  const sql = getSql();

  const clash = await sql.row<any>(
    `SELECT id FROM price_los_tiers
      WHERE organization_id = ? AND property_id = ?
        AND COALESCE(unit_type_id, '') = COALESCE(?, '')
        AND min_nights = ?
        AND COALESCE(persons, -1) = COALESCE(?, -1)`,
    [organizationId, property, input.unit_type_id ?? null, input.min_nights, input.persons ?? null],
  );
  if (clash) return null;

  const id = crypto.randomUUID();
  await sql.run(
    `INSERT INTO price_los_tiers
       (id, organization_id, property_id, unit_type_id, min_nights, adjustment_gross, persons, label)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, organizationId, property, input.unit_type_id ?? null, input.min_nights,
     input.adjustment_gross, input.persons ?? null, input.label ?? null],
  );
  return id;
}

export async function updateTier(id: string, adjustmentGross: number, label?: string | null): Promise<boolean> {
  const organizationId = await requireOrganizationId();
  const res = await getSql().run(
    'UPDATE price_los_tiers SET adjustment_gross = ?, label = ?, updated_at = ? WHERE id = ? AND organization_id = ?',
    [adjustmentGross, label ?? null, nowIso(), id, organizationId],
  );
  return res.changes > 0;
}

export async function deleteTier(id: string): Promise<boolean> {
  const organizationId = await requireOrganizationId();
  const res = await getSql().run(
    'DELETE FROM price_los_tiers WHERE id = ? AND organization_id = ?', [id, organizationId]);
  return res.changes > 0;
}

/**
 * A calendar day as the domain compares it: 'YYYY-MM-DD'.
 *
 * SQLite hands back the string that was stored; the Postgres driver hands back
 * a Date built in the server's zone, and `new Date('2026-07-01').toISOString()`
 * in a zone west of UTC is 2026-06-30. A season would start a day early on one
 * driver and not the other.
 */
function day(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(v).slice(0, 10);
}

/** SQLite wants a string in these TEXT columns; Postgres casts it to timestamptz. */
function nowIso(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}
