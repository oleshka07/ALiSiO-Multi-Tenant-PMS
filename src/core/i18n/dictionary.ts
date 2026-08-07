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
 * The languages the product offers, and how to fetch each one.
 *
 * A static `import de from './messages/de.json'` put the whole German
 * dictionary — 163 KB — into a chunk every browser downloads. That is
 * affordable at one language and absurd at seven: a Czech receptionist would
 * be shipped German, Polish, Dutch and French to use none of them.
 *
 * So each is an `import()`, resolved once the language is known. Until it
 * resolves, `translate()` returns the source text, which is the same thing it
 * does for a missing entry — the interface starts Ukrainian and settles,
 * exactly as it already did while /api/auth/me was in flight. Nothing waits on
 * a dictionary, and nothing blanks.
 *
 * The keys of this object are what `check-translations.mjs` reads to decide
 * which languages must be complete, so adding a line here is the act of
 * offering a language, not merely of having a file. Czech has a dictionary and
 * is deliberately not listed: it is half done, and half a language is worse
 * than none — the screen would be Czech in places and Ukrainian in others with
 * no way for the person reading it to know why.
 */
const SOURCES: Partial<Record<Language, () => Promise<{ default: Record<string, Entry> }>>> = {
  de: () => import('./messages/de.json', { with: { type: 'json' } }),
};

/** Filled in as each language arrives; empty means "not loaded yet", not "empty". */
const DICTIONARIES: Partial<Record<Language, Record<string, Entry>>> = {};

const inFlight = new Map<Language, Promise<void>>();

/**
 * Fetch a language's dictionary once.
 *
 * Returns a promise so a caller that wants to re-render on arrival can await
 * it; callers that do not care simply never look.
 */
export function loadDictionary(language: Language): Promise<void> {
  if (language === UI_SOURCE_LANGUAGE || DICTIONARIES[language]) return Promise.resolve();
  const existing = inFlight.get(language);
  if (existing) return existing;

  const source = SOURCES[language];
  if (!source) return Promise.resolve();

  const promise = source()
    .then((module) => {
      DICTIONARIES[language] = module.default;
    })
    .catch((error) => {
      // A dictionary that fails to load leaves the interface Ukrainian, which
      // is a degradation rather than a break — but it should not be silent.
      console.error(`[i18n] dictionary for ${language} failed to load`, error);
    });
  inFlight.set(language, promise);
  return promise;
}

/** Is this language's dictionary in memory yet? */
export function isLoaded(language: Language): boolean {
  return language === UI_SOURCE_LANGUAGE || DICTIONARIES[language] !== undefined;
}

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

/** Which languages the operator interface is offered in. */
export const TRANSLATED_UI_LANGUAGES = Object.keys(SOURCES) as Language[];

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
  if (!SOURCES[language]) return 0;
  const dict = DICTIONARIES[language];
  // Offered but not fetched yet: the honest answer is "fully", because a
  // language is only offered once check:i18n says it is complete. Reporting 0
  // here would tell someone their language covers nothing while it loads.
  if (!dict) return 1;
  if (catalogueSize === 0) return 0;
  return Math.min(1, Object.keys(dict).length / catalogueSize);
}
