/**
 * Tenant-isolation audit.
 *
 * The question this answers: can one hotel's request reach another hotel's
 * rows? With 136 tables and ~370 routes that cannot be established by reading,
 * and it is the one class of bug that must be zero before a second customer
 * exists — a leak is not a bug report, it is a breach.
 *
 * Method:
 *   1. Classify every table by how it is scoped to an organization:
 *        direct   — has organization_id
 *        derived  — reaches one through a foreign key (property_id, …)
 *        global   — product reference data, same for everyone
 *        UNSCOPED — no path at all; every tenant shares the rows
 *   2. Read every SQL statement in the source and check whether a statement
 *      touching a tenant table constrains it.
 *   3. Report UNIQUE constraints that omit the organization, because those are
 *      where the second customer breaks the first.
 *
 * Run: node scripts/audit-tenant.mjs [--json]
 * Read-only.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');
const DB_FILE = path.join(SRC, 'lib', 'db.ts');

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
const dbText = fs.existsSync(DB_FILE) ? read(DB_FILE) : '';

/**
 * The live schema, when there is one, is the truth. db.ts creates a table and
 * then rebuilds it in a later migration, and the parser below takes the first
 * CREATE it sees — so reading only the source reports the shape a table had
 * before its migrations, which is how invoices kept being reported as UNIQUE on
 * invoice_number alone after that was fixed.
 */
async function liveSchema() {
  const file = path.join(ROOT, process.env.DB_PATH || 'data/alisio.db');
  if (!fs.existsSync(file)) return '';
  try {
    const { default: Database } = await import('better-sqlite3');
    const db = new Database(file, { readonly: false });
    const rows = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND sql IS NOT NULL").all();
    db.close();
    return rows.map((r) => `${r.sql};`).join('\n') + '\n';
  } catch (e) {
    console.error('[audit] live schema unavailable, falling back to db.ts:', e.message);
    return '';
  }
}

// ── 1. table catalogue ───────────────────────────────────────────────────────
/** table -> { columns, refs: {column -> table}, unique: [[cols]] } */
const tables = new Map();
const allText = (await liveSchema()) + [...src.values()].join('\n');

for (const m of allText.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?([a-z_0-9]+)\s*\(/gi)) {
  const name = m[1];
  if (tables.has(name)) continue;
  let i = m.index + m[0].length;
  let depth = 1;
  while (i < allText.length && depth > 0) {
    if (allText[i] === '(') depth++;
    else if (allText[i] === ')') depth--;
    i++;
  }
  const body = allText.slice(m.index + m[0].length, i - 1);
  const columns = new Set();
  const refs = {};
  const unique = [];
  let buf = '', d = 0;
  const parts = [];
  for (const ch of body) {
    if (ch === '(') d++;
    if (ch === ')') d--;
    if (ch === ',' && d === 0) { parts.push(buf); buf = ''; continue; }
    buf += ch;
  }
  parts.push(buf);
  for (const raw of parts) {
    const line = raw.trim().replace(/\s+/g, ' ');
    if (!line) continue;
    const uq = line.match(/^UNIQUE\s*\(([^)]+)\)/i);
    if (uq) { unique.push(uq[1].split(',').map((s) => s.trim().replace(/["'`]/g, ''))); continue; }
    // A table-level FOREIGN KEY clause carries the same scope information as an
    // inline REFERENCES, and skipping it reported tables as unscoped that are
    // not — guest_registrations reaches an organization through its reservation.
    const tfk = line.match(/^FOREIGN KEY\s*\(\s*([a-z_0-9]+)\s*\)\s*REFERENCES\s+([a-z_0-9]+)/i);
    if (tfk) { columns.add(tfk[1]); refs[tfk[1]] = tfk[2]; continue; }
    if (/^(PRIMARY KEY|FOREIGN KEY|CHECK|CONSTRAINT)\b/i.test(line)) continue;
    const cm = line.match(/^["'`]?([a-z_0-9]+)["'`]?\s+[A-Z]+/i);
    if (!cm) continue;
    const col = cm[1];
    columns.add(col);
    const fk = line.match(/REFERENCES\s+([a-z_0-9]+)/i);
    if (fk) refs[col] = fk[1];
    if (/\bUNIQUE\b/i.test(line)) unique.push([col]);
  }
  tables.set(name, { columns, refs, unique });
}

// ALTER TABLE … ADD COLUMN
for (const m of allText.matchAll(/ALTER TABLE ([a-z_0-9]+) ADD COLUMN ([a-z_0-9]+)[^;'"`]*/gi)) {
  const t = tables.get(m[1]);
  if (!t) continue;
  t.columns.add(m[2]);
  const fk = m[0].match(/REFERENCES\s+([a-z_0-9]+)/i);
  if (fk) t.refs[m[2]] = fk[1];
}

// Reference data that is the same for every tenant, so being unscoped is right.
const GLOBAL_TABLES = new Set([
  'organizations', 'sessions', 'rate_limits', 'settings', 'sqlite_sequence',
  'content_translations', 'email_processed', 'fin_system_state',
  'hostex_sync_log', 'hostex_property_map',
]);

const ORG_COLS = ['organization_id', 'org_id', 'tenant_id'];

/** How does this table reach an organization? */
function scopeOf(name, seen = new Set()) {
  const t = tables.get(name);
  if (!t) return { kind: 'unknown', path: [] };
  if (ORG_COLS.some((c) => t.columns.has(c))) return { kind: 'direct', path: [] };
  if (seen.has(name)) return { kind: 'unscoped', path: [] };
  seen.add(name);
  for (const [col, target] of Object.entries(t.refs)) {
    if (target === name) continue;
    const up = scopeOf(target, seen);
    if (up.kind === 'direct' || up.kind === 'derived') {
      return { kind: 'derived', path: [`${col}->${target}`, ...up.path] };
    }
  }
  return { kind: 'unscoped', path: [] };
}

const scope = new Map();
for (const name of tables.keys()) {
  scope.set(name, GLOBAL_TABLES.has(name) ? { kind: 'global', path: [] } : scopeOf(name));
}

// ── 2. statement scan ────────────────────────────────────────────────────────
// Every SQL string in the source, matched to the tables it touches.
const findings = [];

/**
 * SQL is read out of individual string literals rather than by scanning the
 * file. Matching across literal boundaries let one statement's WHERE clause be
 * attributed to the next statement — and vice versa, which is worse: it marked
 * correctly-scoped writes as critical purely because a later query in the same
 * file contained SUM().
 */
function sqlLiterals(body) {
  const out = [];
  const re = /`((?:[^`\\]|\\.)*)`|'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g;
  let m;
  while ((m = re.exec(body))) {
    const text = m[1] ?? m[2] ?? m[3] ?? '';
    if (!/\b(SELECT|INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE|DELETE\s+FROM)\b/i.test(text)) continue;
    out.push({ text, index: m.index });
  }
  return out;
}

function tablesIn(sql) {
  const out = new Set();
  for (const m of sql.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+["'`]?([a-z_0-9]+)["'`]?/gi)) {
    if (tables.has(m[1])) out.add(m[1]);
  }
  return [...out];
}

/** Does the statement constrain the organization, directly or by joining up? */
function isConstrained(sql) {
  if (/\b(organization_id|org_id|tenant_id)\b/i.test(sql)) return true;
  // A join to a scoped parent plus a WHERE on that parent's id also isolates.
  if (/\bJOIN\s+properties\b/i.test(sql) && /\bproperty_id\s*=\s*\?/i.test(sql)) return true;
  if (/\bWHERE[\s\S]*\b(property_id|reservation_id|unit_id|guest_id|site_id|lead_id|conversation_id)\s*=\s*\?/i.test(sql)) return true;
  return false;
}

for (const [f, body] of src) {
  if (f === DB_FILE) continue; // schema bootstrap, not tenant traffic
  for (const lit of sqlLiterals(body)) {
    const sql = lit.text.replace(/\s+/g, ' ').trim();
    if (sql.length < 20) continue;
    if (/^\s*(CREATE|ALTER|DROP|PRAGMA)\b/i.test(sql)) continue;
    const touched = tablesIn(sql).filter((t) => {
      const s = scope.get(t);
      return s && (s.kind === 'direct' || s.kind === 'derived');
    });
    if (!touched.length) continue;
    if (isConstrained(sql)) continue;
    const line = body.slice(0, lit.index).split('\n').length;
    const op = /^SELECT/i.test(sql) ? 'read' : /^INSERT/i.test(sql) ? 'write' : /^UPDATE/i.test(sql) ? 'update' : 'delete';
    const hasWhere = /\bWHERE\b/i.test(sql);
    const aggregates = /\b(SUM|COUNT|AVG|MIN|MAX|TOTAL)\s*\(/i.test(sql);

    // Severity is about what actually happens when the second tenant arrives.
    //   critical — an aggregate with no organization constraint silently adds
    //              one company's money to another's report
    //   high     — a read or, worse, a write/delete with no WHERE at all
    //   medium   — constrained only by a row id, which isolates *if* ownership
    //              was verified first; that has to be checked by hand
    let severity;
    if (aggregates) severity = 'critical';
    else if (!hasWhere) severity = op === 'read' ? 'high' : 'critical';
    else if (/\bWHERE[\s\S]*\b(month|year|date|status|is_active|type|code)\s*=/i.test(sql)) severity = 'high';
    else severity = 'medium';

    findings.push({ file: rel(f), line, tables: touched, op, severity, sql: sql.slice(0, 130) });
  }
}

// ── 3. unique constraints missing the organization ───────────────────────────
// A composite UNIQUE is safe when one of its columns already leads to a
// tenant — UNIQUE(property_id, code) cannot collide across organizations,
// because property_id cannot. Only constraints where no column narrows to a
// tenant are global, and those are the ones the second customer trips over.
const uniqueRisks = [];
for (const [name, t] of tables) {
  const s = scope.get(name);
  if (!s || s.kind === 'global') continue;
  for (const cols of t.unique) {
    if (cols.length === 1 && /^id$/i.test(cols[0])) continue;
    const narrowsToTenant = cols.some((c) => {
      if (ORG_COLS.includes(c)) return true;
      const target = t.refs[c];
      if (!target) return false;
      const ts = scope.get(target);
      return ts && (ts.kind === 'direct' || ts.kind === 'derived');
    });
    if (narrowsToTenant) continue;
    // Random tokens collide only by accident; flag them separately from
    // human-chosen values like an invoice number or a coupon code.
    const random = cols.length === 1 && /token|uuid|session/i.test(cols[0]);
    uniqueRisks.push({ table: name, cols, scope: s.kind, kind: random ? 'token' : 'chosen' });
  }
}

const byScope = { direct: [], derived: [], global: [], unscoped: [], unknown: [] };
for (const [n, s] of scope) byScope[s.kind].push(n);

const report = { byScope, findings, uniqueRisks };
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const h = (s) => console.log(`\n${'═'.repeat(78)}\n${s}\n${'═'.repeat(78)}`);

h('1. ЯК ТАБЛИЦІ ПРИВʼЯЗАНІ ДО ОРГАНІЗАЦІЇ');
console.log(`  напряму (organization_id):  ${byScope.direct.length}`);
console.log(`  через звʼязок:              ${byScope.derived.length}`);
console.log(`  глобальні (так і треба):    ${byScope.global.length}`);
console.log(`  БЕЗ ПРИВʼЯЗКИ:              ${byScope.unscoped.length}`);
if (byScope.unscoped.length) {
  console.log('\n  Спільні для всіх клієнтів:');
  for (const t of byScope.unscoped.sort()) console.log(`    ${t}`);
}

const bySev = { critical: [], high: [], medium: [] };
for (const f of findings) bySev[f.severity].push(f);

h(`2. ЗАПИТИ БЕЗ ОБМЕЖЕННЯ ЗА ОРГАНІЗАЦІЄЮ (${findings.length})`);
console.log(`  критичні: ${bySev.critical.length}   високі: ${bySev.high.length}   середні: ${bySev.medium.length}`);
console.log('\n  критичні = підсумки або запис/видалення без обмеження: числа й рядки різних');
console.log('  компаній змішуються. середні = обмежені лише id рядка, ізолюють ЯКЩО');
console.log('  власника перевірено раніше — це треба дивитися руками.');

for (const sev of ['critical', 'high']) {
  const list = bySev[sev];
  if (!list.length) continue;
  console.log(`\n  ── ${sev.toUpperCase()} (${list.length}) ──`);
  const grouped = {};
  for (const f of list) (grouped[f.file] ||= []).push(f);
  for (const [file, fs_] of Object.entries(grouped).sort((a, b) => b[1].length - a[1].length).slice(0, 14)) {
    console.log(`\n  ${file}  (${fs_.length})`);
    for (const f of fs_.slice(0, 2)) {
      console.log(`    ${String(f.line).padStart(5)} ${f.op.padEnd(6)} ${f.tables.join(',')}`);
      console.log(`          ${f.sql}`);
    }
  }
}

const chosen = uniqueRisks.filter((u) => u.kind === 'chosen');
const tokens = uniqueRisks.filter((u) => u.kind === 'token');
h(`3. UNIQUE БЕЗ ОРГАНІЗАЦІЇ (${uniqueRisks.length})`);
console.log(`  Значення, які обирає людина — зіткнення гарантоване (${chosen.length}):`);
for (const u of chosen) console.log(`    ${u.table.padEnd(28)} UNIQUE(${u.cols.join(', ')})`);
console.log(`\n  Випадкові токени — зіткнення малоймовірне, але скоуп все одно потрібен (${tokens.length}):`);
for (const u of tokens) console.log(`    ${u.table.padEnd(28)} UNIQUE(${u.cols.join(', ')})`);
