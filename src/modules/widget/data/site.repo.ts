/* eslint-disable @typescript-eslint/no-explicit-any */
import { getSql } from '@core/db/async';
import { requireOrganizationId, runWithOrganization } from '@core/auth/tenant-context';

/**
 * Finding a booking site, and deciding which hosts it trusts.
 *
 * Both questions used to be answered with the first customer's domain written
 * into the source: `slug === 'kv.kemp-carlsbad.cz'`, `targetHost.includes(
 * 'kemp-carlsbad.cz')`, `originHost !== 'kemp-carlsbad-cz.onrender.com'`. Every
 * later hotel would have needed its own line in the same conditions.
 *
 * booking_sites.allowed_domains has existed since an early migration and the
 * settings API already accepts writes to it — nothing ever read it. This is
 * that column being read.
 */

export interface SiteRow {
  id: string;
  slug?: string | null;
  site_url?: string | null;
  allowed_domains?: string | null;
  [key: string]: any;
}

/** Hostname of a URL that may arrive bare ("example.com") or full. */
function hostOf(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value.startsWith('http') ? value : `https://${value}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** The extra hosts this site declares, from the comma- or JSON-list column. */
function extraHosts(site: SiteRow): string[] {
  const raw = site.allowed_domains;
  if (!raw) return [];
  let list: string[];
  try {
    const parsed = JSON.parse(raw);
    list = Array.isArray(parsed) ? parsed.map(String) : String(parsed).split(',');
  } catch {
    list = raw.split(',');
  }
  return list.map((d) => hostOf(d.trim())).filter((h): h is string => !!h);
}

/**
 * May the widget of this site be embedded on — or redirect to — this host?
 *
 * The site's own domain and its subdomains always; anything the hotel listed
 * in allowed_domains; localhost for development. A site that declares no
 * domain at all trusts everyone, which is what an unconfigured widget did
 * before and what the embed flow still depends on.
 */
export function siteAllowsHost(site: SiteRow | null | undefined, host: string | null): boolean {
  if (!host) return false;
  const target = host.toLowerCase();
  if (target === 'localhost' || target === '127.0.0.1') return true;
  if (!site) return false;

  const own = hostOf(site.site_url);
  if (!own && extraHosts(site).length === 0) return true;

  if (own && (target === own || target.endsWith(`.${own}`))) return true;
  return extraHosts(site).some((h) => target === h || target.endsWith(`.${h}`));
}

/**
 * Find a site by whatever the widget sent: its id, its slug, or the hostname
 * it is running on. The hostname path is what the hardcoded slug aliases were
 * standing in for — a widget on kv.example.com finds the site whose site_url
 * or allowed_domains names that host, without anyone editing this file.
 */
/**
 * The public entry point: find the hotel, then act as it.
 *
 * A guest is not a tenant. The widget arrives with a site key — a slug, an id,
 * or the hostname it is embedded on — and nothing else, and every authenticated
 * route in this codebase gets its organization from a guard before the handler
 * runs (see core/auth/session.ts). The public routes had no such guard: they
 * filtered by ids the caller supplied and never established a tenant, which
 * works on SQLite, where nothing checks, and returns an empty page on Postgres,
 * where every policy does.
 *
 * So this is that guard. The lookup itself runs before any organization is set
 * — booking_sites is readable then, and only then, and only for reading — and
 * everything the handler does afterwards runs as the site's organization.
 *
 * Returns null when the key names no site, so the caller picks the status code
 * rather than being handed one.
 */
export async function withSite<T>(
  key: string | null | undefined,
  fn: (site: SiteRow | undefined) => Promise<T>,
): Promise<T | null> {
  // Every column, deliberately: a caller that narrowed the list and forgot
  // organization_id would get null back and answer 404, which looks exactly
  // like an unknown site.
  const site = key ? await resolveSiteByKey(key) : undefined;

  // A key that names nothing is a real 404. No key at all is the widget the
  // first customer embedded before sites existed — useBookingWidget still sends
  // siteId only `if (siteId)` — so it falls back the way the rest of the
  // codebase does: the sole organization, or a refusal once there is more than
  // one. Nothing here guesses which hotel a guest meant.
  if (key && !site) return null;

  let organizationId: string;
  if (site?.organization_id) {
    organizationId = String(site.organization_id);
  } else {
    // requireOrganizationId throws once there is more than one hotel, which is
    // correct for a handler that forgot to scope itself and wrong here: this
    // is a public route being asked "which hotel?" and answering "none named".
    // Thrown, it reached the catch as a 500; returned, the caller says 404.
    try {
      organizationId = await requireOrganizationId();
    } catch {
      return null;
    }
  }

  return runWithOrganization(organizationId, () => fn(site));
}

export async function resolveSiteByKey(key: string | null | undefined, columns = '*'): Promise<SiteRow | undefined> {
  const sql = getSql();
  if (!key) return undefined;

  const direct = await sql.row<any>(`SELECT ${columns} FROM booking_sites WHERE slug = ? OR id = ?`, [key, key]) as SiteRow | undefined;
  if (direct) return direct;

  const host = hostOf(key);
  if (!host) return undefined;

  const candidates = await sql.rows<any>(`SELECT ${columns} FROM booking_sites WHERE site_url IS NOT NULL OR allowed_domains IS NOT NULL`) as SiteRow[];
  return candidates.find((s) => {
    const own = hostOf(s.site_url);
    if (own && (host === own || host.endsWith(`.${own}`))) return true;
    return extraHosts(s).some((h) => host === h || host.endsWith(`.${h}`));
  });
}
