/**
 * Ретенція знає ПРО ВСІ таблиці з персональними даними (INC-305, INC-306).
 *
 *   node scripts/check-retention-tables.mjs [--strict]
 *
 * ── Що ловить ───────────────────────────────────────────────────────────
 *
 * Знеособлення перелічує таблиці поіменно, тож нова таблиця з даними гостя
 * лишається поза ним МОВЧКИ: нічого не падає, персональні дані просто
 * переживають термін зберігання. Саме так туди не потрапили `guest_consents`
 * і `consent_texts` — вони новіші за ретенцію.
 *
 * ── Стереже ВЛАСТИВІСТЬ (§3.2.1) ────────────────────────────────────────
 *
 * Твердження: **множина таблиць із ПЕРСОНАЛЬНИМИ КОЛОНКАМИ дорівнює
 * об'єднанню чотирьох кошиків реєстру** — знеособлюються, видаляються,
 * свідомо лишаються (з ПРИЧИНОЮ) і названі діркою (теж із причиною). Гейт не
 * має списку «підозрілих» імен і не шукає візерунків у SQL: він порівнює дві
 * множини, тож будь-яка нова таблиця зобов'язує автора сказати вголос, що з
 * нею робить ретенція.
 *
 * **Гейт перевіряє власний прилад.** Правило, яке не збігається з жодною
 * колонкою схеми, — мертве: або його зламали, або дані переїхали. Без цієї
 * перевірки визначення можна звузити до нічого, і гейт лишиться ЗЕЛЕНИМ,
 * просто не бачачи більше нікого. Це знайшлося зломом власного гейта: перша
 * редакція на звужене визначення не червоніла.
 *
 * **Персональне визначається за КОЛОНКОЮ**, і визначення живе в коді —
 * `src/modules/guests/domain/personal-data.ts`. Перша редакція стерегла
 * таблиці з `guest_id`: їх пʼять, а з персональними колонками — двадцять.
 * Саме назва підвела минулого разу, тож дивимось на колонки.
 *
 * Червоніє й на трьох тихіших випадках: таблиця названа, а в схемі її вже
 * немає; «лишаємо» без причини; і таблиця, названа у двох кошиках одразу —
 * тобто ретенція нібито і стирає її, і лишає.
 */
import fs from 'node:fs';

const STRICT = process.argv.includes('--strict');
const SCHEMA = 'db/postgres/schema.sql';
const REGISTRY = 'src/modules/guests/domain/retention-tables.ts';
const DEFINITION = 'src/modules/guests/domain/personal-data.ts';

const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

// ── Визначення «персонального» — з коду, не з цього файла ───────────────────
//
// Гейт не має власного уявлення про персональні дані: він читає правила там,
// де їх читає застосунок. Інакше визначень стало б два, і вони розійшлися б —
// той самий клас, що два списки статусів у INC-045.
const rules = [];
{
  const def = strip(fs.readFileSync(DEFINITION, 'utf8'));
  const block = def.match(/PERSONAL_COLUMN_RULES[^=]*=\s*\[([\s\S]*?)\n\];/);
  if (!block) {
    console.error(`${DEFINITION}: не знайдено PERSONAL_COLUMN_RULES — гейт не має чим міряти`);
    process.exit(2);
  }
  for (const m of block[1].matchAll(/label:\s*'([^']+)'\s*,\s*match:\s*\/(.+?)\/\s*,/g)) {
    rules.push({ label: m[1], rx: new RegExp(m[2]) });
  }
  if (!rules.length) {
    console.error(`${DEFINITION}: правил нуль — гейт стеріг би порожнечу`);
    process.exit(2);
  }
}

// ── Хто в схемі тримає персональні дані ─────────────────────────────────────
const holdsGuest = new Set(['guests']);
const why = new Map();
{
  let table = null;
  for (const line of fs.readFileSync(SCHEMA, 'utf8').split(/\r?\n/)) {
    const open = line.match(/^CREATE TABLE "([^"]+)" \($/);
    if (open) { table = open[1]; continue; }
    if (!table) continue;
    if (line.startsWith(')')) { table = null; continue; }
    const col = line.match(/^\s+"([^"]+)"\s/);
    if (!col) continue;
    // Посилання на гостя — теж підстава: таблиця може не мати жодної
    // персональної колонки і все одно бути в світі ретенції. Саме такий
    // випадок `guest_consents`, з якого все й почалось (INC-305): у ній
    // немає ні імені, ні пошти, і рішення «не чіпаємо» треба було ухвалити
    // вголос. Звузити тут до самих колонок означало б згубити цей критерій.
    if (col[1] === 'guest_id') {
      holdsGuest.add(table);
      if (!why.has(table)) why.set(table, new Set());
      why.get(table).add('посилання на гостя');
      continue;
    }
    for (const r of rules) {
      if (r.rx.test(col[1])) {
        holdsGuest.add(table);
        if (!why.has(table)) why.set(table, new Set());
        why.get(table).add(r.label);
        break;
      }
    }
  }
}

const src = strip(fs.readFileSync(REGISTRY, 'utf8'));
const listOf = (name) => {
  const m = src.match(new RegExp(`${name}[^=]*=\\s*\\[([\\s\\S]*?)\\]`));
  return new Set(m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : []);
};
const anonymised = listOf('RETENTION_ANONYMISED');
const deleted = listOf('RETENTION_DELETED');
const kept = new Map();
{
  const m = src.match(/RETENTION_KEPT[^=]*=\s*\{([\s\S]*?)\n\}/);
  if (m) for (const e of m[1].matchAll(/(\w+)\s*:\s*((?:'[^']*'\s*\+?\s*)+)/g)) {
    kept.set(e[1], [...e[2].matchAll(/'([^']*)'/g)].map((x) => x[1]).join('').trim());
  }
}

const problems = [];

// ── Нуль: чи працює прилад ──────────────────────────────────────────────────
//
// Правило, що не збігається з жодною колонкою в схемі, нічого не стереже.
// Порахувати це коштує один прохід, а без цього звуження визначення робить
// гейт сліпим мовчки.
{
  const columns = [];
  let table = null;
  for (const line of fs.readFileSync(SCHEMA, 'utf8').split(/\r?\n/)) {
    const open = line.match(/^CREATE TABLE "([^"]+)" \($/);
    if (open) { table = open[1]; continue; }
    if (!table) continue;
    if (line.startsWith(')')) { table = null; continue; }
    const col = line.match(/^\s+"([^"]+)"\s/);
    if (col) columns.push(col[1]);
  }
  for (const r of rules) {
    if (!columns.some((c) => r.rx.test(c))) {
      problems.push(`${DEFINITION}: правило «${r.label}» не збігається з ЖОДНОЮ колонкою схеми — `
        + 'або воно зламане, або дані переїхали; мертве правило нічого не стереже');
    }
  }
}

if (!anonymised.size) problems.push(`${REGISTRY}: не знайдено RETENTION_ANONYMISED`);
if (!deleted.size) problems.push(`${REGISTRY}: не знайдено RETENTION_DELETED`);

const gaps = new Map();
{
  const m = src.match(/RETENTION_GAPS[^=]*=\s*\{([\s\S]*?)\n\};/);
  if (m) for (const e of m[1].matchAll(/(\w+)\s*:\s*((?:'[^']*'\s*\+?\s*)+)/g)) {
    gaps.set(e[1], [...e[2].matchAll(/'([^']*)'/g)].map((x) => x[1]).join('').trim());
  }
}

const named = new Set([...anonymised, ...deleted, ...kept.keys(), ...gaps.keys()]);

for (const table of [...holdsGuest].sort()) {
  if (!named.has(table)) {
    problems.push(`${table}: тримає персональні дані (${[...(why.get(table) ?? [])].join(', ')}), `
      + 'але ретенція про неї не знає — внесіть у RETENTION_ANONYMISED / RETENTION_DELETED '
      + 'або назвіть у RETENTION_KEPT / RETENTION_GAPS із причиною');
  }
}
for (const table of [...named].sort()) {
  if (!holdsGuest.has(table)) {
    problems.push(`${table}: названа в реєстрі ретенції, але персональних колонок у схемі не має — рядок застарів`);
  }
}
for (const [table, reason] of [...kept].sort()) {
  if (!reason) problems.push(`${table}: «лишаємо» БЕЗ причини — це схованка, а не рішення`);
}
for (const [table, reason] of [...gaps].sort()) {
  if (!reason) problems.push(`${table}: названа діркою БЕЗ причини — тоді це просто пропуск`);
  if (kept.has(table)) problems.push(`${table}: і «свідомо лишаємо», і «дірка» — це різні твердження`);
}
for (const table of [...anonymised]) {
  if (deleted.has(table) || kept.has(table)) {
    problems.push(`${table}: названа у двох кошиках одразу — ретенція нібито і стирає її, і лишає`);
  }
}
for (const table of [...deleted]) {
  if (kept.has(table)) problems.push(`${table}: і видаляється, і лишається — оберіть одне`);
}

if (problems.length) {
  console.error('\ncheck-retention-tables: ретенція знає не про всі таблиці з персональними даними\n');
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error(`\n  у схемі в світі ретенції: ${[...holdsGuest].sort().join(', ')}`);
  console.error(`  знеособлюються: ${[...anonymised].sort().join(', ') || '—'}`);
  console.error(`  видаляються:    ${[...deleted].sort().join(', ') || '—'}`);
  console.error(`  свідомо лишаються: ${[...kept.keys()].sort().join(', ') || '—'}\n`);
  process.exit(STRICT ? 1 : 0);
}
console.log(`check-retention-tables: ${holdsGuest.size} таблиць із персональними даними — `
  + `${anonymised.size} знеособлюються, ${deleted.size} видаляються, ${kept.size} лишаються свідомо`);

// Дірки друкуються ЗАВЖДИ, а не лише при червоному: список, який видно раз на
// рік у звіті, — це список, якого немає. Гейт від них не червоніє (латати чужі
// теки він не може), але й мовчати про них не дає.
if (gaps.size) {
  console.log(`  ⚠ персональні дані, яких ретенція не чіпає НІКОЛИ — ${gaps.size}:`);
  for (const [table, reason] of [...gaps].sort()) console.log(`      ${table}: ${reason}`);
}
