import { NextResponse } from 'next/server';
import { getSql } from '@core/db/async';

/**
 * GET /api/health — is the application alive AND is the database readable.
 *
 * Exists for the EXTERNAL uptime monitor. The deploy's own health check is a
 * POST to /api/auth/login — the right probe for a one-off check, and exactly
 * the wrong one for a monitor: failed logins are counted per IP and locked
 * out for 15 minutes, so a monitor poking it every minute would block itself
 * and then report an outage that is not there.
 *
 * This route answers the same underlying question — "does a request reach a
 * table?" — without touching the login counter. `organizations` is one of the
 * tables deliberately outside row-level security (it is read before a tenant
 * is known — see ARCHITECTURE §3), so an empty tenant context here is fine
 * and no tenant data can leak: the response carries a boolean, never rows.
 *
 * GET /login proves only that the bundle serves; a build that could not load
 * its database driver once passed that while every data route returned 500.
 * That is why this reads the database and 503s when it cannot.
 */
export async function GET() {
  try {
    const sql = getSql();
    await sql.row('SELECT count(*) AS n FROM organizations');
    return NextResponse.json({ ok: true });
  } catch (e) {
    // Deliberately no e.message in the body (invariant 6) — the monitor needs
    // a status, the detail belongs to the server log.
    console.error('[health] database unreachable:', e);
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
