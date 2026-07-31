/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import * as connectionsRepo from '../data/connections.repo';
import { withActor, withOwner, type Actor } from '@core/auth/session';

/**
 * connection_id and unit_type_id arrive from the client, so the repo checks
 * both against the session's organization; null back means one of them is not
 * ours and the answer is 404.
 */

export const listMappings = withActor(async (request: NextRequest, _ctx, actor: Actor) => {
  try {
    const { searchParams } = new URL(request.url);
    const connectionId = searchParams.get('connection_id') || undefined;
    return NextResponse.json(connectionsRepo.listMappings(actor.organizationId, connectionId));
  } catch (e: any) {
    console.error('GET /api/channels/mappings error:', e?.message || e);
    return NextResponse.json({ error: 'Failed to fetch mappings' }, { status: 500 });
  }
});

export const upsertMapping = withOwner(async (request: NextRequest, _ctx, actor: Actor) => {
  try {
    const body = await request.json();
    const { connection_id, unit_type_id, external_room_type_id, external_rate_plan_id } = body;

    if (!connection_id || !unit_type_id) {
      return NextResponse.json(
        { error: 'connection_id and unit_type_id are required' },
        { status: 400 },
      );
    }

    const result = connectionsRepo.upsertMapping(actor.organizationId, {
      connection_id, unit_type_id, external_room_type_id, external_rate_plan_id,
    });
    if (!result) return NextResponse.json({ error: 'Connection or unit type not found' }, { status: 404 });

    return NextResponse.json(
      { id: result.id, status: result.created ? 'created' : 'updated' },
      result.created ? { status: 201 } : undefined,
    );
  } catch (e: any) {
    console.error('POST /api/channels/mappings error:', e?.message || e);
    return NextResponse.json({ error: 'Failed to save mapping' }, { status: 500 });
  }
});

export const deleteMapping = withOwner(async (request: NextRequest, _ctx, actor: Actor) => {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const removed = connectionsRepo.deleteMapping(actor.organizationId, id);
    if (!removed) return NextResponse.json({ error: 'Mapping not found' }, { status: 404 });
    return NextResponse.json({ status: 'deleted' });
  } catch (e: any) {
    console.error('DELETE /api/channels/mappings error:', e?.message || e);
    return NextResponse.json({ error: 'Failed to delete mapping' }, { status: 500 });
  }
});
