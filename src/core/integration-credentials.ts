/* eslint-disable @typescript-eslint/no-explicit-any */
import { getDb } from './db/index.ts';
import { getSql } from './db/async.ts';

/**
 * Whose integration account is this?
 *
 * Until now: the server's. An `API_KEY` in the environment is a single value
 * for the whole process, so every organization on the box shared one account.
 * The feature registry could switch an integration OFF for a hotel, but it
 * could not give two hotels their own — turning it on for the second would
 * have pointed it at the first one's listings. The two integrations that
 * carried that flaw are gone; the seam stays, because the next one will be
 * written against it.
 *
 * channel_credentials already had the right shape (organization_id, channel,
 * client_id/secret/access_token) — it was built for Booking.com and never
 * used for anything else. This reads it for any integration, and falls back
 * to the environment so the existing single-tenant install keeps working
 * until its owner saves credentials in the UI.
 */

export type IntegrationChannel = 'booking_com' | 'fiskaly';

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
    case 'booking_com':
      return env.BOOKING_COM_CLIENT_ID
        ? { clientId: env.BOOKING_COM_CLIENT_ID, clientSecret: env.BOOKING_COM_CLIENT_SECRET, perOrganization: false }
        : null;
    case 'fiskaly':
      return env.FISKALY_API_KEY
        ? { clientId: env.FISKALY_API_KEY, clientSecret: env.FISKALY_API_SECRET, perOrganization: false }
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
export async function integrationCredentials(
  channel: IntegrationChannel,
  organizationId?: string | null,
): Promise<IntegrationCredentials | null> {
  const sql = getSql();
  if (organizationId) {
    try {
      const row = await sql.row<any>(`
        SELECT client_id, client_secret, access_token
        FROM channel_credentials
        WHERE organization_id = ? AND channel = ?
        ORDER BY updated_at DESC LIMIT 1
      `, [organizationId, channel]) as
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
export async function integrationConfigured(
  channel: IntegrationChannel,
  organizationId?: string | null,
): Promise<boolean> {
  return !!await integrationCredentials(channel, organizationId);
}

// ─── The settings screen ──────────────────────────────────────────────────

/**
 * Which secret each integration needs, named the way its own dashboard names
 * it. One list, read by both the API and the screen, so a new integration is
 * one entry rather than three edits that can disagree.
 *
 * Teya is absent on purpose: payments are configured per booking site, not per
 * organization, and that screen already exists (Сайти → Платежі).
 */
export const INTEGRATION_FIELDS: Record<string, { field: 'accessToken' | 'clientId' | 'clientSecret'; label: string; hint?: string }[]> = {
  booking_com: [
    { field: 'clientId', label: 'Client ID' },
    { field: 'clientSecret', label: 'Client secret' },
  ],
  // TSE (KassenSichV). Which TSS and which registered till a PROPERTY uses
  // are identifiers, not secrets — they live in fin_fiscal_settings.
  fiskaly: [
    { field: 'clientId', label: 'API key', hint: 'fiskaly dashboard → SIGN DE' },
    { field: 'clientSecret', label: 'API secret' },
  ],
};

const COLUMN = { accessToken: 'access_token', clientId: 'client_id', clientSecret: 'client_secret' } as const;

/**
 * The last four characters, and nothing else.
 *
 * A settings screen has to show that a key is saved without showing the key:
 * anyone who can open the page can read what it renders, and a token pasted
 * back into a screenshot or a support chat is a token leaked.
 */
function mask(value?: string | null): string | null {
  if (!value) return null;
  return value.length <= 4 ? '••••' : `••••${value.slice(-4)}`;
}

export interface IntegrationStatus {
  channel: string;
  /** Per field: whether it is set, and a hint of the value — never the value. */
  values: Record<string, string | null>;
  /** true when the values are this organization's own, false when the server's. */
  perOrganization: boolean;
  configured: boolean;
}

/** What the settings screen shows for one integration. */
export async function integrationStatus(channel: IntegrationChannel, organizationId: string): Promise<IntegrationStatus> {
  const creds = await integrationCredentials(channel, organizationId);
  const values: Record<string, string | null> = {};
  for (const { field } of INTEGRATION_FIELDS[channel] || []) {
    values[field] = mask(creds?.[field]);
  }
  return {
    channel,
    values,
    perOrganization: !!creds?.perOrganization,
    configured: !!creds,
  };
}

/**
 * Save this organization's own credentials for one integration.
 *
 * An empty string clears a field — that is how an owner takes a key back off
 * the server. Fields not named are left as they were, so saving only a client
 * secret does not silently wipe the client id.
 */
export async function saveIntegrationCredentials(
  organizationId: string,
  channel: IntegrationChannel,
  values: Partial<Record<'accessToken' | 'clientId' | 'clientSecret', string>>,
): Promise<void> {
  const sql = getSql();
  const allowed = new Set((INTEGRATION_FIELDS[channel] || []).map((f) => f.field));
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, value] of Object.entries(values)) {
    if (!allowed.has(key as any)) continue;
    sets.push(`${COLUMN[key as keyof typeof COLUMN]} = ?`);
    params.push(value === '' ? null : value);
  }
  if (!sets.length) return;

  const existing = await sql.row<any>('SELECT id FROM channel_credentials WHERE organization_id = ? AND channel = ?', [organizationId, channel]) as { id: string } | undefined;

  if (existing) {
    await sql.run(`UPDATE channel_credentials SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [...params, existing.id]);
    return;
  }

  const id = `cred_${channel}_${organizationId}`.slice(0, 60);
  await sql.run(`
    INSERT INTO channel_credentials (id, organization_id, channel, environment, created_at, updated_at)
    VALUES (?, ?, ?, 'production', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [id, organizationId, channel]);
  await sql.run(`UPDATE channel_credentials SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [...params, id]);
}
