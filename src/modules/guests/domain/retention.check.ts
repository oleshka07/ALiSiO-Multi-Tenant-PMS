/**
 * The retention window refuses what would delete everything.
 *
 *   node src/modules/guests/domain/retention.check.ts
 *
 * See retention.ts for why this is worth a file of its own. In short: while the
 * cutoff was computed in SQL, a negative window was harmless by accident, and
 * moving the arithmetic into JavaScript turned the same input into "anonymise
 * every guest in the database". This proves it now refuses.
 */
import assert from 'node:assert';
import { retentionCutoff } from './retention.ts';

const NOW = new Date('2026-08-31T12:00:00Z');

// ── Windows that must be refused ────────────────────────────────────────────
const REFUSED: [number, string][] = [
  [-6, 'negative — the cutoff would land in the FUTURE and match every reservation'],
  [-1, 'negative'],
  [0, '"keep nothing" is never what an operator means to type'],
  [0.5, 'fractional — a typo, not a policy'],
  [NaN, 'parseInt of a non-number gives NaN'],
  [Infinity, 'not a real window'],
  [601, 'fifty years of retention is a typo'],
];

for (const [months, why] of REFUSED) {
  assert.throws(
    () => retentionCutoff(months, NOW),
    /Retention window must be/,
    `a window of ${String(months)} was accepted — ${why}`,
  );
}
console.log('  ok  negative, zero, fractional and absurd windows are refused');

// The one that mattered, stated as its consequence rather than its message.
for (const months of [-1, -6, -120]) {
  let cutoff: string | null = null;
  try { cutoff = retentionCutoff(months, NOW); } catch { /* expected */ }
  assert.strictEqual(cutoff, null,
    `a window of ${months} produced the cutoff ${cutoff}, which is after today — every guest record would be anonymised`);
}
console.log('  ok  no window can produce a cutoff in the future');

// ── Windows that must work, and land exactly where SQLite put them ──────────
// 31 Aug 2026 − 6 months overflows to 3 Mar: February has 28 days in 2026, so
// "the 31st of February" rolls forward. SQLite's '-6 months' does the same.
assert.strictEqual(retentionCutoff(6, NOW), '2026-03-03');
assert.strictEqual(retentionCutoff(1, new Date('2026-08-15T00:00:00Z')), '2026-07-15');
assert.strictEqual(retentionCutoff(12, new Date('2026-08-15T00:00:00Z')), '2025-08-15');
assert.strictEqual(retentionCutoff(600, new Date('2026-08-15T00:00:00Z')), '1976-08-15');

// Time of day never moves the date, and the result is UTC rather than local.
assert.strictEqual(
  retentionCutoff(6, new Date('2026-08-15T23:59:59Z')),
  retentionCutoff(6, new Date('2026-08-15T00:00:00Z')),
  'the hour changed the cutoff date',
);
console.log('  ok  a valid window lands where the SQL version put it');

console.log('retention: a window that would erase everything is refused');
