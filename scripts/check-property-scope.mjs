/**
 * Область обʼєкта живе в одному місці — або ніде. І доходить до ЗАПИТУ.
 *
 *   node scripts/check-property-scope.mjs            # звіт обома осями
 *   node scripts/check-property-scope.mjs --strict   # інтерфейс: нуль; читання: храповик
 *   node scripts/check-property-scope.mjs --list     # повний список мовчазних читань
 *
 * Дві осі, і вони про різні половини однієї вади.
 *
 *   ВІСЬ «ІНТЕРФЕЙС» — хто тримає вибір оператора. Нуль від початку.
 *   ВІСЬ «ЧИТАННЯ»  — чи цей вибір доходить до SQL. Храповик (INC-029).
 *
 * Перша була зроблена 03.09 і в її ж шапці написано: «API-маршрути далі
 * приймають `property_id` явно — змінилося лише те, ХТО його визначає». Це
 * виявилось половиною правди: вибір доходив до шапки й до адреси, а до запиту
 * — ні. Друга вісь заведена 09.09 саме тому.
 *
 * ── Чим це ламалося ────────────────────────────────────────────────────────
 *
 * 03.09.2026: вісім екранів читали «який обʼєкт», і кожен тримав власний
 * стан. Зразок із `settings/rate-plans/page.tsx`:
 *
 *   const [propertyId, setPropertyId] = useState('');
 *   if (arr[0]) setPropertyId(arr[0].id);      // ← щоразу перший
 *
 * З одним готелем це непомітно. З двома кожен екран незалежно скидався на
 * ПЕРШИЙ — оператор не «постійно вибирав», він щоразу починав із чужого
 * готелю. І це не незручність: ціни з екрана їдуть у менеджер каналів і на
 * Booking, тобто правка не того обʼєкта — тиха втрата грошей, рівно той
 * клас, який тут ловлять усюди (AGENTS інваріант 29: межа проходить по
 * ДАНИХ). Тепер область одна — `PropertyScopeProvider` у розкладці, вибір
 * у шапці, значення в адресі (`?property=`) і в куці, — а екран лише читає
 * `usePropertyScope()`.
 *
 * Без гейта наступна сторінка знову заведе свій `useState`, і через місяць
 * ми повернемось сюди ж. Тому червоним стає:
 *
 *   1. власний стан області — `useState`, чия змінна названа як «обраний
 *      обʼєкт» (`propertyId`, `selectedProperty`, `currentProperty`…);
 *      `properties` (список) не рахується;
 *   2. перший обʼєкт як вибір — `properties[0]`, `props[0]`, `propData[0]`:
 *      мовчазний дефолт, той самий, що інваріант 8 забороняє публічним
 *      маршрутам;
 *   3. читання адреси або куки повз провайдер — `.get('property')`,
 *      імʼя куки `property_scope`: другий читач означає два джерела правди
 *      і дві вкладки, які бʼються між собою.
 *
 * Перевіряються екрани й компоненти (`src/app`, `src/components`, `src/ui`),
 * після вирізання коментарів (AGENTS §4). Єдиний дозволений власник стану —
 * `src/ui/PropertyScopeContext.tsx`; серверні двері (`@auth`) сюди не
 * входять, там кука і є даними.
 *
 * Самоперевірка перед сканом: кожне правило мусить спрацювати на зразку
 * порушення і промовчати на зразку правильного коду (інваріант 24 — гейт,
 * який не вміє ставати червоним, гірший за відсутній).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const strict = process.argv.includes('--strict');
const list = process.argv.includes('--list');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCAN = ['src/app', 'src/components', 'src/ui'];
const PROVIDER = 'src/ui/PropertyScopeContext.tsx';
const COOKIE = 'property_scope';

/** Імʼя стану, що означає «обраний обʼєкт» (не список обʼєктів). */
function isScopeName(name) {
  return /^(?:selected|current|active|scoped|chosen)?_?propert(?:y|yId|y_id|yID)$/i.test(name);
}

const STATE_RE = /const\s*\[\s*([A-Za-z_$][\w$]*)\s*,\s*set[A-Za-z_$][\w$]*\s*\]\s*=\s*useState\b/g;
const FIRST_RE = /\b(?:properties|props|propData|propList|propertyList|propertiesList)\s*\??\.?\s*\[\s*0\s*\]/;
const PARAM_RE = /\.get\(\s*['"`]property['"`]\s*\)/;
const COOKIE_RE = new RegExp(`\\b${COOKIE}\\b`);

/** Коментарі геть, переводи рядків лишаються — інакше номер рядка бреше. */
function stripComments(text) {
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    const d = text[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && text[i] !== '\n') { out += ' '; i++; }
    } else if (c === '/' && d === '*') {
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) { out += text[i] === '\n' ? '\n' : ' '; i++; }
      out += '  '; i += 2;
    } else if (c === '"' || c === "'" || c === '`') {
      out += c; i++;
      while (i < n && text[i] !== c) {
        if (text[i] === '\\') { out += text[i]; i++; if (i < n) { out += text[i]; i++; } continue; }
        out += text[i]; i++;
      }
      if (i < n) { out += text[i]; i++; }
    } else {
      out += c; i++;
    }
  }
  return out;
}

/** Порушення в одному файлі: [{ line, rule, text }]. */
function scan(source) {
  const text = stripComments(source);
  const found = [];
  const lines = text.split('\n');
  for (const m of text.matchAll(STATE_RE)) {
    if (!isScopeName(m[1])) continue;
    const line = text.slice(0, m.index).split('\n').length;
    found.push({ line, rule: 'власний стан області', text: `useState → ${m[1]}` });
  }
  lines.forEach((l, i) => {
    if (FIRST_RE.test(l)) found.push({ line: i + 1, rule: 'перший обʼєкт як вибір', text: l.trim() });
    if (PARAM_RE.test(l)) found.push({ line: i + 1, rule: 'параметр адреси повз провайдер', text: l.trim() });
    if (COOKIE_RE.test(l)) found.push({ line: i + 1, rule: 'кука повз провайдер', text: l.trim() });
  });
  return found.sort((a, b) => a.line - b.line);
}

// ── Самоперевірка: правило, яке не червоніє на зразку, не правило ─────────
const RED = [
  ["const [propertyId, setPropertyId] = useState('');", 'власний стан області'],
  ["const [selectedProperty, setSelectedProperty] = useState<string>('');", 'власний стан області'],
  ['const [currentProperty, setCurrentProperty] = useState<Property | null>(null);', 'власний стан області'],
  ['if (arr.length) setPropertyId(properties[0].id);', 'перший обʼєкт як вибір'],
  ['const prop = props.find((p) => p.id === b.property_id) || props[0];', 'перший обʼєкт як вибір'],
  ["const pid = useSearchParams().get('property');", 'параметр адреси повз провайдер'],
  [`document.cookie.includes('${COOKIE}=')`, 'кука повз провайдер'],
];
const GREEN = [
  "const [properties, setProperties] = useState<Property[]>([]);",
  'const { propertyId, properties } = usePropertyScope();',
  "// const [propertyId, setPropertyId] = useState('');",
  "const [propertyForm, setPropertyForm] = useState({ name: '' });",
  "const [propertyName, setPropertyName] = useState('');",
  "const first = units[0];",
];
for (const [sample, rule] of RED) {
  const hits = scan(sample);
  if (!hits.some((h) => h.rule === rule)) {
    console.error(`check-property-scope: самоперевірка — правило «${rule}» не спрацювало на зразку:\n  ${sample}`);
    process.exit(2);
  }
}
for (const sample of GREEN) {
  const hits = scan(sample);
  if (hits.length) {
    console.error(`check-property-scope: самоперевірка — хибне спрацювання на правильному коді:\n  ${sample}\n  → ${hits[0].rule}`);
    process.exit(2);
  }
}

// ── Скан ────────────────────────────────────────────────────────────────────
const files = [];
for (const dir of SCAN) (function walk(d) {
  if (!fs.existsSync(d)) return;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (!/\.tsx?$/.test(e.name) || /\.check\.tsx?$/.test(e.name)) continue;
    files.push(p);
  }
})(path.join(ROOT, dir));

const problems = [];
for (const file of files) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  if (rel === PROVIDER) continue;
  for (const hit of scan(fs.readFileSync(file, 'utf8'))) problems.push({ rel, ...hit });
}

let failed = false;

if (problems.length) {
  console.log(`check-property-scope: ${problems.length} місць, де область обʼєкта живе поза провайдером`);
  for (const p of problems) console.log(`  ${p.rel}:${p.line}  ${p.rule}: ${p.text}`);
  console.log('\n  Екран читає область через usePropertyScope() (src/ui/PropertyScopeContext.tsx);');
  console.log('  екран налаштувань, якому потрібен рівно один обʼєкт, загортається в <PropertyRequired>.');
  if (strict) failed = true;
} else {
  console.log(`check-property-scope: інтерфейс чистий — ${files.length} файлів, область лише в ${PROVIDER}`);
}

// ════════════════════════════════════════════════════════════════════════════
// ВІСЬ «ЧИТАННЯ»: чи вибір оператора доходить до SQL (INC-029)
// ════════════════════════════════════════════════════════════════════════════
//
// ── Що саме стверджується ──────────────────────────────────────────────────
//
// «Читання таблиці, яка має `property_id`, ОБМЕЖЕНЕ названим обʼєктом — або
// область прийшла типом `PropertyScope`, і тоді «усі» сказано словом.»
//
// Це властивість, а не візерунок (AGENTS §3.2.1): гейт не перелічує форми, у
// яких помилку вже бачили, — він перелічує ЛІКИ і рахує все інше. Тому та сама
// помилка, записана інакше, не проходить: щоб пройти, треба справді обмежити
// запит.
//
// Ліків рівно три, і всі три перевіряються в тексті самого твердження:
//
//   1. `property_id` порівняно з параметром — `= ?`, `= $1`, `IN (?, ?)`;
//   2. `property_id` зчеплено з `property_id` іншої таблиці того ж запиту —
//      обмеження одного джойн переносить на друге;
//   3. у запит вставлено фрагмент від `propertyScopeFilter()` з
//      `@core/property-scope` — тоді область прийшла типом, і `{ kind: 'all' }`
//      написано словами вище за течією.
//
// ЩО НЕ Є ЛІКАМИ, і це найважливіший рядок цього гейта:
// `property_id IN (SELECT id FROM properties WHERE organization_id = ?)` — те,
// що видає `propertyScopeSql()` з `properties/data/tenant-scope.ts`. Це вісь
// ОРЕНДАРЯ («усі обʼєкти цього рахунку»), і саме вона робить `listUnits`
// схожим на проскоуплений запит. Дві осі, дві різні відповіді; ця не рахується.
//
// ── Чому храповик, а не «має бути нуль» ────────────────────────────────────
//
// Бо мовчазних читань 335 у 98 файлах, і це НЕ 335 дірок — так само, як 59
// місць `audit-by-id-scope` не були 59 дірками. Частина законно охоплює весь
// рахунок, частина отримує обʼєкт із параметра маршруту окремо від запиту,
// частина йде за первинним ключем після доведеної власності вище. Вимагати
// нуля сьогодні означало б червону збірку, яку ніхто не полагодить за вечір, —
// а таку збірку всі вчаться ігнорувати (те саме міркування, через яке в CI
// немає `npm run lint`). Тому стеля кожного файла зафіксована на день
// увімкнення: більше — збірка падає і називає файл; менше — теж падає і
// просить опустити стелю; файла немає в списку — стеля нуль, тобто новий
// читач народжується з віссю.
//
// ── Одне обмеження, яке треба знати ────────────────────────────────────────
//
// Гейт дивиться на ОДИН рядковий літерал. Читач, який приклеює свій фільтр
// окремим рядком (`query += ' AND u.property_id = ?'`), лишається порахованим
// як мовчазний — і це навмисно, а не недогляд: фрагмент, приклеєний за межами
// запиту, неможливо звірити з тим, до чого його приклеїли, а обидва способи
// сходяться до одного правильного — вставити `${filter.sql}` у сам літерал.

/** Таблиці з `property_id` — зі згенерованої схеми, не зі списку в голові. */
const SCHEMA = path.join(ROOT, 'db/postgres/schema.sql');
const propertyScoped = new Set();
// `\r?\n` і зріз '\r': на Windows-копії схема лежить із CRLF, і якір `$` без
// цього не збігається жодного разу (INC-009 ч.2 — гейт, який мовчить).
for (const m of fs.readFileSync(SCHEMA, 'utf8').matchAll(/CREATE TABLE "(\w+)" \(([\s\S]*?)\r?\n\);/g)) {
  if (/"property_id"/.test(m[2])) propertyScoped.add(m[1]);
}

/** Рядкові літерали файла — усі три лапки, з позицією початку. */
function literals(text) {
  const out = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    const d = text[i + 1];
    if (c === '/' && d === '/') { while (i < n && text[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { while (i < n && !(text[i] === '*' && text[i + 1] === '/')) i++; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const start = i;
      let body = '';
      i++;
      while (i < n && text[i] !== c) {
        if (text[i] === '\\') { body += text[i]; i++; if (i < n) { body += text[i]; i++; } continue; }
        body += text[i]; i++;
      }
      i++;
      out.push({ body, start });
      continue;
    }
    i++;
  }
  return out;
}

/** Обмеження ОДНИМ обʼєктом, названим у самому запиті. */
const NAMED_IN_SQL = [
  /property_id\s*(?:=|<>|!=)\s*(?:\?|\$\d+|:\w+)/i,
  /property_id\s*(?:=|<>|!=)\s*\w+\.property_id\b/i,
  /property_id\s+(?:NOT\s+)?IN\s*\(\s*(?!SELECT\b)/i,
];

/** Імена змінних, у яких лежить фрагмент від `propertyScopeFilter()`. */
function scopeFragments(source) {
  const names = new Set();
  for (const m of source.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*propertyScopeFilter\s*\(/g)) names.add(m[1]);
  for (const m of source.matchAll(/(?:const|let|var)\s*\{[^}]*\bsql\s*:\s*([A-Za-z_$][\w$]*)[^}]*\}\s*=\s*propertyScopeFilter\s*\(/g)) names.add(m[1]);
  return names;
}

/** Мовчазні читання одного файла: [{ line, tables }]. */
function scanReads(source) {
  const fragments = scopeFragments(source);
  const found = [];
  for (const lit of literals(source)) {
    if (!/\bSELECT\b/i.test(lit.body)) continue;
    const tables = [...new Set(
      [...lit.body.matchAll(/\b(?:FROM|JOIN)\s+"?(\w+)"?\b/gi)].map((m) => m[1]).filter((t) => propertyScoped.has(t)),
    )];
    if (tables.length === 0) continue;
    if (NAMED_IN_SQL.some((re) => re.test(lit.body))) continue;
    if ([...fragments].some((n) => lit.body.includes(`\${${n}.sql}`) || lit.body.includes(`\${${n}}`))) continue;
    found.push({ line: source.slice(0, lit.start).split(/\r?\n/).length, tables });
  }
  return found;
}

// ── Самоперевірка: правило, яке не червоніє на зразку, не правило ───────────
//
// §3.2: зелень нового гейта — підозра, доки його не показали червоним. Тут це
// зроблено на зразках обох родів, і серед зелених навмисно стоїть форма, якою
// та сама помилка записується інакше (SQL замість JS, `IN` замість `=`,
// фрагмент замість літерала) — §3.2.1: зелений на другій формі тієї самої
// помилки це вирок гейту, а не коду.
const READ_RED = [
  "await sql.rows('SELECT id FROM units WHERE is_active = TRUE')",
  "await sql.rows('SELECT u.id FROM units u JOIN unit_types ut ON ut.id = u.unit_type_id WHERE u.is_active = TRUE')",
  // Вісь орендаря, вдягнена як вісь обʼєкта: саме так виглядає `listUnits`.
  "await sql.rows('SELECT id FROM units WHERE property_id IN (SELECT id FROM properties WHERE organization_id = ?)')",
  "await sql.rows('SELECT SUM(total_price) AS t FROM reservations WHERE check_in >= ?')",
];
const READ_GREEN = [
  "await sql.rows('SELECT id FROM units WHERE property_id = ?', [propertyId])",
  "await sql.rows('SELECT id FROM units WHERE property_id IN (?, ?)', ids)",
  "await sql.rows('SELECT u.id FROM units u JOIN unit_types ut ON ut.property_id = u.property_id')",
  "const filter = propertyScopeFilter(scope, 'u');\nawait sql.rows(`SELECT u.id FROM units u WHERE ${filter.sql}`, filter.params)",
  "const { sql: scopeSql } = propertyScopeFilter(scope, 'r');\nawait sql.rows(`SELECT r.id FROM reservations r WHERE ${scopeSql}`, params)",
  // Таблиця без осі обʼєкта взагалі — гейт про неї мовчить.
  "await sql.rows('SELECT id FROM organizations WHERE id = ?', [orgId])",
  // Запис — не читання: писачі тримає `requirePropertyId`, не цей гейт.
  "await sql.run('UPDATE units SET name = ? WHERE id = ?', [name, id])",
];
for (const sample of READ_RED) {
  if (scanReads(sample).length === 0) {
    console.error(`check-property-scope: самоперевірка осі «читання» — зразок порушення не спіймано:\n  ${sample}`);
    process.exit(2);
  }
}
for (const sample of READ_GREEN) {
  const hits = scanReads(sample);
  if (hits.length) {
    console.error(`check-property-scope: самоперевірка осі «читання» — хибне спрацювання:\n  ${sample}\n  → [${hits[0].tables.join(', ')}]`);
    process.exit(2);
  }
}

/**
 * Стеля кожного файла на 2026-09-09 — день, коли вісь почала блокувати.
 *
 * Це НЕ мета: мета нуль. Змінювати вниз — разом із виправленням; угору —
 * ніколи (саме це гейт і тримає).
 *
 * ── Чому окремим файлом, а не мапою тут ────────────────────────────────────
 *
 * `audit-by-id-scope` і `check-boundaries` тримають базлайн усередині гейта, і
 * для одного автора це правильно. Тут авторів три: блок INC-029 роблять три
 * сесії паралельно, кожна опускає стелю СВОЇХ файлів, а логіка гейта належить
 * одній із них. Спільна мапа всередині чужого файла означала б або три
 * редагування одного файла правилами `docs/tasks/README.md` заборонені, або
 * три копії гейта. Дані окремо від коду розводять це: сесія опускає рядок у
 * JSON, гейт лишається за своїм господарем, git зливає рядки сам.
 *
 * `src/lib/db.ts` у списку з тієї ж причини, що й у `audit-by-id-scope`: це
 * міграції, вони виконуються до будь-якого орендаря й будь-якого обʼєкта і
 * читають таблицю цілком за визначенням.
 */
const BASELINE_FILE = 'scripts/property-scope-baseline.json';
const READ_BASELINE = JSON.parse(fs.readFileSync(path.join(ROOT, BASELINE_FILE), 'utf8'));

const codeFiles = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (/\.tsx?$/.test(e.name) && !/\.check\.tsx?$/.test(e.name)) codeFiles.push(p);
  }
})(path.join(ROOT, 'src'));

const reads = new Map();
let silentTotal = 0;
for (const file of codeFiles) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  const hits = scanReads(fs.readFileSync(file, 'utf8'));
  if (hits.length) { reads.set(rel, hits); silentTotal += hits.length; }
}

if (list) {
  console.log('');
  console.log('═'.repeat(78));
  console.log('ЧИТАННЯ БЕЗ ОСІ ОБʼЄКТА — читати очима, не тривога сама по собі');
  console.log('═'.repeat(78));
  console.log('');
  console.log(`  ${propertyScoped.size} таблиць з property_id, ${codeFiles.length} файлів у src/`);
  console.log(`  мовчать: ${silentTotal} у ${reads.size} файлах`);
  console.log('');
  for (const [file, hits] of [...reads].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${file}  (${hits.length}, стеля ${READ_BASELINE[file] ?? 0})`);
    for (const h of hits) console.log(`    :${h.line}  [${h.tables.join(', ')}]`);
  }
  console.log('');
}

if (strict) {
  const grown = [];
  const shrunk = [];
  for (const [file, hits] of reads) {
    const ceiling = READ_BASELINE[file] ?? 0;
    if (hits.length > ceiling) grown.push({ file, now: hits.length, ceiling, hits });
  }
  for (const [file, ceiling] of Object.entries(READ_BASELINE)) {
    const now = reads.get(file)?.length ?? 0;
    if (now < ceiling) shrunk.push({ file, now, ceiling });
  }

  if (grown.length || shrunk.length) {
    console.log('');
    console.log('ЧИТАННЯ БЕЗ ОСІ ОБʼЄКТА — храповик зрушився');
    console.log('');
    for (const g of grown) {
      console.log(`  ${g.file}: ${g.now}, стеля ${g.ceiling} — НОВЕ ПОРУШЕННЯ`);
      console.log('    Читач приймає PropertyScope і вставляє ${filter.sql} у сам запит');
      console.log('    (propertyScopeFilter із @core/property-scope). «Усі обʼєкти» —');
      console.log('    законно, але пишеться ALL_PROPERTIES і з причиною поруч.');
      for (const h of g.hits) console.log(`      :${h.line}  [${h.tables.join(', ')}]`);
    }
    for (const s of shrunk) {
      console.log(`  ${s.file}: було ${s.ceiling}, стало ${s.now} — ОПУСТІТЬ СТЕЛЮ`);
      console.log(`    у ${BASELINE_FILE}: ${s.now === 0 ? 'приберіть рядок' : `"${s.file}": ${s.now},`}`);
    }
    console.log('');
    console.log('  Зразок правильного: src/core/property-scope.check.ts — той самий запит');
    console.log('  на фікстурі «одна організація, два обʼєкти»: 5 і 7, а не 12.');
    console.log(`  Повний список мовчазних читань — node ${path.relative(ROOT, fileURLToPath(import.meta.url)).split(path.sep).join('/')} --list`);
    failed = true;
  } else {
    console.log(`check-property-scope: читання — ${silentTotal} мовчазних у ${reads.size} файлах, усі в межах стелі`);
  }
} else if (!list) {
  console.log(`check-property-scope: читання — ${silentTotal} мовчазних у ${reads.size} файлах (--list покаже які)`);
}

process.exit(failed ? 1 : 0);
