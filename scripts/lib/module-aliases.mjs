/**
 * `@core/…` and `@/…` for bare node.
 *
 *   import './../../scripts/lib/module-aliases.mjs';   // then dynamic import()
 *
 * The application's modules import each other through the tsconfig path
 * aliases. The bundler knows them; node does not. Anything that reaches a
 * repository or a domain module from a plain `node file.ts` — the self-checks
 * in src/**\/*.check.ts, an operator script — dies on
 * `Cannot find package '@core/db'` without this.
 *
 * Extensions are resolved too: repositories import `./tenant-scope` with no
 * `.ts`, which node also refuses.
 *
 * IMPORTANT — registerHooks runs when this module is evaluated, so it must be
 * imported BEFORE anything that needs an alias. A static `import` of an
 * aliased module in the same file is hoisted above this one and still fails;
 * use `await import(...)` after this line.
 *
 * scripts/apply-hotel.mjs keeps its own inline copy of this resolver and that
 * is deliberate, not an oversight. It runs on the server during a deploy,
 * where the only thing guaranteed to exist is the file being executed —
 * that copy exists because the first production run failed on exactly this,
 * after passing locally under a loader the server did not have. A shared
 * helper is right for checks that run inside the repository; it is not worth
 * re-introducing a dependency into the one script whose whole lesson was that
 * it must carry its own.
 */
import fs from 'node:fs';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

// fileURLToPath, not URL.pathname: pathname keeps percent-encoding and a
// leading slash before the drive letter, so on a Windows checkout under a
// path with a space every alias silently resolved to nothing and each
// data-level check died with "Cannot find package '@core/db'".
const ROOT = path.dirname(path.dirname(
  path.dirname(fileURLToPath(import.meta.url)),
));

const ALIASES = (() => {
  try {
    const raw = fs.readFileSync(path.join(ROOT, 'tsconfig.json'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
    return Object.entries(JSON.parse(raw).compilerOptions?.paths ?? {});
  } catch { return []; }
})();

function onDisk(candidate) {
  for (const p of [candidate, `${candidate}.ts`, `${candidate}.tsx`, `${candidate}.mjs`,
    `${candidate}.js`, path.join(candidate, 'index.ts')]) {
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  return null;
}

function fromAlias(spec) {
  for (const [pattern, [target]] of ALIASES) {
    if (pattern.endsWith('/*')) {
      const head = pattern.slice(0, -1);
      if (spec.startsWith(head)) return path.join(ROOT, target.slice(0, -1) + spec.slice(head.length));
    } else if (spec === pattern) {
      return path.join(ROOT, target);
    }
  }
  return null;
}

/**
 * `next/<something>` -> `next/<something>.js`.
 *
 * A module facade (`@properties`, `@pricing`) pulls in the module's API
 * handlers and the session, and those import `next/server` and `next/headers`.
 * The bundler resolves them; node does not — `next` has no exports entry for
 * either, only files on disk. Same "bundler knows, node does not" gap as the
 * aliases above, so it is fixed in the same place.
 *
 * A rule, not a list: enumerating the two known names would need extending on
 * every further facade, and each time the failure reads as a broken feature
 * rather than a broken launch. When the file is absent the specifier goes
 * through untouched, so a genuine typo stays an error.
 */
function nextGap(spec) {
  if (!spec.startsWith('next/') || spec.endsWith('.js')) return null;
  const file = path.join(ROOT, 'node_modules', `${spec}.js`);
  return fs.existsSync(file) ? pathToFileURL(file).href : null;
}

registerHooks({
  resolve(spec, ctx, next) {
    const gap = nextGap(spec);
    if (gap) return { url: gap, shortCircuit: true };
    const mapped = fromAlias(spec);
    if (mapped) {
      const file = onDisk(mapped);
      if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
    }
    if (spec.startsWith('.') && ctx.parentURL?.startsWith('file://')) {
      const file = onDisk(path.resolve(path.dirname(fileURLToPath(ctx.parentURL)), spec));
      if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
    }
    return next(spec, ctx);
  },
});
