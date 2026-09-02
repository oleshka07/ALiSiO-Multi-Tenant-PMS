#!/usr/bin/env node
/**
 * И6: повний синк не кличеться з таймера — ні з крона, ні з інтервалу.
 *
 *   node scripts/check-no-timer-fullsync.mjs [--strict]
 *
 * Сертифікація Channex (тест 13) відкидає «logic that just sends full sync on
 * a timer basis»; рішення Ц23 — повний синк робиться рукою оператора або при
 * ввімкненні розсилки, і ніколи за розкладом. Стан між ними тримають черга
 * дельт і звірка (П6).
 *
 * Що вважається таймером: обробники крона (`src/app/api/cron/**`, файли
 * `*cron*` у модулях, обхідники `publish-all`/`pull-all`), будь-який файл із
 * `setInterval(`, і розклади в `deploy/` (crontab-рядки). Жоден із них не
 * має згадувати повний синк: `fullSync…`, `full-sync`, `enqueueFullSync`,
 * `runFullSync`. Коментарі вирізаються перед пошуком (AGENTS §4) — інакше
 * гейт ловив би пояснення «чому тут немає повного синку».
 *
 * Перевірка була ЧЕРВОНОЮ — тимчасовим викликом дверей повного синку з
 * `publish-cron.handlers.ts`. Інваріант 24.
 */
import fs from 'node:fs';
import path from 'node:path';

const MARK = /\bfullSync\w*\b|\bfull-sync\b|\benqueueFullSync\b|\brunFullSync\b/;

const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:\\])\/\/.*$/gm, '$1')
  .replace(/^\s*#.*$/gm, '');

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', '.git'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p.replace(/\\/g, '/'));
  }
  return out;
}

const source = walk('src').filter((f) => /\.(ts|tsx|mjs)$/.test(f) && !/\.check\.ts$/.test(f));
const isTimerPath = (f) =>
  f.startsWith('src/app/api/cron/')
  || /\/[^/]*cron[^/]*\.(ts|tsx)$/.test(f)
  || /\/(publish-all|pull-all)\.ts$/.test(f);

const failures = [];
let scanned = 0;
for (const f of source) {
  const text = stripComments(fs.readFileSync(f, 'utf8'));
  const timer = isTimerPath(f) || /\bsetInterval\s*\(/.test(text);
  if (!timer) continue;
  scanned++;
  text.split('\n').forEach((line, i) => {
    if (MARK.test(line)) failures.push(`${f}:${i + 1}: ${line.trim().slice(0, 120)}`);
  });
}
// Розклади оператора: рядок crontab із маршрутом повного синку — теж таймер.
for (const f of walk('deploy').filter((f) => /\.(sh|cron|txt)$/.test(f))) {
  scanned++;
  stripComments(fs.readFileSync(f, 'utf8')).split('\n').forEach((line, i) => {
    if (/full-sync/.test(line)) failures.push(`${f}:${i + 1}: ${line.trim().slice(0, 120)}`);
  });
}

if (failures.length) {
  console.error('✗ повний синк за таймером (И6, Ц23): рукою оператора або при ввімкненні, ніколи з крона чи інтервалу');
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`✓ повний синк не кличеться з таймера — ${scanned} файлів крона, інтервалів і розкладів чисті`);
