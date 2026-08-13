/**
 * Документація, яка розійшлася з кодом.
 *
 *   node scripts/check-docs-current.mjs [--strict]
 *
 * AGENTS.md §2 каже: «Зміна, яка робить документацію неточною, не завершена,
 * поки документацію не оновлено. Це частина того самого коміту, а не наступна
 * задача.»
 *
 * Правило було, і його порушили десять комітів поспіль. За тиждень зʼявилися
 * фоліо, фактури, сторно, ставки ПДВ, серії нумерації, цінова матриця,
 * правила каналів і два нові гейти — і жодного рядка в docs/. Наступний, хто
 * відкриє ARCHITECTURE.md, побачить систему, якої вже немає, і ухвалить
 * рішення за нею. Неточний документ гірший за відсутній — це теж написано в
 * AGENTS.md, тим самим абзацом.
 *
 * Правило, про яке нікому не нагадують, — це не правило. Тому воно тут.
 *
 * ── Що саме перевіряється ───────────────────────────────────────────────────
 *
 *   1. Кожна таблиця, створена міграцією з db/postgres/migrations/, названа
 *      в docs/ARCHITECTURE.md.
 *   2. Кожен гейт із `npm run check` названий у docs/ARCHITECTURE.md.
 *   3. Кожна міграція має рядок у docs/DEPLOY.md — або в тексті, або
 *      покриття правилом, що їх накочує deploy.sh.
 *
 * Навмисно НЕ перевіряється «кожна таблиця у схемі». Їх 102, і більшість
 * старші за цю дисципліну; вимога описати всі одразу дала б сто абзаців
 * заповнювача, а не документацію. Міграції — межа, від якої почався порядок:
 * усе, що додано з того часу, має бути описане, і це саме та частина, яку
 * читають, коли розбираються з новим.
 *
 * Перевірка на згадку імені, а не на якість тексту. Машина не вміє відрізнити
 * опис від відписки — але вона вміє помітити, що таблиці немає взагалі, а це
 * і був справжній випадок.
 */
import fs from 'node:fs';
import path from 'node:path';

const strict = process.argv.includes('--strict');

const ARCH = 'docs/ARCHITECTURE.md';
const DEPLOY = 'docs/DEPLOY.md';
const MIGRATIONS = 'db/postgres/migrations';

const arch = fs.readFileSync(ARCH, 'utf8');
const deployDoc = fs.readFileSync(DEPLOY, 'utf8');

const problems = [];

// ── 1. Таблиці, створені міграціями ─────────────────────────────────────────
const migrationTables = new Map();   // таблиця → файл міграції
for (const file of fs.readdirSync(MIGRATIONS).sort()) {
  if (!file.endsWith('.sql')) continue;
  const sql = fs.readFileSync(path.join(MIGRATIONS, file), 'utf8');
  for (const m of sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?"?([a-z_]+)"?/gi)) {
    // Перша міграція, що її створює, і є місцем, де таблиця зʼявилася.
    if (!migrationTables.has(m[1])) migrationTables.set(m[1], file);
  }
}

for (const [table, file] of migrationTables) {
  // schema_migrations — реєстр самого механізму міграцій, а не модель даних.
  if (table === 'schema_migrations') continue;
  if (!arch.includes(table)) {
    problems.push({
      what: `таблиця \`${table}\``,
      where: `створена в ${file}`,
      fix: `назвіть її в ${ARCH} — розділ моделі даних`,
    });
  }
}

// ── 2. Гейти з npm run check ────────────────────────────────────────────────
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const gates = [...(pkg.scripts.check || '').matchAll(/scripts\/(check-[a-z-]+\.mjs)/g)]
  .map((m) => m[1]);

for (const gate of new Set(gates)) {
  if (!arch.includes(gate)) {
    problems.push({
      what: `гейт \`${gate}\``,
      where: 'у npm run check',
      fix: `назвіть його в ${ARCH} — розділ перевірок`,
    });
  }
}

// ── 3. Міграції описані як механізм ─────────────────────────────────────────
// Не кожна поіменно — їх стане сто. Але DEPLOY.md мусить пояснювати, ЯК вони
// накочуються, інакше людина на сервері робить це руками або не робить.
if (!/migrate\.sh/.test(deployDoc)) {
  problems.push({
    what: 'накочування міграцій',
    where: 'deploy/migrate.sh',
    fix: `опишіть у ${DEPLOY}, як міграції потрапляють на сервер`,
  });
}

// ── Звіт ────────────────────────────────────────────────────────────────────
console.log('');
console.log('══════════════════════════════════════════════════════════════════════════════');
console.log('ДОКУМЕНТАЦІЯ РОЗІЙШЛАСЯ З КОДОМ — має бути нуль');
console.log('══════════════════════════════════════════════════════════════════════════════');
console.log('');

if (problems.length === 0) {
  console.log(`  чисто — ${migrationTables.size} таблиць із міграцій, ${new Set(gates).size} гейтів`);
  console.log('');
  process.exit(0);
}

for (const p of problems) {
  console.log(`  ${p.what}`);
  console.log(`      ${p.where}`);
  console.log(`      → ${p.fix}`);
  console.log('');
}
console.log(`  разом: ${problems.length}`);
console.log('');
console.log('  AGENTS.md §2: зміна, яка робить документацію неточною, не завершена,');
console.log('  поки документацію не оновлено. Це той самий коміт, а не наступна задача.');
console.log('');

process.exit(strict ? 1 : 0);
