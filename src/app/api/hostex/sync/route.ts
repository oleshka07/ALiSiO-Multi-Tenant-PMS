import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import { hostexSync, hostexSyncStatus } from '@channels';
import { getSql } from '@core/db/async';

const CRON_SECRET = process.env.CRON_SECRET || '';

/** Check if the request has a valid session (logged-in user) */
async function hasValidSession(request: NextRequest): Promise<boolean> {
  const sessionId = request.cookies.get('session_id')?.value;
  if (!sessionId) return false;
  try {
    const sql = getSql();
    const session = await sql.row<{ id: string }>('SELECT id FROM sessions WHERE id = ?', [sessionId]);
    return !!session;
  } catch {
    return false;
  }
}

/** Auth: accept cron secret OR valid session cookie */
async function isAuthorized(request: NextRequest): Promise<boolean> {
  // Cron secret (header or query param)
  if (CRON_SECRET) {
    const secret = request.headers.get('x-cron-secret')
      || new URL(request.url).searchParams.get('secret');
    if (secret === CRON_SECRET) return true;
  }
  // Logged-in user (session cookie) — the calendar's «sync now» button.
  if (await hasValidSession(request)) return true;
  // An unset CRON_SECRET used to mean "allow anyone". In production it WAS
  // unset — docker-compose never passed it into the container — so this line
  // was not a dev convenience, it was the live configuration of a route that
  // pulls a channel manager's reservations.
  return false;
}

// POST /api/hostex/sync — triggered by cron OR calendar UI button
export async function POST(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return await hostexSync();
}

// GET /api/hostex/sync — sync status. Session-only: the caller is the calendar
// UI, and the withActor wrapper inside also checks the hostex feature.
export const GET = hostexSyncStatus;
