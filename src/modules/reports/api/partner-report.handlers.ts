/**
 * Publishing a report, and serving the link it produces.
 *
 * Two audiences with nothing in common. The operator side is ordinary guarded
 * API: owner-only, because publishing puts a month of the hotel's numbers at a
 * URL anyone holding it can open. The public side is a bare GET that returns a
 * document — no session, no JSON envelope, no application shell.
 */
import { NextResponse } from 'next/server';
import { withOwner } from '@core/auth/session';
import { requestPropertyScope } from '@core/auth/property-scope';
import {
  readPublishedReport, recordView, publishReport, listReports, revokeReport, rotateToken,
} from '../data/partner-report.repo';

/**
 * The report itself, at /report/<token>.
 *
 * Headers, and why each one:
 *
 *   X-Robots-Tag  the URL is unguessable but not secret — it travels by email
 *                 and gets pasted into chats. Unguessable stops an attacker;
 *                 this stops a crawler that was handed the link from putting
 *                 the hotel's revenue into a search index.
 *   Cache-Control `private, no-store`: no shared cache — a CDN or a corporate
 *                 proxy must not keep a copy that outlives a revoked link.
 *   CSP           the document is written by us, but it is also arbitrary HTML
 *                 stored in a row. Pinning what it may load means a future
 *                 report — or a mistake in one — cannot quietly call home.
 *
 * A missing, revoked or malformed token all give the same 404. Distinguishing
 * them would tell whoever is guessing which guesses were close.
 */
export async function servePartnerReport(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const report = await readPublishedReport(token);
  if (!report) {
    return new Response(NOT_FOUND_PAGE, {
      status: 404,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  await recordView(report);

  return new Response(report.html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store, max-age=0, must-revalidate',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
      // No Referrer-Policy here on purpose. next.config.ts sets
      // `strict-origin-when-cross-origin` for every path and wins over a
      // header set in the handler — a `no-referrer` written here would look
      // like protection and do nothing. It is not needed: the URL is the
      // secret, and that policy already strips everything but the origin from
      // any cross-origin request, so the token cannot travel in a Referer.
      // X-Frame-Options and X-Content-Type-Options come from there too.
      'Content-Security-Policy': [
        "default-src 'self'",
        // Reports are self-contained documents: styles and behaviour are
        // inline, images are data: URIs. The one exception is the charting
        // library, which every report so far loads from cdnjs.
        "script-src 'unsafe-inline' https://cdnjs.cloudflare.com",
        "style-src 'unsafe-inline'",
        "img-src data: blob:",
        "font-src data:",
        // Nothing in a finished report needs to talk to anything.
        "connect-src 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
        "base-uri 'none'",
      ].join('; '),
    },
  });
}

const NOT_FOUND_PAGE = `<!doctype html>
<html lang="uk"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Звіт недоступний</title>
<style>body{font:16px/1.6 system-ui,sans-serif;margin:0;display:grid;place-items:center;
min-height:100vh;background:#f7f7f8;color:#333}div{text-align:center;padding:2rem}
h1{font-size:1.25rem;margin:0 0 .5rem}p{margin:0;color:#777}</style></head>
<body><div><h1>Звіт недоступний</h1>
<p>Посилання неправильне або більше не діє.</p></div></body></html>`;

// ── Operator side ───────────────────────────────────────────────────────────

/** Every report this hotel has published, with its link and view count. */
export const listPartnerReports = withOwner(async (request, _ctx, actor) => {
  // Область — із запиту: список звітів це список ОБРАНОГО обʼєкта (Д45).
  const reports = await listReports(await requestPropertyScope(request, actor.organizationId));
  return NextResponse.json({ reports });
});

/**
 * Publish an HTML document and get back the link to send.
 *
 * The body carries the finished document — this endpoint does not render one.
 * What produces the HTML (a script, a template, next month an aggregation over
 * the hotel's own data) is deliberately somebody else's problem: this is the
 * part that must not change when that does.
 */
export const publishPartnerReport = withOwner(async (request: Request) => {
  const body = await request.json().catch(() => null) as any;
  if (!body?.html || typeof body.html !== 'string') {
    return NextResponse.json({ error: 'html is required' }, { status: 400 });
  }
  if (!body.title || typeof body.title !== 'string') {
    return NextResponse.json({ error: 'title is required' }, { status: 400 });
  }
  if (body.period != null && !/^\d{4}-\d{2}$/.test(String(body.period))) {
    return NextResponse.json({ error: 'period must be YYYY-MM' }, { status: 400 });
  }

  const report = await publishReport({
    title: body.title,
    html: body.html,
    period: body.period ?? null,
    slug: body.slug ?? null,
    propertyId: body.property_id ?? body.propertyId ?? null,
    replace: body.replace !== false,
  });

  return NextResponse.json({ report, url: `/report/${report.token}` });
});

/** Stop a link working. The report stays; only its address dies. */
export const revokePartnerReport = withOwner(async (
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const done = await revokeReport(id);
  if (!done) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
});

/** A new address for the same report — for when the old link went too far. */
export const rotatePartnerReportToken = withOwner(async (
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const token = await rotateToken(id);
  if (!token) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ token, url: `/report/${token}` });
});
