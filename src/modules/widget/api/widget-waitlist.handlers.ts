/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { getDb } from '@core/db';
import { hasFeature, featureDisabled } from '@core/features';
import { checkRateLimit } from '@core/security/rate-limit';

/**
 * A guest asking to be told when a date frees up.
 *
 * This was raw SQL inside a route file with no checks at all: no session (it
 * is public by design), but also no verification that siteId named a real
 * site, no rate limit, and no organization. Anyone could POST names, emails
 * and phone numbers into the table from the open internet, as fast as they
 * liked, attributed to any site id they invented.
 *
 * Public still, but: the site must exist, its hotel must have the widget,
 * the address must look like one, and one IP gets ten entries an hour.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function joinWaitlistOptions() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

const isDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const cap = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : null);

export async function joinWaitlist(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { siteId, unitId, checkIn, checkOut, email, phone, name } = body;

    if (!siteId || !isDate(checkIn) || !isDate(checkOut) || typeof email !== 'string') {
      return NextResponse.json(
        { error: 'siteId, checkIn (YYYY-MM-DD), checkOut (YYYY-MM-DD) and email are required' },
        { status: 400, headers: CORS_HEADERS },
      );
    }
    if (checkOut <= checkIn) {
      return NextResponse.json({ error: 'checkOut must be after checkIn' }, { status: 400, headers: CORS_HEADERS });
    }
    const cleanEmail = email.trim().toLowerCase();
    if (cleanEmail.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) {
      return NextResponse.json({ error: 'a valid email is required' }, { status: 400, headers: CORS_HEADERS });
    }

    const sql = getSql();

    // The site decides which hotel this is — an invented id gets a 404, not a row.
    const site = await sql.row<any>(`
      SELECT bs.id, p.organization_id
      FROM booking_sites bs
      JOIN properties p ON bs.property_id = p.id
      WHERE bs.id = ? AND bs.status != 'deleted'
    `, [siteId]) as { id: string; organization_id: string } | undefined;
    if (!site) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404, headers: CORS_HEADERS });
    }
    if (!hasFeature(getDb(), site.organization_id, 'widget')) {
      return featureDisabled('widget', CORS_HEADERS);
    }

    const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim()
      || request.headers.get('x-real-ip')
      || 'unknown';
    const limit = checkRateLimit(`waitlist:${ip}`, 'registration', 10, 60);
    if (!limit.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: CORS_HEADERS });
    }

    await sql.run(`
      INSERT INTO waitlist (site_id, unit_id, check_in, check_out, email, phone, name)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [site.id, cap(unitId, 64), checkIn, checkOut, cleanEmail, cap(phone, 32), cap(name, 120)]);

    return NextResponse.json({ success: true }, { headers: CORS_HEADERS });
  } catch (error: any) {
    console.error('[Waitlist] error:', error?.message || error);
    return NextResponse.json({ error: 'Failed to join waitlist' }, { status: 500, headers: CORS_HEADERS });
  }
}
