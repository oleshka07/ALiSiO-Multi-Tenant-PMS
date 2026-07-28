/**
 * Static audit of the application surface.
 *
 * Answers, mechanically and repeatably, the questions that are impossible to
 * answer reliably by reading 900 files by hand:
 *   A  which pages are stubs or unreachable
 *   B  which API routes nothing calls
 *   C  which tables the code never touches
 *   D  where data from the original single-tenant deployment is still hardcoded
 *   E  what is explicitly unfinished
 *
 * Run: node scripts/audit.mjs [--json]
 * Everything is read-only.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');

// ── file collection ──────────────────────────────────────────────────────────
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.next') continue;
      walk(p);
    } else if (/\.(ts|tsx)$/.test(e.name)) {
      files.push(p);
    }
  }
})(SRC);

const read = (f) => fs.readFileSync(f, 'utf8');
const rel = (f) => path.relative(ROOT, f).replace(/\\/g, '/');
const src = new Map(files.map((f) => [f, read(f)]));
const allText = [...src.values()].join('\n');

const isPage = (f) => /[\\/]page\.tsx$/.test(f);
const isRoute = (f) => /[\\/]route\.ts$/.test(f);
const isComponent = (f) => !isRoute(f);

const routeUrl = (f) =>
  '/' +
  rel(f)
    .replace(/^src\/app\//, '')
    .replace(/\/route\.ts$/, '')
    .replace(/\/page\.tsx$/, '')
    .replace(/\((\w|-)+\)\//g, '');

const report = { A: [], B: [], C: [], D: [], E: [], stats: {} };

// ── A. pages that render nothing meaningful ──────────────────────────────────
const pages = files.filter(isPage);
for (const f of pages) {
  const body = src.get(f);
  const lines = body.split('\n').length;
  const fetches = (body.match(/fetch\(/g) || []).length;
  const url = routeUrl(f);
  const isRedirect = /redirect\(/.test(body) && lines < 20;
  if (isRedirect) {
    report.A.push({ kind: 'redirect-only', url, lines, file: rel(f) });
  } else if (lines < 60 && fetches === 0) {
    report.A.push({ kind: 'stub-page', url, lines, fetches, file: rel(f) });
  }
}

// links pointing at routes that do not exist
const pageUrls = new Set(pages.map(routeUrl));
const dynamicPage = [...pageUrls].filter((u) => u.includes('['));
const hrefRe = /href=\{?["'`](\/[a-z0-9\-/[\]._]*)["'`]/gi;
const seenHref = new Set();
for (const [f, body] of src) {
  if (isRoute(f)) continue;
  let m;
  while ((m = hrefRe.exec(body))) {
    const href = m[1].split('?')[0].replace(/\/$/, '') || '/';
    if (href.startsWith('/api/')) continue;
    const key = href + '|' + rel(f);
    if (seenHref.has(key)) continue;
    seenHref.add(key);
    if (pageUrls.has(href)) continue;
    // tolerate dynamic segments: /sites/abc matches /sites/[siteId]
    const matchesDynamic = dynamicPage.some((d) => {
      const rx = new RegExp('^' + d.replace(/\[[^\]]+\]/g, '[^/]+') + '$');
      return rx.test(href);
    });
    if (matchesDynamic) continue;
    if (/\$\{|\[/.test(href)) continue; // template or unresolved
    report.A.push({ kind: 'broken-link', href, from: rel(f) });
  }
}

// ── B. API routes nothing calls ──────────────────────────────────────────────
// Callers live in three places, and missing any of them turns working code into
// a false "dead route": React components, the plain-JS embeddable widget under
// public/, and other server code (cron handlers, bots) calling siblings.
const routes = files.filter(isRoute);
const publicText = (() => {
  const dir = path.join(ROOT, 'public');
  if (!fs.existsSync(dir)) return '';
  const out = [];
  (function w(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) w(p);
      else if (/\.(js|html|json)$/.test(e.name)) out.push(read(p));
    }
  })(dir);
  return out.join('\n');
})();
const callerText = files.filter(isComponent).map((f) => src.get(f)).join('\n') + '\n' + publicText;
const routeServerText = routes.map((f) => src.get(f)).join('\n');

for (const f of routes) {
  const url = routeUrl(f);
  // /api/x/[id]/y  ->  /api/x/(?:[^/'"`]+|\$\{[^}]*\})/y  so template literals match
  const pattern = url
    .split('/')
    .map((seg) =>
      /^\[.+\]$/.test(seg)
        ? '(?:[^/\'"`]+|\\$\\{[^}]*\\})'
        : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    )
    .join('/');
  const rx = new RegExp(pattern + `(?:["'\`/?]|\\$\\{|$)`);
  if (rx.test(callerText)) continue;
  const body = src.get(f);
  const methods = [...body.matchAll(/export\s+(?:const|async function)\s+(GET|POST|PUT|PATCH|DELETE)/g)].map((m) => m[1]);
  // A route only referenced by other route files is still reachable (cron, bot,
  // webhook) — flag it separately rather than calling it dead.
  // Classify by how the route is *meant* to be reached. A cron endpoint with no
  // in-app caller is correct by design; an orphaned page endpoint is not.
  let kind;
  if (/^\/api\/(cron|webhooks)\//.test(url) || /\/cron$/.test(url)) kind = 'external-cron-webhook';
  else if (/telegram|whatsapp|bot/.test(url)) kind = 'bot-bridge';
  else if (/^\/api\/(admin|test-|debug)/.test(url) || /debug|cleanup|clean-/.test(url)) kind = 'admin-debug';
  else if (rx.test(routeServerText)) kind = 'server-only';
  else kind = 'orphan';
  report.B.push({ url, methods: methods.join(',') || '?', file: rel(f), kind });
}

// ── C. tables the code never touches ─────────────────────────────────────────
const dbFile = path.join(SRC, 'lib', 'db.ts');
const dbText = fs.existsSync(dbFile) ? read(dbFile) : '';
const declared = new Set(
  [...dbText.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?([a-z_0-9]+)/gi)].map((m) => m[1])
);
// also tables created outside db.ts
for (const [f, body] of src) {
  if (f === dbFile) continue;
  for (const m of body.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?([a-z_0-9]+)/gi)) declared.add(m[1]);
}
const nonDb = files.filter((f) => f !== dbFile).map((f) => src.get(f)).join('\n');
for (const t of [...declared].sort()) {
  if (/_new$|_pr\d+$/.test(t)) {
    report.C.push({ table: t, kind: 'migration-temp' });
    continue;
  }
  const rx = new RegExp(`\\b${t}\\b`);
  const usedElsewhere = rx.test(nonDb);
  const dmlInDb = new RegExp(`(FROM|INTO|UPDATE|JOIN)\\s+["'\`]?${t}\\b`, 'i').test(dbText);
  if (!usedElsewhere && !dmlInDb) report.C.push({ table: t, kind: 'never-referenced' });
  else if (!usedElsewhere) report.C.push({ table: t, kind: 'only-inside-db.ts' });
}

// ── D. leftovers from the original single-tenant deployment ──────────────────
const SMELLS = [
  ['org_alisio', /org_alisio\w*/g],
  ['old property name', /Carlsbad|Březová|Karlovy Vary/gi],
  ['old buildings', /\bBudova [A-Z]\b|Будова [A-Z]|bldg_[a-z]/g],
  ['old unit types', /Stealth House|Mirror House|Tiny House|Barn House/gi],
  ['old services', /svc_sauna|svc_tub|svc_pool|svc_sup|svc_bbq|addon_broom/g],
  ['old business units', /bu_glamping|bu_camping|bu_restaurant|bu_sauna|bu_pool|bu_budova/g],
  ['old promo', /GLAMPING['"]|promo_glamping/g],
  ['personal mailbox', /4sv\.exe|@alisio\.cz/g],
  ['old domain', /alisio\.rozum\.one|kemp[a-z-]*\.cz/gi],
  ['hardcoded price list', /wpl_[a-z0-9_]+/g],
];

// Absolute URLs pointing at one specific deployment. Every tenant gets its own
// host, so a literal origin baked into a guest link, invoice or webhook is a
// multi-tenancy bug, not a style issue. Anything not obviously a third-party
// API endpoint is suspect.
const THIRD_PARTY = /googleapis|google\.com|gstatic|openai|telegram|facebook|fbcdn|booking\.com|airbnb|hostex|teya|pricelabs|cnb\.cz|schema\.org|w3\.org|github|npmjs|unpkg|jsdelivr|sentry|stripe|gopay|whatsapp|localhost|127\.0\.0\.1|example\.(com|org)/i;
for (const [f, body] of src) {
  for (const m of body.matchAll(/["'`](https?:\/\/[a-z0-9.-]+[^"'`\s]*)["'`]/gi)) {
    const url = m[1];
    if (THIRD_PARTY.test(url)) continue;
    const line = body.slice(0, m.index).split('\n').length;
    report.D.push({ label: 'hardcoded origin', file: rel(f), line, count: 1, sample: url.slice(0, 60) });
  }
}
for (const [f, body] of src) {
  for (const [label, rx] of SMELLS) {
    rx.lastIndex = 0;
    const hits = body.match(rx);
    if (!hits) continue;
    const lineNo = body.slice(0, body.search(rx)).split('\n').length;
    report.D.push({ label, file: rel(f), line: lineNo, count: hits.length, sample: [...new Set(hits)].slice(0, 3).join(', ') });
  }
}

// ── E. explicitly unfinished ─────────────────────────────────────────────────
for (const [f, body] of src) {
  body.split('\n').forEach((line, i) => {
    const m = line.match(/\b(TODO|FIXME|HACK|XXX|not implemented|coming soon|Не реалізовано|в розробці)\b/i);
    if (m) report.E.push({ file: rel(f), line: i + 1, marker: m[1], text: line.trim().slice(0, 110) });
  });
}

// ── stats ────────────────────────────────────────────────────────────────────
report.stats = {
  files: files.length,
  pages: pages.length,
  routes: routes.length,
  tablesDeclared: declared.size,
  A_ui: report.A.length,
  B_deadRoutes: report.B.length,
  C_tables: report.C.length,
  D_leftovers: report.D.length,
  E_unfinished: report.E.length,
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const h = (s) => console.log(`\n${'═'.repeat(78)}\n${s}\n${'═'.repeat(78)}`);
h('ПІДСУМОК');
for (const [k, v] of Object.entries(report.stats)) console.log(`  ${k.padEnd(18)} ${v}`);

h('A. UI: заглушки, редиректи, биті посилання');
for (const r of report.A) {
  if (r.kind === 'broken-link') console.log(`  [БИТЕ]     ${r.href}  ←  ${r.from}`);
  else console.log(`  [${r.kind === 'redirect-only' ? 'РЕДИРЕКТ' : 'ЗАГЛУШКА'}] ${String(r.url).padEnd(38)} ${r.lines} рядків  ${r.file}`);
}

h('B. API-маршрути без викликача в застосунку');
const LABELS = {
  orphan: 'ОСИРОТІЛІ — треба розібратися',
  'external-cron-webhook': 'cron / вебхуки — так і має бути',
  'bot-bridge': 'мости для ботів — так і має бути',
  'admin-debug': 'адмін / налагодження — кандидати на видалення',
  'server-only': 'викликаються з іншого серверного коду',
};
for (const kind of ['orphan', 'admin-debug', 'server-only', 'bot-bridge', 'external-cron-webhook']) {
  const rs = report.B.filter((r) => r.kind === kind);
  if (!rs.length) continue;
  console.log(`\n  ${LABELS[kind]} (${rs.length}):`);
  for (const r of rs) console.log(`    ${r.url.padEnd(52)} ${r.methods}`);
}

h('C. Таблиці без використання');
for (const r of report.C) console.log(`  ${r.table.padEnd(34)} ${r.kind}`);

h('D. Рештки старого бізнесу в коді');
for (const r of report.D) console.log(`  ${r.label.padEnd(22)} ${r.file}:${r.line}  ×${r.count}  ${r.sample}`);

h('E. Явно незавершене');
const byFile = {};
for (const r of report.E) (byFile[r.file] ||= []).push(r);
for (const [f, rs] of Object.entries(byFile)) {
  console.log(`  ${f}  (${rs.length})`);
  for (const r of rs.slice(0, 4)) console.log(`      ${r.line}: ${r.text}`);
}
