/* eslint-disable @typescript-eslint/no-explicit-any */
import { getSql } from '@core/db/async';
import type { DayPrice, PriceUpsertInput } from '../domain/types';

export async function getPriceMonth(unitTypeId: string, month: number, year: number): Promise<{ unitTypeId: string; month: number; year: number; days: DayPrice[] }> {
  const sql = getSql();
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  const rows = await sql.rows<any>(`
    SELECT * FROM price_calendar
    WHERE unit_type_id = ? AND date >= ? AND date <= ?
    ORDER BY date ASC
  `, [unitTypeId, startDate, endDate]);

  const priceMap = new Map<string, any>();
  for (const row of rows as any[]) priceMap.set(row.date, row);

  const days: DayPrice[] = [];
  for (let d = 1; d <= lastDay; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dayOfWeek = new Date(year, month - 1, d).getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 5 || dayOfWeek === 6;
    const existing = priceMap.get(dateStr);

    if (existing) {
      days.push({
        date: dateStr, day: d, dayOfWeek, isWeekend,
        base_price: existing.base_price,
        weekend_price: existing.weekend_price,
        effective_price: isWeekend && existing.weekend_price != null ? existing.weekend_price : existing.base_price,
        min_stay: existing.min_stay,
        max_stay: existing.max_stay,
        closed: existing.closed,
        cta: existing.cta,
        ctd: existing.ctd,
        hasData: true,
      });
    } else {
      days.push({ date: dateStr, day: d, dayOfWeek, isWeekend, base_price: 0, weekend_price: null, effective_price: 0, min_stay: 1, max_stay: null, closed: 0, cta: 0, ctd: 0, hasData: false });
    }
  }

  return { unitTypeId, month, year, days };
}

export async function upsertPrices(unitTypeId: string, prices: PriceUpsertInput[]): Promise<number> {
  const sql = getSql();
  await sql.tx(async (t) => {
    for (const p of prices) {
      await t.run(`
      INSERT INTO price_calendar (id, unit_type_id, date, base_price, weekend_price, min_stay, max_stay, closed, cta, ctd)
      VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(unit_type_id, date) DO UPDATE SET
        base_price = excluded.base_price,
        weekend_price = excluded.weekend_price,
        min_stay = excluded.min_stay,
        max_stay = excluded.max_stay,
        closed = excluded.closed,
        cta = excluded.cta,
        ctd = excluded.ctd,
        updated_at = CURRENT_TIMESTAMP
      `, [unitTypeId, p.date, p.base_price ?? 0, p.weekend_price ?? null, p.min_stay ?? 1, p.max_stay ?? null, p.closed ? 1 : 0, p.cta ? 1 : 0, p.ctd ? 1 : 0]);
    }
  });

  return prices.length;
}

export async function getBulkPrices(organizationId: string, startDate: string, endDate: string) {
  const sql = getSql();
  return await sql.rows<any>(`
    SELECT pc.unit_type_id, pc.date, pc.base_price, pc.weekend_price,
      CASE
        WHEN (${sql.dialect.dayOfWeek('pc.date')} IN (0, 5, 6)) AND pc.weekend_price IS NOT NULL
        THEN pc.weekend_price
        ELSE pc.base_price
      END as effective_price
    FROM price_calendar pc
    JOIN unit_types ut ON pc.unit_type_id = ut.id
    JOIN properties p ON ut.property_id = p.id
    WHERE p.organization_id = ? AND pc.date >= ? AND pc.date <= ?
    ORDER BY pc.unit_type_id, pc.date
  `, [organizationId, startDate, endDate]);
}

export interface BulkUpdateInput {
  unitTypeId: string;
  dateFrom: string;
  dateTo: string;
  applyTo?: 'all' | 'weekdays' | 'weekends';
  base_price?: number;
  weekend_price?: number | null;
  min_stay?: number;
  max_stay?: number | null;
  closed?: boolean;
  cta?: boolean;
  ctd?: boolean;
}

export async function bulkUpdatePrices(input: BulkUpdateInput): Promise<number> {
  const sql = getSql();
  const { unitTypeId, dateFrom, dateTo, applyTo = 'all' } = input;

  let count = 0;
  const start = new Date(dateFrom);
  const end = new Date(dateTo);

  await sql.tx(async (t) => {
    const current = new Date(start);
    while (current <= end) {
      const dateStr = current.toISOString().split('T')[0];
      const dayOfWeek = current.getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 5 || dayOfWeek === 6;

      if (applyTo === 'weekdays' && isWeekend) { current.setDate(current.getDate() + 1); continue; }
      if (applyTo === 'weekends' && !isWeekend) { current.setDate(current.getDate() + 1); continue; }

      const existing = await t.row<any>('SELECT * FROM price_calendar WHERE unit_type_id = ? AND date = ?', [unitTypeId, dateStr]);
      const basePrice = input.base_price ?? existing?.base_price ?? 0;
      const weekendPrice = input.weekend_price !== undefined ? input.weekend_price : (existing?.weekend_price ?? null);
      const minStay = input.min_stay ?? existing?.min_stay ?? 1;
      const maxStay = input.max_stay !== undefined ? input.max_stay : (existing?.max_stay ?? null);
      const closed = input.closed !== undefined ? (input.closed ? 1 : 0) : (existing?.closed ?? 0);
      const cta = input.cta !== undefined ? (input.cta ? 1 : 0) : (existing?.cta ?? 0);
      const ctd = input.ctd !== undefined ? (input.ctd ? 1 : 0) : (existing?.ctd ?? 0);

      await t.run(`
      INSERT INTO price_calendar (id, unit_type_id, date, base_price, weekend_price, min_stay, max_stay, closed, cta, ctd)
      VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(unit_type_id, date) DO UPDATE SET
        base_price = excluded.base_price,
        weekend_price = excluded.weekend_price,
        min_stay = excluded.min_stay,
        max_stay = excluded.max_stay,
        closed = excluded.closed,
        cta = excluded.cta,
        ctd = excluded.ctd,
        updated_at = CURRENT_TIMESTAMP
      `, [unitTypeId, dateStr, basePrice, weekendPrice, minStay, maxStay, closed, cta, ctd]);
      count++;
      current.setDate(current.getDate() + 1);
    }
  });

  return count;
}
