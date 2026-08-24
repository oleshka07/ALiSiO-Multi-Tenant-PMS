import { NextRequest, NextResponse } from 'next/server';
import { secretAuthFailure } from '@core/security/cron-auth';
import { syncSingleReservation, syncReservations } from '../data/hostex-sync';

export async function hostexWebhook(request: NextRequest): Promise<NextResponse> {
  // Checked BEFORE the body is read, and refused when the secret is unset.
  // `if (WEBHOOK_SECRET && ...)` meant an unconfigured server accepted any
  // unsigned event and acted on it — and the container never received
  // HOSTEX_WEBHOOK_SECRET, so that was every server.
  const denied = secretAuthFailure(request, 'HOSTEX_WEBHOOK_SECRET');
  if (denied) return denied;

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const event = (payload.event as string) || '';
  const reservationCode = (payload.reservation_code as string) || '';

  console.log(`[Hostex Webhook] ${event} | code: ${reservationCode}`);

  if (event === 'reservation_created' || event === 'reservation_updated') {
    setImmediate(async () => {
      try {
        if (reservationCode) await syncSingleReservation(reservationCode);
        else await syncReservations();
      } catch (e: unknown) {
        console.error('[Hostex Webhook] Background error:', (e as Error).message);
      }
    });
  }

  return NextResponse.json({ ok: true, event, code: reservationCode });
}

export async function hostexWebhookInfo(): Promise<NextResponse> {
  return NextResponse.json({
    endpoint: '/api/webhooks/hostex',
    status: 'active',
    strategy: '?reservation_code= targeted fetch — bypasses 20-record cap',
    events: ['reservation_created', 'reservation_updated'],
    security: 'Hostex-Webhook-Secret-Token header',
  });
}
