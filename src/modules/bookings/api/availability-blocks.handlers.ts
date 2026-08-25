/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { withActor, type Actor } from '@core/auth/session';
import { ownedUnit } from '../data/owned.repo';
import { serverError } from '@core/http/errors';

export const listAvailabilityBlocks = withActor(async (_req, _ctx, actor: Actor) => {
  try {
    const sql = getSql();

    // Scope through the unit's property rather than the denormalized column:
    // rows inserted before organization_id was set stay visible to their owner.
    const blocks = await sql.rows<any>(`
      SELECT b.id, b.unit_id, b.date_from, b.date_to, b.reason, b.notes, b.hostex_code, b.created_at
      FROM availability_blocks b
      JOIN units u ON b.unit_id = u.id
      JOIN properties p ON u.property_id = p.id
      WHERE p.organization_id = ?
      ORDER BY b.date_from ASC
    `, [actor.organizationId]);

    return NextResponse.json(blocks);
  } catch (e: any) {
    console.error('GET /api/availability-blocks error:', e.message);
    return NextResponse.json([]);
  }
});

export const createAvailabilityBlock = withActor(async (request: Request, _ctx, actor: Actor) => {
  try {
    const sql = getSql();
    const body = await request.json();
    const { unit_id, date_from, date_to, reason, notes } = body;
    if (!unit_id || !date_from || !date_to) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    if (!await ownedUnit(actor.organizationId, unit_id)) {
      return NextResponse.json({ error: 'Unit not found' }, { status: 404 });
    }
    const id = `blk_${Date.now()}_${Math.random().toString(36).substring(2,7)}`;
    await sql.run(`
      INSERT INTO availability_blocks (id, organization_id, unit_id, date_from, date_to, reason, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [id, actor.organizationId, unit_id, date_from, date_to, reason || 'maintenance', notes || null]);
    return NextResponse.json({ ok: true, id });
  } catch (e: any) {
    return serverError('modules/bookings/api/availability-blocks createAvailabilityBlock', e);
  }
});

export const deleteAvailabilityBlock = withActor(async (request: Request, _ctx, actor: Actor) => {
  try {
    const sql = getSql();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    await sql.run(`
      DELETE FROM availability_blocks WHERE id = ? AND unit_id IN (
        SELECT u.id FROM units u JOIN properties p ON u.property_id = p.id WHERE p.organization_id = ?
      )
    `, [id, actor.organizationId]);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return serverError('modules/bookings/api/availability-blocks deleteAvailabilityBlock', e);
  }
});
