/**
 * The widget opens in a language somebody actually chose.
 *
 *   node src/modules/widget/ui/widget-language.check.ts
 *
 * The old line was `useState<BookingLang>(initialLang || 'uk')`, and the only
 * thing that could move it was a browser whose language happened to be one of
 * uk/en/cs/de. Everyone else — a Polish guest, a Dutch guest, a guest whose
 * phone is set to Italian — booked a room in Ukrainian, at a German hotel.
 *
 * The assertions below are about who gets the last word, and about the one
 * case that has no good answer (nothing known), which must not resolve to the
 * product author's language.
 */
import assert from 'node:assert';
import { asWidgetLang, pickWidgetLanguage } from './widget-language.ts';

// ── What counts as a language the widget can render ──────────────────
assert.strictEqual(asWidgetLang('de'), 'de');
assert.strictEqual(asWidgetLang('de-AT'), 'de', 'a region is still the language');
assert.strictEqual(asWidgetLang('CS'), 'cs');
assert.strictEqual(asWidgetLang(' en-GB '), 'en');
assert.strictEqual(asWidgetLang('pl'), null,
  'the product speaks Polish, the widget does not — it must fall through, not render half a page');
assert.strictEqual(asWidgetLang(''), null);
assert.strictEqual(asWidgetLang(null), null);
assert.strictEqual(asWidgetLang(undefined), null);
assert.strictEqual(asWidgetLang(42), null);
console.log('  ok  мова віджета — тільки та, яку він справді вміє');

// ── Order of precedence ──────────────────────────────────────────────
assert.deepStrictEqual(
  pickWidgetLanguage({ param: 'cs', embed: 'de', browser: 'en', site: 'uk' }),
  { lang: 'cs', pinned: true }, '?lang= is the guest saying it out loud');
assert.deepStrictEqual(
  pickWidgetLanguage({ embed: 'de', browser: 'en', site: 'uk' }),
  { lang: 'de', pinned: true }, 'the embedding page speaks for the hotel');
assert.deepStrictEqual(
  pickWidgetLanguage({ browser: 'en', site: 'de' }),
  { lang: 'en', pinned: true }, "the browser is the guest's own setting");
assert.deepStrictEqual(
  pickWidgetLanguage({ site: 'de' }),
  { lang: 'de', pinned: true }, "with nothing from the guest, the hotel's language leads");
console.log('  ok  ?lang= → embed → браузер → мова готелю');

// This is the bug, stated as an assertion: a guest whose browser the widget
// does not speak, at a German hotel, gets German — not Ukrainian.
assert.strictEqual(pickWidgetLanguage({ browser: 'pl-PL', site: 'de' }).lang, 'de',
  'a Polish-speaking guest at a German hotel was shown Ukrainian');
assert.strictEqual(pickWidgetLanguage({ browser: 'it', site: 'cs' }).lang, 'cs');
console.log('  ok  гість, чиєї мови віджет не знає, бачить мову готелю');

// ── When nothing is known ────────────────────────────────────────────
// `pinned: false` is what lets the site's language, which arrives a round-trip
// later, still land — while a guest who has already chosen is left alone.
assert.deepStrictEqual(pickWidgetLanguage({}), { lang: 'en', pinned: false });
assert.deepStrictEqual(
  pickWidgetLanguage({ browser: 'pl', site: null }),
  { lang: 'en', pinned: false },
  'an unrenderable browser language and no site yet is still «nothing known»');
console.log('  ok  коли невідомо нічого — англійська, і відповідь не зафіксована');

console.log('віджет відкривається мовою, яку хтось справді обрав');
