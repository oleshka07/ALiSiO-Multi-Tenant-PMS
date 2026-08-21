/**
 * Route authorisation audit.
 *
 * The middleware only checks that a session_id cookie is *present*. It does not
 * validate it against the database and never resolves which organization the
 * caller belongs to. Everything real happens inside the handler.
 *
 * So a route that never resolves a session runs with no identity at all: any
 * logged-in user of any tenant can call it, and whatever it reads or writes is
 * chosen entirely by the request. Combined with an unscoped query — see
 * audit-tenant.mjs — that is exactly how one hotel reads another's data.
 *
 * Handlers usually live in a module and are re-exported by route.ts, so imports
 * are followed one hop to find where the check actually is.
 *
 * Run: node scripts/audit-routes.mjs [--json]
 * Read-only.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '.next') walk(p); }
    else if (/\.(ts|tsx)$/.test(e.name)) files.push(p);
  }
})(SRC);

const read = (f) => fs.readFileSync(f, 'utf8');
const rel = (f) => path.relative(ROOT, f).replace(/\\/g, '/');
const src = new Map(files.map((f) => [f, read(f)]));

// ── public surface, taken from the middleware itself ─────────────────────────
const proxyText = src.get(path.join(SRC, 'proxy.ts')) ?? '';
function listFrom(name) {
  const m = proxyText.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));
  if (!m) return [];
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}
const PUBLIC_PREFIXES = listFrom('PUBLIC_PREFIXES');
const PUBLIC_EXACT = listFrom('PUBLIC_EXACT');

const routeUrl = (f) =>
  '/' + rel(f).replace(/^src\/app\//, '').replace(/\/route\.ts$/, '').replace(/\((\w|-)+\)\//g, '');

const isPublic = (url) =>
  PUBLIC_EXACT.includes(url) || PUBLIC_PREFIXES.some((p) => url.startsWith(p));

// ── how a handler establishes identity ───────────────────────────────────────
const SESSION = /withActor|withPermission|withOwner|currentActor|getSessionUser|requireOwner|requirePermission|requireAuth|currentUser\s*\(/;
const TOKEN = /CRON_SECRET|EMAIL_POLL_SECRET|ICAL_CRON_SECRET|HOSTEX_WEBHOOK_SECRET|WHATSAPP_APP_SECRET|verifySignature|x-webhook-signature|Bearer /i;
/** Guest/investor links carry an unguessable token that identifies the row. */
const ROW_TOKEN = /guest_page_token|portal_token|export_token|\btoken\b\s*[,)=]/;

/** Resolve a local import specifier to a file we have. */
function resolveImport(fromFile, spec) {
  let base;
  if (spec.startsWith('@/')) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith('@core/')) base = path.join(SRC, 'core', spec.slice(6));
  else if (/^@[a-z]+$/.test(spec)) base = path.join(SRC, 'modules', spec.slice(1), 'api');
  else if (spec.startsWith('@')) {
    const [mod, ...rest] = spec.slice(1).split('/');
    base = path.join(SRC, 'modules', mod, 'api', ...rest);
  } else if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec);
  else return null;

  for (const c of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    if (src.has(c)) return c;
  }
  return null;
}

/** Text of the route plus the modules it imports, one hop deep. */
function reachableText(routeFile, depth = 2, seen = new Set()) {
  if (seen.has(routeFile) || depth < 0) return '';
  seen.add(routeFile);
  let text = src.get(routeFile) ?? '';
  for (const m of text.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
    const target = resolveImport(routeFile, m[1]);
    if (target) text += '\n' + reachableText(target, depth - 1, seen);
  }
  return text;
}

const routes = files.filter((f) => /[\\/]route\.ts$/.test(f) && rel(f).includes('src/app/api/'));
const report = { unauthenticated: [], publicNoCheck: [], ok: [], stats: {} };

for (const f of routes) {
  const url = routeUrl(f);
  const text = reachableText(f);
  const methods = [...(src.get(f) ?? '').matchAll(/export\s+(?:const|async function)\s+(GET|POST|PUT|PATCH|DELETE)/g)].map((x) => x[1]);
  const writes = methods.some((x) => x !== 'GET');

  const hasSession = SESSION.test(text);
  const hasToken = TOKEN.test(text);
  const hasRowToken = ROW_TOKEN.test(text);

  if (isPublic(url)) {
    // Public by design — but then it must prove the caller some other way.
    if (!hasToken && !hasRowToken && !hasSession) {
      report.publicNoCheck.push({ url, methods: methods.join(','), writes, file: rel(f) });
    } else {
      report.ok.push(url);
    }
    continue;
  }

  if (!hasSession && !hasToken) {
    // Behind the middleware, so a cookie must exist — but the cookie is never
    // validated there and no organization is derived from it. A shared secret
    // counts as identity here: a cron job and a bot have no session to
    // present, and a Bearer token is how they identify themselves.
    report.unauthenticated.push({ url, methods: methods.join(','), writes, file: rel(f) });
  } else {
    report.ok.push(url);
  }
}

report.stats = {
  routes: routes.length,
  publicPrefixes: PUBLIC_PREFIXES.length,
  noIdentity: report.unauthenticated.length,
  publicNoCheck: report.publicNoCheck.length,
  ok: report.ok.length,
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const h = (s) => console.log(`\n${'═'.repeat(78)}\n${s}\n${'═'.repeat(78)}`);
h('ПІДСУМОК');
for (const [k, v] of Object.entries(report.stats)) console.log(`  ${k.padEnd(18)} ${v}`);

h(`ЗА СЕСІЄЮ, АЛЕ БЕЗ ВИЗНАЧЕННЯ ОСОБИ (${report.unauthenticated.length})`);
console.log('  Middleware лише перевіряє наявність cookie. Ці маршрути ніде не');
console.log('  зʼясовують, ХТО викликає і з якої організації — отже будь-який');
console.log('  залогінений користувач будь-якої компанії може їх викликати.\n');
const w = report.unauthenticated.filter((r) => r.writes);
const ro = report.unauthenticated.filter((r) => !r.writes);
console.log(`  ── зі змінами даних (${w.length}) ──`);
for (const r of w) console.log(`    ${r.url.padEnd(52)} ${r.methods}`);
console.log(`\n  ── лише читання (${ro.length}) ──`);
for (const r of ro.slice(0, 40)) console.log(`    ${r.url.padEnd(52)} ${r.methods}`);
if (ro.length > 40) console.log(`    … ще ${ro.length - 40}`);

h(`ПУБЛІЧНІ БЕЗ ЖОДНОЇ ПЕРЕВІРКИ (${report.publicNoCheck.length})`);
console.log('  Виведені з-під middleware і не перевіряють ні токен, ні сесію.\n');
for (const r of report.publicNoCheck) {
  console.log(`  ${r.writes ? '[ЗАПИС]' : '[читання]'} ${r.url.padEnd(46)} ${r.methods}`);
}
