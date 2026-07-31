/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import * as connectionsRepo from '../data/connections.repo';
import { withActor, withOwner, type Actor } from '@core/auth/session';

/** The organization comes from the session, never from the request. */

export const listConnections = withActor(async (_req, _ctx, actor: Actor) => {
  try {
    return NextResponse.json(connectionsRepo.listConnections(actor.organizationId));
  } catch (e: any) {
    console.error('GET /api/channels/connections error:', e?.message || e);
    return NextResponse.json({ error: 'Failed to fetch connections' }, { status: 500 });
  }
});

export const createConnection = withOwner(async (request: NextRequest, _ctx, actor: Actor) => {
  try {
    const body = await request.json();
    const { channel, external_property_id, connection_types, pricing_model } = body;

    if (!channel) {
      return NextResponse.json({ error: 'Channel is required' }, { status: 400 });
    }

    const id = connectionsRepo.createConnection(actor.organizationId, {
      channel, external_property_id, connection_types, pricing_model,
    });
    return NextResponse.json({ id, status: 'created' }, { status: 201 });
  } catch (e: any) {
    console.error('POST /api/channels/connections error:', e?.message || e);
    return NextResponse.json({ error: 'Failed to create connection' }, { status: 500 });
  }
});
