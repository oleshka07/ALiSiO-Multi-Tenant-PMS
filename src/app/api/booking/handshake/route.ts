import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import crypto from 'crypto';
import { withSite } from '@/modules/widget/data/site.repo';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    // As the hotel the site names: a handshake token belongs to one, and the
    // insert was refused by its policy — the caller is a guest with no tenant.
    return (await withSite(searchParams.get('siteSlug') || searchParams.get('siteId'), async () => {
    const sql = getSql();
    const siteSlug = searchParams.get('siteSlug') || '';
    const siteId = searchParams.get('siteId') || '';

    // The table is created by the boot migration and is in
    // db/postgres/schema.sql. Creating it per request was free on SQLite
    // and impossible on Postgres, where the application's role owns nothing:
    // "permission denied for schema public".

    // Clean up expired handshakes
    await sql.run(`
      DELETE FROM widget_handshakes 
      WHERE expires_at < CURRENT_TIMESTAMP
    `);

    // Resolve site configuration to check if authorized
    let resolvedSiteId = siteId;
    let allowedSiteUrl = null;
    if (siteSlug || siteId) {
      const site = await sql.row<{ id: string; site_url: string | null }>(`
        SELECT id, site_url 
        FROM booking_sites 
        WHERE (slug = ? OR id = ?) AND status != 'deleted'
      `, [siteSlug || siteId, siteSlug || siteId]);
      
      if (site) {
        resolvedSiteId = site.id;
        allowedSiteUrl = site.site_url;
      }
    }

    // CORS check: Validate origin if site_url is configured
    const origin = request.headers.get('origin');
    const responseHeaders = { ...CORS_HEADERS };
    
    if (origin && allowedSiteUrl) {
      try {
        const originHost = new URL(origin).hostname;
        const allowedHost = new URL(allowedSiteUrl.startsWith('http') ? allowedSiteUrl : `https://${allowedSiteUrl}`).hostname;
        
        if (
          originHost !== allowedHost && 
          !originHost.endsWith(`.${allowedHost}`) && 
          originHost !== 'localhost' && 
          originHost !== '127.0.0.1'
        ) {
          return NextResponse.json({ error: 'Origin not authorized' }, { status: 403, headers: CORS_HEADERS });
        }
        responseHeaders['Access-Control-Allow-Origin'] = origin;
      } catch (e) {
        // Fallback to default CORS
      }
    } else if (origin) {
      responseHeaders['Access-Control-Allow-Origin'] = origin;
    }

    // Generate secure token
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString().replace('T', ' ').replace(/\..+/, ''); // 10 minutes from now

    await sql.run(`
      -- organization_id, from the site the handshake belongs to. Left to the
      -- column DEFAULT it was NULL on SQLite; the token then belonged to no
      -- hotel, and the policy that is meant to protect it had nothing to match.
      INSERT INTO widget_handshakes (token, organization_id, site_id, expires_at)
      VALUES (?, (SELECT organization_id FROM booking_sites WHERE id = ?), ?, ?)
    `, [token, resolvedSiteId, resolvedSiteId, expiresAt]);

    return NextResponse.json({ token }, { headers: responseHeaders });
    })) ?? NextResponse.json({ error: 'Unknown site' }, { status: 404, headers: CORS_HEADERS });
  } catch (error: any) {
    console.error('Handshake error:', error?.message || error);
    return NextResponse.json({ error: 'Handshake failed' }, { status: 500, headers: CORS_HEADERS });
  }
}
