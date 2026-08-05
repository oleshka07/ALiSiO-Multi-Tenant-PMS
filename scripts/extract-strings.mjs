/**
 * Wrap the interface's Ukrainian text in t(), so it can be translated.
 *
 *   node scripts/extract-strings.mjs --dry            # report, change nothing
 *   node scripts/extract-strings.mjs <path> [<path>]  # rewrite those files
 *   node scripts/extract-strings.mjs --all            # the whole operator UI
 *
 * Parsed with the TypeScript compiler, not matched with regexes. The thing
 * being edited is 95 files of working JSX with nested expressions, ternaries
 * and template literals in it; a regex that is 99% right across 3,500 edits is
 * wrong 35 times, and each one is a broken screen.
 *
 * What it touches, and nothing else:
 *
 *   <div>Текст</div>              → <div>{t('Текст')}</div>
 *   placeholder="Текст"           → placeholder={t('Текст')}
 *
 * Attributes are an allow-list, not a deny-list: className, href, id and
 * friends look like text and are not.
 *
 * What it refuses to touch, and says so:
 *
 *   - files without 'use client' — useT() is a hook, and a server component
 *     calling one fails at build time rather than in review;
 *   - text with HTML entities (&apos;, &nbsp;) — moving those into a string
 *     literal changes what renders;
 *   - JSX inside a function that is not a component, where a hook cannot go.
 *
 * Module-scope constants (the nav arrays, ROLE_LABELS) are deliberately out of
 * scope: their strings are defined where no hook can run, so they are wrapped
 * at the point they are rendered instead, by hand.
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const CYRILLIC = /[А-Яа-яЇїІіЄєҐґ]/;

/**
 * The key is the text as it renders, not as it is indented.
 *
 * JSX collapses runs of whitespace, so a paragraph wrapped across four source
 * lines renders as one line — but its source text carries the file's
 * indentation. Left alone, the dictionary key would contain twenty spaces and
 * a newline, and re-indenting the file would silently orphan the translation.
 */
const renderedText = (text) => text.replace(/\s+/g, ' ').trim();

/** Attributes whose value is shown to a person. */
const TEXT_ATTRIBUTES = new Set([
  'placeholder',
  'title',
  'alt',
  'aria-label',
  'aria-placeholder',
  'label',
]);

const ROOTS = ['src/app/app', 'src/components', 'src/modules'];
const SKIP_DIRS = new Set(['node_modules', '.next', '_design']);

// ─── file discovery ──────────────────────────────────────────────────────────
function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.name.endsWith('.tsx') && !entry.name.endsWith('.check.tsx')) yield full;
  }
}

// ─── emit a JS string literal for arbitrary text ─────────────────────────────
function literal(text) {
  return `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
}

/**
 * Is the name `t` already taken in this file?
 *
 * The booking widget carries its own `t` — a translations object, not a
 * function — and several finance tabs bind `t` as a row variable. Declaring a
 * second one shadows theirs and the file stops compiling, which is how the
 * first run of this produced 83 errors. When the name is taken, the hook goes
 * in under another one.
 */
function nameIsTaken(source, name) {
  let taken = false;
  const check = (node) => {
    if (taken) return;
    if (
      (ts.isVariableDeclaration(node) ||
        ts.isParameter(node) ||
        ts.isImportSpecifier(node) ||
        ts.isBindingElement(node) ||
        ts.isFunctionDeclaration(node)) &&
      node.name &&
      ts.isIdentifier(node.name) &&
      node.name.text === name
    ) {
      taken = true;
      return;
    }
    ts.forEachChild(node, check);
  };
  check(source);
  return taken;
}

/**
 * The nearest enclosing function that a hook may be called in — a component.
 * Returns null when the JSX lives in a plain helper, which is the case this
 * refuses to edit rather than generating code that fails the rules of hooks.
 */
function enclosingComponent(node) {
  let candidate = null;
  for (let n = node.parent; n; n = n.parent) {
    let name = null;
    let body = null;

    if (ts.isFunctionDeclaration(n)) {
      name = n.name?.text ?? null;
      body = n.body;
    } else if (
      (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) &&
      n.parent &&
      ts.isVariableDeclaration(n.parent) &&
      ts.isIdentifier(n.parent.name)
    ) {
      name = n.parent.name.text;
      body = n.body;
    }

    // A component's name is capitalised; a helper's is not, and useT() cannot
    // legally run inside one.
    if (name && body && ts.isBlock(body) && /^[A-Z]/.test(name)) candidate = { node: n, body };
  }
  return candidate;
}

// ─── one file ────────────────────────────────────────────────────────────────
function processFile(file, catalogue, report) {
  const original = fs.readFileSync(file, 'utf8');
  if (!CYRILLIC.test(original)) return null;

  if (!/^\s*['"]use client['"]/.test(original)) {
    report.serverComponents.push(file);
    return null;
  }

  const source = ts.createSourceFile(
    file,
    original,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );

  // `t` unless the file already has one of its own.
  const fn = nameIsTaken(source, 't') ? 'tUi' : 't';

  const edits = [];
  const components = new Map(); // body node → insertion offset
  let skippedEntities = 0;
  let skippedHelpers = 0;

  const useIn = (node) => {
    const component = enclosingComponent(node);
    if (!component) {
      skippedHelpers++;
      return false;
    }
    // after the opening brace of the component body
    components.set(component.body, component.body.getStart(source) + 1);
    return true;
  };

  const visit = (node) => {
    if (ts.isJsxText(node)) {
      const raw = node.getText(source);
      const trimmed = raw.trim();
      const key = renderedText(trimmed);
      if (key && CYRILLIC.test(key)) {
        // An entity is markup, not text: '&apos;' inside a string literal
        // renders as those six characters.
        if (key.includes('&')) {
          skippedEntities++;
        } else if (useIn(node)) {
          const start = node.getStart(source) + raw.indexOf(trimmed);
          edits.push({ start, end: start + trimmed.length, text: `{${fn}(${literal(key)})}` });
          catalogue.add(key);
        }
      }
    } else if (ts.isJsxAttribute(node) && node.initializer) {
      const name = node.name.getText(source);
      if (TEXT_ATTRIBUTES.has(name) && ts.isStringLiteral(node.initializer)) {
        const value = renderedText(node.initializer.text);
        if (CYRILLIC.test(value) && useIn(node)) {
          edits.push({
            start: node.initializer.getStart(source),
            end: node.initializer.getEnd(),
            text: `{${fn}(${literal(value)})}`,
          });
          catalogue.add(value);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  if (skippedEntities) report.entities.push(`${file} (${skippedEntities})`);
  if (skippedHelpers) report.helpers.push(`${file} (${skippedHelpers})`);
  if (!edits.length) return null;

  // Declare the hook once per component that needs it.
  for (const offset of components.values()) {
    edits.push({ start: offset, end: offset, text: `\n  const ${fn} = useT();` });
  }

  // Back to front, so earlier offsets stay valid.
  edits.sort((a, b) => b.start - a.start);
  let output = original;
  for (const edit of edits) {
    output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  }

  // The module may already be imported for I18nProvider — extend that import
  // rather than skipping, which silently left useT undefined.
  const existing = output.match(/import\s*\{([^}]*)\}\s*from '@core\/i18n\/client';/);
  if (existing) {
    if (!/\buseT\b/.test(existing[1])) {
      output = output.replace(
        existing[0],
        `import {${existing[1].replace(/\s*$/, '')}, useT } from '@core/i18n/client';`,
      );
    }
  } else {
    const useClient = output.match(/^\s*['"]use client['"];?\r?\n/);
    const at = useClient ? useClient[0].length : 0;
    output = `${output.slice(0, at)}\nimport { useT } from '@core/i18n/client';${output.slice(at)}`;
  }

  return { output, count: edits.length - components.size };
}

// ─── run ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const dry = argv.includes('--dry');
const all = argv.includes('--all');
const targets = argv.filter((a) => !a.startsWith('--'));

const files = targets.length
  ? targets.flatMap((t) => (fs.statSync(t).isDirectory() ? [...walk(t)] : [t]))
  : all || dry
    ? ROOTS.flatMap((r) => [...walk(r)])
    : [];

if (!files.length) {
  console.error('Вкажіть файл або теку, або --all для всього операторського UI.');
  process.exit(2);
}

const catalogue = new Set();
const report = { serverComponents: [], entities: [], helpers: [] };
let changedFiles = 0;
let changedStrings = 0;

for (const file of files) {
  const result = processFile(file, catalogue, report);
  if (!result) continue;
  changedFiles++;
  changedStrings += result.count;
  if (!dry) fs.writeFileSync(file, result.output);
  console.log(`${String(result.count).padStart(4)}  ${file}`);
}

console.log(
  `\n${changedStrings} рядків у ${changedFiles} файлах${dry ? ' (нічого не записано)' : ''}`,
);
console.log(`каталог: ${catalogue.size} унікальних`);

// Everything refused is printed: a silent skip is how half a screen stays
// Ukrainian and nobody can say why.
for (const [label, list] of [
  ['серверні компоненти (hook не можна)', report.serverComponents],
  ['текст із HTML-сутностями', report.entities],
  ['JSX поза компонентом', report.helpers],
]) {
  if (list.length) {
    console.log(`\nпропущено — ${label}: ${list.length}`);
    for (const item of list.slice(0, 8)) console.log(`  ${item}`);
    if (list.length > 8) console.log(`  …ще ${list.length - 8}`);
  }
}

if (!dry) {
  const cataloguePath = 'src/core/i18n/messages/catalogue.json';
  const existing = fs.existsSync(cataloguePath)
    ? JSON.parse(fs.readFileSync(cataloguePath, 'utf8'))
    : [];
  const merged = [...new Set([...existing, ...catalogue])].sort((a, b) => a.localeCompare(b, 'uk'));
  fs.writeFileSync(cataloguePath, `${JSON.stringify(merged, null, 2)}\n`);
  console.log(`\nкаталог записано: ${cataloguePath} (${merged.length})`);
}
