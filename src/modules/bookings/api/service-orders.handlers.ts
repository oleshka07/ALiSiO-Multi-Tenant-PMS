/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { todayFor } from '@core/hotel-day';
import { withActor, withPermission } from '@core/auth/session';
import { serverError } from '@core/http/errors';
import { handleError } from '@core/http/errors';
import { requestPropertyScope } from '@core/auth/property-scope';
import { widgetServiceOrdersOf, guestServiceOrdersOf } from '../data/service-orders.repo';

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

    // Який ОБʼЄКТ, а не лише який орендар (INC-029): персонал зміни працює в
    // одному будинку, а список показував замовлення обох — з іменами гостей і
    // номерами кімнат. Запити й довід про ДВА якорі — `data/service-orders.repo.ts`;
    // сюди їх не повернути: `withActor` кличе `cookies()`, тож сцени не буває.
    const scope = await requestPropertyScope(req, actor.organizationId);
    const window = { period, dateParam, dateTo };

    const widgetOrders = await widgetServiceOrdersOf(actor.organizationId, scope, window) as any[];

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

    const guestOrders = await guestServiceOrdersOf(actor.organizationId, scope, window) as any[];

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
    // Названа відмова їде своїм статусом (інваріант 6, Ц43): чужий
    // `property_id` — це 404, а не «сервер зламався».
    return handleError('modules/bookings/api/service-orders listServiceOrders', error);
  }
});

/**
 * «Чи це замовлення цього готелю?» — питаємо в SQL, а не в політики.
 *
 * Помилка, яка тут була: `SELECT id FROM booking_service_orders WHERE id = ?`
 * без організації. Хендлер бачив рядок будь-якого орендаря, відповідав «є» і
 * далі виконував `UPDATE ... WHERE id = ?` — теж без організації. Тобто
 * будь-хто з правом `manage_bookings` у будь-якому готелі міг завершити,
 * скасувати або перевідкрити замовлення послуги чужого готелю, знаючи лише id.
 *
 * На Postgres RLS-політика ще прикривала (`booking_service_orders_tenant` /
 * `service_orders_tenant` у db/postgres/schema.sql), але на SQLite політик
 * НЕМАЄ — а SQLite стоїть у dev і в CI. Тримає лише явний фільтр у запиті.
 *
 * Жодна з двох таблиць не має власного `organization_id`, тож орендар
 * береться тим самим шляхом, що й у списку вище:
 *   booking_service_orders → additional_services → properties.organization_id
 *   service_orders         → reservations.organization_id
 */
async function ownedServiceOrder(
  organizationId: string,
  id: string,
): Promise<{ isBSO: boolean; isSO: boolean }> {
  const sql = getSql();
  const bso = await sql.row<{ id: string }>(`
    SELECT bso.id
    FROM booking_service_orders bso
    JOIN additional_services ads ON bso.service_id = ads.id
    JOIN properties p ON ads.property_id = p.id
    WHERE bso.id = ? AND p.organization_id = ?
  `, [id, organizationId]);
  const so = await sql.row<{ id: string }>(`
    SELECT so.id
    FROM service_orders so
    JOIN reservations r ON so.reservation_id = r.id
    WHERE so.id = ? AND r.organization_id = ?
  `, [id, organizationId]);
  return { isBSO: !!bso, isSO: !!so };
}

export const updateServiceOrder = withPermission('manage_bookings', async (req: NextRequest, _ctx, actor) => {
  try {
    const sql = getSql();
    const body = await req.json();
    const { id, action } = body;

    if (!id || !action) {
      return NextResponse.json({ error: 'id and action required' }, { status: 400 });
    }

    // Чужий id → 404, не 403 (AGENTS.md §3.5): відповідь не повинна
    // підтверджувати, що замовлення з таким id існує в іншого готелю.
    const { isBSO, isSO } = await ownedServiceOrder(actor.organizationId, String(id));

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
          // `MAX(0, booked_count - 1)` — це двоаргументний max SQLite. У
          // Postgres MAX — агрегат, і цей рядок падав із «function max(integer,
          // integer) does not exist», тобто скасування замовлення зі слотом
          // віддавало 500 на проді. Нижню межу тримає умова, а не функція:
          // так однаково працює в обох діалектах.
          await sql.run("UPDATE service_time_slots SET booked_count = booked_count - 1 WHERE booked_count > 0 AND id IN (SELECT time_slot_id FROM booking_service_orders WHERE id = ?)", [id]);
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
    // `error?.message` у логу — це половина діагностики без стека; текст
    // відповіді при цьому все одно нічого не пояснював. serverError робить
    // обидві половини одним викликом (AGENTS.md §3.6).
    return serverError('modules/bookings/api/service-orders updateServiceOrder', error);
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
