/**
 * Whose integration account.
 *
 *   node src/core/integration-credentials.check.ts
 *
 * The bug this guards: integration credentials were single environment
 * variables, so every organization on the server shared one account. The
 * feature registry could turn an integration off for a hotel but never give
 * two hotels their own — switching it on for the second would have pointed it
 * at the first one's listings. The two channels that carried that bug (Hostex,
 * PriceLabs) have since been removed entirely; the invariant outlives them,
 * because the next integration will be written against this same seam.
 *
 * Invariants:
 *   - an organization's own credentials win over the server's;
 *   - two organizations never see each other's;
 *   - no organization (a cron tick, a webhook) gets the environment only —
 *     never one tenant's account picked at random;
 *   - nothing configured anywhere reads as not configured, not as a crash.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-cred-'));
process.env.ALISIO_DATA_DIR = tmp;
process.env.BOOKING_COM_CLIENT_ID = 'env-token';
delete process.env.FISKALY_API_KEY;

const { getDb } = await import('./db/index.ts');
const { getSql } = await import('./db/async.ts');
const { integrationCredentials, integrationConfigured } = await import('./integration-credentials.ts');

const sql = getSql();
const org = (suffix: string) => `__cred_check__${suffix}`;
for (const s of ['a', 'b']) {
  await sql.run('INSERT OR IGNORE INTO organizations (id, name, slug) VALUES (?, ?, ?)', [org(s), `Cred ${s}`, `__cred_check__${s}`]);
}
await sql.run(`
  INSERT INTO channel_credentials (id, organization_id, channel, environment, client_id)
  VALUES ('__cred_check__a_bcom', ?, 'booking_com', 'production', 'token-of-a')
`, [org('a')]);

// A's own token wins over the server's.
const a = await integrationCredentials('booking_com', org('a'));
assert.strictEqual(a?.clientId, 'token-of-a', "A did not get its own token");
assert.strictEqual(a?.perOrganization, true, "A's token is not marked as its own");

// B saved nothing, so it falls back to the server — and critically NOT to A's.
const b = await integrationCredentials('booking_com', org('b'));
assert.strictEqual(b?.clientId, 'env-token', "B did not fall back to the environment");
assert.notStrictEqual(b?.clientId, 'token-of-a', "B is using A's account");
assert.strictEqual(b?.perOrganization, false);

// No organization at all — the environment, never a guess.
const none = await integrationCredentials('booking_com', null);
assert.strictEqual(none?.clientId, 'env-token', 'a caller without an organization got something unexpected');
assert.notStrictEqual(none?.clientId, 'token-of-a', "a background job picked a tenant's account");

// Nothing anywhere is "not configured", not an exception.
assert.strictEqual(await integrationCredentials('fiskaly', org('a')), null);
assert.strictEqual(await integrationConfigured('fiskaly', org('a')), false);
assert.strictEqual(await integrationConfigured('booking_com', org('b')), true);

await sql.run('DELETE FROM channel_credentials WHERE organization_id LIKE ?', ['__cred_check__%']);
await sql.run('DELETE FROM organizations WHERE id LIKE ?', ['__cred_check__%']);

try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
catch { /* Windows holds the file a moment; the OS temp dir cleans itself */ }

console.log('integration credentials: per organization, with the server as fallback, never a neighbour');
