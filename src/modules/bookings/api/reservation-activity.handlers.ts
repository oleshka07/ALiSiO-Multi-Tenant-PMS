/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { withActor, type Actor } from '@core/auth/session';
import { ownedReservation } from '../data/owned.repo';

export const listActivity = withActor(async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }, actor: Actor) => {
  try {
    const sql = getSql();
    const { id } = await params;
    if (!await ownedReservation(actor.organizationId, id)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const rows = await sql.rows<any>('SELECT * FROM booking_activity_log WHERE reservation_id = ? ORDER BY created_at DESC', [id]);
    return NextResponse.json(rows);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
});

export const createActivity = withActor(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }, actor: Actor) => {
  try {
    const sql = getSql();
    const { id } = await params;
    if (!await ownedReservation(actor.organizationId, id)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const body = await request.json();
    const logId = `al_${Date.now()}`;
    // organization_id from the session — the reservation was already checked
    // to belong to it above.
    await sql.run(
      'INSERT INTO booking_activity_log (id, organization_id, reservation_id, action, details) VALUES (?, ?, ?, ?, ?)',
      [logId, actor.organizationId, id, body.action || 'note', body.details || ''],
    );
    return NextResponse.json({ id: logId }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
});
