/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { todayFor, shiftDays } from '@core/hotel-day';
import type { Actor } from '@core/auth/session';
import { serverError } from '@core/http/errors';
import type { DashboardAlert } from '../domain/alerts';

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
    // The hotel's day. This one WRITES: the auto-archive below flips
    // confirmed bookings to no_show, and a cutoff computed in UTC moves that
    // decision by up to three hours across a date boundary — archiving a
    // booking a day early while the guest is still travelling, or a day late.
    const today = await todayFor(org);
    const archiveCutoff = shiftDays(today, -7);

    await sql.run(`
      UPDATE reservations
      SET status = 'no_show', updated_at = CURRENT_TIMESTAMP
      WHERE ${OWN()} AND check_in < ? AND status = 'confirmed'
    `, [org, archiveCutoff]);

    // Код і дані, а не готовий рядок. Українське речення, складене тут,
    // німецький портьє читав як є: `check-i18n-leak` забороняє `t()` під
    // src/app/api навмисно, щоб мова оператора не вирішувала мову документів
    // і листів гостю. Рядок складає екран — див. domain/alerts.ts.
    const alerts: DashboardAlert[] = [];

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
        bookingId: r.id, guestName: `${r.first_name} ${r.last_name}`,
        unitName: r.unit_name, checkIn: r.check_in,
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
            bookingId: r.id, guestName: `${r.first_name} ${r.last_name}`,
            unitName: r.unit_name,
          });
        } else {
          // Regular unpaid booking
          alerts.push({
            type: 'unpaid_arrival', severity: 'warning',
            bookingId: r.id, guestName: `${r.first_name} ${r.last_name}`,
            unitName: r.unit_name,
          });
        }
      }
      if (r.registration_status !== 'registered') {
        alerts.push({
          type: 'unregistered_arrival', severity: 'warning',
          bookingId: r.id, guestName: `${r.first_name} ${r.last_name}`,
          unitName: r.unit_name,
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
        bookingId: r.id, guestName: `${r.first_name} ${r.last_name}`,
        unitName: r.unit_name,
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
        bookingId: r.id, guestName: `${r.first_name} ${r.last_name}`,
        unitName: r.unit_name,
      });
    }

    // Гість попросив рахунок зі своєї сторінки (`/api/guest/[token]/payment-request`).
    // Без дати: гість натискає, коли йому зручно, а не в день заїзду, і
    // прохання, яке зʼявиться в банері лише в день приїзду, вже нікому не
    // потрібне. Виїхані й скасовані не рахуються — там питання закрите.
    const paymentRequests = await sql.rows<any>(`
      SELECT r.id, g.first_name, g.last_name, u.name as unit_name
      FROM reservations r
      JOIN guests g ON r.guest_id = g.id
      JOIN units u ON r.unit_id = u.id
      WHERE ${OWN('r.')} AND r.payment_status = 'payment_requested'
        AND r.status IN ('confirmed', 'tentative', 'checked_in')
      ORDER BY r.check_in
    `, [org]);

    for (const r of paymentRequests) {
      alerts.push({
        type: 'payment_requested', severity: 'info',
        bookingId: r.id, guestName: `${r.first_name} ${r.last_name}`,
        unitName: r.unit_name,
      });
    }

    return NextResponse.json(alerts);
  } catch (e: any) {
    return serverError('modules/dashboard/api/alerts getAlerts', e);
  }
}
