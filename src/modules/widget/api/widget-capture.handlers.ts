/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { runWithOrganization } from '@core/auth/tenant-context';
import { hasFeature, featureDisabled } from '@core/features';
import { checkRateLimit } from '@core/security/rate-limit';
import { foldFormIntoLead, isEmptyLead, isTrapped } from '../domain/lead-form';

/**
 * The other half of `public/widget/collector.js`.
 *
 * That snippet is what a hotel pastes into the <head> of its own website. It
 * listens for every form submission on the page and POSTs the fields here.
 * `site_incoming_leads` exists to receive them, the analytics funnel counts
 * its rows, and the site page now has a «Форми» tab that reads them.
 *
 * This route did not exist. Not "returned an error": there was no file. The
 * collector's fetch went to a 404, and its own `.catch(function () {})`
 * swallowed that on purpose, so the guest's form still looked like it worked.
 * A hotel that followed the installation instructions has been losing every
 * enquiry since the snippet shipped, with nothing anywhere saying so — not in
 * the browser, not in a log, not in the inbox built to show them.
 *
 * That is the worst shape a bug can take. A button that errors is reported
 * within the hour; a form that says «дякуємо» and drops the message is found
 * out when a guest phones to ask why nobody answered.
 *
 * Public by necessity — it is called from the hotel's own domain, by a browser
 * that has never seen a session. So everything a public write needs is here:
 * the site must exist, its hotel must have the feature, one address gets
 * twenty enquiries an hour, and the honeypot decides silently.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function captureLeadOptions() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function captureLead(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const siteId = typeof body.siteId === 'string' ? body.siteId : '';
    if (!siteId) {
      return NextResponse.json({ error: 'siteId is required' }, { status: 400, headers: CORS_HEADERS });
    }

    const sql = getSql();

    // The site decides which hotel this is. An invented id gets a 404 rather
    // than a row: without it, anyone could file enquiries against any site id
    // they cared to guess, and they would land in a real hotel's inbox.
    const site = await sql.row<any>(
      "SELECT id, organization_id FROM booking_sites WHERE id = ? AND status != 'deleted'",
      [siteId],
    ) as { id: string; organization_id: string } | undefined;
    if (!site) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404, headers: CORS_HEADERS });
    }

    return runWithOrganization(site.organization_id, async () => {
      if (!await hasFeature(site.organization_id, 'booking_engine')) {
        return featureDisabled('booking_engine', CORS_HEADERS);
      }

      const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim()
        || request.headers.get('x-real-ip')
        || 'unknown';
      const limit = await checkRateLimit(`capture:${ip}`, 'registration', 20, 60);
      if (!limit.allowed) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: CORS_HEADERS });
      }

      // The honeypot answers 200 and stores nothing.
      //
      // Telling a bot it was caught teaches whoever wrote it to leave the
      // field alone next time. The hotel sees no row, which is the point, and
      // the page behaves exactly as it does for a person.
      if (isTrapped(body)) {
        return NextResponse.json({ success: true }, { headers: CORS_HEADERS });
      }

      const lead = foldFormIntoLead(body);
      if (isEmptyLead(lead)) {
        return NextResponse.json({ error: 'the form carried no contact and no message' },
          { status: 400, headers: CORS_HEADERS });
      }

      await sql.run(
        `INSERT INTO site_incoming_leads (site_id, full_name, email, phone, message, status)
         VALUES (?, ?, ?, ?, ?, 'new')`,
        [site.id, lead.full_name, lead.email, lead.phone, lead.message],
      );

      return NextResponse.json({ success: true }, { headers: CORS_HEADERS });
    });
  } catch (error: any) {
    console.error('[Capture] error:', error?.message || error);
    return NextResponse.json({ error: 'Failed to capture the form' }, { status: 500, headers: CORS_HEADERS });
  }
}
