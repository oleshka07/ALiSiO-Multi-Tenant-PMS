/**
 * The public origin of this deployment.
 *
 * Twenty places used to build guest links, invoice links and messenger deep
 * links from a literal `https://alisio.swipescape.eu`, usually as the fallback
 * of an environment variable — and across three different variable names
 * (NEXT_PUBLIC_APP_URL, NEXT_PUBLIC_BASE_URL, NEXTAUTH_URL). A deployment that
 * set only one of them silently mailed another operator's domain to its guests.
 *
 * One resolver, one canonical variable, the legacy names accepted so existing
 * deployments keep working, and no real domain as a fallback: an unconfigured
 * instance yields a relative URL, which is wrong-looking in an email but cannot
 * send anybody to somebody else's site.
 *
 * ponytail: one origin per deployment. Once tenants get their own domains this
 * reads the organization's configured host instead.
 */
const LEGACY_VARS = ['NEXT_PUBLIC_APP_URL', 'NEXT_PUBLIC_BASE_URL', 'NEXTAUTH_URL', 'PUBLIC_APP_URL'] as const;

function resolve(): string {
  const candidates = [process.env.APP_URL, ...LEGACY_VARS.map((v) => process.env[v])];
  for (const c of candidates) {
    const trimmed = c?.trim().replace(/\/+$/, '');
    if (trimmed) return trimmed;
  }
  return '';
}

/** Origin without a trailing slash, or '' when nothing is configured. */
export function appBaseUrl(): string {
  return resolve();
}

/** Absolute URL for `path` when an origin is configured, otherwise the path itself. */
export function appUrl(path: string): string {
  const base = resolve();
  const p = path.startsWith('/') ? path : `/${path}`;
  return base ? `${base}${p}` : p;
}

/** True when links leaving the system (emails, external messages) will be absolute. */
export function appUrlConfigured(): boolean {
  return resolve() !== '';
}
