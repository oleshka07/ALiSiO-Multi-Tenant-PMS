/**
 * Інструмент, який запускають У ОБРАЗІ, мусить у образі БУТИ.
 *
 *   node scripts/check-image-tools.mjs
 *   node scripts/check-image-tools.mjs --strict     # у npm run check і в CI
 *
 * ── Що сталося ──────────────────────────────────────────────────────────
 *
 * 10.09.2026 деплой беты пройшов цілком — 8 міграцій, здоровʼя, усі чотири
 * димові перевірки — і впав на останньому кроці:
 *
 *   Error: Cannot find module '/app/scripts/apply-hotel.mjs'
 *
 * Прод через це не поїхав. Крок, що впав, — рівно той, яким готель клієнта
 * налаштовується з файла.
 *
 * ── Чому цього не бачив жоден гейт ──────────────────────────────────────
 *
 * Бо всі вони бігають там, де ДЕРЕВО НА МІСЦІ: у CI і на машині розробника
 * `scripts/` і `src/` є завжди. Зламана була сама обставина «в образі їх
 * немає», а її не видно нізвідки, крім образу.
 *
 * Але вона видна на ТЕКСТІ — так само, як `check-migration-rls` бачить
 * відсутню політику, не піднімаючи бази. `deploy/*.sh` і `docs/DEPLOY.md`
 * називають, що саме запускають усередині контейнера; `Dockerfile` називає,
 * що туди потрапляє. Розбіжність двох переліків — це і є дефект.
 *
 * ── Що стверджується ────────────────────────────────────────────────────
 *
 * ВЛАСТИВІСТЬ, не візерунок: для КОЖНОГО виклику виду
 * `docker exec … node scripts/X` або `docker run … <образ> scripts/X`
 * шлях `scripts/X` мусить потрапляти в рантайм-шар `Dockerfile` —
 * або окремим `COPY`, або через `COPY … /app/scripts`.
 *
 * Дірка, якої гейт НЕ закриває, названа прямо: він не знає, чи є в образі
 * `src/`, від якого ці скрипти залежать транзитивно. Це стереже сусіднє
 * твердження — воно вимагає, щоб рантайм-шар копіював `src` і
 * `tsconfig.json`, якщо хоч один інструмент імпортує з `src/`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const strict = process.argv.includes('--strict');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// ── Хто запускається в образі ──────────────────────────────────────────────
const SOURCES = ['deploy/deploy.sh', 'deploy/to-postgres.sh', 'docs/DEPLOY.md'];

/**
 * Виклики інструментів усередині контейнера — проходом ПО РЯДКАХ, не одним
 * хитрим виразом. Дві редакції до цієї, і обидві повчальні:
 *
 * перша вимагала, щоб `--entrypoint node` і сам скрипт стояли в ОДНОМУ
 * рядку, — і не бачила `scripts/pg-import.mjs`, бо `docker run` там
 * розбитий на пʼять рядків зворотними скісними (§3.2.1: візерунок замість
 * властивості);
 *
 * друга намагалась охопити перенос рядка одним виразом і пішла в
 * катастрофічний перебір — гейт, який не завершується, гірший за
 * відсутній.
 *
 * Тому просто: рядок відкриває блок, якщо в ньому є `docker exec`,
 * `docker run` або `--entrypoint node`; блок триває, доки рядки
 * продовжуються зворотною скісною. Про це можна міркувати очима, і саме
 * тому воно тут.
 */
function callsInImage(text) {
  const out = [];
  let open = false;
  for (const line of text.split('\n')) {
    if (/docker\s+exec|docker\s+run|--entrypoint\s+node/.test(line)) open = true;
    if (!open) continue;
    for (const m of line.matchAll(/\b(scripts\/[A-Za-z0-9._-]+\.mjs)/g)) out.push(m[1]);
    if (!/\\\s*$/.test(line)) open = false;
  }
  return out;
}

const called = new Map();   // шлях → де названо
for (const src of SOURCES) {
  for (const f of callsInImage(read(src))) {
    if (!called.has(f)) called.set(f, src);
  }
}

// ── Що потрапляє в образ ───────────────────────────────────────────────────
const dockerfile = read('Dockerfile');
// Рантайм-шар — усе після останнього `FROM … AS runner`; копіювання в
// builder до образу не веде.
const runtime = dockerfile.slice(dockerfile.lastIndexOf('AS runner'));
const copies = [...runtime.matchAll(/^COPY\s+(?:--[^\s]+\s+)*([^\s]+)\s+([^\s]+)\s*$/gm)]
  .map((m) => ({ from: m[1], to: m[2] }));
const copiesScriptsDir = copies.some((c) => /\/app\/scripts\/?$/.test(c.from));
const copiesSrcDir = copies.some((c) => /\/app\/src\/?$/.test(c.from));
const copiesTsconfig = copies.some((c) => /\/app\/tsconfig\.json$/.test(c.from));
const copiedFiles = new Set(copies
  .map((c) => c.from.replace(/^\/app\//, ''))
  .filter((f) => f.endsWith('.mjs')));

const problems = [];
for (const [file, where] of called) {
  if (copiesScriptsDir || copiedFiles.has(file)) continue;
  problems.push(`${where} запускає «${file}» у контейнері, а рантайм-шар Dockerfile його не копіює`);
}

// ── Друге твердження: інструмент, що імпортує `src/`, потребує `src/` ─────
const importsSrc = [...called.keys()].filter((f) => {
  try { return /(from|import\()\s*['"][^'"]*\.\.\/src\//.test(read(f)) || /['"]@(core|invoicing|properties|bookings|channels|pricing|guests|companies)\b/.test(read(f)); }
  catch { return false; }
});
if (importsSrc.length && !copiesSrcDir) {
  problems.push(`${importsSrc.length} інструмент(и) імпортують із src/ (${importsSrc.join(', ')}), а рантайм-шар src/ не копіює`);
}
if (importsSrc.length && !copiesTsconfig) {
  problems.push('інструменти резолвлять аліаси через tsconfig.json (scripts/lib/module-aliases.mjs), а рантайм-шар його не копіює');
}
// Рід модуля для вихідників: без нього `.ts` читаються як CommonJS і кожен
// імпорт падає. Це доведено прогоном у відтвореній файловій системі образу.
if (copiesSrcDir && !/src\/package\.json/.test(runtime)) {
  problems.push('src/ копіюється, але рід модуля для нього не заданий — `.ts` читатимуться як CommonJS');
}

// ── Самоперевірка: правило, яке не червоніє на зразку, нічого не стереже ───
const SELF = [
  ['docker exec "$c" node scripts/apply-hotel.mjs --all', 'scripts/apply-hotel.mjs'],
  ['  --entrypoint node "alisio-pms:$E" scripts/pg-import.mjs "$URL"', 'scripts/pg-import.mjs'],
  ['docker exec -it alisio-beta-app node scripts/provision-org.mjs --name x', 'scripts/provision-org.mjs'],
  // Та сама форма, РОЗБИТА НА РЯДКИ — саме її гейт спершу не бачив.
  ['  docker run --rm \\\n    --network "$N" \\\n    --entrypoint node \\\n    "alisio-pms:$E" scripts/pg-import.mjs "$URL"',
   'scripts/pg-import.mjs'],
];
for (const [sample, expect] of SELF) {
  const hit = callsInImage(sample);
  if (!hit.includes(expect)) {
    console.error(`check-image-tools: самоперевірка — «${expect}» не впізнано у зразку:\n  ${sample}`);
    process.exit(2);
  }
}
// І навпаки: виклик БЕЗ контейнера інструментом образу не є.
if (callsInImage('node scripts/pg-schema.mjs').length) {
  console.error('check-image-tools: самоперевірка — локальний виклик порахований як виклик у образі');
  process.exit(2);
}

console.log('');
console.log('═'.repeat(78));
console.log('ІНСТРУМЕНТИ, ЯКІ ЗАПУСКАЮТЬ У ОБРАЗІ — мають у ньому бути');
console.log('═'.repeat(78));
console.log('');
console.log(`  запускають у контейнері: ${called.size}`);
for (const [f, w] of called) console.log(`    ${f}  ← ${w}`);
console.log(`  рантайм-шар копіює scripts/: ${copiesScriptsDir ? 'так' : 'НІ'}`
  + ` · src/: ${copiesSrcDir ? 'так' : 'НІ'} · tsconfig.json: ${copiesTsconfig ? 'так' : 'НІ'}`);
console.log(`  з них імпортують із src/: ${importsSrc.length}`);
console.log('');

if (problems.length) {
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log('');
  console.log('  Це не ловиться сценою: сцена бігає там, де дерево на місці.');
  if (strict) process.exit(1);
} else {
  console.log(`  чисто — кожен інструмент, який запускають у образі, у ньому є`);
}
