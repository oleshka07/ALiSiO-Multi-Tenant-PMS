/**
 * A promise used as if it were a value.
 *
 *   node scripts/check-await.mjs
 *
 * Why this exists: moving a module onto the asynchronous seam turns its
 * functions into async ones, and the call sites do not have to change for the
 * code to keep compiling. Two of those are silent and dangerous.
 *
 *   if (!ownsProperty(org, id)) return null;
 *
 * A promise is truthy, so `!promise` is ALWAYS false. Every ownership guard in
 * the properties module compiled cleanly and stopped guarding — createBuilding
 * would have attached a building to another tenant's property. TypeScript says
 * nothing, because `!` accepts any value.
 *
 *   return NextResponse.json(listCategories(org));
 *
 * `NextResponse.json` takes `any`, so a promise serialises to `{}`. The screen
 * gets an empty object and no layer complains.
 *
 * Neither is findable by the type checker, so it is findable here or not at
 * all. The check is deliberately narrow: it reports a call to a function this
 * repository declares `async`, in a position where the promise itself is the
 * value being used. Passing a promise on to something that awaits it later is
 * legitimate and is not reported.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOTS = ['src'];
const files = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.tsx?$/.test(entry.name)) files.push(full);
  }
}
for (const r of ROOTS) walk(r);

// ── Which functions each file declares async ────────────────────────────────
// Per file, not repository-wide: `owns` is a local synchronous helper in the
// guest registry AND an async one in the properties repository. A global set
// reports the innocent one, and a check that cries wolf gets switched off.
const declaredAsync = new Map();          // file → Set of names it declares async
const asyncAnywhere = new Set();
const declaredSyncSomewhere = new Set();  // the same name, declared NOT async
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const names = new Set();
  for (const m of src.matchAll(/^\s*(?:export\s+)?async\s+function\s+(\w+)/gm)) names.add(m[1]);
  for (const m of src.matchAll(/^\s*(?:export\s+)?const\s+(\w+)\s*=\s*async\s*\(/gm)) names.add(m[1]);
  declaredAsync.set(f, names);
  for (const n of names) asyncAnywhere.add(n);
  for (const m of src.matchAll(/^\s*(?:export\s+)?function\s+(\w+)/gm)) declaredSyncSomewhere.add(m[1]);
}

/** Where a relative specifier lands, with the extension TypeScript would add. */
function resolve(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const cand of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(cand)) return path.relative(process.cwd(), cand);
  }
  return null;
}

/**
 * The names a file could be calling: its own, plus what it imports.
 *
 * Relative imports are resolved to the actual file, because two of them can
 * export the same name with different asyncness — `getSyncStatus` is a plain
 * function in channels/data and an async one in channels/api, and reporting
 * the wrong one is how a check earns its way into being ignored.
 */
function namesInScope(file, src) {
  const scope = new Set(declaredAsync.get(file) || []);

  for (const m of src.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    const [, names, spec] = m;
    const target = spec.startsWith('.') ? resolve(file, spec) : null;
    const known = target ? declaredAsync.get(target) : null;
    for (const raw of names.split(',')) {
      const name = raw.trim().split(/\s+as\s+/).pop().trim();
      if (!name) continue;
      if (known) { if (known.has(name)) scope.add(name); }
      // A non-relative specifier goes through a module facade; fall back to
      // the repository-wide answer, but only when it is unambiguous.
      else if (asyncAnywhere.has(name) && !declaredSyncSomewhere.has(name)) scope.add(name);
    }
  }

  // `import * as repo from './x.repo'` — calls read `repo.listThings(...)`.
  for (const m of src.matchAll(/import\s*\*\s*as\s*\w+\s*from\s*['"]([^'"]+)['"]/g)) {
    const target = m[1].startsWith('.') ? resolve(file, m[1]) : null;
    for (const n of (target ? declaredAsync.get(target) : asyncAnywhere) || []) scope.add(n);
  }
  return scope;
}

// Method names that belong to built-ins. `SLUG_RE.test(x)` is not a call to
// somebody's `async function test`.
const BUILTIN = new Set([
  'test', 'get', 'set', 'has', 'add', 'map', 'filter', 'find', 'some', 'every',
  'json', 'text', 'all', 'run', 'row', 'rows', 'push', 'join', 'split', 'slice',
  'replace', 'then', 'catch', 'keys', 'values', 'entries', 'parse', 'stringify',
  'sort', 'includes', 'match', 'trim', 'toString', 'close', 'open', 'start',
  'stop', 'end', 'next', 'emit', 'on', 'off', 'send', 'write', 'read', 'exec',
  'prepare', 'delete', 'reverse', 'concat', 'indexOf', 'charAt', 'padStart',
]);

// Names too generic to attribute to one declaration.
const AMBIGUOUS = new Set(['load', 'save', 'submit', 'refresh', 'reload', 'handler', 'main', 'init']);

const findings = [];
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const lines = src.split('\n');
  const scope = namesInScope(f, src);

  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('import ')) return;
    if (/^\s*(?:export\s+)?(?:async\s+)?function\s/.test(line)) return;   // a declaration

    for (const name of scope) {
      if (AMBIGUOUS.has(name) || BUILTIN.has(name)) continue;

      // Position 1: negated — `!name(`. Always wrong: a promise is truthy.
      const negated = new RegExp(`![\\s(]*(?:\\w+\\.)?${name}\\s*\\(`);
      if (negated.test(line) && !new RegExp(`!\\s*await`).test(line)) {
        findings.push({ file: f, line: i + 1, name, kind: 'заперечення промісу — завжди false', text: trimmed });
        continue;
      }

      // Position 2: handed straight to a JSON response, which takes `any`.
      const json = new RegExp(`json\\(\\s*(?:\\w+\\.)?${name}\\s*\\(`);
      if (json.test(line) && !/json\(\s*await/.test(line)) {
        findings.push({ file: f, line: i + 1, name, kind: 'проміс у відповідь — серіалізується в {}', text: trimmed });
        continue;
      }

      // Position 3: a property read off the call — `name(x).cnt`, `name(x).length`.
      const prop = new RegExp(`(?<!await\\s)(?:\\w+\\.)?${name}\\s*\\([^)]*\\)\\.(?!then|catch|finally)\\w`);
      if (prop.test(line) && !new RegExp(`await[\\s(]*(?:\\w+\\.)?${name}`).test(line)) {
        findings.push({ file: f, line: i + 1, name, kind: 'читання поля з промісу', text: trimmed });
        continue;
      }

      // Position 4: assigned to a variable, with no await on the way in.
      // The widget price list shipped a promise straight into a SQL parameter
      // — `const organizationId = organizationForSite(...)` — and SQLite
      // answered "can only bind numbers, strings, bigints, buffers, and null".
      // The three positions above all missed it: the promise travelled through
      // a variable first. A promise held deliberately for a later await is
      // rare enough here that the catch is worth the noise.
      const assigned = new RegExp(`(?:const|let|var)\\s+\\w+\\s*(?::[^=]+)?=\\s*(?:\\w+\\.)?${name}\\s*\\(`);
      if (assigned.test(line) && !/=\s*(?:await|\(await)/.test(line)) {
        findings.push({ file: f, line: i + 1, name, kind: 'проміс покладено у змінну без await', text: trimmed });
      }
    }
  });
}

if (findings.length === 0) {
  console.log('await: жодного промісу не використано як значення');
  process.exit(0);
}

console.error(`\nawait: ${findings.length} місць, де проміс використано як значення\n`);
for (const f of findings) {
  console.error(`  ${f.file}:${f.line}`);
  console.error(`    ${f.kind} — ${f.name}()`);
  console.error(`    ${f.text.slice(0, 110)}\n`);
}
process.exit(1);
