/* eslint-disable @typescript-eslint/no-explicit-any */
//
// Cron entry point — POST /api/cron/sync-pricelabs.
// Pulls daily prices from PriceLabs for the 6 glamping houses, converts EUR→CZK,
// and upserts into price_calendar so the widget + channel manager see the
// fresh rates.
//
// Authentication mirrors poll-bank-inboxes: caller must present the
// `X-Cron-Secret` header matching `process.env.CRON_SECRET`. The crontab on
// the VPS reads that value from /root/projects/alisio-pms/.env.
//
// Usage in crontab (set up automatically by .github/workflows/deploy.yml):
//   0 4 * * * curl -fsS -X POST -H "X-Cron-Secret: $SECRET" \
//     http://localhost:3000/api/cron/sync-pricelabs
//

import { NextRequest, NextResponse } from 'next/server';
import { syncPriceLabsToCalendar } from '../data/pricelabs-sync';

export async function syncPriceLabsFromCron(request: NextRequest): Promise<NextResponse> {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: 'CRON_SECRET env variable is not configured on the server' },
      { status: 503 },
    );
  }

  const provided = request.headers.get('x-cron-secret');
  if (provided !== expected) {
    return NextResponse.json({ error: 'invalid or missing X-Cron-Secret header' }, { status: 401 });
  }

  // Optional ?days=N override for ad-hoc runs.
  const { searchParams } = new URL(request.url);
  const days = Math.min(365, Math.max(1, parseInt(searchParams.get('days') || '90', 10)));

  try {
    const result = await syncPriceLabsToCalendar(days);

    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } catch (e: any) {
    console.error('[PL cron] sync failed:', e?.message, e?.stack);
    return NextResponse.json({ ok: false, error: e?.message || 'sync failed' }, { status: 500 });
  }
}
