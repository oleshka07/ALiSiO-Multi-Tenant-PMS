/**
 * An operator route that never establishes who is calling, or which hotel.
 *
 *   node scripts/check-route-guards.mjs [--strict]
 *
 * The middleware only checks that a session_id cookie is PRESENT. It does not
 * validate it and it never derives an organization, so a handler that does not
 * go through one of the guards runs with no identity at all (see the note at
 * the top of core/auth/session.ts — this was once true of 59 routes).
 *
 * On SQLite that meant any logged-in user of any tenant could reach whatever
 * the route touched. On Postgres the row-level policies stop the damage, but
 * they stop the route too: with no organization set, a scoped write is refused
 * outright and a scoped read quietly returns nothing. So an unguarded operator
 * route is now both a security hole and a broken feature.
 *
 * A guard can be applied in three places, and all three count:
 *
 *   in the route file        export const POST = withActor(handler)
 *   in the module barrel     export const listAccounts = await withFinanceRead(_listAccounts)
 *   inside the handler       currentActor() … runWithOrganization(...)
 *
 * The middle one is the common shape here and is why a check that only reads
 * route files reports most of the API as unguarded. This one follows the export
 * through the barrel before deciding.
 *
 * Public routes are exempt by path: a guest, an embedded widget, a payment
 * gateway and a cron job have no session by definition, and each of those
 * establishes its tenant from what it does have — a site key, a reservation
 * token, a shared secret.
 */
import fs from 'node:fs';
import path from 'node:path';

const GUARDS = /\bwith(Actor|Permission|Owner|FinanceRead|FinanceWrite|Site)\b|\bcurrentActor\b|\brunWithOrganization\b/;

/** A guest, a widget, a gateway or a cron has no session — by design. */
const PUBLIC = /\/api\/(widget|booking|guest|public|webhooks?|cron|auth|health)\b|\/api\/tasks\/telegram|\/api\/payments\/webhook/;

// Read the alias table with a regex rather than JSON.parse: tsconfig.json is
// JSONC, and stripping its comments generically eats the `*` in `"@*.ts"`.
const aliases = {};
for (const m of fs.readFileSync('tsconfig.json', 'utf8')
  .matchAll(/"([^"]+)"\s*:\s*\[\s*"([^"]+)"/g)) {
  if (m[1].includes('*') || m[1].startsWith('@')) aliases[m[1]] = [m[2]];
}

/** Where an import specifier lands on disk. */
function resolveSpec(fromFile, spec) {
  let base;
  if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec);
  else {
    const hit = Object.entries(aliases).find(([k]) => {
      const stem = k.replace(/\*$/, '');
      return k.endsWith('*') ? spec.startsWith(stem) : spec === k;
    });
    if (!hit) return null;
    const [key, [target]] = hit;
    base = path.resolve(target.replace(/\*$/, '') + spec.slice(key.replace(/\*$/, '').length));
  }
  for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return path.relative(process.cwd(), c);
  }
  return null;
}

/** Is `name`, as exported by `file`, guarded — following one hop through a barrel? */
function guardedExport(file, name, depth = 0) {
  if (depth > 2 || !fs.existsSync(file)) return false;
  const src = fs.readFileSync(file, 'utf8');

  // export const NAME = withX(...)  /  export const NAME = await withX(...)
  const assigned = src.match(new RegExp(`export\\s+const\\s+${name}\\s*(?::[^=]+)?=\\s*([^\\n;]+)`));
  if (assigned && GUARDS.test(assigned[1])) return true;

  // export async function NAME — the guard would be inside the body
  const declared = src.match(new RegExp(`export\\s+async\\s+function\\s+${name}\\b[\\s\\S]{0,2500}`));
  if (declared && GUARDS.test(declared[0].split(/\nexport /)[0])) return true;

  // Re-exported from somewhere else: follow it.
  if (assigned) {
    const rhs = assigned[1].trim().replace(/;$/, '');
    if (/^\w+$/.test(rhs)) return guardedExport(file, rhs, depth + 1) || followImport(file, src, rhs, depth);
  }
  return followImport(file, src, name, depth);
}

function followImport(file, src, name, depth) {
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    const names = m[1].split(',').map((s) => s.trim());
    const entry = names.find((n) => n.split(/\s+as\s+/).pop().trim() === name);
    if (!entry) continue;
    const original = entry.split(/\s+as\s+/)[0].trim();
    const target = resolveSpec(file, m[2]);
    if (target) return guardedExport(target, original, depth + 1);
  }
  // export { a, b } from './x'
  for (const m of src.matchAll(/export\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    const entry = m[1].split(',').map((s) => s.trim())
      .find((n) => n.split(/\s+as\s+/).pop().trim() === name);
    if (!entry) continue;
    const target = resolveSpec(file, m[2]);
    if (target) return guardedExport(target, entry.split(/\s+as\s+/)[0].trim(), depth + 1);
  }
  return false;
}

const routes = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (e.name === 'route.ts') routes.push(full);
  }
})('src/app/api');

const open = [];
let checked = 0;
for (const file of routes) {
  if (PUBLIC.test('/' + file.replace(/^src\/app/, '').replace(/^\//, ''))) continue;
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/export\s+(?:async\s+function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/g)) {
    checked++;
    if (!guardedExport(file, m[1])) {
      open.push(`${file.replace(/^src\/app/, '')}  ${m[1]}`);
    }
  }
}

console.log(`\nroute-guards: ${checked} операторських обробників, ${open.length} без варти\n`);
for (const o of open) console.log('  ' + o);
if (open.length) {
  console.log(`
  Без варти немає ні перевірки прав, ні орендаря. На Postgres це означає, що
  запис відхиляється політикою, а читання тихо повертає порожнє — тобто роут
  зламаний рівно настільки ж, наскільки відкритий.\n`);
}

if (process.argv.includes('--strict') && open.length) process.exit(1);
