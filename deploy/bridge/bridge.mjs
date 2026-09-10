#!/usr/bin/env node
/**
 * Міст Winhotel — окремий контейнер, який відновлює знімок і витягає дані.
 *
 *   node bridge.mjs --watch /snapshots --work /work [--interval 30]
 *   node bridge.mjs --once <знімок.fbk|.fbk.gz|.fdb> --out <тека> [--mode gbak|copy|backup]
 *
 * Перший режим — у контейнері `bridge` (deploy/docker-compose.yml, профіль
 * `bridge`): дивиться на том, без HTTP, без Postgres, без мережі. Другий —
 * той самий код локально (`apps/winhotel-import/bridge-local.sh`), для
 * живого проходу контролера (задача §2.8).
 *
 * Протокол на томі — `src/apps/winhotel-import/storage.ts`:
 *   <org>/<id>.fbk.gz + <org>/<id>.ready  → беремо
 *   <org>/<id>.extracting                 → узяли
 *   <org>/<id>/*.jsonl, aggregates.json, <org>/<id>.extracted → готово
 *   <org>/<id>.failed                     → текст відмови
 *
 * Маркер `.extracting` без `.extracted`/`.failed` після перезапуску — це
 * знімок, на якому міст помер; він береться знову (робоча тека — своя на
 * кожен прохід, тож нічого від попереднього не лишається).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { processSnapshot } from './lib/extract.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SQL_DIR = process.env.WINHOTEL_SQL_DIR || path.resolve(HERE, 'sql');

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const has = (name) => process.argv.includes(name);

const log = (msg) => console.log(`[bridge ${new Date().toISOString().slice(11, 19)}] ${msg}`);

function modeFor(file, explicit) {
  if (explicit) return explicit;
  const name = file.replace(/\.gz$/, '').toLowerCase();
  return name.endsWith('.fdb') ? 'copy' : 'gbak';
}

async function once() {
  const input = arg('--once');
  const out = arg('--out');
  if (!input || !out) {
    console.error('використання: bridge.mjs --once <знімок> --out <тека> [--mode gbak|copy]');
    process.exit(2);
  }
  if (!fs.existsSync(input)) { console.error(`немає файла ${input}`); process.exit(2); }
  const work = arg('--work', path.join(out, '.work'));
  const mode = modeFor(input, arg('--mode'));
  const result = await processSnapshot({
    archive: path.resolve(input), mode, sqlDir: SQL_DIR, outDir: path.resolve(out), workDir: path.resolve(work),
    snapshot: { file: path.basename(input), mode }, log,
  });
  const total = Object.values(result.entities).reduce((a, b) => a + b, 0);
  log(`готово: ${Object.keys(result.entities).length} сутностей, ${total} рядків, ${Object.keys(result.numbers).length} агрегатів → ${out}`);
}

/** Знімки, які чекають: є `.ready`, немає `.extracted`/`.failed`. */
function pending(root) {
  const out = [];
  if (!fs.existsSync(root)) return out;
  for (const org of fs.readdirSync(root, { withFileTypes: true })) {
    if (!org.isDirectory()) continue;
    const dir = path.join(root, org.name);
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.ready')) continue;
      const id = f.slice(0, -'.ready'.length);
      const base = path.join(dir, id);
      if (fs.existsSync(`${base}.extracted`) || fs.existsSync(`${base}.failed`)) continue;
      if (!fs.existsSync(`${base}.fbk.gz`)) continue;
      out.push({ org: org.name, id, base });
    }
  }
  return out;
}

async function handle({ org, id, base }, work) {
  let ready = {};
  try { ready = JSON.parse(fs.readFileSync(`${base}.ready`, 'utf8')); } catch { /* маркер без JSON — режим за іменем */ }
  const mode = ready.mode === 'copy' ? 'copy' : 'gbak';
  fs.writeFileSync(`${base}.extracting`, new Date().toISOString());
  log(`${org}/${id}: беру (${mode})`);
  try {
    const result = await processSnapshot({
      archive: `${base}.fbk.gz`, mode, sqlDir: SQL_DIR, outDir: base, workDir: path.join(work, id),
      snapshot: { id, mode, sha256: ready.sha256 ?? null, takenAt: ready.takenAt ?? null }, log: (m) => log(`${id}: ${m}`),
    });
    fs.writeFileSync(`${base}.extracted`, JSON.stringify({ at: new Date().toISOString(), entities: result.entities }));
    log(`${org}/${id}: готово`);
  } catch (e) {
    // Текст — наш або з isql/gbak, обрізаний: він піде на картку готелю.
    const text = String(e && e.message ? e.message : e).slice(0, 500);
    fs.writeFileSync(`${base}.failed`, text);
    log(`${org}/${id}: ВІДМОВА — ${text}`);
  } finally {
    fs.rmSync(`${base}.extracting`, { force: true });
  }
}

async function watch() {
  const root = arg('--watch');
  const work = arg('--work', '/work');
  const interval = Number(arg('--interval', '30')) * 1000;
  fs.mkdirSync(work, { recursive: true });
  log(`дивлюсь на ${root} кожні ${interval / 1000} с; SQL — ${SQL_DIR}`);
  for (;;) {
    for (const item of pending(root)) await handle(item, work);
    await new Promise((r) => setTimeout(r, interval));
  }
}

if (has('--once')) {
  once().catch((e) => { console.error(`[bridge] ВІДМОВА — ${e && e.message ? e.message : e}`); process.exit(1); });
} else if (has('--watch')) {
  watch().catch((e) => { console.error(`[bridge] ВІДМОВА — ${e && e.message ? e.message : e}`); process.exit(1); });
} else {
  console.error('використання: bridge.mjs --watch <том> [--work <тека>] | --once <знімок> --out <тека>');
  process.exit(2);
}
