/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@core/db';
import { getSql } from '@core/db/async';
import { hasFeature } from '@core/features';
import { sendDailyOperationalDigest } from '@/modules/notifications/data/daily-digest';

/**
 * The nightly digest, once per hotel.
 *
 * This used to call the digest with no arguments, and the digest summed every
 * organization on the server: revenue, arrivals and guest names of all of them
 * in one Telegram message. It now runs once for each organization that has the
 * telegram feature — one message, one hotel's numbers.
 */
export async function GET(request: NextRequest) {
  // Auth: require CRON_SECRET in production
  const authHeader = request.headers.get('x-cron-secret') || request.headers.get('authorization')?.replace('Bearer ', '');
  const secret = process.env.CRON_SECRET || 'local-cron';
  if (authHeader !== secret) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const sql = getSql();
    const organizations = (await sql.rows<{ id: string; name: string }>('SELECT id, name FROM organizations'))
      .filter((o) => hasFeature(getDb(), o.id, 'telegram'));

    const results: { organization: string; sent: boolean; error?: string }[] = [];
    for (const org of organizations) {
      try {
        // One failing hotel must not stop the others' digests.
        const r = await sendDailyOperationalDigest(org.id);
        results.push({ organization: org.name, sent: r.sent });
        console.log(`[Daily Digest Cron] ${org.name}: sent=${r.sent}`);
      } catch (e: any) {
        results.push({ organization: org.name, sent: false, error: e?.message });
        console.error(`[Daily Digest Cron] ${org.name} failed:`, e?.message);
      }
    }

    return NextResponse.json({
      organizations: results.length,
      sent: results.filter((r) => r.sent).length,
      results,
    });
  } catch (error: any) {
    console.error('[Daily Digest Cron] Error:', error?.message);
    return NextResponse.json({ error: error?.message }, { status: 500 });
  }
}
