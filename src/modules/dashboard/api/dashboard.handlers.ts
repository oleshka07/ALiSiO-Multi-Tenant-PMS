/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { withActor, type Actor } from '@core/auth/session';
import { todayFor, shiftDays } from '@core/hotel-day';
import { occupancyOnDay } from '@core/occupancy-rate';

/**
 * The first screen after logging in — arrivals, departures, occupancy.
 *
 * FIRST MODULE ON THE ASYNCHRONOUS SEAM. Every query here goes through `Sql`
 * (core/db/async.ts) instead of better-sqlite3 directly. It still runs on
 * SQLite today — the point is that the CALL SHAPE is now the one Postgres
 * needs, so this module is ready before the driver exists. The rest follow
 * one at a time; see docs/ARCHITECTURE.md §8.
 *
 * None of it was scoped. Every hotel saw the same numbers: today's arrivals
 * across the whole server, an occupancy percentage computed from everyone's
 * units, and a list of upcoming guests with names. reservations and units
 * reach their organization through property_id.
 */
const OWN = (alias = '') => `${alias}property_id IN (SELECT id FROM properties WHERE organization_id = ?)`;

export const getDashboard = withActor(async (request: NextRequest, _ctx, actor: Actor) => {
  try {
    const sql = getSql();
    const org = actor.organizationId;
    // Область обʼєкта (BUILD-PLAN, Блок 1): обраний обʼєкт звужує дашборд,
    // «Усі обʼєкти» рахує організацію цілком і підписує рядки готелем.
    // Чужий id дає порожньо: організація стоїть у кожному WHERE і без нього.
    const propertyFilter = new URL(request.url).searchParams.get('property_id') || '';
    const scope = (alias = '') => (propertyFilter ? `${OWN(alias)} AND ${alias}property_id = ?` : OWN(alias));
    const scoped = (...rest: unknown[]) => (propertyFilter ? [org, propertyFilter, ...rest] : [org, ...rest]);
    // The hotel's day, not the server's. `toISOString()` is UTC, so between
    // midnight and 01:00–03:00 local a Prague or Kyiv hotel saw yesterday's
    // arrivals, yesterday's departures and yesterday's occupancy — every
    // night, at the exact hour a night receptionist starts their shift.
    const today = await todayFor(org);

    const arrivals = await sql.row<any>(`SELECT COUNT(*) as cnt FROM reservations WHERE ${scope()} AND check_in = ? AND status IN ('confirmed', 'tentative')`, scoped(today));

    const departures = await sql.row<any>(`SELECT COUNT(*) as cnt FROM reservations WHERE ${scope()} AND check_out = ? AND status IN ('checked_in')`, scoped(today));

    // Завантаженість рахує `@core/occupancy-rate`, і ці два запити навмисно не
    // фільтрують ані юнітів, ані статусів. Тут стояв власний COUNT з власним
    // набором статусів (checked_in + confirmed), а у звіті — інший, і власник
    // бачив за один день два різних відсотки (AUDIT.md §2.9). Щойно фільтр
    // повертається в SQL, повертається й розходження: у чисельнику бракувало
    // `tentative`, тобто номер, який уже не можна продати, показувався вільним.
    const unitRows = await sql.rows<any>(`SELECT id, is_active, is_pool FROM units WHERE ${scope()}`, scoped());

    const stayRows = await sql.rows<any>(`SELECT unit_id, check_in, check_out, status FROM reservations WHERE ${scope()} AND check_in <= ? AND check_out > ?`, scoped(today, today));

    const occ = occupancyOnDay(unitRows, stayRows, today);

    const future = shiftDays(today, 3);

    const upcomingArrivals = (await sql.rows<any>(`
      SELECT r.id, r.check_in, r.check_out, r.nights, r.adults, r.children, r.status,
        g.first_name, g.last_name,
        u.name as unit_name, u.code as unit_code,
        r.property_id, p.name as property_name
      FROM reservations r
      JOIN guests g ON r.guest_id = g.id
      LEFT JOIN units u ON r.unit_id = u.id
      JOIN properties p ON p.id = r.property_id
      WHERE ${scope('r.')} AND r.check_in BETWEEN ? AND ? AND r.status IN ('confirmed', 'tentative')
      ORDER BY r.check_in
      LIMIT 10
    `, scoped(today, future)));

    const todayDepartures = (await sql.rows<any>(`
      SELECT r.id, r.check_out, r.status,
        g.first_name, g.last_name,
        u.name as unit_name, u.code as unit_code, u.cleaning_status,
        r.property_id, p.name as property_name
      FROM reservations r
      JOIN guests g ON r.guest_id = g.id
      LEFT JOIN units u ON r.unit_id = u.id
      JOIN properties p ON p.id = r.property_id
      WHERE ${scope('r.')} AND r.check_out = ? AND r.status IN ('checked_in', 'confirmed')
      ORDER BY u.name
    `, scoped(today)));

    return NextResponse.json({
      arrivalsToday: arrivals?.cnt || 0,
      departuresToday: departures?.cnt || 0,
      occupancyRate: occ.rate,
      freeUnits: occ.freeUnits,
      totalUnits: occ.sellableUnits,
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
