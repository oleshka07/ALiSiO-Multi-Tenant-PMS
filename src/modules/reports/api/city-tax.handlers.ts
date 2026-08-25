/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { todayFor } from '@core/hotel-day';
import type { Actor } from '@core/auth/session';
import { serverError } from '@core/http/errors';

/** reservations reach an organization through property_id — see reports.handlers.ts. */
const OWN = (alias = '') => `${alias}property_id IN (SELECT id FROM properties WHERE organization_id = ?)`;

export async function getCityTaxReport(request: Request, _ctx: unknown, actor: Actor) {
  try {
    const sql = getSql();
    const org = actor.organizationId;
    const { searchParams } = new URL(request.url);
    // «This month» at the hotel. In UTC, the first hours of the 1st of a
    // month still belonged to the previous one — and this report is filed
    // with the municipality.
    const month = searchParams.get('month') || (await todayFor(org)).slice(0, 7);

    const startDate = `${month}-01`;
    const [y, m] = month.split('-').map(Number);
    const endDate = new Date(y, m, 1).toISOString().split('T')[0];

    const bookings = await sql.rows<any>(`
      SELECT
        r.id, r.check_in, r.check_out, r.nights, r.adults, r.children, r.status,
        r.source, r.total_price, r.city_tax_amount, r.city_tax_included, r.city_tax_paid,
        g.first_name, g.last_name,
        u.name as unit_name,
        c.type as category_type
      FROM reservations r
      JOIN guests g ON r.guest_id = g.id
      JOIN units u ON r.unit_id = u.id
      JOIN categories c ON u.category_id = c.id
      WHERE ${OWN('r.')}
        AND r.status NOT IN ('cancelled', 'no_show')
        AND r.check_in < ? AND r.check_out > ?
      ORDER BY r.check_in
    `, [org, endDate, startDate]);

    const totalGuests = bookings.reduce((s: number, b: any) => s + (b.adults || 0), 0);
    const totalTaxAmount = bookings.reduce((s: number, b: any) => s + (b.city_tax_amount || 0), 0);
    const totalTaxPaid = bookings.filter((b: any) => b.city_tax_paid === 'paid').reduce((s: number, b: any) => s + (b.city_tax_amount || 0), 0);
    const totalTaxPending = bookings.filter((b: any) => b.city_tax_paid === 'pending').reduce((s: number, b: any) => s + (b.city_tax_amount || 0), 0);
    const totalTaxIncluded = bookings.filter((b: any) => b.city_tax_included).reduce((s: number, b: any) => s + (b.city_tax_amount || 0), 0);
    const totalTaxNotIncluded = totalTaxAmount - totalTaxIncluded;

    const bySource: Record<string, { count: number; amount: number; paid: number; pending: number }> = {};
    for (const b of bookings as any[]) {
      const src = b.source || 'direct';
      if (!bySource[src]) bySource[src] = { count: 0, amount: 0, paid: 0, pending: 0 };
      bySource[src].count++;
      bySource[src].amount += b.city_tax_amount || 0;
      if (b.city_tax_paid === 'paid') bySource[src].paid += b.city_tax_amount || 0;
      if (b.city_tax_paid === 'pending') bySource[src].pending += b.city_tax_amount || 0;
    }

    return NextResponse.json({
      month, totalBookings: bookings.length, totalGuests,
      totalTaxAmount, totalTaxPaid, totalTaxPending, totalTaxIncluded, totalTaxNotIncluded,
      bySource, bookings,
    });
  } catch (e: any) {
    return serverError('modules/reports/api/city-tax getCityTaxReport', e);
  }
}
