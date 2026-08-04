/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function getWidgetReservationOptions() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function getWidgetReservation(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400, headers: CORS_HEADERS });
    }

    const sql = getSql();
    const r = await sql.row<any>(`
      SELECT r.id, r.unit_id, r.check_in, r.check_out, r.nights,
             r.adults, r.children, r.status, r.payment_status, r.total_price,
             u.name AS unit_name,
             g.first_name, g.last_name, g.email, g.phone
      FROM reservations r
      LEFT JOIN units u ON u.id = r.unit_id
      LEFT JOIN guests g ON g.id = r.guest_id
      WHERE r.id = ?
    `, [id]) as any;

    if (!r) {
      return NextResponse.json({ error: 'Not found' }, { status: 404, headers: CORS_HEADERS });
    }

    let services: any[] = [];
    try {
      services = await sql.rows<any>(`
        SELECT bso.id, bso.service_id, bso.quantity, bso.service_date,
               bso.unit_price, bso.total_price, bso.status, bso.payment_status,
               bso.options_json, bso.menu_item_id,
               s.name AS service_name
        FROM booking_service_orders bso
        LEFT JOIN additional_services s ON s.id = bso.service_id
        WHERE bso.reservation_id = ?
        ORDER BY bso.id
      `, [id]) as any[];
    } catch { /* optional table */ }

    return NextResponse.json({
      reservation: {
        id: r.id,
        unit_id: r.unit_id,
        unit_name: r.unit_name,
        check_in: r.check_in,
        check_out: r.check_out,
        nights: r.nights,
        adults: r.adults,
        children: r.children,
        status: r.status,
        payment_status: r.payment_status,
        total_price: r.total_price,
        guest: {
          first_name: r.first_name,
          last_name: r.last_name,
          email: r.email,
          phone: r.phone,
        },
      },
      services,
    }, { headers: CORS_HEADERS });
  } catch (error: any) {
    console.error('GET /api/booking/reservation error:', error?.message || error);
    return NextResponse.json({ error: 'Failed to fetch reservation' }, { status: 500, headers: CORS_HEADERS });
  }
}
