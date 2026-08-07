/* eslint-disable @typescript-eslint/no-explicit-any */
import { getSql } from '@core/db/async';
import type { QuoteResult } from '../domain/types';

export async function calculateQuote(unitTypeId: string, checkIn: string, checkOut: string, adults = 2, children = 0): Promise<QuoteResult> {
  const sql = getSql();

  const prices = await sql.rows<any>(`
    SELECT * FROM price_calendar
    WHERE unit_type_id = ? AND date >= ? AND date < ?
    ORDER BY date ASC
  `, [unitTypeId, checkIn, checkOut]) as any[];

  const priceMap = new Map<string, any>();
  for (const p of prices) priceMap.set(p.date, p);

  const start = new Date(checkIn);
  const end = new Date(checkOut);
  const nightsTotal = Math.round((end.getTime() - start.getTime()) / 86400000);

  const dayNames = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  const breakdown: QuoteResult['breakdown'] = [];
  let accommodationTotal = 0;
  let missingDays = 0;

  const current = new Date(start);
  for (let i = 0; i < nightsTotal; i++) {
    const dateStr = current.toISOString().split('T')[0];
    const dayOfWeek = current.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 5 || dayOfWeek === 6;
    const entry = priceMap.get(dateStr);
    let dayPrice = 0;

    if (entry) {
      dayPrice = isWeekend && entry.weekend_price != null ? entry.weekend_price : entry.base_price;
    } else {
      missingDays++;
    }

    breakdown.push({ date: dateStr, dayName: dayNames[dayOfWeek], price: dayPrice, isWeekend });
    accommodationTotal += dayPrice;
    current.setDate(current.getDate() + 1);
  }

  // Fees & taxes
  let fees: any[] = [];
  try {
    // The fees are the ones belonging to the unit type being quoted. Reading
    // them from the first property in the table priced one hotel's stay with
    // another hotel's city tax and cleaning fee.
    const prop = await sql.row<any>('SELECT property_id AS id FROM unit_types WHERE id = ?', [unitTypeId]) as any;
    if (prop?.id) {
      fees = await sql.rows<any>('SELECT * FROM fees_taxes WHERE property_id = ? AND is_active = TRUE', [prop.id]) as any[];
    }
  } catch { /* fees_taxes may not exist */ }

  const feeBreakdown: QuoteResult['feeBreakdown'] = [];
  let feesTotal = 0;
  const totalGuests = adults + children;

  for (const fee of fees) {
    let amount = 0;
    switch (fee.type) {
      case 'per_stay': amount = fee.amount; break;
      case 'per_night': amount = fee.amount * nightsTotal; break;
      case 'per_person': amount = fee.amount * totalGuests; break;
      case 'per_person_per_night': amount = fee.amount * adults * nightsTotal; break;
      case 'percentage': amount = Math.round(accommodationTotal * fee.amount / 100); break;
    }
    if (amount > 0) { feeBreakdown.push({ name: fee.name, amount }); feesTotal += amount; }
  }

  return { unitTypeId, checkIn, checkOut, nights: nightsTotal, adults, children, breakdown, accommodationTotal, feeBreakdown, feesTotal, total: accommodationTotal + feesTotal, currency: 'CZK', missingDays, hasPricing: missingDays < nightsTotal };
}
