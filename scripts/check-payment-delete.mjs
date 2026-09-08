#!/usr/bin/env node
/**
 * Видалення платежу знімає гроші з ОБОХ книг (Р8.7).
 *
 *   node scripts/check-payment-delete.mjs --strict
 *
 * Фоліо — єдина книга проживання (В3), але гроші за бронь лежать ще й рядком
 * `fin_operations`: каса пише в обидві. Видалення чистило лише фінансову
 * книгу — і саме тому «видалено» не означало «повернено»:
 *
 *   рецепція видаляє помилковий платіж 5000 → рядок `fin_operations` зник →
 *   перерахунок статусу читає ФОЛІО, бачить там ті самі 5000 → бронь
 *   лишається `paid`, виселення відчинене, а грошей уже ніде немає.
 *
 * Помилки при цьому не буває ніде: обидві книги «працюють», просто кажуть
 * різне. Тому правило механічне: `DELETE FROM fin_operations` дозволений лише
 * у файлі, який у тій самій операції знімає гроші й з книги гостя —
 * `reverseOperationInFolio`.
 *
 * Червоне:
 *   - файл видаляє `fin_operations` і не знає слова `reverseOperationInFolio`;
 *   - видаляє файл, якого немає в списку дозволених (нові двері заводяться
 *     свідомо, а не тим, хто скопіював рядок).
 *
 * Прибирання тестового сміття (`check-isolation.mjs` зносить свою
 * організацію цілком) — не платіж і не бронь: там немає ні фоліо, ні гостя.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const STRICT = process.argv.includes('--strict');

/** Хто має право видаляти рядок фінансової книги — і чому. */
const ALLOWED = new Map([
  ['src/modules/finance/api/operations.handlers.ts',
    'Фінанси: видалення операції та обʼєднання двох в переміщення'],
  ['src/modules/finance/api/payment-bridge.ts',
    'двері платежів: одна операція і всі операції броні'],
]);

/** Файли, де рядок є, а книги гостя не буває взагалі. */
const NOT_MONEY = new Set([
  'scripts/check-isolation.mjs',   // зносить власну тестову організацію
  // Той самий випадок: прибирає ВЛАСНІ пробні організації, у яких немає ні
  // броні, ні гостя, ні фоліо — рядки, які він знімає, створені ним же
  // кількома рядками вище (Р12.3).
  'src/modules/finance/api/operation-scope.check.ts',
  // І цей — рівно того ж роду: прибирає власні пробні організації, у яких
  // немає ні броні, ні гостя, ні фоліо (Р13.2).
  'src/modules/finance/data/operation-tags.check.ts',
  'src/modules/finance/api/pnl-classifier.check.ts',
  'src/modules/finance/data/axis-repair.check.ts',
]);

const DELETES = /DELETE\s+FROM\s+fin_operations\b/i;
const DOOR = /reverseOperationInFolio\b/;

/** Коментарі не код: власна документація гейта не має його ж і живити. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'dist', 'build', 'coverage']);
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') && e.name !== '.claude') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(full); continue; }
    if (/\.(ts|tsx|mjs|js)$/.test(e.name)) files.push(path.relative(ROOT, full));
  }
})(path.join(ROOT, 'src'));
for (const f of fs.readdirSync(path.join(ROOT, 'scripts'))) {
  if (/\.(mjs|js|ts)$/.test(f)) files.push(path.join('scripts', f));
}

const problems = [];
for (const rel of files) {
  const src = stripComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  if (!DELETES.test(src)) continue;
  const key = rel.split(path.sep).join('/');
  if (NOT_MONEY.has(key)) continue;
  if (!ALLOWED.has(key)) {
    problems.push(`${key}: видаляє рядок фінансової книги, а таких дверей не заведено — гроші зникнуть з однієї книги й лишаться в другій`);
    continue;
  }
  if (!DOOR.test(src)) {
    problems.push(`${key}: видаляє рядок фінансової книги і не кличе reverseOperationInFolio — фоліо лишиться зі сплаченим, слово броні лишиться «оплачено»`);
  }
}

if (problems.length) {
  console.log(`check-payment-delete: ${problems.length} червоних`);
  for (const p of problems) console.log(`  ЧЕРВОНЕ  ${p}`);
  if (STRICT) process.exit(1);
} else {
  console.log(`check-payment-delete: видалення платежу знімає гроші з обох книг (дозволених дверей: ${ALLOWED.size})`);
}
