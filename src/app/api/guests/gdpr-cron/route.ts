import { NextResponse } from 'next/server';
import { anonymizeOldRegistrations } from '@guests';
import { serverError } from '@core/http/errors';

export async function GET(request: Request) {
  // Fails closed. This used to run unauthenticated whenever CRON_SECRET was
  // unset, and it permanently anonymises guest records — the one operation in
  // the system that cannot be undone.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 503 });
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // 72 months = the six-year Evidenční kniha duty, the same period the
    // two-step erasure in gdpr.handlers.ts waits out. ?months=X can shorten
    // it, but a shorter registry retention is an operator's explicit
    // decision, never a default — the old default of 6 would have wiped a
    // registry the law says to keep for six years.
    const { searchParams } = new URL(request.url);
    const monthsParam = searchParams.get('months');
    const months = monthsParam ? parseInt(monthsParam, 10) : 72;
    // Refused here as well as in the repository: a bad window on this endpoint
    // should be a 400 the caller can see, not an exception in a cron log.
    if (!Number.isInteger(months) || months < 1 || months > 600) {
      return NextResponse.json(
        { error: 'months must be a whole number between 1 and 600' },
        { status: 400 },
      );
    }

    const result = await anonymizeOldRegistrations(months);

    // A tenant whose pass failed must show up here, not only in the log: the
    // per-organization catch once swallowed a broken UPDATE for every tenant
    // and this endpoint reported { success: true, anonymizedCount: 0 } —
    // indistinguishable from "nothing was due". A failed tenant now turns
    // the whole response into a 500 a cron monitor can alert on.
    const failed = result.failedOrganizations > 0;
    return NextResponse.json({
      success: !failed,
      message: `GDPR CRON: Anonymized ${result.registrations} registration records and `
        + `${result.guests} guest profiles older than ${months} months.`
        + (failed ? ` ${result.failedOrganizations} organization(s) failed — see server log.` : ''),
      anonymizedCount: result.registrations,
      anonymizedGuests: result.guests,
      failedOrganizations: result.failedOrganizations,
    }, { status: failed ? 500 : 200 });
  } catch (err: any) {
    console.error('[GDPR Cron Error]:', err);
    return serverError('app/api/guests/gdpr-cron GET', err, 'Failed');
  }
}
