/**
 * Лист «Kiosk heute» о 7:00 — по всіх готелях, кожному на адресу обʼєкта.
 *
 * Секрет — той самий, що в решти кронів (`cronAuthFailure`): будить його
 * розклад, а не людина. `failedOrganizations` у відповіді — не прикраса: саме
 * за ним `deploy/run-cron.sh` відрізняє «крон відпрацював» від «крон
 * відповів 200», і саме його бракувало кронам, які роками мовчки не робили
 * нічого.
 */
import { NextRequest, NextResponse } from 'next/server';
import { cronAuthFailure } from '@core/security/cron-auth';
import { serverError } from '@core/http/errors';
import { sendKioskDayMails } from '@/apps/kiosk/data/today-mail';

export async function GET(request: NextRequest) {
  const denied = cronAuthFailure(request);
  if (denied) return denied;

  try {
    const result = await sendKioskDayMails();
    const failed = result.failedOrganizations > 0;
    return NextResponse.json({
      success: !failed,
      message: `Kiosk day mail: sent ${result.sent}, skipped ${result.skipped} property(ies) with no live terminal`
        + (result.withoutAddress > 0
          ? `; ${result.withoutAddress} property(ies) HAVE a terminal but no e-mail address — nobody is reading the day`
          : '')
        + (failed ? `; ${result.failedOrganizations} organization(s) failed — see server log.` : '.'),
      sent: result.sent,
      skipped: result.skipped,
      withoutAddress: result.withoutAddress,
      failedOrganizations: result.failedOrganizations,
    }, { status: failed ? 500 : 200 });
  } catch (error: any) {
    console.error('Kiosk day mail cron error:', error);
    return serverError('app/api/cron/kiosk-day GET', error);
  }
}
