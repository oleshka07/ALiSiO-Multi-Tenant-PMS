/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { getDb } from '@core/db';
import { withActor, type Actor } from '@core/auth/session';

/**
 * The first screen after logging in — arrivals, departures, occupancy.
 *
 * None of it was scoped. Every hotel saw the same numbers: today's arrivals
 * across the whole server, an occupancy percentage computed from everyone's
 * units, and a list of upcoming guests with names. reservations and units
 * reach their organization through property_id.
 */
const OWN = (alias = '') => `${alias}property_id IN (SELECT id FROM properties WHERE organization_id = ?)`;

export const getDashboard = withActor(async (_request, _ctx, actor: Actor) => {
  try {
    const db = getDb();
    const org = actor.organizationId;
    const today = new Date().toISOString().split('T')[0];

    const arrivals = db.prepare(
      `SELECT COUNT(*) as cnt FROM reservations WHERE ${OWN()} AND check_in = ? AND status IN ('confirmed', 'tentative')`
    ).get(org, today) as any;

    const departures = db.prepare(
      `SELECT COUNT(*) as cnt FROM reservations WHERE ${OWN()} AND check_out = ? AND status IN ('checked_in')`
    ).get(org, today) as any;

    const totalUnits = db.prepare(
      `SELECT COUNT(*) as cnt FROM units WHERE ${OWN()} AND is_active = 1 AND is_pool = 0`
    ).get(org) as any;

    const occupied = db.prepare(
      `SELECT COUNT(DISTINCT r.unit_id) as cnt FROM reservations r JOIN units u ON u.id = r.unit_id WHERE ${OWN('r.')} AND r.check_in <= ? AND r.check_out > ? AND r.status IN ('checked_in', 'confirmed') AND u.is_pool = 0`
    ).get(org, today, today) as any;

    const totalCount = totalUnits?.cnt || 0;
    const occupiedCount = occupied?.cnt || 0;
    const occupancyRate = totalCount > 0 ? Math.round((occupiedCount / totalCount) * 100) : 0;

    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 3);
    const future = futureDate.toISOString().split('T')[0];

    const upcomingArrivals = db.prepare(`
      SELECT r.id, r.check_in, r.check_out, r.nights, r.adults, r.children, r.status,
        g.first_name, g.last_name,
        u.name as unit_name, u.code as unit_code
      FROM reservations r
      JOIN guests g ON r.guest_id = g.id
      JOIN units u ON r.unit_id = u.id
      WHERE ${OWN('r.')} AND r.check_in BETWEEN ? AND ? AND r.status IN ('confirmed', 'tentative')
      ORDER BY r.check_in
      LIMIT 10
    `).all(org, today, future) || [];

    const todayDepartures = db.prepare(`
      SELECT r.id, r.check_out, r.status,
        g.first_name, g.last_name,
        u.name as unit_name, u.code as unit_code, u.cleaning_status
      FROM reservations r
      JOIN guests g ON r.guest_id = g.id
      JOIN units u ON r.unit_id = u.id
      WHERE ${OWN('r.')} AND r.check_out = ? AND r.status IN ('checked_in', 'confirmed')
      ORDER BY u.name
    `).all(org, today) || [];

    return NextResponse.json({
      arrivalsToday: arrivals?.cnt || 0,
      departuresToday: departures?.cnt || 0,
      occupancyRate,
      freeUnits: totalCount - occupiedCount,
      totalUnits: totalCount,
      upcomingArrivals,
      todayDepartures,
    });
  } catch (error: any) {
    console.error('GET /api/dashboard error:', error?.message || error);
    return NextResponse.json({
      arrivalsToday: 0, departuresToday: 0, occupancyRate: 0,
      freeUnits: 0, totalUnits: 0, upcomingArrivals: [], todayDepartures: [],
      error: error?.message || 'Failed to fetch dashboard stats',
    });
  }
});
