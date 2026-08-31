/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { todayFor } from '@core/hotel-day';
import { occupancy } from '@core/occupancy-rate';
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
    // Defaulting to «today» means the hotel's today, not the server's.
    const hotelToday = await todayFor(org);
    const from = searchParams.get('from') || hotelToday;
    const to = searchParams.get('to') || hotelToday;

    const bookings = await sql.rows<any>(`
      SELECT r.*, u.name as unit_name, c.type as category_type,
             g.first_name, g.last_name
      FROM reservations r
      LEFT JOIN units u ON r.unit_id = u.id
      LEFT JOIN categories c ON u.category_id = c.id
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

    // Завантаженість рахує `@core/occupancy-rate` — та сама функція, що й на
    // дашборді. Тут стояла власна копія: знаменник по ВСІХ юнітах (разом із
    // знятими з продажу і з віртуальним pool-юнітом «Чорновик»), чисельник по
    // всіх статусах, крім cancelled і draft. Готель на 10 номерів мав
    // знаменник 12 і недосяжні 100 %, а no_show — броня, з якої ніхто не
    // ночував, — рахувалася зайнятим номером (AUDIT.md §2.9).
    //
    // Запити свідомо не фільтрують ані юнітів, ані статусів: правило «що
    // продається» і «що зайняте» живе в одному місці, інакше дві копії знову
    // розійдуться. Вікно `check_out > from AND check_in <= to` — не частина
    // формули, а спосіб не тягнути в памʼять усю історію готелю.
    const unitRows = await sql.rows<any>(`SELECT id, is_active, is_pool FROM units WHERE ${OWN()}`, [org]);

    const stayRows = await sql.rows<any>(`
      SELECT unit_id, check_in, check_out, status FROM reservations
      WHERE ${OWN()}
        AND check_out > ? AND check_in <= ?
    `, [org, from, to]);

    const occ = occupancy(unitRows, stayRows, from, to);
    const totalDays = occ.days;
    const occupancyPct = occ.rate;
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
