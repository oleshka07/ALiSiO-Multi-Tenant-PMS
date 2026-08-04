/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import type { Actor } from '@core/auth/session';

/**
 * reservations reach an organization through property_id. Every query here uses
 * the same fragment — including the auto-archive UPDATE, which without it marks
 * every other hotel's confirmed bookings as no_show.
 */
const OWN = (alias = '') => `${alias}property_id IN (SELECT id FROM properties WHERE organization_id = ?)`;

export async function getAlerts(_request: Request, _ctx: unknown, actor: Actor) {
  try {
    const sql = getSql();
    const org = actor.organizationId;
    const today = new Date().toISOString().split('T')[0];

    // Auto-archive: confirmed bookings with check_in > 7 days ago → no_show
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const archiveCutoff = sevenDaysAgo.toISOString().split('T')[0];

    await sql.run(`
      UPDATE reservations
      SET status = 'no_show', updated_at = CURRENT_TIMESTAMP
      WHERE ${OWN()} AND check_in < ? AND status = 'confirmed'
    `, [org, archiveCutoff]);

    const alerts: { type: string; severity: 'warning' | 'danger' | 'info'; message: string; bookingId: string; guestName: string }[] = [];

    // Overdue arrivals: confirmed with check_in in the past, but within 7 days
    const overdueArrivals = await sql.rows<any>(`
      SELECT r.id, r.check_in, u.name as unit_name, g.first_name, g.last_name
      FROM reservations r
      JOIN guests g ON r.guest_id = g.id
      JOIN units u ON r.unit_id = u.id
      WHERE ${OWN('r.')} AND r.check_in < ? AND r.check_in >= ? AND r.status = 'confirmed'
      ORDER BY r.check_in DESC
    `, [org, today, archiveCutoff]);

    for (const r of overdueArrivals) {
      alerts.push({
        type: 'overdue_arrival', severity: 'danger',
        message: `Прострочений заїзд ${r.check_in} — ${r.unit_name}`,
        bookingId: r.id, guestName: `${r.first_name} ${r.last_name}`,
      });
    }

    // Today's arrivals — unpaid or unregistered
    const todayArrivals = await sql.rows<any>(`
      SELECT r.id, r.payment_status, r.registration_status, r.total_price, g.first_name, g.last_name, u.name as unit_name
      FROM reservations r
      JOIN guests g ON r.guest_id = g.id
      JOIN units u ON r.unit_id = u.id
      WHERE ${OWN('r.')} AND r.check_in = ? AND r.status IN ('confirmed', 'tentative')
    `, [org, today]);

    for (const r of todayArrivals) {
      const isFullyPaid = r.payment_status === 'paid' || r.payment_status === 'prepaid';
      if (!isFullyPaid) {
        if ((r.total_price || 0) === 0) {
          // Zero-price booking — requires admin confirmation (promo/barter/error)
          alerts.push({
            type: 'zero_price_arrival', severity: 'warning',
            message: `Сьогодні заїзд, ціна = 0 — потрібне підтвердження — ${r.unit_name}`,
            bookingId: r.id, guestName: `${r.first_name} ${r.last_name}`,
          });
        } else {
          // Regular unpaid booking
          alerts.push({
            type: 'unpaid_arrival', severity: 'warning',
            message: `Сьогодні заїзд, оплата не завершена — ${r.unit_name}`,
            bookingId: r.id, guestName: `${r.first_name} ${r.last_name}`,
          });
        }
      }
      if (r.registration_status !== 'registered') {
        alerts.push({
          type: 'unregistered_arrival', severity: 'warning',
          message: `Сьогодні заїзд, реєстрація не пройдена — ${r.unit_name}`,
          bookingId: r.id, guestName: `${r.first_name} ${r.last_name}`,
        });
      }
    }

    // Checked-in without registration
    const noRegCheckedIn = await sql.rows<any>(`
      SELECT r.id, g.first_name, g.last_name, u.name as unit_name
      FROM reservations r
      JOIN guests g ON r.guest_id = g.id
      JOIN units u ON r.unit_id = u.id
      WHERE ${OWN('r.')} AND r.status = 'checked_in' AND (r.registration_status IS NULL OR r.registration_status = 'not_registered')
    `, [org]);

    for (const r of noRegCheckedIn) {
      alerts.push({
        type: 'checked_in_no_reg', severity: 'danger',
        message: `Заселений без реєстрації — ${r.unit_name}`,
        bookingId: r.id, guestName: `${r.first_name} ${r.last_name}`,
      });
    }

    // Today's departures still checked-in
    const todayDepartures = await sql.rows<any>(`
      SELECT r.id, g.first_name, g.last_name, u.name as unit_name
      FROM reservations r
      JOIN guests g ON r.guest_id = g.id
      JOIN units u ON r.unit_id = u.id
      WHERE ${OWN('r.')} AND r.check_out = ? AND r.status = 'checked_in'
    `, [org, today]);

    for (const r of todayDepartures) {
      alerts.push({
        type: 'today_departure', severity: 'info',
        message: `Сьогодні виїзд — ${r.unit_name}`,
        bookingId: r.id, guestName: `${r.first_name} ${r.last_name}`,
      });
    }

    return NextResponse.json(alerts);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
