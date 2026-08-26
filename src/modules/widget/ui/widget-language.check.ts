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
import { asWidgetLang, pickWidgetLanguage, WIDGET_LANGUAGES } from './widget-language.ts';

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

// ── The embed script on the hotel's own page ─────────────────────────
//
// Everything above decides the language INSIDE the widget, and none of it
// mattered in production, because `public/widget/embed.v2.js` — the snippet
// pasted into the hotel's website — appended `?lang=uk` to the iframe URL
// whenever it could not work one out. `?lang=` is the highest precedence
// there is: the outer script reached over the whole chain and pinned the
// product author's language. Fixing the widget alone changed nothing on a
// real site, and nothing said so.
//
// Two things are asserted here because both are load-bearing and both live
// in a file no compiler reads:
//   1. the embed must not invent a language — no bare `|| 'uk'` default;
//   2. its list of renderable languages must be the same list as this
//      module's, or the browser check silently disagrees with the widget.
import { readFileSync } from 'node:fs';

const embedSource = readFileSync(
  new URL('../../../../public/widget/embed.v2.js', import.meta.url), 'utf8');

const embedList = embedSource.match(/var WIDGET_LANGUAGES = \[([^\]]*)\]/);
assert.ok(embedList, 'embed.v2.js no longer declares WIDGET_LANGUAGES — the check cannot see the list');
assert.deepStrictEqual(
  embedList[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')),
  [...WIDGET_LANGUAGES],
  'the embed script and the widget disagree about which languages exist',
);

assert.ok(
  /if \(lang\) queryParams\.set\('lang', lang\)/.test(embedSource),
  'the embed must pass ?lang= only when it knows one — an absent param is how the hotel’s language wins');
assert.ok(
  !/browserLang\(\)\s*\|\|\s*'[a-z]{2}'/.test(embedSource),
  "the embed invents a language again: a hardcoded default here outranks the hotel's own setting");
console.log('  ok  embed на сайті готелю не вигадує мову і знає той самий список');

console.log('віджет відкривається мовою, яку хтось справді обрав');
