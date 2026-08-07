/**
 * Generate the Postgres schema from the live SQLite database.
 *
 *   node scripts/pg-schema.mjs            # writes db/postgres/schema.sql
 *   node scripts/pg-schema.mjs --print    # to stdout
 *
 * Generated rather than hand-written on purpose. A 4000-line schema.sql
 * maintained by hand is out of date the week after it is committed, and the
 * one thing that must not drift between SQLite and Postgres is which column
 * carries the organization — that is what row-level security keys on.
 *
 * What this fixes on the way across (Phase 1.4):
 *
 *   money      REAL -> NUMERIC(14,2). A double cannot represent 0.10 exactly;
 *              a commission of 2870.55 * 0.15 stores as 430.58250000000004,
 *              and a year of those does not add up to the cent. NUMERIC is
 *              exact decimal arithmetic, and needs no change in application
 *              code — unlike moving to integer minor units, which would touch
 *              every calculation and every screen.
 *   timestamps TEXT -> TIMESTAMPTZ. ISO strings sort correctly and so hid the
 *              problem, but no arithmetic and no time zone is possible on them.
 *   dates      TEXT -> DATE where the value is a calendar day (check-in, not
 *              an instant).
 *   flags      INTEGER 0/1 -> BOOLEAN.
 *   documents  TEXT holding JSON -> JSONB.
 *
 * What it does NOT do: invent a different shape. Table and column names, keys,
 * checks and indexes come from the live database as they are.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const ROOT = process.cwd();
const DB_PATH = path.join(ROOT, process.env.DB_PATH || 'data/alisio.db');
const OUT = path.join(ROOT, 'db', 'postgres', 'schema.sql');

const db = new Database(DB_PATH, { readonly: false });

// ── Type mapping ─────────────────────────────────────────────────────────────

/** Columns whose name alone does not say what they are. Table.column wins. */
const OVERRIDE = {
  // Periods and labels that look like dates but are not.
  'fin_budgets.month': 'TEXT',                 // 'YYYY-MM'
  'invoice_periods.month': 'TEXT',             // 'YYYY-MM'
  'invoices.period': 'TEXT',                   // 'YYYY-MM'
  'investor_monthly_notes.month': 'TEXT',
  'capex_items.month': 'TEXT',
  'accruals.month': 'TEXT',
  'capex_items.useful_life_months': 'INTEGER',
  'gift_card_bundles.validity_months': 'INTEGER',
  // Counts and ratios that the money pattern would otherwise claim.
  'bank_statements.total_transactions': 'INTEGER',
  'import_runs.rows_total': 'INTEGER',
  'early_bookings.discount_percent': 'NUMERIC(5,2)',
  'reservations.commission_percent': 'NUMERIC(5,2)',
  'booking_sources.commission_percent': 'NUMERIC(5,2)',
  // Exchange rates need more precision than money.
  'finance_exchange_rates.rate': 'NUMERIC(18,8)',
  // Free-text or enum columns caught by a money/date word.
  'reservations.deposit_status': 'TEXT',
  'reservation_guests.fee_exempt_reason': 'TEXT',
  'coupons.discount_type': 'TEXT',
  'gift_card_automation_rules.discount_type': 'TEXT',
  'gift_cards.value_type': 'TEXT',
  'fin_system_state.value': 'TEXT',
  'settings.value': 'TEXT',
  'import_entity_mappings.source_value': 'TEXT',
};

/** An amount of money. NUMERIC(14,2) — up to 999 999 999 999.99. */
const MONEY = /(^|_)(amount|price|total|balance|fee|cost|revenue|payout|deposit|commission|discount|subtotal|due|face_value|opening_balance|closing_balance)($|_)/;
const MONEY_SUFFIX = /_czk$|_eur$|_amount$|_price$|_total$|_fee$|_sum$/;

/** An instant. */
const TIMESTAMP = /_at$|^created$|^updated$|^timestamp$/;
/** A calendar day, with no time of day and no zone. */
const DATE_ONLY = /^check_in$|^check_out$|^date$|_date$|^valid_from$|^valid_until$|^expires_at$|^period_from$|^period_to$/;
/** A true/false flag stored as 0/1. */
const BOOL = /^is_|^has_|^can_|_enabled$|^locked$|^confirmed$|^active$|_active$|^read_only$|^needs_|^smoking$|^partial$|_hidden$|_exempt$|_reported$|_included_in_price$|^enabled$|^archived$/;
/** A JSON document kept in a text column. */
const JSONISH = /_json$|^old_values$|^new_values$|^parameters$|^config$|^payload$|^raw_payload$|^assumptions$|^metadata$|^allowed_tabs$|^connection_types$|^applicable_services$|^allowed_days$|^included_services$|^applied_listings$|^allowed_promo_codes$|^permissions$/;

function pgType(table, col, sqliteType, defaultValue) {
  const key = `${table}.${col}`;
  if (OVERRIDE[key]) return OVERRIDE[key];

  const inferred = inferType(table, col, sqliteType);

  // A quoted string default contradicts every type but TEXT and JSONB. This is
  // how `city_tax_paid TEXT DEFAULT 'pending'` came out as NUMERIC(14,2): the
  // name matched a money word, and only Postgres refusing the DDL said
  // otherwise. The default is data; the pattern is a guess.
  const d = defaultValue == null ? null : String(defaultValue).trim();
  const quoted = d != null && /^'([^']|'')*'$/.test(d);
  if (quoted && inferred !== 'TEXT' && inferred !== 'JSONB') {
    const inner = d.slice(1, -1);
    const looksNumeric = /^-?\d+(\.\d+)?$/.test(inner);
    const looksDate = /^\d{4}-\d{2}-\d{2}/.test(inner);
    if (!looksNumeric && !looksDate) {
      typeCorrections.push(`${table}.${col}: ${inferred} -> TEXT (default ${d})`);
      return 'TEXT';
    }
  }
  return inferred;
}

const typeCorrections = [];

function inferType(table, col, sqliteType) {

  const t = (sqliteType || '').toUpperCase();
  const n = col.toLowerCase();

  // A key is a key. `paid_expense_id` matched the money pattern on `paid` and
  // came out as NUMERIC(14,2), which would have failed against the foreign key
  // it points at.
  if (/_id$|^id$/.test(n)) return t === 'INTEGER' ? 'BIGINT' : 'TEXT';

  if (JSONISH.test(n)) return 'JSONB';
  if (DATE_ONLY.test(n) && n !== 'expires_at') return 'DATE';
  if (TIMESTAMP.test(n) || n === 'expires_at') return 'TIMESTAMPTZ';
  if (BOOL.test(n) && (t === 'INTEGER' || t === '' || t === 'BOOLEAN')) return 'BOOLEAN';
  if (MONEY.test(n) || MONEY_SUFFIX.test(n)) return 'NUMERIC(14,2)';

  switch (t) {
    case 'INTEGER': return 'BIGINT';
    case 'REAL':    return 'DOUBLE PRECISION';
    case 'NUMERIC': return 'NUMERIC(14,2)';
    case 'BLOB':    return 'BYTEA';
    case 'DATETIME':return 'TIMESTAMPTZ';
    case 'BOOLEAN': return 'BOOLEAN';
    default:        return 'TEXT';
  }
}

/** SQLite default expression -> Postgres, or null when it cannot carry over. */
function pgDefault(raw, type) {
  if (raw == null) return null;
  const v = String(raw).trim();

  if (/^datetime\(\s*'now'\s*\)$/i.test(v)) return 'now()';
  if (/^date\(\s*'now'\s*\)$/i.test(v)) return 'CURRENT_DATE';
  if (/^CURRENT_TIMESTAMP$/i.test(v)) return 'now()';
  const rb = v.match(/^lower\(hex\(randomblob\((\d+)\)\)\)$/i);
  if (rb) return `encode(gen_random_bytes(${rb[1]}), 'hex')`;
  if (/^strftime\(\s*'%Y-%m-%dT%H:%M:%SZ'\s*,\s*'now'\s*\)$/i.test(v)) return 'now()';
  if (/^NULL$/i.test(v)) return null; // no default is the same thing, and clearer

  if (type === 'BOOLEAN') {
    if (v === '0') return 'false';
    if (v === '1') return 'true';
  }
  if (type === 'JSONB' && /^'.*'$/.test(v)) return `${v}::jsonb`;
  // Numeric and quoted-string literals carry over as they are.
  if (/^-?\d+(\.\d+)?$/.test(v) || /^'([^']|'')*'$/.test(v)) return v;
  return null; // an expression we have not taught it — dropped, and reported
}

// ── Read the live schema ─────────────────────────────────────────────────────

const tables = db
  .prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
  .all();

const indexes = db
  .prepare(`SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL ORDER BY tbl_name, name`)
  .all();

const info = new Map();   // table -> columns
const fks = new Map();    // table -> foreign keys
for (const t of tables) {
  info.set(t.name, db.prepare(`PRAGMA table_info("${t.name}")`).all());
  fks.set(t.name, db.prepare(`PRAGMA foreign_key_list("${t.name}")`).all());
}

/** CHECK constraints are not exposed by any pragma, so they come from the DDL. */
function checksOf(sql) {
  const out = [];
  const re = /CHECK\s*\(/gi;
  let m;
  while ((m = re.exec(sql))) {
    let i = m.index + m[0].length, depth = 1;
    while (i < sql.length && depth > 0) {
      if (sql[i] === '(') depth++;
      else if (sql[i] === ')') depth--;
      i++;
    }
    out.push(sql.slice(m.index + m[0].length, i - 1).replace(/\s+/g, ' ').trim());
  }
  return out;
}

/** UNIQUE(...) constraints, from the auto-indexes SQLite creates for them. */
function uniquesOf(table) {
  const out = [];
  for (const ix of db.prepare(`PRAGMA index_list("${table}")`).all()) {
    if (!ix.unique) continue;
    if (ix.origin === 'pk') continue; // the primary key is emitted separately
    const cols = db.prepare(`PRAGMA index_info("${ix.name}")`).all().map((c) => c.name);
    if (cols.some((c) => c == null)) continue; // expression index — skipped, reported
    out.push(cols);
  }
  return out;
}

// ── Tenancy: how each table reaches an organization ──────────────────────────

const ORG_COL = 'organization_id';
// Identity. These are read BEFORE the tenant is known — login looks a user up
// by email, and every authenticated request joins app_users through a session
// id — so a tenant policy cannot restrict them, it can only break them:
// current_setting('app.organization_id') RAISES on a connection that has not
// set it, and no caller can set it before it knows which organization the
// person belongs to. Scoped by the application instead: every query that lists
// or edits users carries WHERE organization_id = ?, and check-isolation.mjs
// proves it against a live database.
const IDENTITY = new Set(['organizations', 'sessions']);

// Reference data, the same rows for every customer.
// Readable before the tenant is known. Login looks a user up by email and
// every authenticated request joins app_users through a session id — neither
// caller can name an organization, because finding the row is HOW the
// organization is discovered. postgres.ts sets app.organization_id to '' when
// there is no context, so the strict predicate matched nothing and every login
// returned 401: not a refusal, a table the application could not read.
//
// Only the read side opens, and only while no tenant is set. WITH CHECK stays
// strict, so no row can ever be written into another organization, and a
// request that HAS a tenant still sees only its own users.
const READ_BEFORE_TENANT = new Set(['app_users']);

const REFERENCE = new Set([
  'rate_limits', 'settings', 'content_translations',
  'email_processed', 'fin_system_state', 'hostex_sync_log', 'hostex_property_map',
]);

const GLOBAL = new Set([...IDENTITY, ...REFERENCE]);

const columnsOf = (t) => new Set((info.get(t) || []).map((c) => c.name));

/**
 * Returns how to constrain this table to the current organization:
 *   {kind:'direct'}                      -> organization_id = current
 *   {kind:'derived', col, parent}        -> col IN (SELECT id FROM parent WHERE ...)
 *   {kind:'global'} | {kind:'none'}
 */
function scopeOf(table, seen = new Set()) {
  if (GLOBAL.has(table)) return { kind: 'global' };
  if (columnsOf(table).has(ORG_COL)) return { kind: 'direct' };
  if (seen.has(table)) return { kind: 'none' };
  seen.add(table);

  // Which foreign key to hang the policy on, when there is more than one.
  //
  // Taking the first that reaches an organization is what this did, and it
  // chose building_id for unit_types — a column a unit type does not need.
  // A policy keyed on a NULLable column is not a policy: `NULL IN (SELECT …)`
  // is NULL, never true, so a row without a building could not be inserted
  // (WITH CHECK) and, had one existed, could not be read (USING). Every unit
  // type created on Postgres was rejected. The same table has property_id,
  // NOT NULL, one hop from the organization.
  //
  // So: a mandatory key beats an optional one, and among equals the shorter
  // path wins — fewer subqueries per row, and one less table whose own policy
  // has to be right for this one to hold.
  const notnull = new Map((info.get(table) || []).map((c) => [c.name, !!c.notnull]));
  const ranked = (fks.get(table) || [])
    .filter((fk) => fk.table !== table)
    // A copy per candidate: `seen` guards one PATH against cycles, and sharing
    // it let the first foreign key evaluated mark a parent visited, so a better
    // key pointing at the same parent was thrown away as a cycle. That is how
    // reservation_guests ended up scoped through the optional guest_id while
    // reservation_id, NOT NULL, sat right there.
    .map((fk) => ({ fk, up: scopeOf(fk.table, new Set(seen)) }))
    .filter((c) => c.up.kind === 'direct' || c.up.kind === 'derived')
    .map((c) => ({ ...c, rank: (notnull.get(c.fk.from) ? 0 : 2) + (c.up.kind === 'direct' ? 0 : 1) }))
    .sort((a, b) => a.rank - b.rank);

  if (ranked.length) {
    const best = ranked[0];
    if (!notnull.get(best.fk.from)) {
      notes.push(`${table}: scoped through ${best.fk.from}, which is NULLable — a row with NULL there is invisible to every tenant`);
    }
    return { kind: 'derived', col: best.fk.from, parent: best.fk.table };
  }
  return { kind: 'none' };
}

/** The RLS predicate for one table, or null when it needs none. */
function rlsPredicate(table) {
  const s = scopeOf(table);
  if (s.kind === 'direct') {
    return `${q(ORG_COL)} = current_setting('app.organization_id')`;
  }
  if (s.kind === 'derived') {
    const parentPred = rlsPredicate(s.parent);
    if (!parentPred) return null;
    return `${q(s.col)} IN (SELECT ${q('id')} FROM ${q(s.parent)} WHERE ${parentPred})`;
  }
  return null;
}

const q = (name) => `"${name}"`;

// ── Emit ─────────────────────────────────────────────────────────────────────

const notes = [];
const out = [];
const w = (s = '') => out.push(s);

w('--');
w('-- ALiSiO PMS — Postgres schema');
w('--');
w('-- GENERATED by scripts/pg-schema.mjs from the live SQLite database.');
w('-- Do not edit by hand: re-run the generator instead, and put judgement');
w('-- calls in its OVERRIDE map so they survive the next run.');
w('--');
w('-- Row-level security is at the bottom. Every connection must set the');
w('-- tenant before it reads anything:');
w('--');
w("--     SET LOCAL app.organization_id = '<org id>';");
w('--');
w('-- Without it the query returns no rows: on a fresh connection');
w('-- current_setting() raises undefined_object, and once the parameter has');
w('-- been set anywhere in the session it reads back empty, which matches');
w('-- nothing. Either way a forgotten scope is an error or an empty result,');
w('-- never a full-table read. That is the whole point.');
w('--');
w('-- The application must connect as a role that is NOT the table owner.');
w('-- FORCE ROW LEVEL SECURITY below covers the owner too, but relying on it');
w('-- alone means one table missing FORCE is a silent full-table read.');
w('--');
w();
w('CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_bytes for id defaults');
w();

for (const t of tables) {
  const cols = info.get(t.name);
  if (!cols.length) continue;

  const pk = cols.filter((c) => c.pk).sort((a, b) => a.pk - b.pk).map((c) => c.name);
  const lines = [];

  for (const c of cols) {
    const type = pgType(t.name, c.name, c.type, c.dflt_value);
    const def = pgDefault(c.dflt_value, type);
    if (c.dflt_value != null && def === null && !/^NULL$/i.test(String(c.dflt_value).trim())) {
      notes.push(`${t.name}.${c.name}: default ${JSON.stringify(c.dflt_value)} not carried over`);
    }
    // A single-column INTEGER PRIMARY KEY is SQLite's rowid alias: implicitly
    // NOT NULL, and filled in by SQLite when the INSERT omits it. Postgres will
    // not fill it in unless told to, so without IDENTITY the first insert that
    // relies on that fails the NOT NULL — which is exactly what took the Hostex
    // sync down on the first run against Postgres. BY DEFAULT rather than
    // ALWAYS, so the import can still write the ids it is copying.
    const rowidAlias = pk.length === 1 && pk[0] === c.name
      && String(c.type).toUpperCase() === 'INTEGER' && def === null;

    let line = `  ${q(c.name)} ${type}`;
    if (def !== null) line += ` DEFAULT ${def}`;
    if (rowidAlias) line += ' GENERATED BY DEFAULT AS IDENTITY';
    if (c.notnull || (pk.length === 1 && pk[0] === c.name)) line += ' NOT NULL';
    lines.push(line);
  }

  if (pk.length) lines.push(`  PRIMARY KEY (${pk.map(q).join(', ')})`);
  for (const u of uniquesOf(t.name)) lines.push(`  UNIQUE (${u.map(q).join(', ')})`);


  for (const chk of checksOf(t.sql || '')) {
    // datetime('now') and friends inside a CHECK would not parse; those are
    // rare and reported rather than translated blindly.
    if (/datetime\(|date\(|strftime\(/i.test(chk)) {
      notes.push(`${t.name}: CHECK (${chk}) uses a SQLite date function — review by hand`);
      continue;
    }
    lines.push(`  CHECK (${chk})`);
  }

  w(`CREATE TABLE ${q(t.name)} (`);
  w(lines.join(',\n'));
  w(');');
  w();
}

// ── Foreign keys ─────────────────────────────────────────────────────────────
// Added after every table exists: the tables are emitted alphabetically, which
// does not respect dependencies, and the schema has cycles that no ordering
// would resolve anyway.

w('-- ── Foreign keys ────────────────────────────────────────────────────────');
w();
const known = new Set(tables.map((t) => t.name));
for (const t of tables) {
  let n = 0;
  for (const fk of fks.get(t.name) || []) {
    if (!known.has(fk.table)) {
      notes.push(`${t.name}.${fk.from}: references ${fk.table}, which does not exist — dropped`);
      continue;
    }
    const onDelete = fk.on_delete && fk.on_delete !== 'NO ACTION' ? ` ON DELETE ${fk.on_delete}` : '';
    const onUpdate = fk.on_update && fk.on_update !== 'NO ACTION' ? ` ON UPDATE ${fk.on_update}` : '';
    w(`ALTER TABLE ${q(t.name)} ADD CONSTRAINT ${q(`fk_${t.name}_${fk.from}_${++n}`)}`);
    w(`  FOREIGN KEY (${q(fk.from)}) REFERENCES ${q(fk.table)} (${q(fk.to || 'id')})${onDelete}${onUpdate};`);
  }
}
w();

// ── Indexes ──────────────────────────────────────────────────────────────────

w('-- ── Indexes ─────────────────────────────────────────────────────────────');
w();
for (const ix of indexes) {
  if (ix.name.startsWith('sqlite_')) continue;
  const cols = db.prepare(`PRAGMA index_info("${ix.name}")`).all();
  if (cols.some((c) => c.name == null)) {
    // An expression index. Postgres understands the same expression, so the
    // column list is taken from the original DDL rather than the pragma.
    const inner = (ix.sql.match(/\(([^;]*)\)\s*(WHERE[\s\S]*)?$/i) || [])[1];
    if (!inner) { notes.push(`index ${ix.name}: expression index — not generated`); continue; }
    const uniqE = /CREATE\s+UNIQUE\s+INDEX/i.test(ix.sql) ? 'UNIQUE ' : '';
    w(`CREATE ${uniqE}INDEX ${q(ix.name)} ON ${q(ix.tbl_name)} (${inner.trim()});`);
    continue;
  }
  const uniq = /CREATE\s+UNIQUE\s+INDEX/i.test(ix.sql) ? 'UNIQUE ' : '';
  const where = (ix.sql.match(/\bWHERE\b(.+)$/is) || [])[1];
  const partial = where && !/datetime\(|date\(|strftime\(/i.test(where) ? ` WHERE${where.replace(/\s+/g, ' ').replace(/;$/, '')}` : '';
  if (where && !partial) notes.push(`index ${ix.name}: partial WHERE uses a date function — dropped`);
  w(`CREATE ${uniq}INDEX ${q(ix.name)} ON ${q(ix.tbl_name)} (${cols.map((c) => q(c.name)).join(', ')})${partial};`);
}
w();

// Every RLS predicate is a lookup on organization_id or on a parent's id, so
// those columns are indexed whether or not SQLite had an index there.
w('-- Indexes the row-level security predicates depend on.');
for (const t of tables) {
  if (!columnsOf(t.name).has(ORG_COL)) continue;
  w(`CREATE INDEX IF NOT EXISTS ${q(`idx_${t.name}_org`)} ON ${q(t.name)} (${q(ORG_COL)});`);
}
w();

// ── Row-level security ───────────────────────────────────────────────────────

w('-- ── Row-level security ──────────────────────────────────────────────────');
w('--');
w('-- The application connects as a role that is NOT the table owner and NOT');
w('-- superuser, so these policies actually apply. FORCE makes them apply to');
w('-- the owner too, which is what catches a migration script reading across');
w('-- tenants by accident.');
w();

const rlsCovered = [];
const rlsIdentity = [];
const rlsReference = [];
const rlsNone = [];

for (const t of tables) {
  const s = scopeOf(t.name);
  if (s.kind === 'global') { (IDENTITY.has(t.name) ? rlsIdentity : rlsReference).push(t.name); continue; }
  const pred = rlsPredicate(t.name);
  if (!pred) { rlsNone.push(t.name); continue; }
  rlsCovered.push(t.name);
  const readPred = READ_BEFORE_TENANT.has(t.name)
    ? `${pred} OR current_setting('app.organization_id') = ''`
    : pred;
  w(`ALTER TABLE ${q(t.name)} ENABLE ROW LEVEL SECURITY;`);
  w(`ALTER TABLE ${q(t.name)} FORCE ROW LEVEL SECURITY;`);
  w(`CREATE POLICY ${q(`${t.name}_tenant`)} ON ${q(t.name)}`);
  w(`  USING (${readPred})`);
  w(`  WITH CHECK (${pred});`);
  w();
}

w('-- Identity: read before the tenant is known, so a policy here would not');
w('-- restrict these queries, it would break them. Scoped by the application.');
for (const t of rlsIdentity) w(`--   ${t}`);
w();
w('-- Reference data, identical for every customer: no policy by design.');
for (const t of rlsReference) w(`--   ${t}`);
w();
if (rlsNone.length) {
  w('-- !! No path to an organization — these would be shared between customers.');
  for (const t of rlsNone) w(`--   ${t}`);
  w();
}

const sql = out.join('\n');

if (process.argv.includes('--print')) {
  process.stdout.write(sql);
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, sql, 'utf8');
  console.log(`wrote ${path.relative(ROOT, OUT)}`);
}

console.log(`tables ${tables.length}  rls ${rlsCovered.length}  identity ${rlsIdentity.length}  reference ${rlsReference.length}  unscoped ${rlsNone.length}`);
if (rlsNone.length) console.error('UNSCOPED TABLES:', rlsNone.join(', '));
if (typeCorrections.length) {
  console.error(`
${typeCorrections.length} type(s) corrected from the column default:`);
  for (const c of typeCorrections) console.error('  -', c);
}
// Deduplicated: scopeOf runs once per table that references this one, so a
// single finding was printed eight times and the list read like a disaster.
const uniqueNotes = [...new Set(notes)];
if (uniqueNotes.length) {
  console.error(`\n${uniqueNotes.length} thing(s) needing a human:`);
  for (const n of uniqueNotes) console.error('  -', n);
}
db.close();
