/**
 * Boot behaviour of getDb().
 *
 *   node src/lib/db-boot.check.ts
 *
 * The bug this guards against: the connection used to be cached BEFORE
 * initSchema/runMigrations ran. A migration failure left the broken handle in
 * the module-level cache, every later getDb() returned it through the
 * `if (db) return db` guard, and the app served a half-migrated schema with
 * the real error long gone from any log near the symptom.
 *
 * Three assertions, in order:
 *   1. a database that cannot migrate makes getDb() THROW;
 *   2. the second call throws AGAIN — nothing broken was cached;
 *   3. once the file is replaced, the SAME process boots normally.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-boot-'));
process.env.ALISIO_DATA_DIR = tmp;

// Not a database. better-sqlite3 opens it, the first prepare in initSchema
// hits SQLITE_NOTADB.
fs.writeFileSync(path.join(tmp, 'alisio.db'), 'this is not a database');

// The import happens after the env var is set — DATA_DIR is read at load.
const { getDb, _resetDb } = await import('./db.ts');

let first: unknown = null;
try { getDb(); } catch (e) { first = e; }
assert.ok(first, 'getDb() returned a connection to a corrupt database');

let second: unknown = null;
try { getDb(); } catch (e) { second = e; }
assert.ok(second, 'the broken connection was cached — the guard bug is back');

// The operator replaces the bad file; the same process must recover.
// Truncate rather than delete: on Windows the just-closed handle can still
// hold a delete-lock for a moment, and an empty file is a valid new database.
fs.writeFileSync(path.join(tmp, 'alisio.db'), '');
const db = getDb();
const orgs = db.prepare('SELECT COUNT(*) c FROM organizations').get() as { c: number };
assert.ok(orgs.c >= 1, 'fresh boot did not build and seed the schema');

_resetDb();
try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
catch { /* Windows may hold the file a moment; the OS temp dir cleans itself */ }

console.log('db-boot: failure throws, is not cached, and recovery works');
