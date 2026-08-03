/* eslint-disable @typescript-eslint/no-explicit-any */
import { getSql } from '@core/db/async';
import { getDb } from '@core/db';
import { hasFeature } from '@core/features';
import type { ResolvedSiteCredentials } from '../domain/types';
import { getEnvStore } from '../api/create-payment-session';

export async function resolveSiteCredentials(opts: { slug?: string | null; id?: string | null }): Promise<ResolvedSiteCredentials | null> {
  const slug = opts.slug || undefined;
  const id = opts.id || undefined;
  if (!slug && !id) return null;

  const sql = getSql();
  const site = slug
    ? await sql.row<any>('SELECT id, payment_config, site_url FROM booking_sites WHERE slug = ?', [slug])
    : await sql.row<any>('SELECT id, payment_config, site_url FROM booking_sites WHERE id = ?', [id!]);

  if (!site) return null;

  let payCfg: any = {};
  try {
    payCfg = JSON.parse(site.payment_config || '{}');
  } catch {
    return null;
  }

  const enabled = payCfg.enabled && payCfg.provider === 'teya' && payCfg.teya?.client_id;

  if (enabled) {
    return {
      siteId: site.id,
      siteUrl: site.site_url || undefined,
      credentials: {
        client_id: payCfg.teya.client_id,
        client_secret: payCfg.teya.client_secret,
        store_id: payCfg.teya.store_id,
      },
    };
  }

  // A site may point at one of the server's named env stores instead of
  // carrying its own keys. Which store used to be decided by two literal site
  // ids and a slug from the first customer; the site now says so itself.
  // Without that key the answer is null and the caller falls back to the
  // global env credentials, exactly as before.
  if (payCfg.store === 'camping' || payCfg.store === 'glamping') {
    const envStore = getEnvStore(payCfg.store);
    if (envStore?.client_id) {
      return {
        siteId: site.id,
        siteUrl: site.site_url || undefined,
        credentials: envStore,
      };
    }
  }

  return null;
}

export function isGlobalTeyaConfigured(): boolean {
  return !!process.env.TEYA_CLIENT_ID;
}

/**
 * Does this organization take online payments at all?
 *
 * The feature comes first: an organization that has not bought Teya has no
 * payments no matter what env vars are set on the server. Then either one of
 * its sites carries a working Teya config, or the transitional global env
 * credentials exist. Callers ask this — not "is Teya configured" — so a second
 * provider changes this function, not every caller.
 */
export async function isPaymentConfigured(organizationId: string): Promise<boolean> {
  const sql = getSql();
  if (!hasFeature(getDb(), organizationId, 'teya')) return false;
  const sites = await sql.rows<{ payment_config: string }>(
    'SELECT payment_config FROM booking_sites WHERE organization_id = ?', [organizationId],
  );
  for (const s of sites) {
    try {
      const cfg = JSON.parse(s.payment_config || '{}');
      if (cfg.enabled && cfg.provider === 'teya' && cfg.teya?.client_id) return true;
    } catch { /* malformed config is not a configured payment */ }
  }
  return isGlobalTeyaConfigured();
}
