import { NextResponse } from 'next/server';

/**
 * The one way a scheduled job proves it is the scheduler.
 *
 * There were five spellings of this check and three of them failed OPEN:
 *
 *   process.env.CRON_SECRET || 'local-cron'    // a password printed in the source
 *   if (!CRON_SECRET) return true;             // unset means everyone
 *   (no check at all)                          // /api/cron/abandoned-carts
 *
 * On its own each looks like a convenience for local development. Together
 * with `deploy/docker-compose.yml`, which passed a hand-kept list of seven
 * variables into the container and did not include CRON_SECRET, they meant the
 * secret was permanently undefined **in production** — so the fallback was not
 * a dev convenience, it was the live configuration. `GET /api/cron/guest-reminders`
 * with `Authorization: Bearer local-cron` answered 200 on the running build:
 * anyone on the internet could make the server email every guest, anonymise
 * registrations, or start a channel sync.
 *
 * So: unset is 503, not "allow". A job that cannot authenticate must not run,
 * and the operator must find out from a failing cron rather than from a guest
 * asking why they got the same letter four times.
 *
 * Accepts either spelling the crontab entries already use — `X-Cron-Secret:`
 * or `Authorization: Bearer` — because both are in service and rewriting the
 * server's crontab is not part of a security fix.
 */
export function cronAuthFailure(request: Request): NextResponse | null {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: 'CRON_SECRET is not configured on the server' },
      { status: 503 },
    );
  }

  const header = request.headers.get('x-cron-secret')
    || request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    || '';

  if (header !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}

/**
 * As above, for the jobs that carry their own secret rather than the shared
 * one — an iCal feed puller and the Hostex webhook, each with its own value so
 * that handing a channel manager a URL does not hand it the crontab.
 */
export function secretAuthFailure(request: Request, envName: string): NextResponse | null {
  const expected = process.env[envName];
  if (!expected) {
    return NextResponse.json(
      { error: `${envName} is not configured on the server` },
      { status: 503 },
    );
  }

  const header = request.headers.get('x-cron-secret')
    || request.headers.get(envName === 'HOSTEX_WEBHOOK_SECRET' ? 'hostex-webhook-secret-token' : 'x-webhook-secret')
    || request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    || new URL(request.url).searchParams.get('secret')
    || '';

  if (header !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}
