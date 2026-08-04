/* eslint-disable @typescript-eslint/no-explicit-any */
import { getSql } from '@core/db/async';

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
