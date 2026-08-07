/**
 * Interface text.
 *
 * The key of every entry IS the Ukrainian string as it appears in the source.
 * That is deliberate, and it is the whole reason this could be rolled out over
 * a working product rather than a rewrite:
 *
 *   - a missing translation renders the Ukrainian, never `settings.save.label`,
 *     so a half-finished dictionary degrades instead of breaking;
 *   - the codemod that introduced `t()` WRAPS text instead of replacing it, so
 *     every diff stays readable and a bad edit is visible on sight;
 *   - it is how the guest portal and the booking widget already work
 *     (`content-translations.ts` maps Ukrainian phrases the same way), so this
 *     is one convention rather than a second one.
 *
 * The cost is that one Ukrainian word cannot have two translations by context
 * — «Закрити» as a button and as a status collapse into one entry. When that
 * actually bites, the entry gets a disambiguating suffix at the call site;
 * it has not bitten yet.
 */

import { type Language, UI_SOURCE_LANGUAGE } from './languages.ts';
import de from './messages/de.json' with { type: 'json' };

/**
 * An entry is either the phrase, or the phrase per plural category.
 *
 * «1 Einträge» is wrong in German and «5 záznamy» is wrong in Czech, and no
 * amount of dictionary coverage fixes it: the count decides the word, and the
 * rule for which count picks which word is different in every language.
 * German needs two forms, Czech and Polish need three, and Ukrainian needs
 * three of its own.
 *
 * The categories are CLDR's — `one`, `few`, `many`, `other` — and which ones a
 * language actually uses comes from `Intl.PluralRules`, not from us.
 */
export type Entry = string | Partial<Record<Intl.LDMLPluralRule, string>>;

/**
 * Only languages with a dictionary appear here. The rest fall through to the
 * source text, which is correct: an untranslated interface is Ukrainian.
 */
const DICTIONARIES: Partial<Record<Language, Record<string, Entry>>> = {
  de: de as Record<string, Entry>,
};

/** `Intl.PluralRules` is not free to construct, and this runs per render. */
const rules = new Map<Language, Intl.PluralRules>();
function pluralRules(language: Language): Intl.PluralRules {
  let cached = rules.get(language);
  if (!cached) {
    cached = new Intl.PluralRules(language);
    rules.set(language, cached);
  }
  return cached;
}

/** Which languages the operator interface has been translated into. */
export const TRANSLATED_UI_LANGUAGES = Object.keys(DICTIONARIES) as Language[];

export function translate(text: string, language: Language): string {
  if (language === UI_SOURCE_LANGUAGE) return text;
  const entry = DICTIONARIES[language]?.[text];
  if (typeof entry === 'string') return entry;
  // A plural entry reached without a count: `other` is the form a language uses
  // for "in general", so it is the least wrong thing to show.
  return entry?.other ?? text;
}

/**
 * The form of `text` that goes with `count`.
 *
 *   `${n} ${plural(n, 'записів')}`   →   1 Eintrag · 5 Einträge
 *
 * The source string is still the key, and it is still whatever single Ukrainian
 * form the developer happened to write. That is fine: the key identifies the
 * phrase, and the dictionary carries the forms. Ukrainian itself renders that
 * one written form until `messages/uk.json` gives it categories of its own —
 * the shape allows it, nothing forces it yet.
 */
export function translatePlural(text: string, count: number, language: Language): string {
  const entry = DICTIONARIES[language]?.[text];
  if (entry && typeof entry !== 'string') {
    const category = pluralRules(language).select(count);
    return entry[category] ?? entry.other ?? text;
  }
  return translate(text, language);
}

/**
 * How much of the interface a language actually covers. Used by the settings
 * screen to say so out loud rather than letting someone pick a language and
 * wonder why half the screen did not change.
 */
export function coverage(language: Language, catalogueSize: number): number {
  if (language === UI_SOURCE_LANGUAGE) return 1;
  const dict = DICTIONARIES[language];
  if (!dict || catalogueSize === 0) return 0;
  return Math.min(1, Object.keys(dict).length / catalogueSize);
}
