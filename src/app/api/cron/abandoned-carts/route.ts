import { NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { sendAbandonedCartEmail } from '@/modules/bookings/data/send-abandoned-cart-email';
import { cronAuthFailure } from '@core/security/cron-auth';
import { serverError } from '@core/http/errors';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  // There was no check at all here, and this route emails guests.
  const denied = cronAuthFailure(request);
  if (denied) return denied;

  try {
    const sql = getSql();
    
    // PROD MODE: Check for carts created more than 30 minutes ago
    const abandonedReservations = await sql.rows<{ id: string }>(`
      SELECT id 
      FROM reservations 
      WHERE status = 'tentative' 
        AND payment_status = 'unpaid' 
        AND created_at < ${sql.dialect.plusMinutes('CURRENT_TIMESTAMP', '-30')}
        AND created_at > ${sql.dialect.plusMinutes('CURRENT_TIMESTAMP', '-120')}
        AND COALESCE(internal_notes, '') NOT LIKE '%[ABANDONED_CART_SENT]%'
    `);

    if (!abandonedReservations.length) {
      return NextResponse.json({ ok: true, processed: 0, message: 'No abandoned carts found' });
    }

    const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
    let processed = 0;

    for (const res of abandonedReservations) {
      const sent = await sendAbandonedCartEmail(res.id, origin);
      if (sent) {
        // Mark as sent
        await sql.run(`
          UPDATE reservations 
          SET internal_notes = COALESCE(internal_notes, '') || '\n[ABANDONED_CART_SENT]'
          WHERE id = ?
        `, [res.id]);
        processed++;
      }
    }

    return NextResponse.json({ ok: true, processed, totalFound: abandonedReservations.length });
  } catch (error: any) {
    console.error('[CronAbandonedCarts] Error:', error);
    return serverError('app/api/cron/abandoned-carts GET', error);
  }
}
