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
import { propertyScopedTables, scanSource, sourceFiles } from './lib/property-scope-scan.mjs';

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
// «Читання таблиці, яка має `property_id`, ДОВЕДЕНО обмежене названим
// обʼєктом — або область прийшла типом `PropertyScope`, і тоді «усі» сказано
// словом.»
//
// Це властивість, а не візерунок (AGENTS §3.2.1): гейт не перелічує форми, у
// яких помилку вже бачили, — він перелічує ЛІКИ і рахує все інше. Тому та сама
// помилка, записана інакше, не проходить: щоб пройти, треба справді обмежити
// запит.
//
// ── Вимір — спільний інструмент, а не власна регулярка ─────────────────────
//
// `scripts/lib/property-scope-scan.mjs`, розбір AST. Перша редакція цього гейта
// різала файли регуляркою по літералах і мала три вади, кожну з яких незалежно
// вимірила сесія 1:
//
//   * шматувала запит на уламки навколо `${…}` — одиниця обліку розходилась
//     між сесіями, тобто стелю опускали б на різні числа за ту саму роботу;
//   * не мала третього кошика — запит, чия умова приїздить підстановкою,
//     потрапляв у «мовчить», і базлайн спадав САМ СОБОЮ, щойно динамічний
//     запит переписували на статичний;
//   * зараховувала `property_id` у СПИСКУ КОЛОНОК як «названий» — саме через
//     це `fin_folios` виглядав як 4 названі читання, маючи НУЛЬ.
//
// Рішення контролера 09.09.2026: інструмент один на три сесії, живе в
// `scripts/lib/`, кошиків три, храповик рахує **«не доведено» = мовчить +
// невизначений**. Запит, що переїхав із «невизначеного» в «називає», опускає
// стелю законно; той, що переїхав у «мовчить», не міняє нічого.
//
// **Одиниця — ПАРА «оператор × scoped-таблиця»**, і це не тлумачення, а
// звірене число: на `05af394` цей розбір дає 597 пар, сесія 1 доповіла 596, і
// «не доведено» збігається точно — 372 і 372. Одиниця «оператор» дала б на
// тому самому дереві 297, тобто інший базлайн за ту саму роботу.

/**
 * Стеля кожного файла — «не доведено» (мовчить + невизначений) на день
 * увімкнення.
 *
 * Це НЕ мета: мета нуль. Змінювати вниз — разом із виправленням; угору —
 * ніколи (саме це гейт і тримає).
 *
 * ── Чому окремим файлом, а не мапою тут ────────────────────────────────────
 *
 * `audit-by-id-scope` і `check-boundaries` тримають базлайн усередині гейта, і
 * для одного автора це правильно. Тут авторів три: блок INC-029 роблять три
 * сесії паралельно, кожна опускає стелю СВОЇХ файлів, а логіка гейта належить
 * одній із них. Спільна мапа всередині чужого файла означала б редагування
 * файла, названого чужим (`docs/tasks/README.md` це забороняє), або три копії
 * гейта. Дані окремо від коду: сесія опускає рядок у JSON, гейт лишається за
 * своїм господарем, git зливає рядки сам.
 *
 * `src/lib/db.ts` у списку з тієї ж причини, що й у `audit-by-id-scope`: це
 * міграції, вони виконуються до будь-якого орендаря й будь-якого обʼєкта і
 * читають таблицю цілком за визначенням.
 */
const BASELINE_FILE = 'scripts/property-scope-baseline.json';
const READ_BASELINE = JSON.parse(fs.readFileSync(path.join(ROOT, BASELINE_FILE), 'utf8'));

const scopedTables = propertyScopedTables(ROOT);

// ── Самоперевірка: правило, яке не червоніє на зразку, не правило ───────────
//
// §3.2: зелень нового гейта — підозра, доки його не показали червоним. Зразки
// підібрані так, щоб кожен перевіряв ОКРЕМЕ рішення виміру, а не повторював
// сусідній: список колонок проти фільтра, підстановка проти статики, двері
// області проти голого `${…}`, вісь орендаря проти осі обʼєкта, `JOIN` проти
// `FROM`, конкатенація проти шаблона (§3.2.1 — та сама помилка іншою формою).
const SELF_CHECK = [
  // [кошиків, зразок, {спільне означення}, {суворе означення}]
  [1, "const q = `SELECT u.id, u.property_id FROM units u WHERE u.is_active = TRUE`;", 'silent', 'silent'],
  [1, "const q = `SELECT g.id FROM guests g JOIN reservations r ON r.guest_id = g.id WHERE g.email = ?`;", 'silent', 'silent'],
  [1, "const q = `SELECT u.id FROM units u WHERE u.property_id = ?`;", 'names', 'names'],
  [1, "const q = `SELECT ${cols} FROM units u WHERE u.property_id = ?`;", 'names', 'names'],
  [1, "const q = 'SELECT a FROM units ' + 'WHERE property_id = ?';", 'names', 'names'],
  [1, "const f = propertyScopeFilter(scope, 'u');\nconst q = `SELECT u.id FROM units u WHERE ${f.sql}`;", 'names', 'names'],
  [1, "const { sql: s } = propertyScopeFilter(scope, 'r');\nconst q = `SELECT r.id FROM reservations r WHERE ${s}`;", 'names', 'names'],
  [1, "const q = `SELECT u.id FROM units u WHERE ${where}`;", 'unknown', 'unknown'],
  // Пара «оператор × таблиця»: два scoped-джойни — дві одиниці, не одна.
  [2, "const q = `SELECT r.id FROM reservations r JOIN units u ON u.id = r.unit_id WHERE r.property_id = ?`;", 'names', 'names'],
  // Сліпа пляма спільного означення, названа числом: вісь ОРЕНДАРЯ виглядає
  // названою, суворе означення її не приймає.
  [1, "const q = 'SELECT id FROM units WHERE property_id IN (SELECT id FROM properties WHERE organization_id = ?)';", 'names', 'silent'],
  [1, "const q = `SELECT u.id FROM units u JOIN properties p ON p.id = u.property_id WHERE p.organization_id = ?`;", 'names', 'silent'],
];
for (const [count, sample, expected, expectedStrict] of SELF_CHECK) {
  const hits = scanSource(sample, 'self-check.ts', scopedTables);
  const bad = hits.length !== count
    || hits.some((h) => h.verdict !== expected || h.strict !== expectedStrict);
  if (bad) {
    console.error(`check-property-scope: самоперевірка осі «читання» — очікували ${count}×`
      + `«${expected}»/«${expectedStrict}», отримали `
      + `«${hits.map((h) => `${h.verdict}/${h.strict}`).join(', ') || 'нічого'}» на зразку:\n`
      + `  ${sample.replace(/\n/g, '\n  ')}`);
    process.exit(2);
  }
}
// І одне твердження про сам вимір: запит без scoped-таблиці не рахується
// взагалі, інакше гейт лічив би половину застосунку.
if (scanSource("const q = 'SELECT id FROM organizations WHERE id = ?';", 'self-check.ts', scopedTables).length) {
  console.error('check-property-scope: самоперевірка — таблиця без осі обʼєкта потрапила в облік');
  process.exit(2);
}

// ── Вимір ──────────────────────────────────────────────────────────────────
const codeFiles = sourceFiles(ROOT);
const reads = new Map();
const totals = { names: 0, silent: 0, unknown: 0 };
let strictUnproven = 0;
for (const file of codeFiles) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  const hits = scanSource(fs.readFileSync(file, 'utf8'), rel, scopedTables);
  if (hits.length === 0) continue;
  for (const h of hits) {
    totals[h.verdict]++;
    if (h.strict !== 'names') strictUnproven++;
  }
  const unproven = hits.filter((h) => h.verdict !== 'names');
  if (unproven.length) reads.set(rel, unproven);
}
const unprovenTotal = totals.silent + totals.unknown;

const summary = () => `називає ${totals.names}, мовчить ${totals.silent}, `
  + `невизначено ${totals.unknown} → не доведено ${unprovenTotal} у ${reads.size} файлах`
  + ` (за суворим означенням було б ${strictUnproven})`;

if (list) {
  console.log('');
  console.log('═'.repeat(78));
  console.log('ЧИТАННЯ БЕЗ ДОВЕДЕНОЇ ОСІ ОБʼЄКТА — читати очима, не тривога сама по собі');
  console.log('═'.repeat(78));
  console.log('');
  console.log(`  ${scopedTables.size} таблиць з property_id, ${codeFiles.length} файлів у src/`);
  console.log(`  ${summary()}`);
  console.log('');
  for (const [file, hits] of [...reads].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${file}  (${hits.length}, стеля ${READ_BASELINE[file] ?? 0})`);
    for (const h of hits) console.log(`    :${h.line}  ${h.verdict === 'unknown' ? 'невизначено' : 'мовчить    '}  ${h.table}`);
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
    console.log('ЧИТАННЯ БЕЗ ДОВЕДЕНОЇ ОСІ ОБʼЄКТА — храповик зрушився');
    console.log('');
    for (const g of grown) {
      console.log(`  ${g.file}: ${g.now}, стеля ${g.ceiling} — НОВЕ ПОРУШЕННЯ`);
      console.log('    Читач приймає PropertyScope і вставляє ${filter.sql} у сам запит');
      console.log('    (propertyScopeFilter із @core/property-scope). «Усі обʼєкти» —');
      console.log('    законно, але пишеться ALL_PROPERTIES і з причиною поруч.');
      for (const h of g.hits) console.log(`      :${h.line}  ${h.verdict === 'unknown' ? 'невизначено' : 'мовчить'}  ${h.table}`);
    }
    for (const s of shrunk) {
      console.log(`  ${s.file}: було ${s.ceiling}, стало ${s.now} — ОПУСТІТЬ СТЕЛЮ`);
      console.log(`    у ${BASELINE_FILE}: ${s.now === 0 ? 'приберіть рядок' : `"${s.file}": ${s.now},`}`);
    }
    console.log('');
    console.log('  Зразок правильного: src/modules/properties/data/units.repo.ts (listUnits)');
    console.log('  і його сцена units.repo.check.ts — 5 і 7 номерів, а не 12.');
    console.log('  Повний список — node scripts/check-property-scope.mjs --list');
    failed = true;
  } else {
    console.log(`check-property-scope: читання — ${summary()}, усі в межах стелі`);
  }
} else if (!list) {
  console.log(`check-property-scope: читання — ${summary()} (--list покаже які)`);
}

process.exit(failed ? 1 : 0);
