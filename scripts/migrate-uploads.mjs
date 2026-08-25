#!/usr/bin/env node
/**
 * Move the files uploaded before they had an owner.
 *
 *   node scripts/migrate-uploads.mjs            # report only
 *   node scripts/migrate-uploads.mjs --write    # move the files, rewrite the URLs
 *
 * Files used to land in `data/uploads/<folder>/<name>`. Nothing in that path
 * says which hotel the file belongs to, which is why `GET /api/uploads/...`
 * had nothing to check and served any hotel's guest passports to any logged-in
 * user of any other. New uploads go to `data/uploads/<orgId>/<folder>/<name>`
 * and the read route derives the path from the actor's own organization, so a
 * file it does not own cannot be addressed.
 *
 * The files already on disk are the leftover. They have to move, and the
 * question «whose is this?» has no recorded answer — that missing answer IS
 * the bug. So this refuses to guess:
 *
 *   - exactly one organization on this server → every legacy file is that
 *     one's, and there is nothing to get wrong;
 *   - more than one → it stops and prints what it found. Assigning them by
 *     mtime, by folder name or by whoever is listed first would be inventing
 *     ownership for guest identity documents, and a wrong guess here is a
 *     GDPR breach performed by a maintenance script.
 *
 * Until they are moved, the read route answers 404 for them. That is the
 * intended order: a broken thumbnail is recoverable, a leaked passport is not.
 */
import fs from 'node:fs';
import path from 'node:path';
import './lib/module-aliases.mjs';

const { getSql } = await import('@core/db/async');
const { UPLOAD_ROOT } = await import('@core/storage/uploads');

const write = process.argv.includes('--write');
const sql = getSql();

if (!fs.existsSync(UPLOAD_ROOT)) {
  console.log('data/uploads/ не існує — нічого переносити.');
  process.exit(0);
}

const orgs = await sql.rows('SELECT id, name FROM organizations ORDER BY created_at', []);
const orgIds = new Set(orgs.map((o) => o.id));

// A top-level entry that is not an organization id is a legacy folder.
const legacyFolders = fs.readdirSync(UPLOAD_ROOT, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !orgIds.has(e.name))
  .map((e) => e.name);

// Files sitting loose at the root, with no folder at all.
const looseFiles = fs.readdirSync(UPLOAD_ROOT, { withFileTypes: true })
  .filter((e) => e.isFile())
  .map((e) => e.name);

function countFiles(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) n += countFiles(path.join(dir, e.name));
    else n += 1;
  }
  return n;
}

const total = legacyFolders.reduce((n, f) => n + countFiles(path.join(UPLOAD_ROOT, f)), 0)
  + looseFiles.length;

console.log(`організацій: ${orgs.length}`);
for (const o of orgs) console.log(`  ${o.id}  ${o.name}`);
console.log(`\nстарих тек без власника: ${legacyFolders.length}${legacyFolders.length ? ` (${legacyFolders.join(', ')})` : ''}`);
console.log(`файлів у них: ${total}`);

if (!total) {
  console.log('\nПереносити нема чого.');
  process.exit(0);
}

if (orgs.length !== 1) {
  console.error(`\nЗУПИНКА: на цьому сервері ${orgs.length} організацій.`);
  console.error('Чиї це файли — ніде не записано, а вгадувати належність сканів');
  console.error('паспортів не можна. Розкладіть їх руками у data/uploads/<id-організації>/');
  console.error('і поправте URL у базі, або приберіть, якщо це залишки.');
  process.exit(1);
}

const org = orgs[0].id;
console.log(`\nУсі вони належать ${org} (${orgs[0].name}) — інших організацій тут немає.`);

if (!write) {
  console.log('Це був звіт. Щоб справді перенести — додайте --write.');
  process.exit(0);
}

let moved = 0;
for (const folder of legacyFolders) {
  const from = path.join(UPLOAD_ROOT, folder);
  const to = path.join(UPLOAD_ROOT, org, folder);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.renameSync(from, to);
  moved += countFiles(to);
  console.log(`  ${folder}/ → ${org}/${folder}/`);
}
for (const file of looseFiles) {
  const to = path.join(UPLOAD_ROOT, org, 'general');
  fs.mkdirSync(to, { recursive: true });
  fs.renameSync(path.join(UPLOAD_ROOT, file), path.join(to, file));
  moved += 1;
  console.log(`  ${file} → ${org}/general/${file}`);
}

// The URLs stored in the database point at the old shape. Rewrite them the
// same way the files moved: insert the organization after /api/uploads/.
//
// This list is the columns an upload can actually reach, traced from the six
// <ImageUploadField> call sites and the task attachment writer — not a guess.
// `useful_info` is JSON holding `photo_url` per entry, so it is rewritten as
// text: the substitution is a prefix insertion and does not care about shape.
const URL_COLUMNS = [
  ['task_attachments', 'url'],
  ['additional_services', 'photo_url'],
  ['menu_items', 'photo_url'],
  ['units', 'entry_photo_url'],
  ['guest_page_config', 'entry_photo_url'],
  ['guest_page_config', 'territory_map_url'],
  ['guest_page_config', 'useful_info'],
  ['property_guest_config', 'parking_photo_url'],
  ['property_guest_config', 'territory_map_url'],
  ['property_guest_config', 'useful_info'],
];

let rewritten = 0;
const OLD_PREFIX = '/api/uploads/';
const NEW_PREFIX = `/api/uploads/${org}/`;

for (const [table, column] of URL_COLUMNS) {
  try {
    const rows = await sql.rows(
      `SELECT id, "${column}" AS v FROM "${table}" WHERE "${column}" LIKE '%/api/uploads/%'`, []);
    for (const r of rows) {
      const before = String(r.v);
      // Only paths that have not already been migrated. Matching the org
      // prefix first keeps a second run from producing /api/uploads/org/org/.
      const after = before.split(NEW_PREFIX).join('\u0000')
        .split(OLD_PREFIX).join(NEW_PREFIX)
        .split('\u0000').join(NEW_PREFIX);
      if (after === before) continue;
      await sql.run(`UPDATE "${table}" SET "${column}" = ? WHERE id = ?`, [after, r.id]);
      rewritten += 1;
    }
  } catch (e) {
    // A table that does not exist on this database is not an error worth
    // stopping for — but it IS worth printing, because a silent skip here
    // means images that quietly stay broken.
    console.error(`  пропущено ${table}.${column}: ${e.message}`);
  }
}

console.log(`\nперенесено файлів: ${moved}   переписано значень у базі: ${rewritten}`);

// Read back rather than trust the UPDATEs: on Postgres a row-level policy can
// filter a write silently, and the operator would find out from a guest
// looking at a broken photo of the lock box.
let leftovers = 0;
for (const [table, column] of URL_COLUMNS) {
  try {
    const rows = await sql.rows(
      `SELECT id, "${column}" AS v FROM "${table}" WHERE "${column}" LIKE '%/api/uploads/%'`, []);
    leftovers += rows.filter((r) => !String(r.v).includes(NEW_PREFIX)).length;
  } catch { /* reported above */ }
}
if (leftovers) {
  console.error(`УВАГА: ${leftovers} значень усе ще вказують на старий шлях.`);
  console.error('Найімовірніше — політика Postgres відфільтрувала UPDATE.');
  process.exit(1);
}
console.log('Перевірено читанням: старих шляхів у цих колонках не лишилось.');
