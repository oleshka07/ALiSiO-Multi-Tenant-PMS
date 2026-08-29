#!/usr/bin/env node
/**
 * Replace `return NextResponse.json({ error: err.message }, { status: 500 })`
 * with `return serverError('<scope>', err)`.
 *
 *   node scripts/codemod-server-errors.mjs --dry
 *   node scripts/codemod-server-errors.mjs
 *
 * One-shot. The gate that keeps it fixed is scripts/check-error-leak.mjs.
 *
 * Only status 500 is touched. A 400 carrying a validation message is that
 * message doing its job, and `propertyErrorStatus(e)` chooses 400/403/404 from
 * a domain error whose text is written to be read by a person.
 *
 * The scope is `<path without src/ and extension> <enclosing function>`, taken
 * from the nearest `function name(` / `const name =` above the catch. It is a
 * log prefix, not an identifier — approximate is fine, absent is not, because
 * a 500 with no scope in the log is the state this is fixing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dry = process.argv.includes('--dry');
// fileURLToPath, не .pathname: на Windows .pathname дає '/D:/…%20…', і
// readdirSync такого шляху падає з ENOENT ще до першої заміни.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// `{ error: X.message }` or `{ error: X?.message || 'Fallback' }`, answered 500.
const LEAK = /return\s+NextResponse\.json\(\s*\{\s*error:\s*(e|err|error)(\??\.message)(\s*\|\|\s*(['"`])((?:[^'"`\\]|\\.)*)\4)?\s*\}\s*,\s*\{\s*status:\s*500\s*,?\s*\}\s*\)\s*;/g;

// Anchored at column 0: a top-level declaration is the handler, an indented
// `const accounts = ...` is a local variable three lines above the catch, and
// matching that produced scopes like «accounts accounts».
const NAME = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)|^(?:export\s+)?const\s+(\w+)\s*=/gm;

let files = 0;
let hits = 0;

function enclosingName(text, index) {
  let name = '';
  NAME.lastIndex = 0;
  let m;
  while ((m = NAME.exec(text)) && m.index < index) name = m[1] || m[2] || name;
  return name;
}

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.next') continue;
      walk(p);
      continue;
    }
    if (!e.name.endsWith('.ts')) continue;
    if (e.name.endsWith('.check.ts')) continue;

    const rel = path.relative(ROOT, p).replaceAll(path.sep, '/');
    let text = fs.readFileSync(p, 'utf8');
    if (!LEAK.test(text)) continue;
    LEAK.lastIndex = 0;

    const base = rel.replace(/^src\//, '').replace(/\.ts$/, '')
      .replace(/\/route$/, '').replace(/\.handlers$/, '');

    let fileHits = 0;
    text = text.replace(LEAK, (whole, varName, _dot, _orPart, _q, fallback, offset, full) => {
      fileHits += 1;
      const fn = enclosingName(full, offset);
      const scope = fn ? `${base} ${fn}` : base;
      // A hand-written fallback string was the author saying what this failure
      // means to the caller; keep it as the user-facing half.
      const userArg = fallback ? `, '${fallback.replace(/'/g, "\\'")}'` : '';
      return `return serverError('${scope}', ${varName}${userArg});`;
    });

    if (!text.includes("from '@core/http/errors'")) {
      // After the last import, so it lands with the others rather than above
      // a file-header comment.
      const imports = [...text.matchAll(/^import .*?;$/gm)];
      if (imports.length) {
        const last = imports[imports.length - 1];
        const at = last.index + last[0].length;
        text = `${text.slice(0, at)}\nimport { serverError } from '@core/http/errors';${text.slice(at)}`;
      } else {
        text = `import { serverError } from '@core/http/errors';\n${text}`;
      }
    }

    files += 1;
    hits += fileHits;
    console.log(`  ${rel}: ${fileHits}`);
    if (!dry) fs.writeFileSync(p, text);
  }
}

walk(path.join(ROOT, 'src'));
console.log(`\nфайлів: ${files}   замін: ${hits}${dry ? '   (--dry, нічого не записано)' : ''}`);
