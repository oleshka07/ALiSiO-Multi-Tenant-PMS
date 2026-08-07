/**
 * Plural forms.
 *
 *   node src/core/i18n/plural.check.ts
 *
 * The case this exists for is not German — German is two forms and forgiving.
 * It is Czech and Polish, where the form depends on the number in a way that
 * looks arbitrary from the outside, and where getting it wrong produces text
 * that is grammatical-looking and wrong. Nobody reviewing a diff catches that;
 * a test does.
 */
import assert from 'node:assert';
import { translate, translatePlural } from './dictionary.ts';

// ─── the shape falls back the way the product does ───────────────────────────
// An unknown key is the source string, in every form. That is the property the
// whole design rests on: a half-finished dictionary degrades, it does not break.
assert.strictEqual(translatePlural('немає такого ключа', 1, 'de'), 'немає такого ключа');
assert.strictEqual(translatePlural('немає такого ключа', 5, 'de'), 'немає такого ключа');
console.log('  ok  an unknown key stays the source text, whatever the count');

// The source language never consults the dictionary.
assert.strictEqual(translatePlural('записів', 1, 'uk'), 'записів');
console.log('  ok  Ukrainian renders what the developer wrote');

// ─── German: the reason «1 Einträge» stopped happening ───────────────────────
assert.strictEqual(translatePlural('записів', 1, 'de'), 'Eintrag');
assert.strictEqual(translatePlural('записів', 2, 'de'), 'Einträge');
assert.strictEqual(translatePlural('записів', 0, 'de'), 'Einträge', 'German counts zero as many');
console.log('  ok  German picks the form the count needs');

// A plural entry reached through plain translate() must not return an object.
const asText = translate('записів', 'de');
assert.strictEqual(typeof asText, 'string');
assert.strictEqual(asText, 'Einträge', 'without a count, the general form');
console.log('  ok  a plural entry read without a count is still text');

// ─── the languages this was actually built for ───────────────────────────────
// Czech needs three forms and Polish needs three; the boundaries are not the
// same, and neither is 1/2-4/5+ by accident. These assertions are about
// Intl.PluralRules being the thing that decides, not us.
const czech = new Intl.PluralRules('cs');
assert.strictEqual(czech.select(1), 'one');
assert.strictEqual(czech.select(3), 'few');
assert.strictEqual(czech.select(9), 'other');

const polish = new Intl.PluralRules('pl');
assert.strictEqual(polish.select(1), 'one');
assert.strictEqual(polish.select(3), 'few');
assert.strictEqual(polish.select(5), 'many');
console.log('  ok  Czech wants three forms and Polish wants three others');

// So a Czech dictionary that only carries `one` and `other` is not "nearly
// done" — it is wrong on every count from 2 to 4, which is most bookings.
const required = (lang: string) => new Intl.PluralRules(lang).resolvedOptions().pluralCategories;
assert.ok(required('cs').includes('few'), 'check-translations demands this one');
assert.ok(required('pl').includes('many'));
assert.ok(!required('de').includes('few'), 'and does not demand it of German');
console.log('  ok  what a language requires comes from the language');

console.log('plural: the count picks the word, and the language picks the rule');
