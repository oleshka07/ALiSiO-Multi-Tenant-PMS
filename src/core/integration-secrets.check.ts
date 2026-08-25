/**
 * An integration key is not readable in the database.
 *
 *   node src/core/integration-secrets.check.ts
 *
 * The bug: `core/security/secrets.ts` implemented AES-256-GCM and nothing ever
 * called it. `deploy.sh` refused to start without a 64-hex `APP_SECRET_KEY`,
 * `DEPLOY.md` told the operator that key encrypts integration credentials, and
 * `saveIntegrationCredentials` wrote every key straight into
 * `channel_credentials` as `TEXT`. The promise lived in three files and the
 * implementation in none — which is the worst arrangement of the three
 * possible ones, because everybody involved believed the secrets were safe.
 *
 * The assertions, in the order they matter:
 *
 *   1. what lands in the column is not the key. This is the whole finding: a
 *      `SELECT` — a backup, a pg_dump mailed to support, a read through some
 *      unrelated hole — must not yield a usable credential;
 *   2. the round trip works, or encryption is just data loss;
 *   3. a row written before this change still reads, because two databases
 *      already exist and breaking their fiscalisation key to fix its storage
 *      would be a worse bug than the one being fixed;
 *   4. no key configured means no save at all. Not "save in the clear for
 *      now" — that is precisely how the previous state came about;
 *   5. a seal that will not open (rotated key, restored from another
 *      environment) reads as «no key», not as ciphertext handed to fiskaly.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-sec-'));
process.env.ALISIO_DATA_DIR = tmp;
process.env.APP_SECRET_KEY = '0'.repeat(64);
delete process.env.BANK_INBOX_SECRET;
delete process.env.FISKALY_API_KEY;

const { getSql } = await import('./db/async.ts');
const { saveIntegrationCredentials, integrationCredentials, isSealed } =
  await import('./integration-credentials.ts');

const sql = getSql();
const ORG = '__sec_check__a';
const KEY = 'fiskaly-live-key-do-not-log-9f3a';

await sql.run('INSERT OR IGNORE INTO organizations (id, name, slug) VALUES (?, ?, ?)',
  [ORG, 'Sec check', '__sec_check__a']);

try {
  // ── 1. The column does not hold the key ──────────────────────────────
  await saveIntegrationCredentials(ORG, 'fiskaly', { clientId: KEY, clientSecret: 'secret-side' });

  const raw: any = await sql.row<any>(
    'SELECT client_id, client_secret FROM channel_credentials WHERE organization_id = ?', [ORG]);
  assert.ok(raw, 'nothing was written');
  assert.notStrictEqual(raw.client_id, KEY,
    'the API key is sitting in the database in the clear — this is the bug');
  assert.ok(!String(raw.client_id).includes(KEY),
    'the ciphertext contains the key verbatim');
  assert.ok(isSealed(raw.client_id), `client_id is not sealed: ${String(raw.client_id).slice(0, 12)}…`);
  assert.ok(isSealed(raw.client_secret), 'client_secret is not sealed');
  console.log('  ok  ключ у колонці не читається');

  // ── 2. The round trip ────────────────────────────────────────────────
  const read = await integrationCredentials('fiskaly', ORG);
  assert.strictEqual(read?.clientId, KEY, 'the key did not survive the round trip');
  assert.strictEqual(read?.clientSecret, 'secret-side');
  assert.strictEqual(read?.perOrganization, true);
  console.log('  ok  зашифроване читається назад тим самим');

  // ── 3. A row from before this change still works ─────────────────────
  await sql.run('UPDATE channel_credentials SET client_id = ? WHERE organization_id = ?',
    ['legacy-plaintext-key', ORG]);
  const legacy = await integrationCredentials('fiskaly', ORG);
  assert.strictEqual(legacy?.clientId, 'legacy-plaintext-key',
    'a row written before encryption stopped working — that breaks two live databases');
  console.log('  ok  старий незашифрований рядок читається далі');

  // ── 4. No key means no save ──────────────────────────────────────────
  const savedKey = process.env.APP_SECRET_KEY;
  delete process.env.APP_SECRET_KEY;
  await assert.rejects(
    () => saveIntegrationCredentials(ORG, 'fiskaly', { clientId: 'must-not-land' }),
    /APP_SECRET_KEY/,
    'without a key the secret was stored anyway — in the clear',
  );
  const afterRefusal: any = await sql.row<any>(
    'SELECT client_id FROM channel_credentials WHERE organization_id = ?', [ORG]);
  assert.notStrictEqual(afterRefusal.client_id, 'must-not-land',
    'the refused value reached the database');
  process.env.APP_SECRET_KEY = savedKey;
  console.log('  ok  без APP_SECRET_KEY збереження відмовляє, а не пише відкритим текстом');

  // ── 5. A seal that will not open is «no key», not ciphertext ─────────
  await saveIntegrationCredentials(ORG, 'fiskaly', { clientId: KEY });
  process.env.APP_SECRET_KEY = 'f'.repeat(64); // as if the key were rotated
  const wrongKey = await integrationCredentials('fiskaly', ORG);
  assert.strictEqual(wrongKey?.clientId, undefined,
    'a secret that cannot be decrypted was handed to the caller as ciphertext');
  process.env.APP_SECRET_KEY = savedKey;
  console.log('  ok  нерозшифроване — це «ключа нема», а не base64 у бік fiskaly');

  console.log('ключі інтеграцій лежать у базі зашифрованими');
} finally {
  await sql.run('DELETE FROM channel_credentials WHERE organization_id = ?', [ORG]);
  await sql.run('DELETE FROM organizations WHERE id = ?', [ORG]);
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
  catch { /* the OS temp dir cleans itself */ }
}
