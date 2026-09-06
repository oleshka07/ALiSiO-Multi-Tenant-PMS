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
 * Four assertions, in order:
 *   1. a database that cannot migrate makes getDb() THROW;
 *   2. the second call throws AGAIN — nothing broken was cached;
 *   3. once the file is replaced, the SAME process boots normally;
 *   4. a FRESH file boots under NODE_ENV=production — in a subprocess,
 *      because that is the one boot nothing else ever exercises. A dev boot
 *      seeds a demo property first; a production boot seeds nothing, and a
 *      seed that assumes its parent row exists fails only there. That exact
 *      shape (menu items referencing a service no empty database has) kept
 *      the CI live job red from the day it existed: getDb() threw on first
 *      boot, and every route still touching the legacy handle answered 500.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

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

// ── 4. the production first boot ─────────────────────────────────────────────
const prodTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-boot-prod-'));
const probe = `
  import './scripts/lib/module-aliases.mjs';
  const { getDb } = await import('@core/db');
  getDb();
  console.log('PROD-BOOT-OK');
`;
try {
  const out = execFileSync(process.execPath, [
    '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '--input-type=module', '-e', probe,
  ], {
    encoding: 'utf8',
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: 'production', ALISIO_DATA_DIR: prodTmp },
  });
  assert.ok(out.includes('PROD-BOOT-OK'), `production fresh boot printed: ${out}`);
} catch (e: any) {
  assert.fail(`production fresh boot failed: ${String(e.stderr || e.message).split('\n').slice(0, 4).join('\n')}`);
} finally {
  try { fs.rmSync(prodTmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* see below */ }
}
console.log('db-boot: a pristine production boot succeeds — no seed assumes another seed ran');

try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
catch { /* Windows may hold the file a moment; the OS temp dir cleans itself */ }

console.log('db-boot: failure throws, is not cached, and recovery works');

// ── 5–6. перебудова таблиці не лишає базу без зовнішніх ключів ───────────────
//
// 0094 розширює CHECK на `reservations.payment_status`, а в SQLite це можна
// лише перебудовою: `PRAGMA foreign_keys = OFF` → підміна → `ON`. Перша версія
// того блоку не мала ні транзакції, ні повернення прагми в `catch`. Обрив на
// копіюванні лишав `reservations_new` — і застосунок після цього СТАРТУВАВ,
// доходив до «migrations complete» і обслуговував запити з `foreign_keys = 0`,
// бо прагму нікому було повернути. Кожен наступний старт повторював те саме.
//
// Тому тут не «міграція відпрацювала», а стан бази ПІСЛЯ старту, і два обриви,
// які розрізняються тим, що саме лишилось на диску:
//   5. чернетка поверх цілої таблиці — її можна викидати;
//   6. ЛИШЕ `reservations_new` (обрив після зняття оригіналу) — це єдина копія
//      даних, і сліпе прибирання чернетки знищило б готель повністю.
import Database from 'better-sqlite3';

const WIDE = /CHECK \(payment_status IN \([^)]*'partial'[^)]*\)\)/;

/** Стан бази очима свіжого процесу: саме так її побачить застосунок. */
function bootAndRead(dir: string): { fk: number; wide: boolean; leftover: number; rows: number; idx: number; done: boolean } {
  const probe = `
    import './scripts/lib/module-aliases.mjs';
    const { getDb } = await import('@core/db');
    const db = getDb();
    const sql = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='reservations'").get() || {}).sql || '';
    console.log('STATE ' + JSON.stringify({
      fk: db.pragma('foreign_keys', { simple: true }),
      wide: /CHECK \\(payment_status IN \\([^)]*'partial'[^)]*\\)\\)/.test(sql),
      leftover: db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='reservations_new'").get().n,
      rows: db.prepare('SELECT COUNT(*) n FROM reservations').get().n,
      idx: db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='index' AND tbl_name='reservations' AND sql IS NOT NULL").get().n,
    }));
  `;
  const out = execFileSync(process.execPath, [
    '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '--input-type=module', '-e', probe,
  ], { encoding: 'utf8', cwd: process.cwd(), env: { ...process.env, ALISIO_DATA_DIR: dir } });
  const line = out.split('\n').find((l) => l.startsWith('STATE '));
  assert.ok(line, `старт не доповів про стан бази:\n${out.slice(-600)}`);
  return { ...JSON.parse(line!.slice(6)), done: out.includes('migrations complete') };
}

/** Повернути таблицю до ВУЗЬКОГО CHECK — база, якою вона була до 0094. */
function narrowBack(file: string) {
  const raw = new Database(file);
  const sql = (raw.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='reservations'").get() as { sql: string }).sql;
  const wide = WIDE.exec(sql);
  assert.ok(wide, 'свіжа база не має широкого CHECK — 0094 не застосувалась, сцена нижче нічого не доведе');
  const cols = (raw.prepare('PRAGMA table_info(reservations)').all() as { name: string }[]).map((c) => `"${c.name}"`).join(', ');
  // Індекси повертаються ОБОВʼЯЗКОВО: справжня база до 0094 мала їх усі, і без
  // цього фікстура доводила б не те — перший прогін цієї сцени впав на «13 → 4»
  // саме через власну недбалість тут, а не через міграцію.
  const idx = (raw.prepare(
    "SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='reservations' AND sql IS NOT NULL",
  ).all() as { sql: string }[]).map((r) => r.sql);
  raw.exec('PRAGMA foreign_keys = OFF');
  raw.exec('BEGIN');
  raw.exec(sql.replace(wide![0], "CHECK (payment_status IN ('unpaid', 'payment_requested', 'prepaid', 'paid'))")
    .replace(/^CREATE TABLE\s+"?reservations"?/i, 'CREATE TABLE reservations_old'));
  raw.exec(`INSERT INTO reservations_old (${cols}) SELECT ${cols} FROM reservations`);
  raw.exec('DROP TABLE reservations');
  raw.exec('ALTER TABLE reservations_old RENAME TO reservations');
  for (const one of idx) raw.exec(one.replace(/^CREATE\s+(UNIQUE\s+)?INDEX\s+/i, (m) => `${m}IF NOT EXISTS `));
  raw.exec('COMMIT');
  raw.exec('PRAGMA foreign_keys = ON');
  raw.close();
}

const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-0094-'));
const fresh = bootAndRead(freshDir);
assert.strictEqual(fresh.fk, 1, 'після звичайного старту застосунок працює з ВИМКНЕНИМИ зовнішніми ключами');
assert.ok(fresh.wide, 'свіжа база не приймає payment_status = partial');
assert.strictEqual(fresh.leftover, 0);
console.log(`  ok  звичайний старт: foreign_keys = 1, CHECK широкий (${fresh.rows} броней, ${fresh.idx} індексів)`);

// ── 5. обрив, що лишив ЧЕРНЕТКУ поверх цілої таблиці ────────────────────────
const draftDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-0094-draft-'));
bootAndRead(draftDir);
const draftFile = path.join(draftDir, 'alisio.db');
narrowBack(draftFile);
{
  const raw = new Database(draftFile);
  raw.exec('CREATE TABLE reservations_new AS SELECT * FROM reservations');
  raw.close();
}
const afterDraft = bootAndRead(draftDir);
// Прагма — ПЕРШИМ твердженням навмисно: це найгірший наслідок обриву, і саме
// його маскувало сусіднє. Застосунок, що стартував і обслуговує запити без
// перевірки зовнішніх ключів, нічим себе не видає — жодної помилки, жодного
// рядка в лозі, лише мовчазно прийняті осиротілі рядки.
assert.strictEqual(afterDraft.fk, 1, 'після перебудови застосунок працює з ВИМКНЕНИМИ зовнішніми ключами');
assert.ok(afterDraft.done, 'старт після обриву не дійшов до кінця міграцій');
assert.ok(afterDraft.wide, 'перебудова не повторилась: CHECK лишився вузьким, тобто обрив зациклив міграцію назавжди');
assert.strictEqual(afterDraft.leftover, 0, 'чернетка обірваної перебудови лишилась у схемі');
assert.strictEqual(afterDraft.rows, fresh.rows, 'перебудова після обриву загубила броні');
assert.ok(afterDraft.idx >= fresh.idx, `перебудова загубила індекси: ${fresh.idx} → ${afterDraft.idx}`);
console.log('  ok  обрив із чернеткою: наступний старт доводить перебудову до кінця і повертає foreign_keys');

// ── 6. обрив після зняття оригіналу: єдина копія даних у reservations_new ───
const lostDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-0094-lost-'));
bootAndRead(lostDir);
const lostFile = path.join(lostDir, 'alisio.db');
narrowBack(lostFile);
{
  // Обрив відтворюється ТАК, як його робив старий код: чернетка створюється
  // повним CREATE (уже з широким CHECK), рядки копіюються, оригінал знято — і
  // тут процес помирає, не дійшовши до перейменування. `CREATE TABLE … AS
  // SELECT`, з якого сцена починалась, для цього не годиться: він не переносить
  // ЖОДНОГО обмеження, тож «відновлена» таблиця виходила без CHECK узагалі, і
  // твердження падало на власній фікстурі, а не на коді.
  const raw = new Database(lostFile);
  const sql = (raw.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='reservations'").get() as { sql: string }).sql;
  const narrow = /CHECK \(payment_status IN \([^)]*\)\)/.exec(sql)!;
  const cols = (raw.prepare('PRAGMA table_info(reservations)').all() as { name: string }[]).map((c) => `"${c.name}"`).join(', ');
  raw.exec('PRAGMA foreign_keys = OFF');
  raw.exec(sql.replace(narrow[0], "CHECK (payment_status IN ('unpaid', 'payment_requested', 'partial', 'prepaid', 'paid'))")
    .replace(/^CREATE TABLE\s+"?reservations"?/i, 'CREATE TABLE reservations_new'));
  raw.exec(`INSERT INTO reservations_new (${cols}) SELECT ${cols} FROM reservations`);
  raw.exec('DROP TABLE reservations');
  raw.close();
}
const afterLost = bootAndRead(lostDir);
assert.ok(afterLost.done, 'старт після обриву на підміні не дійшов до кінця міграцій');
assert.strictEqual(afterLost.rows, fresh.rows, 'броні загублено: обрив на підміні лишає ЄДИНУ копію в reservations_new');
assert.ok(afterLost.wide, 'відновлену таблицю не перебудовано під широкий CHECK');
assert.strictEqual(afterLost.leftover, 0);
assert.strictEqual(afterLost.fk, 1, 'після відновлення застосунок працює з ВИМКНЕНИМИ зовнішніми ключами');
console.log('  ok  обрив на підміні: дані відновлено з reservations_new, не знищено');

for (const d of [freshDir, draftDir, lostDir]) {
  try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* Windows */ }
}
console.log('db-boot: перебудова reservations не лишає базу ні без даних, ні без зовнішніх ключів');
