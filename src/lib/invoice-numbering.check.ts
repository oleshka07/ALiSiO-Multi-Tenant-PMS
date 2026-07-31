/**
 * Invoice numbers are per organization.
 *
 *   node src/lib/invoice-numbering.check.ts
 *
 * The claim being checked is the one that decides whether two hotels can share
 * a server at all: each of them issues 2026-001 as its first invoice of the
 * year, neither can advance the other's counter, and the two numbers coexist.
 */
import assert from 'node:assert';
import Database from 'better-sqlite3';
import { allocateInvoiceNumber, lockPeriod, isPeriodLocked } from './invoice-numbering.ts';

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE invoice_counters (
    organization_id TEXT NOT NULL, series TEXT NOT NULL, year INTEGER NOT NULL,
    last_no INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (organization_id, series, year)
  );
  CREATE TABLE invoice_periods (
    organization_id TEXT NOT NULL, series TEXT NOT NULL, month TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open', locked_at TEXT,
    PRIMARY KEY (organization_id, series, month)
  );
  CREATE TABLE invoices (
    id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, invoice_number TEXT NOT NULL,
    series TEXT, period TEXT, issued_at TEXT, locked INTEGER NOT NULL DEFAULT 0,
    UNIQUE (organization_id, invoice_number)
  );
`);

const A = 'org_a';
const B = 'org_b';
const YEAR = 2026;

// Each organization starts its own sequence at 1.
const a1 = allocateInvoiceNumber(db, A, 'house', YEAR);
const b1 = allocateInvoiceNumber(db, B, 'house', YEAR);
assert.strictEqual(a1.invoiceNumber, '2026-001', `A got ${a1.invoiceNumber}`);
assert.strictEqual(b1.invoiceNumber, '2026-001', `B got ${b1.invoiceNumber} — it read A's counter`);
console.log('  ok  both organizations issue 2026-001');

// The identical numbers coexist: the UNIQUE is (organization_id, number).
const ins = db.prepare('INSERT INTO invoices (id, organization_id, invoice_number) VALUES (?, ?, ?)');
ins.run('a1', A, a1.invoiceNumber);
ins.run('b1', B, b1.invoiceNumber);
assert.throws(() => ins.run('a1dup', A, a1.invoiceNumber), /UNIQUE/, 'a number was reused inside one organization');
console.log('  ok  the same number in two organizations is accepted, twice in one is not');

// A's second invoice is 002 regardless of how many B has issued.
allocateInvoiceNumber(db, B, 'house', YEAR);
allocateInvoiceNumber(db, B, 'house', YEAR);
assert.strictEqual(allocateInvoiceNumber(db, A, 'house', YEAR).invoiceNumber, '2026-002');
console.log("  ok  B's invoices do not advance A's sequence");

// Series are still independent within an organization.
assert.strictEqual(allocateInvoiceNumber(db, A, 'booking', YEAR).invoiceNumber, 'BKG-2026-001');
console.log('  ok  each series keeps its own sequence');

// Locking a period is per organization too.
lockPeriod(db, A, 'HOUSE', '2026-01');
assert.strictEqual(isPeriodLocked(db, A, 'HOUSE', '2026-01'), true);
assert.strictEqual(isPeriodLocked(db, B, 'HOUSE', '2026-01'), false, "A's lock froze B's period");
console.log("  ok  A locking a period does not lock B's");

console.log('invoice-numbering: all checks passed');
