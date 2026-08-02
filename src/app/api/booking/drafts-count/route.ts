import { NextResponse } from 'next/server';
import { getDb } from '@core/db';
import { withActor, type Actor } from '@core/auth/session';

/**
 * How many pool bookings are waiting, for the badge on the operator calendar.
 *
 * It sits under the '/api/booking/' public prefix — which exists for the
 * guest-facing widget — and had no session check and no organization filter, so
 * it counted every hotel's pool bookings and answered anyone who asked. Its
 * only caller is the dashboard calendar, which always has a session.
 */
export const GET = withActor(async (_req, _ctx, actor: Actor) => {
  const db = getDb();
  // Excludes OTA/channel blocks: fake reservations injected by iCal/Hostex
  // that are not real guests.
  const row = db.prepare(`
    SELECT COUNT(*) as count FROM reservations r
    JOIN units u ON u.id = r.unit_id
    JOIN guests g ON g.id = r.guest_id
    JOIN properties p ON p.id = r.property_id
    WHERE p.organization_id = ?
      AND u.is_pool = 1
      AND r.status IN ('draft', 'confirmed', 'tentative')
      AND LOWER(g.first_name || ' ' || g.last_name) NOT LIKE '%ota%block%'
      AND LOWER(g.first_name || ' ' || g.last_name) NOT LIKE '%channel%block%'
      AND LOWER(g.first_name || ' ' || g.last_name) NOT LIKE '%hostex%block%'
  `).get(actor.organizationId) as { count: number };
  return NextResponse.json({ count: row?.count || 0 });
});

export const runtime = 'nodejs';
