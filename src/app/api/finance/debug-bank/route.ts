import { NextResponse } from 'next/server';

/**
 * Disabled.
 *
 * This read every PDF out of a hard-coded `temporary/bank Rest` folder on the
 * server's disk and imported them as bank statements. That folder was one
 * developer's working directory for one hotel's Komerční banka exports; it does
 * not exist anywhere else, so the route answered 500 on every call.
 *
 * Bulk statement import is a real feature and it already exists behind
 * /api/finance/import — with an upload, a preview and an audit trail. A route
 * that ingests whatever happens to be lying in a directory is not a debug tool
 * on a shared server; it is a way to file one customer's bank statements
 * against another.
 *
 * Answers 410 rather than being deleted, so an unnoticed caller fails loudly.
 */
export function GET() {
  return NextResponse.json(
    { error: 'This endpoint is disabled. Use /api/finance/import.', code: 'GONE' },
    { status: 410 },
  );
}
