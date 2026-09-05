import { NextRequest, NextResponse } from 'next/server';
import { cronAuthFailure } from '@core/security/cron-auth';
import { serverError } from '@core/http/errors';
import { anonymizeOldRegistrations } from '@guests';
import { purgeChannelSendLogs } from '@channels';

export async function GET(request: NextRequest) {
  // Anonymises six-year-old registrations. It used to refuse only when
  // NODE_ENV was production, against a secret that defaulted to a word printed
  // in this file — so in every other environment it ran for anyone who asked.
  const denied = cronAuthFailure(request);
  if (denied) return denied;

  try {
    // One implementation for both retention endpoints. This route carried its
    // own inline copy of the three statements while api/guests/gdpr-cron had
    // another, and the copies drifted until one of them anonymised columns
    // its table does not have — while this one wiped guest profiles that had
    // no stays at all. The shared function (registration.repo.ts) fixes both;
    // 72 months is the six-year Evidenční kniha period this route always used.
    const result = await anonymizeOldRegistrations(72);
    // Журнал відправлень до менеджера каналів (Блок 0.5 п.4): тіла без ПІБ,
    // але й не назавжди — 90 днів, по кожній організації в її контексті.
    const sends = await purgeChannelSendLogs();

    const failed = result.failedOrganizations > 0 || sends.failedOrganizations > 0;
    return NextResponse.json({
      success: !failed,
      message: `Data retention: anonymized ${result.registrations} registration records and `
        + `${result.guests} guest profiles; purged ${sends.deleted} channel send log rows.`
        + (failed ? ` ${result.failedOrganizations + sends.failedOrganizations} organization(s) failed — see server log.` : ''),
      anonymizedCount: result.registrations,
      anonymizedGuests: result.guests,
      purgedSendLogs: sends.deleted,
      failedOrganizations: result.failedOrganizations + sends.failedOrganizations,
    }, { status: failed ? 500 : 200 });
  } catch (error: any) {
    console.error('GDPR Retention Cron Error:', error);
    return serverError('app/api/cron/gdpr-retention GET', error);
  }
}
