/**
 * Лист «ви не дозаселили кошик», раз на кілька хвилин з крона.
 *
 * ── Чому тут цикл по готелях ────────────────────────────────────────────
 *
 * Було: `SELECT id FROM reservations` без жодного контексту орендаря. На
 * SQLite це віддавало всі броні всіх готелів, і лист ішов — гостю чужого
 * готелю включно. На Postgres — гірше й тихіше: зʼєднання з пулу, якому вже
 * ставили орендаря, читає `app.organization_id` порожнім, політика не
 * збігається ні з чим, і запит повертає НУЛЬ рядків без помилки. Крон
 * відповідав `{ok: true, processed: 0, message: 'No abandoned carts found'}`
 * — тобто рапортував успіх щоразу, коли нічого не робив.
 *
 * Крон не має орендаря: він працює за всіх. Отже, орендар ставиться в
 * циклі — той самий шов, що в `cron/gdpr-retention`. `sendAbandonedCartEmail`
 * читає бронь своїм запитом, тож він мусить бути ВСЕРЕДИНІ обгортки, а не
 * поруч.
 */
import { NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { sendAbandonedCartEmail } from '@/modules/bookings/data/send-abandoned-cart-email';
import { cronAuthFailure } from '@core/security/cron-auth';
import { runWithOrganization } from '@core/auth/tenant-context';
import { serverError } from '@core/http/errors';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  // There was no check at all here, and this route emails guests.
  const denied = cronAuthFailure(request);
  if (denied) return denied;

  try {
    const sql = getSql();
    const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
    const hotels = await sql.rows<{ id: string }>('SELECT id FROM organizations');

    let processed = 0;
    let totalFound = 0;

    for (const hotel of hotels) {
      await runWithOrganization(hotel.id, async () => {
        // PROD MODE: Check for carts created more than 30 minutes ago
        const abandoned = await sql.rows<{ id: string }>(`
          SELECT id
          FROM reservations
          WHERE status = 'tentative'
            AND payment_status = 'unpaid'
            AND created_at < ${sql.dialect.plusMinutes('CURRENT_TIMESTAMP', '-30')}
            AND created_at > ${sql.dialect.plusMinutes('CURRENT_TIMESTAMP', '-120')}
            AND COALESCE(internal_notes, '') NOT LIKE '%[ABANDONED_CART_SENT]%'
        `);
        totalFound += abandoned.length;

        for (const res of abandoned) {
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
      });
    }

    return NextResponse.json({ ok: true, processed, totalFound, hotels: hotels.length });
  } catch (error: any) {
    console.error('[CronAbandonedCarts] Error:', error);
    return serverError('app/api/cron/abandoned-carts GET', error);
  }
}
