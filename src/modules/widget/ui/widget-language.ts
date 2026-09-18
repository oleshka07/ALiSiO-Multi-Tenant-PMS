/**
 * Which language the booking widget opens in.
 *
 * The widget started at `'uk'` and stayed there for anyone the browser check
 * missed. A hotel in Greiz whose base language is German therefore greeted
 * every guest arriving without `?lang=` — and whose browser was not one of
 * uk/en/cs/de — in Ukrainian: a language neither the hotel nor the guest
 * speaks, on the page where the guest is deciding whether to pay.
 *
 * `core/i18n/resolve.ts` already states the order for a guest: the hotel's
 * language is the ground, the browser breaks the tie, an explicit choice wins.
 * This file is that order for the one audience whose dictionary is smaller
 * than the product's — the widget has four languages, the product has more —
 * so a language the widget cannot render must fall through rather than be set.
 *
 * Why the hotel's language arrives from the API rather than from
 * `Accept-Language` on the server: `/api/booking/site-config` is the same
 * response for every guest of a site, so making it vary by request header
 * would mean either a `Vary` no cache respects well, or one guest's language
 * served to the next. The browser is read where it belongs — in the browser.
 */
// Шлях ВІДНОСНИЙ, не аліас: цей файл вантажить `widget-language.check.ts`,
// який запускають ГОЛИМ node, а він аліасів `tsconfig.paths` не знає. З
// аліасом перевірка падає з ERR_MODULE_NOT_FOUND — і падає лише в прогоні,
// бо `tsc` резолвер має (той самий клас, що `check-bare-node`).
import { LANGUAGE_CODES } from '../../../core/i18n/languages.ts';

/**
 * Чотири мови віджета, впорядковані РЕЄСТРОМ.
 *
 * Множина тут менша за реєстр свідомо — словників у віджета чотири, і про це
 * вище. А от ПОРЯДОК своїм бути не має: список починався з української, тобто
 * німецький готель показував гостю першою мову, якою не говорить ні він, ні
 * гість. Підмножина — не привід переставляти.
 */
const WIDGET_SPEAKS = ['de', 'en', 'cs', 'uk'] as const;
export const WIDGET_LANGUAGES: readonly WidgetLang[] =
  LANGUAGE_CODES.filter((c): c is WidgetLang => (WIDGET_SPEAKS as readonly string[]).includes(c));
export type WidgetLang = (typeof WIDGET_SPEAKS)[number];

/** The language if the widget can render it, otherwise null. */
export function asWidgetLang(value: unknown): WidgetLang | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().slice(0, 2).toLowerCase();
  return (WIDGET_LANGUAGES as readonly string[]).includes(code) ? (code as WidgetLang) : null;
}

/** What the browser asks for, if the widget speaks it. */
export function browserWidgetLang(): WidgetLang | null {
  if (typeof navigator === 'undefined') return null;
  const candidates = [
    ...(Array.isArray(navigator.languages) ? navigator.languages : []),
    navigator.language,
  ];
  for (const c of candidates) {
    const lang = asWidgetLang(c);
    if (lang) return lang;
  }
  return null;
}

export interface WidgetLangSources {
  /** `?lang=` — the guest said so out loud. */
  param?: unknown;
  /** `window.__BOOKING_LANG__` — the hotel said so on the embedding page. */
  embed?: unknown;
  /** Passed in by whoever mounted the widget. */
  initial?: unknown;
  /** `navigator.language`. */
  browser?: unknown;
  /** `organizations.language`, from /api/booking/site-config. */
  site?: unknown;
}

/**
 * The language, and whether the answer is settled.
 *
 * `pinned` is false only when the answer came from nothing better than the
 * final fallback — that is what lets the site's language, which arrives one
 * network round-trip later, still take effect without overriding a guest who
 * has already chosen.
 */
export function pickWidgetLanguage(sources: WidgetLangSources): {
  lang: WidgetLang;
  pinned: boolean;
} {
  for (const value of [sources.param, sources.embed, sources.initial, sources.browser, sources.site]) {
    const lang = asWidgetLang(value);
    if (lang) return { lang, pinned: true };
  }
  // Nobody said anything the widget understands. English is the language a
  // hotel guest is least likely to be insulted by; Ukrainian, which this used
  // to be, is a guess about the hotel's owner rather than about the guest.
  return { lang: 'en', pinned: false };
}
