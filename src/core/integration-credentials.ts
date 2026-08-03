/* eslint-disable @typescript-eslint/no-explicit-any */
import { getDb } from './db/index.ts';

/**
 * Whose Hostex account is this? Whose PriceLabs key?
 *
 * Until now: the server's. `process.env.HOSTEX_ACCESS_TOKEN` and
 * `PRICELABS_API_KEY` are single values for the whole process, so every
 * organization on the box shared one channel-manager account. The feature
 * registry could switch Hostex OFF for a hotel, but it could not give two
 * hotels their own — turning it on for the second would have pointed it at
 * the first one's listings.
 *
 * channel_credentials already had the right shape (organization_id, channel,
 * client_id/secret/access_token) — it was built for Booking.com and never
 * used for anything else. This reads it for any integration, and falls back
 * to the environment so the existing single-tenant install keeps working
 * until its owner saves credentials in the UI.
 */

export type IntegrationChannel = 'hostex' | 'pricelabs' | 'booking_com' | 'telegram';

export interface IntegrationCredentials {
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
  /** true when the values came from the organization rather than the server. */
  perOrganization: boolean;
}

/** The environment fallback for each channel — one server-wide account. */
function fromEnv(channel: IntegrationChannel): IntegrationCredentials | null {
  const env = process.env;
  switch (channel) {
    case 'hostex':
      return env.HOSTEX_ACCESS_TOKEN ? { accessToken: env.HOSTEX_ACCESS_TOKEN, perOrganization: false } : null;
    case 'pricelabs':
      return env.PRICELABS_API_KEY ? { accessToken: env.PRICELABS_API_KEY, perOrganization: false } : null;
    case 'telegram':
      return env.TELEGRAM_BOT_TOKEN ? { accessToken: env.TELEGRAM_BOT_TOKEN, perOrganization: false } : null;
    case 'booking_com':
      return env.BOOKING_COM_CLIENT_ID
        ? { clientId: env.BOOKING_COM_CLIENT_ID, clientSecret: env.BOOKING_COM_CLIENT_SECRET, perOrganization: false }
        : null;
    default:
      return null;
  }
}

/**
 * The organization's own credentials, or the server's, or nothing.
 *
 * `organizationId` is optional because some call sites (a cron tick, a
 * webhook) have no session yet. Those get the environment only — which is
 * correct: a background job cannot guess whose account to use, and silently
 * picking one hotel's would be the bug this whole file exists to prevent.
 */
export function integrationCredentials(
  channel: IntegrationChannel,
  organizationId?: string | null,
): IntegrationCredentials | null {
  if (organizationId) {
    try {
      const row = getDb().prepare(`
        SELECT client_id, client_secret, access_token
        FROM channel_credentials
        WHERE organization_id = ? AND channel = ?
        ORDER BY updated_at DESC LIMIT 1
      `).get(organizationId, channel) as
        { client_id?: string; client_secret?: string; access_token?: string } | undefined;

      if (row && (row.access_token || row.client_id)) {
        return {
          clientId: row.client_id || undefined,
          clientSecret: row.client_secret || undefined,
          accessToken: row.access_token || undefined,
          perOrganization: true,
        };
      }
    } catch {
      // The table predates this function on some databases; the env fallback
      // below is the same answer the code gave before.
    }
  }
  return fromEnv(channel);
}

/** Is this integration usable at all for this organization? */
export function integrationConfigured(
  channel: IntegrationChannel,
  organizationId?: string | null,
): boolean {
  return !!integrationCredentials(channel, organizationId);
}
