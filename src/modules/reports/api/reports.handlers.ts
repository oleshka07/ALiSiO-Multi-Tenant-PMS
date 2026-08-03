/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import type { Actor } from '@core/auth/session';

/**
 * reservations and units carry no organization_id — they reach one through
 * property_id. Every query here uses the same fragment so "mine" cannot come
 * to mean two different things in two places.
 */
const OWN = (alias = '') => `${alias}property_id IN (SELECT id FROM properties WHERE organization_id = ?)`;

export async function getReport(request: NextRequest, _ctx: unknown, actor: Actor) {
  try {
    const sql = getSql();
    const org = actor.organizationId;
    const { searchParams } = new URL(request.url);
    const from = searchParams.get('from') || new Date().toISOString().split('T')[0];
    const to = searchParams.get('to') || new Date().toISOString().split('T')[0];

    const bookings = await sql.rows<any>(`
      SELECT r.*, u.name as unit_name, c.type as category_type,
             g.first_name, g.last_name
      FROM reservations r
      JOIN units u ON r.unit_id = u.id
      JOIN categories c ON u.category_id = c.id
      JOIN guests g ON r.guest_id = g.id
      WHERE ${OWN('r.')}
        AND r.check_in BETWEEN ? AND ?
        AND r.status != 'cancelled'
    `, [org, from, to]);

    const totalBookings = bookings.length;
    const totalGuests = bookings.reduce((s: number, b: any) => s + b.adults + b.children, 0);
    const totalRevenue = bookings.reduce((s: number, b: any) => s + (b.total_price || 0), 0);

    const revenueByCategory: Record<string, { bookings: number; revenue: number; nights: number }> = {};
    for (const b of bookings) {
      const cat = b.category_type || 'other';
      if (!revenueByCategory[cat]) revenueByCategory[cat] = { bookings: 0, revenue: 0, nights: 0 };
      revenueByCategory[cat].bookings++;
      revenueByCategory[cat].revenue += b.total_price || 0;
      revenueByCategory[cat].nights += b.nights || 0;
    }

    const totalCommission = bookings.reduce((s: number, b: any) => s + (b.commission_amount || 0), 0);
    const netRevenue = totalRevenue - totalCommission;

    const revenueBySource: Record<string, { bookings: number; revenue: number; commission: number }> = {};
    for (const b of bookings) {
      const src = b.source || 'direct';
      if (!revenueBySource[src]) revenueBySource[src] = { bookings: 0, revenue: 0, commission: 0 };
      revenueBySource[src].bookings++;
      revenueBySource[src].revenue += b.total_price || 0;
      revenueBySource[src].commission += b.commission_amount || 0;
    }

    // PR #6: read reservation-linked payments from fin_operations (income minus refunds).
    const payments = await sql.rows<any>(`
      SELECT method, amount, op_type, payment_subtype
      FROM fin_operations
      WHERE organization_id = ?
        AND reservation_id IS NOT NULL AND status = 'completed'
        AND paid_at BETWEEN ? AND ?
    `, [org, from, to]);

    const totalPayments = payments.reduce((s: number, p: any) => {
      const signed = p.op_type === 'expense' && p.payment_subtype === 'refund' ? -p.amount : p.amount;
      return s + signed;
    }, 0);
    const paymentsByMethod: Record<string, number> = {};
    for (const p of payments) {
      const signed = p.op_type === 'expense' && p.payment_subtype === 'refund' ? -p.amount : p.amount;
      const key = p.method || 'unknown';
      paymentsByMethod[key] = (paymentsByMethod[key] || 0) + signed;
    }

    const unitCount = await sql.row<any>(`SELECT COUNT(*) as cnt FROM units WHERE ${OWN()}`, [org]);
    const totalUnits = unitCount?.cnt || 0;
    const fromDate = new Date(from);
    const toDate = new Date(to);
    const totalDays = Math.max(1, Math.ceil((toDate.getTime() - fromDate.getTime()) / 86400000) + 1);
    const totalUnitDays = totalUnits * totalDays;

    let bookedUnitDays = 0;
    const allBookings = await sql.rows<any>(`
      SELECT unit_id, check_in, check_out FROM reservations
      WHERE ${OWN()}
        AND check_out > ? AND check_in <= ? AND status NOT IN ('cancelled', 'draft')
    `, [org, from, to]);

    for (let d = new Date(fromDate); d <= toDate; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];
      const occupiedUnits = new Set(
        allBookings.filter((b: any) => dateStr >= b.check_in && dateStr < b.check_out).map((b: any) => b.unit_id)
      );
      bookedUnitDays += occupiedUnits.size;
    }

    const occupancyPct = totalUnitDays > 0 ? Math.round((bookedUnitDays / totalUnitDays) * 100) : 0;
    const avgCheck = totalBookings > 0 ? Math.round(totalRevenue / totalBookings) : 0;

    return NextResponse.json({
      period: { from, to, days: totalDays },
      summary: { totalBookings, totalGuests, totalRevenue, totalCommission, netRevenue, totalPayments, occupancyPct, avgCheck },
      revenueByCategory, revenueBySource, paymentsByMethod,
    });
  } catch (error) {
    console.error('GET /api/reports error:', error);
    return NextResponse.json({ error: 'Failed to generate report' }, { status: 500 });
  }
}
