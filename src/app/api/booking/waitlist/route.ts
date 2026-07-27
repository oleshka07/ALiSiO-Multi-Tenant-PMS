import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@core/db';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { siteId, unitId, checkIn, checkOut, email, phone, name } = body;

    if (!siteId || !checkIn || !checkOut || !email) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const db = getDb();
    db.prepare(`
      INSERT INTO waitlist (site_id, unit_id, check_in, check_out, email, phone, name)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(siteId, unitId || null, checkIn, checkOut, email, phone || null, name || null);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Waitlist API error:', error);
    return NextResponse.json({ error: 'Failed to join waitlist' }, { status: 500 });
  }
}
