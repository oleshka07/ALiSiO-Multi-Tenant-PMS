/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import * as connectionsRepo from '../data/connections.repo';
import { withActor, withOwner, type Actor } from '@core/auth/session';

/**
 * A connection id from another tenant answers 404, so ids cannot be probed.
 * Changing or deleting a connection is owner-only: it is what carries the
 * hotel's inventory to the channel.
 */

type IdParams = { params: Promise<{ id: string }> };

export const getConnection = withActor(async (_request, { params }: IdParams, actor: Actor) => {
  try {
    const { id } = await params;
    const conn = await connectionsRepo.getConnection(actor.organizationId, id);
    if (!conn) return NextResponse.json({ error: 'Connection not found' }, { status: 404 });
    return NextResponse.json(conn);
  } catch (e: any) {
    console.error('GET /api/channels/connections/[id] error:', e?.message || e);
    return NextResponse.json({ error: 'Failed to fetch connection' }, { status: 500 });
  }
});

export const updateConnection = withOwner(async (request: NextRequest, { params }: IdParams, actor: Actor) => {
  try {
    const { id } = await params;
    const body = await request.json();
    const updated = await connectionsRepo.updateConnection(actor.organizationId, id, body);
    // false covers "not yours", "nothing to change" and "credentials belong to
    // someone else"; 404 is the safe reading of all three.
    if (!updated) return NextResponse.json({ error: 'Connection not found' }, { status: 404 });
    return NextResponse.json({ status: 'updated' });
  } catch (e: any) {
    console.error('PUT /api/channels/connections/[id] error:', e?.message || e);
    return NextResponse.json({ error: 'Failed to update connection' }, { status: 500 });
  }
});

export const deleteConnection = withOwner(async (_request, { params }: IdParams, actor: Actor) => {
  try {
    const { id } = await params;
    const removed = await connectionsRepo.deleteConnection(actor.organizationId, id);
    if (!removed) return NextResponse.json({ error: 'Connection not found' }, { status: 404 });
    return NextResponse.json({ status: 'deleted' });
  } catch (e: any) {
    console.error('DELETE /api/channels/connections/[id] error:', e?.message || e);
    return NextResponse.json({ error: 'Failed to delete connection' }, { status: 500 });
  }
});
