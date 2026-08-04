/**
 * The language registry: one list, and everything that asks reads it.
 *
 * Before this there were four separate lists — the guest portal knew seven
 * languages, the booking widget four, translate.ts six, and the operator
 * interface none at all, because Ukrainian was written straight into the JSX.
 * Adding a language meant finding all four and hoping there was not a fifth.
 *
 * Two things are stored, and they are deliberately the same column:
 *
 *   organizations.language  the hotel's base language. Its staff see the
 *                           interface in it, and it is the language its people
 *                           type content in — so it is also the SOURCE for
 *                           translating that content to guests.
 *   app_users.language      one person's override. NULL means "whatever the
 *                           hotel uses", which is what almost everyone wants.
 *
 * Imports here stay dependency-free on purpose: provisioning runs this under
 * plain node, where '@core/…' and 'next/server' do not resolve.
 */

export const LANGUAGES = {
  uk: { native: 'Українська', english: 'Ukrainian' },
  en: { native: 'English', english: 'English' },
  de: { native: 'Deutsch', english: 'German' },
  cs: { native: 'Čeština', english: 'Czech' },
  pl: { native: 'Polski', english: 'Polish' },
  nl: { native: 'Nederlands', english: 'Dutch' },
  fr: { native: 'Français', english: 'French' },
} as const;

export type Language = keyof typeof LANGUAGES;

export const LANGUAGE_CODES = Object.keys(LANGUAGES) as Language[];

/**
 * What an organization gets when nobody chose. Ukrainian because that is what
 * every string in the product is written in today; the moment the interface
 * dictionaries are complete this should become 'en'.
 */
export const DEFAULT_LANGUAGE: Language = 'uk';

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && value in LANGUAGES;
}

/** A code from anywhere untrusted — a column, a form, a query string. */
export function parseLanguage(value: unknown, fallback: Language = DEFAULT_LANGUAGE): Language {
  if (typeof value !== 'string') return fallback;
  const code = value.trim().toLowerCase().split(/[-_]/)[0];
  return isLanguage(code) ? code : fallback;
}

/**
 * The languages a hotel's content is translated INTO — everything except the
 * one it is written in. A German hotel does not need its own text translated
 * to German, and asking a model to do it produces drift, not a copy.
 */
export function targetLanguages(source: Language): Language[] {
  return LANGUAGE_CODES.filter((code) => code !== source);
}

/**
 * Best match from an Accept-Language header. Only used when there is nobody to
 * ask — a guest arriving on a portal link, before any preference exists.
 */
export function fromAcceptLanguage(
  header: string | null | undefined,
  fallback: Language,
): Language {
  if (!header) return fallback;

  const ranked = header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.find((p) => p.trim().startsWith('q='));
      const weight = q ? Number.parseFloat(q.split('=')[1]) : 1;
      return { tag: tag.trim().toLowerCase(), weight: Number.isFinite(weight) ? weight : 0 };
    })
    .filter((entry) => entry.tag && entry.weight > 0)
    .sort((a, b) => b.weight - a.weight);

  for (const { tag } of ranked) {
    const code = tag.split(/[-_]/)[0];
    if (isLanguage(code)) return code;
  }
  return fallback;
}
