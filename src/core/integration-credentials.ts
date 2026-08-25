/* eslint-disable @typescript-eslint/no-explicit-any */
import { getDb } from './db/index.ts';
import { getSql } from './db/async.ts';
import { encryptSecret, decryptSecret, secretsConfigured } from './security/secrets.ts';

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
 * client_id/secret/access_token) — it was built for the Connectivity API of
 * Booking.com, which has since been deleted, and the table outlived it. This
 * reads it for any integration, and falls back to the environment so the
 * existing single-tenant install keeps working until its owner saves
 * credentials in the UI.
 */

export type IntegrationChannel = 'fiskaly';

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
    case 'fiskaly':
      return env.FISKALY_API_KEY
        ? { clientId: env.FISKALY_API_KEY, clientSecret: env.FISKALY_API_SECRET, perOrganization: false }
        : null;
    default:
      return null;
  }
}

// ─── Encryption at rest ───────────────────────────────────────────────────

/**
 * A secret in this table is stored encrypted, and it says so.
 *
 * `core/security/secrets.ts` has had AES-256-GCM in it the whole time.
 * `deploy.sh` refuses to start without a 64-hex `APP_SECRET_KEY`, `DEPLOY.md`
 * tells the operator that key encrypts integration credentials — and not one
 * line called `encryptSecret`. Every key a hotel ever pasted into the settings
 * screen sat in `channel_credentials` as readable `TEXT`: in the backups, in
 * any `pg_dump` sent for support, in front of anyone who reached the database
 * through a wholly unrelated bug. The promise was in three files and the
 * implementation in none.
 *
 * The prefix is the point. Without a marker, "is this ciphertext?" has to be
 * guessed from shape, and a guess that goes wrong either decrypts garbage or
 * stores a plaintext key believing it is already sealed. With it, the answer is
 * read, not inferred, and a row written before this change is recognised as
 * legacy plaintext rather than corrupted — it keeps working, and
 * `scripts/encrypt-credentials.mjs` converts it in place.
 */
const SEAL = 'enc1:';

function seal(plain: string | null): string | null {
  if (plain === null || plain === '') return plain;
  if (plain.startsWith(SEAL)) return plain; // already sealed — do not double-wrap
  // No key means no save. Storing it in the clear "for now" is exactly how the
  // previous state came about, and the operator would never learn of it: the
  // screen would say saved, and it would be saved, in the clear, for years.
  if (!secretsConfigured()) {
    throw new Error('APP_SECRET_KEY is not configured — refusing to store an integration secret in the clear');
  }
  return SEAL + encryptSecret(plain);
}

/**
 * Read a stored value. Sealed values are decrypted; anything else is a row
 * from before this change and is returned as it stands.
 *
 * A seal that will not open is NOT returned as ciphertext. That happens when
 * the key was rotated or the row was restored from another environment's
 * backup, and handing the caller a base64 blob would send it to fiskaly as an
 * API key: a confusing 401 from a third party instead of a plain "this hotel
 * has no usable key". Null is the honest answer.
 */
function unseal(stored: string | null | undefined): string | null {
  if (!stored) return null;
  if (!stored.startsWith(SEAL)) return stored;
  try {
    return decryptSecret(stored.slice(SEAL.length));
  } catch {
    console.error('[integration-credentials] a stored secret could not be decrypted — wrong APP_SECRET_KEY?');
    return null;
  }
}

/** Is this value stored sealed? Used by the gate that proves it. */
export function isSealed(stored: string | null | undefined): boolean {
  return !!stored && stored.startsWith(SEAL);
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
          clientId: unseal(row.client_id) || undefined,
          clientSecret: unseal(row.client_secret) || undefined,
          accessToken: unseal(row.access_token) || undefined,
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
/**
 * Which feature switch governs which integration.
 *
 * NOT the channel name. The settings handler used to cast the channel straight
 * to a feature key, which worked only by coincidence: `hostex` and `pricelabs`
 * happened to be spelled the same on both sides. `fiskaly` is not — its switch
 * is `fiscal_de` — so the German TSE key could never be saved (409 every time)
 * and never even appeared on the screen, because the same cast filtered it out
 * of the list. Nobody noticed while the two coincidences were still here.
 *
 * `null` would mean an integration with no switch of its own. Nothing uses it
 * today; the type keeps it because the next integration may.
 */
export const INTEGRATION_FEATURE: Record<string, string | null> = {
  fiskaly: 'fiscal_de',
};

export const INTEGRATION_FIELDS: Record<string, { field: 'accessToken' | 'clientId' | 'clientSecret'; label: string; hint?: string }[]> = {
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
 *
 * Every value goes through `seal()`. There is no branch that writes plaintext:
 * with no key configured this throws before touching the database, so the
 * failure mode is a save that visibly does not happen, not a save that quietly
 * stores the secret in the clear.
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
    params.push(seal(value === '' ? null : value));
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
