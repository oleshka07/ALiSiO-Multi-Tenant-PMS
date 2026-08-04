/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { getDb } from '@core/db';
import { requireOrganizationId, requirePropertyId } from '@core/auth/tenant-context';
import { withActor } from '@core/auth/session';

export const listBookingSources = withActor(async () => {
  try {
    const sql = getSql();
    // booking_sources reaches an organization through its property; unscoped
    // this listed every hotel's channels and their commission percentages.
    const sources = await sql.rows<any>(`
      SELECT bs.* FROM booking_sources bs
      JOIN properties p ON p.id = bs.property_id
      WHERE p.organization_id = ?
      ORDER BY bs.sort_order, bs.name
    `, [requireOrganizationId(getDb())]);
    return NextResponse.json(sources);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
});

export const createBookingSource = withActor(async (request: Request) => {
  try {
    const sql = getSql();
    const body = await request.json();
    const { name, code, icon_letter, color, sort_order, commission_percent } = body;

    if (!name || !code) {
      return NextResponse.json({ error: 'name and code are required' }, { status: 400 });
    }

    let propertyId: string;
    try {
      propertyId = requirePropertyId(getDb(), body.property_id);
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }

    // A source code only has to be unique inside the property that owns it.
    const existing = await sql.row<any>('SELECT id FROM booking_sources WHERE code = ? AND property_id = ?', [code, propertyId]);
    if (existing) {
      return NextResponse.json({ error: 'Source code already exists' }, { status: 400 });
    }

    const id = `bs_${Date.now()}`;
    await sql.run('INSERT INTO booking_sources (id, property_id, name, code, icon_letter, color, sort_order, commission_percent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [id, propertyId, name, code, icon_letter || '?', color || '#6c7086', sort_order || 0, commission_percent || 0]);

    const created = await sql.row<any>('SELECT * FROM booking_sources WHERE id = ?', [id]);
    return NextResponse.json(created, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
});
