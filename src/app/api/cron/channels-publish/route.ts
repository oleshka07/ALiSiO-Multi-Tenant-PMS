/**
 * Розіслати наявність і ціни в менеджери каналів. З крона, раз на хвилину.
 *
 * Тут — лише автентифікація й відповідь. Усе, що знає про зʼєднання, ключі й
 * контекст орендаря, живе за фасадом модуля (`runChannelPublishCron`).
 *
 * Відповідь віддає `success` і `failedOrganizations`, бо `deploy/run-cron.sh`
 * читає ТІЛО, а не код HTTP. `needsAttention` — у тілі й у повідомленні, але
 * не в `success`: застрягла координата це справа екрана оператора, а
 * червоний крон щохвилини на тиждень усі вчаться ігнорувати.
 */
import { NextResponse } from 'next/server';
import { cronAuthFailure } from '@core/security/cron-auth';
import { serverError } from '@core/http/errors';
import { runChannelPublishCron } from '@channels';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const denied = cronAuthFailure(request);
  if (denied) return denied;

  try {
    const report = await runChannelPublishCron();
    const failed = report.failedOrganizations > 0;

    return NextResponse.json({
      success: !failed,
      ...report,
      message: `${report.sent} coordinate(s) sent in ${report.calls} call(s), ${report.failed} returned`
        + (report.needsAttention ? `, ${report.needsAttention} need attention` : '')
        + (failed ? ` — ${report.failedOrganizations} organization(s) failed, see server log.` : ''),
    }, { status: failed ? 500 : 200 });
  } catch (error: unknown) {
    console.error('[CronChannelsPublish] Error:', error);
    return serverError('app/api/cron/channels-publish GET', error);
  }
}
