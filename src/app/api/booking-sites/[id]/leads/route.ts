/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { serverError } from '@core/http/errors';
import { withOwnedSite } from '../../_owned-site';

/**
 * The enquiries a site's contact form collected.
 *
 * `site_incoming_leads` has existed since the Form Capture migration, the
 * analytics funnel counts its rows, and the site page has a «Форми» tab in its
 * tab bar — but the component behind that tab was never written, so clicking
 * it opened an empty panel. Whatever a guest wrote to the hotel through the
 * form went into a table nobody in the product could read.
 *
 * That is the shape of the bug worth naming: not «a feature is missing», but
 * «somebody wrote to this hotel and nobody ever saw it». An older table was
 * migrated INTO this one, so on a customer's database these rows are not
 * hypothetical.
 *
 * Ownership goes through withOwnedSite, like the rest of booking-sites/[id]:
 * a site id travels in a public URL, and these rows are a stranger's name,
 * e-mail, phone and message.
 */

type IdParams = { params: Promise<{ id: string }> };

const STATUSES = ['new', 'read', 'archived'] as const;

export async function GET(request: NextRequest, { params }: IdParams) {
  try {
    const { id } = await params;
    const status = new URL(request.url).searchParams.get('status');
    return await withOwnedSite(request.headers.get('cookie'), id, async ({ site }) => {
      const sql = getSql();
      const filtered = status && (STATUSES as readonly string[]).includes(status);
      const rows = await sql.rows<any>(
        `SELECT id, full_name, email, phone, message, status, created_at
           FROM site_incoming_leads
          WHERE site_id = ?${filtered ? ' AND status = ?' : ''}
          ORDER BY created_at DESC
          LIMIT 500`,
        filtered ? [site.id, status] : [site.id],
      );
      const counts = await sql.rows<any>(
        'SELECT status, COUNT(*) AS c FROM site_incoming_leads WHERE site_id = ? GROUP BY status',
        [site.id],
      );
      const byStatus: Record<string, number> = { new: 0, read: 0, archived: 0 };
      for (const row of counts) byStatus[String(row.status)] = Number(row.c) || 0;
      return NextResponse.json({ leads: rows, counts: byStatus });
    });
  } catch (error: unknown) {
    return serverError('api/booking-sites/[id]/leads GET', error);
  }
}

/** Mark one enquiry read or archived. The message itself is never edited. */
export async function PATCH(request: NextRequest, { params }: IdParams) {
  try {
    const { id } = await params;
    const body = await request.json();
    const leadId = String(body?.id || '');
    const status = String(body?.status || '');
    if (!leadId) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    if (!(STATUSES as readonly string[]).includes(status)) {
      return NextResponse.json(
        { error: `status must be one of ${STATUSES.join(', ')}` }, { status: 400 });
    }

    return await withOwnedSite(request.headers.get('cookie'), id, async ({ site }) => {
      const sql = getSql();
      // site_id is named as well as the lead id: the lead id alone would let
      // one of this hotel's users move another hotel's enquiry.
      const lead = await sql.row<any>(
        'SELECT id FROM site_incoming_leads WHERE id = ? AND site_id = ?', [leadId, site.id]);
      if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

      await sql.run('UPDATE site_incoming_leads SET status = ? WHERE id = ? AND site_id = ?',
        [status, leadId, site.id]);
      return NextResponse.json({ ok: true, id: leadId, status });
    });
  } catch (error: unknown) {
    return serverError('api/booking-sites/[id]/leads PATCH', error);
  }
}
