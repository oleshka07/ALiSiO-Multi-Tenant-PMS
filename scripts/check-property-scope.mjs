/**
 * Область обʼєкта живе в одному місці — або ніде.
 *
 *   node scripts/check-property-scope.mjs [--strict]
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

if (problems.length) {
  console.log(`check-property-scope: ${problems.length} місць, де область обʼєкта живе поза провайдером`);
  for (const p of problems) console.log(`  ${p.rel}:${p.line}  ${p.rule}: ${p.text}`);
  console.log('\n  Екран читає область через usePropertyScope() (src/ui/PropertyScopeContext.tsx);');
  console.log('  екран налаштувань, якому потрібен рівно один обʼєкт, загортається в <PropertyRequired>.');
  if (strict) process.exit(1);
} else {
  console.log(`check-property-scope: чисто — ${files.length} файлів, область обʼєкта лише в ${PROVIDER}`);
}
