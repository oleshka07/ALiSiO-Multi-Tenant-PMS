/* eslint-disable @typescript-eslint/no-explicit-any */
import { getDb } from '@core/db';
import type { DayPrice, PriceUpsertInput } from '../domain/types';

export function getPriceMonth(unitTypeId: string, month: number, year: number): { unitTypeId: string; month: number; year: number; days: DayPrice[] } {
  const db = getDb();
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  const rows = db.prepare(`
    SELECT * FROM price_calendar
    WHERE unit_type_id = ? AND date >= ? AND date <= ?
    ORDER BY date ASC
  `).all(unitTypeId, startDate, endDate);

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

export function upsertPrices(unitTypeId: string, prices: PriceUpsertInput[]): number {
  const db = getDb();
  const stmt = db.prepare(`
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
      updated_at = datetime('now')
  `);

  db.transaction(() => {
    for (const p of prices) {
      stmt.run(unitTypeId, p.date, p.base_price ?? 0, p.weekend_price ?? null, p.min_stay ?? 1, p.max_stay ?? null, p.closed ? 1 : 0, p.cta ? 1 : 0, p.ctd ? 1 : 0);
    }
  })();

  return prices.length;
}

export function getBulkPrices(startDate: string, endDate: string) {
  return getDb().prepare(`
    SELECT unit_type_id, date, base_price, weekend_price,
      CASE
        WHEN (CAST(strftime('%w', date) AS INTEGER) IN (0, 5, 6)) AND weekend_price IS NOT NULL
        THEN weekend_price
        ELSE base_price
      END as effective_price
    FROM price_calendar
    WHERE date >= ? AND date <= ?
    ORDER BY unit_type_id, date
  `).all(startDate, endDate);
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

export function bulkUpdatePrices(input: BulkUpdateInput): number {
  const db = getDb();
  const { unitTypeId, dateFrom, dateTo, applyTo = 'all' } = input;

  const upsert = db.prepare(`
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
      updated_at = datetime('now')
  `);

  const getExisting = db.prepare('SELECT * FROM price_calendar WHERE unit_type_id = ? AND date = ?');

  let count = 0;
  const start = new Date(dateFrom);
  const end = new Date(dateTo);

  db.transaction(() => {
    const current = new Date(start);
    while (current <= end) {
      const dateStr = current.toISOString().split('T')[0];
      const dayOfWeek = current.getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 5 || dayOfWeek === 6;

      if (applyTo === 'weekdays' && isWeekend) { current.setDate(current.getDate() + 1); continue; }
      if (applyTo === 'weekends' && !isWeekend) { current.setDate(current.getDate() + 1); continue; }

      const existing = getExisting.get(unitTypeId, dateStr) as any;
      const basePrice = input.base_price ?? existing?.base_price ?? 0;
      const weekendPrice = input.weekend_price !== undefined ? input.weekend_price : (existing?.weekend_price ?? null);
      const minStay = input.min_stay ?? existing?.min_stay ?? 1;
      const maxStay = input.max_stay !== undefined ? input.max_stay : (existing?.max_stay ?? null);
      const closed = input.closed !== undefined ? (input.closed ? 1 : 0) : (existing?.closed ?? 0);
      const cta = input.cta !== undefined ? (input.cta ? 1 : 0) : (existing?.cta ?? 0);
      const ctd = input.ctd !== undefined ? (input.ctd ? 1 : 0) : (existing?.ctd ?? 0);

      upsert.run(unitTypeId, dateStr, basePrice, weekendPrice, minStay, maxStay, closed, cta, ctd);
      count++;
      current.setDate(current.getDate() + 1);
    }
  })();

  return count;
}
