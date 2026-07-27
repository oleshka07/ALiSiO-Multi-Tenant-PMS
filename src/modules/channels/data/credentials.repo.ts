/* eslint-disable @typescript-eslint/no-explicit-any */
import { getDb } from '@core/db';

export function listCredentials() {
  return getDb().prepare(`
    SELECT id, organization_id, channel, environment, client_id,
      CASE WHEN client_secret != '' THEN '●●●●●●●●' ELSE '' END as client_secret_masked,
      (access_token IS NOT NULL) as has_token,
      token_expires_at,
      (access_token IS NOT NULL AND token_expires_at > datetime('now')) as token_valid,
      created_at, updated_at
    FROM channel_credentials
    ORDER BY channel, environment
  `).all();
}

export function upsertCredentials(input: {
  channel: string;
  environment: string;
  client_id: string;
  client_secret: string;
}): { id: string; created: boolean } {
  const db = getDb();
  const org = db.prepare('SELECT id FROM organizations LIMIT 1').get() as any;
  if (!org) throw new Error('No organization found');

  const existing = db.prepare(
    'SELECT id FROM channel_credentials WHERE organization_id = ? AND channel = ? AND environment = ?'
  ).get(org.id, input.channel, input.environment) as any;

  let credId: string;

  if (existing) {
    credId = existing.id;
    db.prepare(`
      UPDATE channel_credentials
      SET client_id = ?, client_secret = ?, access_token = NULL,
        token_expires_at = NULL, updated_at = datetime('now')
      WHERE id = ?
    `).run(input.client_id, input.client_secret, credId);
  } else {
    credId = `cred_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    db.prepare(`
      INSERT INTO channel_credentials (id, organization_id, channel, environment, client_id, client_secret)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(credId, org.id, input.channel, input.environment, input.client_id, input.client_secret);
  }

  // Auto-link to connections of this channel that have no credentials
  db.prepare(`
    UPDATE channel_connections
    SET credentials_id = ?, updated_at = datetime('now')
    WHERE channel = ? AND organization_id = ? AND credentials_id IS NULL
  `).run(credId, input.channel, org.id);

  return { id: credId, created: !existing };
}
