/**
 * Кімнати, які ніхто не підтвердив, повертаються в продаж.
 *
 * Секрет — той самий, що в решти кронів: будить його розклад, а не людина.
 * `failedOrganizations` у відповіді не прикраса — саме за ним
 * `deploy/run-cron.sh` відрізняє «крон відпрацював» від «крон відповів 200».
 */
import { NextRequest, NextResponse } from 'next/server';
import { cronAuthFailure } from '@core/security/cron-auth';
import { serverError } from '@core/http/errors';
import { releaseExpiredHolds } from '@/apps/guest-app/data/release-holds';

export async function GET(request: NextRequest) {
  const denied = cronAuthFailure(request);
  if (denied) return denied;

  try {
    const result = await releaseExpiredHolds();
    const failed = result.failedOrganizations > 0;
    return NextResponse.json({
      success: !failed,
      message: `Guest app holds: released ${result.released} unconfirmed booking(s)`
        + (failed ? `; ${result.failedOrganizations} organization(s) failed — see server log.` : '.'),
      released: result.released,
      failedOrganizations: result.failedOrganizations,
    }, { status: failed ? 500 : 200 });
  } catch (error: any) {
    console.error('Guest app holds cron error:', error);
    return serverError('app/api/cron/guest-app-holds GET', error);
  }
}
