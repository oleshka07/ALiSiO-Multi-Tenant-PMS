/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { todayFor } from '@core/hotel-day';
import { withActor, withPermission } from '@core/auth/session';

export const listServiceOrders = withActor(async (req: NextRequest, _ctx, actor) => {
  try {
    const sql = getSql();
    const url = new URL(req.url);
    const dateParam = url.searchParams.get('date') || await todayFor(actor.organizationId);
    const period = url.searchParams.get('period') || 'day';

    // `?date=` used to be pasted into the SQL string. `?date=2026-01-01' OR '1'='1`
    // answered 200 with everything; `?date=x'` answered 500 with the parser's
    // opinion of the query. Both were reproduced against a running build.
    //
    // The shape is checked before anything else, because a date is a date: it
    // is not the parameteriser's job to explain that `2026-13-99` is not one.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
    }

    // The end of a week is computed here rather than by `date(?, '+7 days')`,
    // which is SQLite's spelling and would have to be rewritten for Postgres.
    const dateEnd = new Date(`${dateParam}T00:00:00Z`);
    dateEnd.setUTCDate(dateEnd.getUTCDate() + 7);
    const dateTo = dateEnd.toISOString().slice(0, 10);

    // Scoped, and not by RLS alone: on SQLite there are no policies, and this
    // listed every hotel's service orders — guest names included — to anyone
    // signed in anywhere. Orders reach their tenant two ways, because an order
    // may have no reservation (a walk-in buying through the widget): through
    // the booking when there is one, through the service's property always.
    const orgFilter = `AND ads.property_id IN (SELECT id FROM properties WHERE organization_id = ?)`;

    const dateFilter = period === 'day'
      ? 'AND bso.service_date = ?'
      : period === 'week'
        ? 'AND bso.service_date >= ? AND bso.service_date <= ?'
        : '';
    const dateArgs = period === 'day' ? [dateParam] : period === 'week' ? [dateParam, dateTo] : [];

    const widgetOrders = await sql.rows<any>(`
      SELECT
        bso.id, bso.reservation_id, bso.service_id, bso.quantity,
        bso.service_date, bso.options_json, bso.unit_price, bso.total_price,
        bso.status, bso.payment_status, bso.coupon_code, bso.created_at,
        bso.completed_at, bso.menu_item_id,
        ads.name as service_name, ads.name_en, ads.service_type,
        mi.name_en as menu_item_name,
        g.first_name, g.last_name,
        u.name as unit_name
      FROM booking_service_orders bso
      JOIN additional_services ads ON bso.service_id = ads.id
      LEFT JOIN menu_items mi ON bso.menu_item_id = mi.id
      LEFT JOIN reservations r ON bso.reservation_id = r.id
      LEFT JOIN guests g ON r.guest_id = g.id
      LEFT JOIN units u ON r.unit_id = u.id
      WHERE 1=1 ${dateFilter} ${orgFilter}
        AND bso.status != 'cancelled'
        AND bso.payment_status NOT IN ('failed', 'refunded')
      ORDER BY bso.service_date ASC, bso.created_at DESC
    `, [...dateArgs, actor.organizationId]) as any[];

    const orders = widgetOrders.map(o => {
      let startHour = null, endHour = null;
      if (o.options_json) {
        try {
          const opts = JSON.parse(o.options_json);
          startHour = opts.startHour;
          endHour = opts.startHour + opts.hours;
        } catch { /* ignore */ }
      }
      return {
        id: o.id,
        source: 'widget',
        reservationId: o.reservation_id,
        serviceId: o.service_id,
        serviceName: o.name_en || o.service_name,
        serviceType: o.service_type,
        serviceDate: o.service_date,
        startHour,
        endHour,
        quantity: o.quantity,
        totalPrice: o.total_price,
        status: computeStatus(o),
        paymentStatus: o.payment_status,
        completedAt: o.completed_at,
        couponCode: o.coupon_code,
        menuItemName: o.menu_item_name || null,
        guestName: o.first_name ? `${o.first_name} ${o.last_name}` : null,
        unitName: o.unit_name,
        createdAt: o.created_at,
      };
    });

    const soDateFilter = period === 'day'
      ? 'AND COALESCE(so.service_date, r.check_in) = ?'
      : period === 'week'
        ? 'AND COALESCE(so.service_date, r.check_in) >= ? AND COALESCE(so.service_date, r.check_in) <= ?'
        : '';

    const guestOrders = await sql.rows<any>(`
      SELECT
        so.id, so.reservation_id, so.service_id, so.quantity,
        so.total_price, so.status, so.payment_status, so.created_at,
        so.service_date, so.notes,
        ads.name as service_name, ads.name_en, ads.service_type,
        g.first_name, g.last_name,
        u.name as unit_name,
        r.check_in
      FROM service_orders so
      JOIN additional_services ads ON so.service_id = ads.id
      JOIN reservations r ON so.reservation_id = r.id
      JOIN guests g ON r.guest_id = g.id
      LEFT JOIN units u ON r.unit_id = u.id
      WHERE 1=1 ${soDateFilter}
        AND r.organization_id = ?
        AND so.status != 'cancelled'
        AND so.payment_status NOT IN ('failed', 'refunded')
      ORDER BY so.created_at DESC
      LIMIT 50
    `, [...dateArgs, actor.organizationId]) as any[];

    const gOrders = guestOrders.map(o => {
      let startHour = null, endHour = null;
      let notesDate: string | null = null;
      let menuItemName: string | null = null;
      if (o.notes) {
        try {
          const n = JSON.parse(o.notes);
          // Slot services (sauna, tub): extract time info
          if (o.service_type === 'slot_booking') {
            if (n.startHour != null) { startHour = n.startHour; endHour = n.startHour + (n.hours || 1); }
            if (n.service_date) notesDate = n.service_date;
          }
          // Breakfast: extract menu item names
          if (n.type === 'breakfast' && n.menu_items && Array.isArray(n.menu_items)) {
            menuItemName = n.menu_items
              .filter((mi: any) => mi.quantity > 0)
              .map((mi: any) => `${mi.name || mi.menuItemId} ×${mi.quantity}`)
              .join(', ');
          }
        } catch { /* ignore */ }
      }
      return {
        id: o.id,
        source: 'guest_page',
        reservationId: o.reservation_id,
        serviceId: o.service_id,
        serviceName: o.name_en || o.service_name,
        serviceType: o.service_type,
        serviceDate: o.service_date || notesDate || o.check_in,
        startHour,
        endHour,
        quantity: o.quantity,
        totalPrice: o.total_price,
        status: computeStatus(o),
        paymentStatus: o.payment_status,
        completedAt: null,
        couponCode: null,
        menuItemName,
        guestName: `${o.first_name} ${o.last_name}`,
        unitName: o.unit_name,
        createdAt: o.created_at,
      };
    });

    return NextResponse.json({
      orders: [...orders, ...gOrders],
      total: orders.length + gOrders.length,
      date: dateParam,
      period,
    });

  } catch (error: any) {
    console.error('GET /api/service-orders error:', error?.message);
    return NextResponse.json({ error: 'Failed to load service orders' }, { status: 500 });
  }
});

export const updateServiceOrder = withPermission('manage_bookings', async (req: NextRequest) => {
  try {
    const sql = getSql();
    const body = await req.json();
    const { id, action } = body;

    if (!id || !action) {
      return NextResponse.json({ error: 'id and action required' }, { status: 400 });
    }

    const isBSO = await sql.row<any>('SELECT id FROM booking_service_orders WHERE id = ?', [id]);
    const isSO = await sql.row<any>('SELECT id FROM service_orders WHERE id = ?', [id]);

    if (!isBSO && !isSO) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    switch (action) {
      case 'complete': {
        if (isBSO) {
          await sql.run("UPDATE booking_service_orders SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?", [id]);
        }
        if (isSO) {
          await sql.run("UPDATE service_orders SET status = 'completed' WHERE id = ?", [id]);
        }
        break;
      }
      case 'cancel': {
        if (isBSO) {
          await sql.run("UPDATE booking_service_orders SET status = 'cancelled', payment_status = 'cancelled' WHERE id = ?", [id]);
          await sql.run("UPDATE service_time_slots SET booked_count = MAX(0, booked_count - 1) WHERE id IN (SELECT time_slot_id FROM booking_service_orders WHERE id = ?)", [id]);
        }
        if (isSO) {
          await sql.run("UPDATE service_orders SET status = 'cancelled', payment_status = 'cancelled' WHERE id = ?", [id]);
        }
        break;
      }
      case 'reopen': {
        if (isBSO) {
          await sql.run("UPDATE booking_service_orders SET status = 'confirmed', completed_at = NULL WHERE id = ?", [id]);
        }
        if (isSO) {
          await sql.run("UPDATE service_orders SET status = 'confirmed' WHERE id = ?", [id]);
        }
        break;
      }
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }

    console.log(`[Service Orders] ${action} order ${id}`);
    return NextResponse.json({ success: true, id, action });

  } catch (error: any) {
    console.error('PATCH /api/service-orders error:', error?.message);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
});

function computeStatus(order: any): string {
  if (order.completed_at || order.status === 'completed') return 'completed';
  if (order.status === 'cancelled' || order.payment_status === 'cancelled') return 'cancelled';
  if (order.payment_status === 'failed') return 'cancelled';
  if (order.payment_status === 'paid') return 'paid';
  if (order.payment_status === 'pending') return 'pending';
  if (order.status === 'confirmed') return 'confirmed';
  return 'pending';
}
