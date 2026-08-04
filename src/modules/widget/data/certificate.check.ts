/**
 * Gift certificate redemption.
 *
 *   node src/modules/widget/data/certificate.check.ts
 *
 * Money path, so the invariants are spelled out and runnable:
 *   - a certificate belongs to its organization — another hotel's code is
 *     "not found", not "someone else's certificate";
 *   - only fixed-value types in the booking's currency redeem online;
 *   - the amount never exceeds the total being paid;
 *   - a claim happens ONCE — the second concurrent claim changes nothing.
 */
import assert from 'node:assert';
import Database from 'better-sqlite3';
import { quoteCertificate, claimCertificate } from './certificate.repo.ts';
import { sqliteSql } from '../../../core/db/async.ts';

const db = new Database(':memory:');
const sql = sqliteSql(db);
db.exec(`
  CREATE TABLE gift_cards (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    code TEXT NOT NULL,
    value_type TEXT NOT NULL,
    face_value REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'CZK',
    status TEXT NOT NULL,
    expires_at TEXT,
    reservation_id TEXT,
    activated_at TEXT,
    notes TEXT,
    updated_at TEXT
  );
`);

const put = db.prepare(`
  INSERT INTO gift_cards (id, organization_id, code, value_type, face_value, currency, status, expires_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
put.run('c1', 'org_a', 'GIFT-1000', 'fixed_czk', 1000, 'CZK', 'active', null);
put.run('c2', 'org_a', 'GIFT-OLD', 'fixed_czk', 500, 'CZK', 'active', '2020-01-01');
put.run('c3', 'org_a', 'GIFT-PCT', 'percent', 10, 'CZK', 'active', null);
put.run('c4', 'org_a', 'GIFT-EUR', 'fixed_eur', 100, 'EUR', 'paid', null);
put.run('c5', 'org_a', 'GIFT-USED', 'fixed_czk', 1000, 'CZK', 'activated', null);

// Belongs to its organization.
assert.strictEqual((await quoteCertificate(sql, 'org_b', 'GIFT-1000', 5000, 'CZK')).valid, false,
  "another organization's code must read as not found");

// Case-insensitive, capped at the total.
const q = await quoteCertificate(sql, 'org_a', '  gift-1000 ', 700, 'CZK');
assert.ok(q.valid && q.quote.amount === 700, 'amount must cap at the total being paid');
const q2 = await quoteCertificate(sql, 'org_a', 'GIFT-1000', 5000, 'CZK');
assert.ok(q2.valid && q2.quote.amount === 1000, 'amount must cap at the face value');

// The polite refusals.
assert.strictEqual((await quoteCertificate(sql, 'org_a', 'GIFT-OLD', 5000, 'CZK')).valid, false, 'expired');
assert.strictEqual((await quoteCertificate(sql, 'org_a', 'GIFT-PCT', 5000, 'CZK')).valid, false, 'percent → front desk');
assert.strictEqual((await quoteCertificate(sql, 'org_a', 'GIFT-EUR', 5000, 'CZK')).valid, false, 'currency mismatch');
assert.strictEqual((await quoteCertificate(sql, 'org_a', 'GIFT-USED', 5000, 'CZK')).valid, false, 'already used');

// paid counts as redeemable, in its own currency.
assert.strictEqual((await quoteCertificate(sql, 'org_a', 'GIFT-EUR', 500, 'EUR')).valid, true);

// The claim happens once.
assert.strictEqual(await claimCertificate(sql, 'c1', 'r_1'), true, 'first claim must succeed');
assert.strictEqual(await claimCertificate(sql, 'c1', 'r_2'), false, 'second claim must fail');
const row = db.prepare('SELECT status, reservation_id FROM gift_cards WHERE id = ?').get('c1') as any;
assert.strictEqual(row.status, 'activated');
assert.strictEqual(row.reservation_id, 'r_1', 'the certificate stays with the first booking');

console.log('certificate: scoping, capping, refusals and single-use all hold');
