import { getWidgetPriceList } from '@widget';
import { NextResponse } from 'next/server';

/**
 * Public, read-only price list for the embedded widget.
 *
 * PUT used to live here. This path is exempted from the middleware by the
 * '/api/widget' public prefix and serves Access-Control-Allow-Origin: *, so an
 * unauthenticated PUT from any website returned 200 and rewrote the tenant's
 * published prices. Editing moved to /api/pricing/widget-list, behind a session.
 *
 * The wildcard origin stays — the widget is embedded on customer domains — but
 * only GET is reachable with it.
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export const OPTIONS = () => new NextResponse(null, { status: 204, headers: CORS });

export const GET = async (req: Request) => {
  const res = await getWidgetPriceList(req);
  Object.entries(CORS).forEach(([k, v]) => res.headers.set(k, v));
  return res;
};
