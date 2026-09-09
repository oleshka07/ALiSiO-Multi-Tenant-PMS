/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { todayFor, shiftMonths } from '@core/hotel-day';
import type { Actor } from '@core/auth/session';
import { handleError } from '@core/http/errors';
import { requestPropertyScope } from '@core/auth/property-scope';
import { propertyScopeFilter } from '@core/property-scope';

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
    // Наступний місяць рахує shiftMonths, а не `new Date(y, m, 1)`.
    //
    // Той конструктор бере ЛОКАЛЬНИЙ час, а .toISOString() переводить його в
    // UTC: під TZ=Europe/Prague перше вересня ставало 31 серпня 22:00Z, і
    // endDate виходив '2026-08-31' замість '2026-09-01'. Тобто зі звіту, який
    // подають у міську раду, зникали заїзди останнього дня місяця. На проді
    // спить, бо контейнер стоїть в UTC, — і саме тому це знайшли б лише коли
    // хтось запустив би сервер у своєму поясі.
    const endDate = shiftMonths(startDate, 1);

    // Область обʼєкта (INC-037, той самий рід у сусідньому звіті). Це число
    // ПОДАЮТЬ у міську раду, і подання робиться по закладу: сума по двох
    // обʼєктах не є звітом жодного з них. Осі тут не було взагалі — лише
    // `OWN('r.')`, тобто вісь орендаря, яка означає «усі обʼєкти рахунку».
    // «Усі» лишається законним (власник двох готелів дивиться зведено), але
    // тепер це СКАЗАНЕ значення, а не те, що вийшло.
    const scope = await requestPropertyScope(request, org);
    const axis = propertyScopeFilter(scope, 'r');

    const bookings = await sql.rows<any>(`
      SELECT
        r.id, r.check_in, r.check_out, r.nights, r.adults, r.children, r.status,
        r.source, r.total_price, r.city_tax_amount, r.city_tax_included, r.city_tax_paid,
        g.first_name, g.last_name,
        u.name as unit_name,
        c.type as category_type
      FROM reservations r
      JOIN guests g ON r.guest_id = g.id
      LEFT JOIN units u ON r.unit_id = u.id
      LEFT JOIN categories c ON u.category_id = c.id
      WHERE ${OWN('r.')} AND ${axis.sql}
        AND r.status NOT IN ('cancelled', 'no_show')
        AND r.check_in < ? AND r.check_out > ?
      ORDER BY r.check_in
    `, [org, ...axis.params, endDate, startDate]);

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
    // `handleError`: чужий обʼєкт у параметрі — це названа 404, а не 500.
    return handleError('modules/reports/api/city-tax getCityTaxReport', e);
  }
}
