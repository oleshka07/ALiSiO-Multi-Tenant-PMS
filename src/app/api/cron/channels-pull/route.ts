/**
 * Прочитати стрічки бронювань усіх готелів. З крона, раз на кілька хвилин.
 *
 * Тут — лише автентифікація й відповідь. Усе, що знає про зʼєднання, ключі й
 * контекст орендаря, живе за фасадом модуля (`runChannelPullCron`): маршрут,
 * який сам ходить у таблиці модуля, розходиться з наступним таким маршрутом
 * у тому, кого пропускати, а про кого кричати.
 *
 * Відповідь віддає `success` і `failedOrganizations`, бо `deploy/run-cron.sh`
 * читає ТІЛО, а не код HTTP: «200 і нічого не зробив» — не успіх.
 */
import { NextResponse } from 'next/server';
import { cronAuthFailure } from '@core/security/cron-auth';
import { serverError } from '@core/http/errors';
import { runChannelPullCron } from '@channels';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const denied = cronAuthFailure(request);
  if (denied) return denied;

  try {
    const report = await runChannelPullCron();
    const failed = report.failedOrganizations > 0;

    return NextResponse.json({
      success: !failed,
      ...report,
      message: `${report.applied} booking(s) applied, ${report.duplicates} already seen`
        + (failed ? ` — ${report.failedOrganizations} organization(s) failed, see server log.` : ''),
    }, { status: failed ? 500 : 200 });
  } catch (error: unknown) {
    console.error('[CronChannelsPull] Error:', error);
    return serverError('app/api/cron/channels-pull GET', error);
  }
}
