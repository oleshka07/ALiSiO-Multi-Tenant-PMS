/**
 * A country is one country, however it was spelled.
 *
 *   node src/core/country-code.check.ts
 *
 * Citizenship reaches this system as alpha-3 — the MRZ on a passport is
 * alpha-3 by ISO 9303, and the registration form's own placeholder suggests
 * it — while every rule that reads it compared against alpha-2. `'DEU' ===
 * 'DE'` is false, and two legal obligations were decided by that:
 *
 *   a German guest was never exempt from the Meldeschein (§ 29 BMG), so the
 *   hotel filled in a form the law does not require, for its own nationals;
 *
 *   a Czech guest was always a foreigner in the Evidenční kniha, the register
 *   the police read.
 *
 * Neither surfaced as an error. The form printed and the register exported;
 * they were simply about the wrong people. That is what makes this a check
 * rather than a code-review note — the failure has no symptom.
 */
import assert from 'node:assert';
import { alpha2, sameCountry } from './country-code.ts';
import { meldescheinNeeded } from '../modules/guests/domain/meldeschein.ts';

// ── 1. alpha-3 becomes alpha-2 ───────────────────────────────────────
assert.strictEqual(alpha2('DEU'), 'DE');
assert.strictEqual(alpha2('CZE'), 'CZ');
assert.strictEqual(alpha2('UKR'), 'UA');
assert.strictEqual(alpha2('GBR'), 'GB');
assert.strictEqual(alpha2('deu'), 'DE', 'lower case is the same country');
assert.strictEqual(alpha2(' DEU '), 'DE', 'whitespace is not a country');
console.log('  ok  DEU → DE, CZE → CZ');

// ── 2. alpha-2 is left alone, and nothing is invented ────────────────
assert.strictEqual(alpha2('DE'), 'DE');
assert.strictEqual(alpha2(''), '', 'empty stays empty — «unknown» is an answer');
assert.strictEqual(alpha2(null), '');
assert.strictEqual(alpha2(undefined), '');
assert.strictEqual(alpha2('XXX'), 'XXX',
  'an unknown code is handed back, not silently emptied — a human can see and fix it');
console.log('  ok  alpha-2 unchanged, unknown not swallowed');

// ── 3. The Meldeschein rule, which is the point ──────────────────────
// A German in Germany is exempt. This is the assertion that was false.
assert.deepStrictEqual(
  meldescheinNeeded({ propertyCountry: 'DE', guestNationality: 'DEU' }),
  { required: false, reason: 'german_national' },
  'a German passport (alpha-3, as the MRZ gives it) still demanded a Meldeschein',
);
assert.deepStrictEqual(
  meldescheinNeeded({ propertyCountry: 'DEU', guestNationality: 'DE' }),
  { required: false, reason: 'german_national' },
  'the property country arrives alpha-3 too',
);
// A foreigner in Germany still needs one — the fix must not exempt everybody.
assert.strictEqual(
  meldescheinNeeded({ propertyCountry: 'DE', guestNationality: 'CZE' }).required, true,
  'a Czech guest in Germany must still be registered');
// Unknown citizenship is not "German": the law is stricter, not looser.
assert.deepStrictEqual(
  meldescheinNeeded({ propertyCountry: 'DE', guestNationality: '' }),
  { required: true, reason: 'nationality_unknown' });
// Outside Germany the form does not apply at all.
assert.strictEqual(
  meldescheinNeeded({ propertyCountry: 'CZ', guestNationality: 'DEU' }).required, false);
console.log('  ok  німець у Німеччині звільнений, іноземець — ні');

// ── 4. sameCountry across spellings ──────────────────────────────────
assert.ok(sameCountry('DEU', 'DE'));
assert.ok(sameCountry('cz', 'CZE'));
assert.ok(!sameCountry('DEU', 'CZE'));
assert.ok(!sameCountry('', ''), 'two unknowns are not the same country');
console.log('  ok  порівняння країн не залежить від написання');

console.log('країна — це одна країна, як би її не записали');
