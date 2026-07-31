/* eslint-disable @typescript-eslint/no-explicit-any */
import { getDb } from '@core/db';

/**
 * OAuth credentials for channel managers (Booking.com and friends).
 *
 * listCredentials returned every organization's row. The secret itself was
 * masked, but organization_id, client_id and "a valid token exists" were not —
 * enough to enumerate the tenants on the server and see which of them is
 * connected to which channel. upsertCredentials wrote to `SELECT id FROM
 * organizations LIMIT 1`, so one tenant saving its Booking.com credentials
 * overwrote whichever organization happened to be first.
 */

export function listCredentials(organizationId: string) {
  return getDb().prepare(`
    SELECT id, channel, environment, client_id,
      CASE WHEN client_secret != '' THEN '●●●●●●●●' ELSE '' END as client_secret_masked,
      (access_token IS NOT NULL) as has_token,
      token_expires_at,
      (access_token IS NOT NULL AND token_expires_at > datetime('now')) as token_valid,
      created_at, updated_at
    FROM channel_credentials
    WHERE organization_id = ?
    ORDER BY channel, environment
  `).all(organizationId);
}

export function upsertCredentials(
  organizationId: string,
  input: {
    channel: string;
    environment: string;
    client_id: string;
    client_secret: string;
  },
): { id: string; created: boolean } {
  const db = getDb();

  const existing = db.prepare(
    'SELECT id FROM channel_credentials WHERE organization_id = ? AND channel = ? AND environment = ?',
  ).get(organizationId, input.channel, input.environment) as any;

  let credId: string;

  if (existing) {
    credId = existing.id;
    db.prepare(`
      UPDATE channel_credentials
      SET client_id = ?, client_secret = ?, access_token = NULL,
        token_expires_at = NULL, updated_at = datetime('now')
      WHERE id = ? AND organization_id = ?
    `).run(input.client_id, input.client_secret, credId, organizationId);
  } else {
    credId = `cred_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    db.prepare(`
      INSERT INTO channel_credentials (id, organization_id, channel, environment, client_id, client_secret)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(credId, organizationId, input.channel, input.environment, input.client_id, input.client_secret);
  }

  // Auto-link to this organization's connections of the same channel that have
  // none yet — never to another tenant's.
  db.prepare(`
    UPDATE channel_connections
    SET credentials_id = ?, updated_at = datetime('now')
    WHERE channel = ? AND organization_id = ? AND credentials_id IS NULL
  `).run(credId, input.channel, organizationId);

  return { id: credId, created: !existing };
}
