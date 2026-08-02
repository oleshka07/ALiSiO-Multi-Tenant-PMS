/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { getDb } from '@core/db';
import { requireOrganizationId, requirePropertyId } from '@core/auth/tenant-context';
import { withActor } from '@core/auth/session';

export const listBookingSources = withActor(async () => {
  try {
    const db = getDb();
    // booking_sources reaches an organization through its property; unscoped
    // this listed every hotel's channels and their commission percentages.
    const sources = db.prepare(`
      SELECT bs.* FROM booking_sources bs
      JOIN properties p ON p.id = bs.property_id
      WHERE p.organization_id = ?
      ORDER BY bs.sort_order, bs.name
    `).all(requireOrganizationId(db));
    return NextResponse.json(sources);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
});

export const createBookingSource = withActor(async (request: Request) => {
  try {
    const db = getDb();
    const body = await request.json();
    const { name, code, icon_letter, color, sort_order, commission_percent } = body;

    if (!name || !code) {
      return NextResponse.json({ error: 'name and code are required' }, { status: 400 });
    }

    let propertyId: string;
    try {
      propertyId = requirePropertyId(db, body.property_id);
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }

    // A source code only has to be unique inside the property that owns it.
    const existing = db.prepare(
      'SELECT id FROM booking_sources WHERE code = ? AND property_id = ?',
    ).get(code, propertyId);
    if (existing) {
      return NextResponse.json({ error: 'Source code already exists' }, { status: 400 });
    }

    const id = `bs_${Date.now()}`;
    db.prepare(
      'INSERT INTO booking_sources (id, property_id, name, code, icon_letter, color, sort_order, commission_percent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, propertyId, name, code, icon_letter || '?', color || '#6c7086', sort_order || 0, commission_percent || 0);

    const created = db.prepare('SELECT * FROM booking_sources WHERE id = ?').get(id);
    return NextResponse.json(created, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
});
