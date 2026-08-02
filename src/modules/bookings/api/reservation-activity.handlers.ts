/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@core/db';
import { withActor, type Actor } from '@core/auth/session';
import { ownedReservation } from '../data/owned.repo';

export const listActivity = withActor(async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }, actor: Actor) => {
  try {
    const db = getDb();
    const { id } = await params;
    if (!ownedReservation(db, actor.organizationId, id)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const rows = db.prepare(
      'SELECT * FROM booking_activity_log WHERE reservation_id = ? ORDER BY created_at DESC'
    ).all(id);
    return NextResponse.json(rows);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
});

export const createActivity = withActor(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }, actor: Actor) => {
  try {
    const db = getDb();
    const { id } = await params;
    if (!ownedReservation(db, actor.organizationId, id)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const body = await request.json();
    const logId = `al_${Date.now()}`;
    db.prepare(
      "INSERT INTO booking_activity_log (id, reservation_id, action, details) VALUES (?, ?, ?, ?)"
    ).run(logId, id, body.action || 'note', body.details || '');
    return NextResponse.json({ id: logId }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
});
