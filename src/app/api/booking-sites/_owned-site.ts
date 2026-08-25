/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { getSessionUser, getSessionIdFromCookies } from '@core/auth';
import { runWithOrganization } from '@core/auth/tenant-context';

/**
 * A booking site, if this session's hotel owns it — and a tenant context to
 * work in.
 *
 * Six route files under `booking-sites/[id]/**` checked that a session existed
 * and then queried `WHERE id = ?`. Not one of them called
 * `runWithOrganization`, and the site id is not a secret: the widget hands it
 * out publicly through `/api/booking/site-config?slug=`.
 *
 * That produced two different failures at once, which is why it lasted:
 *
 *   On Postgres the read leaked and the writes broke. `booking_sites` has a
 *   uniquely permissive policy — `OR current_setting('app.organization_id') =
 *   ''` — so with no tenant set, SELECT returned other hotels' rows, including
 *   `design_config`, `widget_config` and `allowed_domains`. The same empty
 *   setting failed every WITH CHECK, so PATCH and DELETE were refused: site
 *   editing was broken for every customer on production, and had been.
 *
 *   On SQLite there is no policy at all, so the same code was plain
 *   cross-tenant read, write and delete — and without a `manage_sites` check
 *   either, so any logged-in receptionist could rewrite another hotel's site.
 *
 * A route that reads the session itself, rather than going through a guard,
 * has to open the tenant context itself. That is what this does, and it
 * returns the site so the caller cannot forget the ownership half.
 *
 * Both belts are here on purpose, and the reintroduction test says why: with
 * `runWithOrganization` in place, removing `AND organization_id = ?` did NOT
 * make the leak come back on Postgres — RLS caught it, because a set tenant
 * makes the policy's `OR … = ''` escape hatch false. Removing the CONTEXT
 * brought it straight back: 200 where 404 belongs. So the context is what
 * holds on Postgres and the explicit filter is what holds on SQLite, where no
 * policy exists at all. Neither one alone covers both engines.
 */
export interface OwnedSite {
  site: any;
  organizationId: string;
  userId: string;
}

/** 401 when there is no session, 404 when the site is not this hotel's. */
export async function withOwnedSite<T>(
  cookieHeader: string | null,
  siteId: string,
  handler: (ctx: OwnedSite) => Promise<T>,
): Promise<T | NextResponse> {
  const session = await getSessionUser(getSessionIdFromCookies(cookieHeader));
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  return runWithOrganization(session.organization_id, async () => {
    const sql = getSql();
    const site = await sql.row<any>(
      "SELECT * FROM booking_sites WHERE id = ? AND organization_id = ? AND status != 'deleted'",
      [siteId, session.organization_id],
    );
    // 404, not 403. Another hotel's site is not a site this caller may learn
    // the existence of, and a site id travels in a public URL.
    if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 });

    return handler({ site, organizationId: session.organization_id, userId: session.id });
  });
}
