/**
 * Whose integration account.
 *
 *   node src/core/integration-credentials.check.ts
 *
 * The bug this guards: integration credentials were single environment
 * variables, so every organization on the server shared one account. The
 * feature registry could turn an integration off for a hotel but never give
 * two hotels their own — switching it on for the second would have pointed it
 * at the first one's listings. The three channels that carried that bug
 * (Hostex, PriceLabs, and the Connectivity API of Booking.com) have since been
 * removed entirely; the invariant outlives them, because the next integration
 * will be written against this same seam. Today the only channel left is the
 * German fiscalisation key, which is exactly the kind of secret that must never
 * be shared between two hotels — one TSS signs for one taxpayer.
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
process.env.FISKALY_API_KEY = 'env-token';

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
  VALUES ('__cred_check__a_fisk', ?, 'fiskaly', 'production', 'token-of-a')
`, [org('a')]);

// A's own token wins over the server's.
const a = await integrationCredentials('fiskaly', org('a'));
assert.strictEqual(a?.clientId, 'token-of-a', "A did not get its own token");
assert.strictEqual(a?.perOrganization, true, "A's token is not marked as its own");

// B saved nothing, so it falls back to the server — and critically NOT to A's.
const b = await integrationCredentials('fiskaly', org('b'));
assert.strictEqual(b?.clientId, 'env-token', "B did not fall back to the environment");
assert.notStrictEqual(b?.clientId, 'token-of-a', "B is using A's account");
assert.strictEqual(b?.perOrganization, false);
assert.strictEqual(await integrationConfigured('fiskaly', org('b')), true);

// No organization at all — the environment, never a guess.
const none = await integrationCredentials('fiskaly', null);
assert.strictEqual(none?.clientId, 'env-token', 'a caller without an organization got something unexpected');
assert.notStrictEqual(none?.clientId, 'token-of-a', "a background job picked a tenant's account");

// Nothing anywhere is "not configured", not an exception — and B falling back
// to nothing must still not fall back to A.
delete process.env.FISKALY_API_KEY;
assert.strictEqual(await integrationCredentials('fiskaly', org('b')), null);
assert.strictEqual(await integrationConfigured('fiskaly', org('b')), false);
assert.strictEqual(await integrationConfigured('fiskaly', null), false);
// A still has its own, unaffected by the server having none.
assert.strictEqual((await integrationCredentials('fiskaly', org('a')))?.clientId, 'token-of-a');

await sql.run('DELETE FROM channel_credentials WHERE organization_id LIKE ?', ['__cred_check__%']);
await sql.run('DELETE FROM organizations WHERE id LIKE ?', ['__cred_check__%']);

try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
catch { /* Windows holds the file a moment; the OS temp dir cleans itself */ }

console.log('integration credentials: per organization, with the server as fallback, never a neighbour');
