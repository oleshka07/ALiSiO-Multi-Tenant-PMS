/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import * as guestsRepo from '../data/guests.repo';
import { withActor, withPermission, type Actor } from '@core/auth/session';

/**
 * The organization comes from the session. A guest id belonging to another
 * tenant answers 404 rather than 403 — the record holds a person's name,
 * contact details and document number, so confirming that it exists is itself
 * a disclosure.
 */

type IdParams = { params: Promise<{ id: string }> };

export const getGuest = withActor(async (_request, { params }: IdParams, actor: Actor) => {
  try {
    const { id } = await params;
    const guest = await guestsRepo.getGuestWithReservations(actor.organizationId, id);
    if (!guest) return NextResponse.json({ error: 'Guest not found' }, { status: 404 });
    return NextResponse.json(guest);
  } catch (error: any) {
    console.error('GET /api/guests/[id] error:', error?.message || error);
    return NextResponse.json({ error: 'Failed to fetch guest' }, { status: 500 });
  }
});

export const updateGuest = withPermission('manage_guests', async (request: NextRequest, { params }: IdParams, actor: Actor) => {
  try {
    const { id } = await params;
    const body = await request.json();
    const updated = await guestsRepo.updateGuest(actor.organizationId, id, body);
    // Now false for both "nothing to change" and "not this tenant's guest";
    // 404 is the safe reading of either.
    if (!updated) return NextResponse.json({ error: 'Guest not found' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('PATCH /api/guests/[id] error:', error?.message || error);
    return NextResponse.json({ error: 'Failed to update guest' }, { status: 500 });
  }
});

export const deleteGuest = withPermission('manage_guests', async (_request, { params }: IdParams, actor: Actor) => {
  try {
    const { id } = await params;
    const result = await guestsRepo.deleteGuest(actor.organizationId, id);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.error === 'Not found' ? 404 : 409 });
    }
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('DELETE /api/guests/[id] error:', error?.message || error);
    return NextResponse.json({ error: 'Failed to delete guest' }, { status: 500 });
  }
});
