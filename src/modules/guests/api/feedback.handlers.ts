/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import * as actionsRepo from '../data/guest-actions.repo';

export async function submitFeedback(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  try {
    const { token } = await params;
    const { feedback } = await request.json();

    if (!feedback?.trim()) {
      return NextResponse.json({ error: 'Feedback is empty' }, { status: 400 });
    }

    const reservationId = actionsRepo.getReservationIdByToken(token);
    if (!reservationId) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });

    actionsRepo.saveFeedback(reservationId, feedback);
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('POST /api/guest/[token]/feedback error:', error?.message || error);
    return NextResponse.json({ error: 'Failed to save feedback' }, { status: 500 });
  }
}
