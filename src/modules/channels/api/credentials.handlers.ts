/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import * as credentialsRepo from '../data/credentials.repo';
import { withOwner, type Actor } from '@core/auth/session';

/**
 * Channel credentials are owner-only: they authenticate the hotel to
 * Booking.com and friends, and whoever can read or replace them can sell its
 * inventory. The organization comes from the session.
 *
 * Errors no longer echo e.message to the caller — these handlers surface
 * database and OAuth failures, and their text is not something a browser needs.
 */

export const listCredentials = withOwner(async (_req, _ctx, actor: Actor) => {
  try {
    return NextResponse.json(await credentialsRepo.listCredentials(actor.organizationId));
  } catch (e: any) {
    console.error('GET /api/channels/credentials error:', e?.message || e);
    return NextResponse.json({ error: 'Failed to fetch credentials' }, { status: 500 });
  }
});

export const upsertCredentials = withOwner(async (request: NextRequest, _ctx, actor: Actor) => {
  try {
    const body = await request.json();
    const { channel, environment, client_id, client_secret } = body;

    if (!channel || !environment || !client_id || !client_secret) {
      return NextResponse.json(
        { error: 'channel, environment, client_id, and client_secret are required' },
        { status: 400 },
      );
    }

    const result = await credentialsRepo.upsertCredentials(actor.organizationId, {
      channel, environment, client_id, client_secret,
    });
    return NextResponse.json({ id: result.id, status: result.created ? 'created' : 'updated' });
  } catch (e: any) {
    console.error('POST /api/channels/credentials error:', e?.message || e);
    return NextResponse.json({ error: 'Failed to save credentials' }, { status: 500 });
  }
});
