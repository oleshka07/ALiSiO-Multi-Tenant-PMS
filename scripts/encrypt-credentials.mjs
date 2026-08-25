#!/usr/bin/env node
/**
 * Seal the integration secrets that were written before they were encrypted.
 *
 *   node scripts/encrypt-credentials.mjs            # report only
 *   node scripts/encrypt-credentials.mjs --write    # actually re-encrypt
 *
 * `channel_credentials` stored every key a hotel pasted into the settings
 * screen as readable `TEXT`, for as long as that screen has existed. New saves
 * are sealed now; rows already in the two live databases are not, and a
 * migration cannot fix them — `APP_SECRET_KEY` lives in the application's
 * environment, not in psql's, and putting it there to run one `UPDATE` would
 * mean pasting the key into a shell history.
 *
 * So this runs where the key already is: inside the app's own environment, the
 * same way `reset-password.mjs` and `platform-user.mjs` do.
 *
 *   docker compose -f deploy/docker-compose.yml exec app \
 *     node scripts/encrypt-credentials.mjs --write
 *
 * Idempotent: a value already carrying the `enc1:` marker is skipped, so
 * running it twice is not running it twice. It never prints a secret — only
 * how many, in which organization, and whether they were already sealed.
 */
import './lib/module-aliases.mjs';

const { getSql } = await import('@core/db/async');
const { isSealed } = await import('@core/integration-credentials');
const { encryptSecret, secretsConfigured } = await import('@core/security/secrets');

const write = process.argv.includes('--write');

if (!secretsConfigured()) {
  console.error('APP_SECRET_KEY не заданий (64 hex) — шифрувати нема чим.');
  console.error('Запускайте всередині контейнера застосунку, де ключ уже в оточенні.');
  process.exit(1);
}

const sql = getSql();
const COLUMNS = ['client_id', 'client_secret', 'access_token'];

const rows = await sql.rows(
  'SELECT id, organization_id, channel, client_id, client_secret, access_token FROM channel_credentials',
  [],
);

if (!rows.length) {
  console.log('У channel_credentials порожньо — нічого шифрувати.');
  process.exit(0);
}

let sealed = 0;
let plain = 0;
let empty = 0;
const pending = [];

for (const row of rows) {
  const sets = [];
  const params = [];
  const state = [];
  for (const col of COLUMNS) {
    const v = row[col];
    if (v === null || v === undefined || v === '') { empty += 1; state.push(`${col}=—`); continue; }
    if (isSealed(v)) { sealed += 1; state.push(`${col}=зашифровано`); continue; }
    plain += 1;
    state.push(`${col}=ВІДКРИТИМ ТЕКСТОМ`);
    sets.push(`${col} = ?`);
    params.push(`enc1:${encryptSecret(String(v))}`);
  }
  console.log(`  ${row.organization_id} / ${row.channel}: ${state.join(', ')}`);
  if (sets.length) pending.push({ id: row.id, sets, params });
}

console.log(`\nрядків: ${rows.length}   зашифрованих значень: ${sealed}   відкритих: ${plain}   порожніх: ${empty}`);

if (!plain) {
  console.log('Усе вже зашифроване.');
  process.exit(0);
}

if (!write) {
  console.log('\nЦе був звіт. Щоб справді перешифрувати — додайте --write.');
  process.exit(0);
}

for (const { id, sets, params } of pending) {
  await sql.run(
    `UPDATE channel_credentials SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [...params, id],
  );
}

// Read back rather than trust the UPDATE: on Postgres a row-level policy can
// filter a write silently, and «перешифровано 3» over three untouched rows is
// the kind of report that gets believed.
const after = await sql.rows('SELECT client_id, client_secret, access_token FROM channel_credentials', []);
const stillPlain = after.reduce((n, r) =>
  n + COLUMNS.filter((c) => r[c] && !isSealed(r[c])).length, 0);

console.log(`\nперешифровано значень: ${plain}`);
if (stillPlain) {
  console.error(`УВАГА: ${stillPlain} значень усе ще відкритим текстом після запису.`);
  console.error('Найімовірніше — політика Postgres відфільтрувала UPDATE (немає app.organization_id).');
  process.exit(1);
}
console.log('Перевірено читанням: відкритого тексту не лишилось.');
