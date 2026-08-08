/* eslint-disable @typescript-eslint/no-explicit-any */
//
// Admin-triggered sync — same engine as the daily cron, but gated by
// manage_pricing instead of X-Cron-Secret so the operator can fire it
// from the UI button on /pricing/pricelabs without juggling secrets.
//

import { NextRequest, NextResponse } from 'next/server';
import { withPermission } from '@core/auth/session';
import { syncPriceLabsToCalendar } from '@/modules/pricing/data/pricelabs-sync';

export const POST = withPermission('manage_pricing', async (request: NextRequest): Promise<NextResponse> => {

  const { searchParams } = new URL(request.url);
  const days = Math.min(365, Math.max(1, parseInt(searchParams.get('days') || '90', 10)));

  try {
    const result = await syncPriceLabsToCalendar(days);
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'sync failed' }, { status: 500 });
  }
});
