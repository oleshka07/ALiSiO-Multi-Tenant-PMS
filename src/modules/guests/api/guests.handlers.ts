/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import * as guestsRepo from '../data/guests.repo';
import { withActor, withPermission, type Actor } from '@core/auth/session';

/**
 * The organization comes from the session. Guest records hold names, emails,
 * phone numbers and document numbers, so an unscoped list here is a personal
 * data leak rather than a display bug.
 */

export const listGuests = withActor(async (request: NextRequest, _ctx, actor: Actor) => {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const country = searchParams.get('country') || '';
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '50', 10);

    const result = await guestsRepo.listGuests(
      actor.organizationId,
      { search: search || undefined, country: country || undefined },
      page,
      limit,
    );
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('GET /api/guests error:', error);
    return NextResponse.json({ error: 'Failed to fetch guests' }, { status: 500 });
  }
});

export const createGuest = withPermission('manage_guests', async (request: NextRequest, _ctx, actor: Actor) => {
  try {
    const body = await request.json();
    const { firstName, lastName } = body;

    if (!firstName || !lastName) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    const guestId = await guestsRepo.createGuest(actor.organizationId, body);
    return NextResponse.json({ id: guestId }, { status: 201 });
  } catch (error: any) {
    console.error('POST /api/guests error:', error);
    return NextResponse.json({ error: 'Failed to create guest' }, { status: 500 });
  }
});
