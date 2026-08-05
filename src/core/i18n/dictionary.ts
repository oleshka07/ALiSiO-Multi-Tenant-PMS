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

import { type Language, UI_SOURCE_LANGUAGE } from './languages';
import de from './messages/de.json';

/**
 * Only languages with a dictionary appear here. The rest fall through to the
 * source text, which is correct: an untranslated interface is Ukrainian.
 */
const DICTIONARIES: Partial<Record<Language, Record<string, string>>> = {
  de: de as Record<string, string>,
};

/** Which languages the operator interface has been translated into. */
export const TRANSLATED_UI_LANGUAGES = Object.keys(DICTIONARIES) as Language[];

export function translate(text: string, language: Language): string {
  if (language === UI_SOURCE_LANGUAGE) return text;
  return DICTIONARIES[language]?.[text] ?? text;
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
