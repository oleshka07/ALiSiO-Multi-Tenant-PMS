/**
 * The published report, at /report/<token>.
 *
 * A route handler, not a page: what comes back is a document that was written
 * once and is served back exactly as it was stored. Wrapping it in the
 * application's layout would change it, and a report that renders differently
 * next year is not a report.
 *
 * Registered in PUBLIC_PREFIXES (src/proxy.ts) — the token is the credential.
 */
import { servePartnerReport } from '@reports';
export const GET = servePartnerReport;
export const dynamic = 'force-dynamic';
