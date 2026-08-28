// ─── Booking Widget Date & Price Utilities ───
import type { BookingLang } from './translations';

export function fmtDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

export function parseDate(s: string): Date {
  return new Date(s + 'T00:00:00');
}

export function formatDisplayDate(s: string, lang: BookingLang): string {
  const d = parseDate(s);
  const locales: Record<string, string> = { uk: 'uk-UA', en: 'en-GB', cs: 'cs-CZ', de: 'de-DE' };
  return d.toLocaleDateString(locales[lang] || 'uk-UA', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function formatFullDate(s: string, lang: BookingLang): string {
  const d = parseDate(s);
  const locales: Record<string, string> = { uk: 'uk-UA', en: 'en-GB', cs: 'cs-CZ', de: 'de-DE' };
  return d.toLocaleDateString(locales[lang] || 'uk-UA', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * Ціна так, як її бачить гість у віджеті.
 *
 * Дефолт `'Kč'` тут був валютою першого клієнта: віджет німецького готелю
 * підписував ціни кронами, поки (і якщо) не приїде конфігурація сайту. Немає
 * валюти — друкуємо число без знака: воно принаймні правильне.
 */
export function formatPrice(n: number, currency: string = ''): string {
  const formatted = new Intl.NumberFormat('cs-CZ').format(n).replace(',', ' ');
  return `${formatted} ${currency}`.trim();
}

export function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

export function getFirstDayOfMonth(year: number, month: number): number {
  const d = new Date(year, month, 1).getDay();
  return d === 0 ? 6 : d - 1;
}

/** One bookable category, summarised for the category step. */
export interface CategoryOption {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  sort: number;
  /** How many units of this category are free for the chosen dates. */
  count: number;
  /** Cheapest nightly rate among them; 0 when none is priced. */
  fromPrice: number;
}

/**
 * Group available units into categories for the optional category step.
 *
 * Replaces the retired wizard's hardcoded three-category
 * branches: the grouping now comes from whatever categories the property
 * actually has units in. Units without a category are ignored rather than
 * bucketed under a fake one, so a mis-seeded row cannot invent a category.
 */
export function groupUnitsByCategory(units: {
  categoryId?: string;
  categoryName?: string;
  categoryIcon?: string | null;
  categoryColor?: string | null;
  categorySort?: number;
  avgPricePerNight?: number;
}[]): CategoryOption[] {
  const byId = new Map<string, CategoryOption>();
  for (const u of units) {
    if (!u.categoryId) continue;
    const price = u.avgPricePerNight ?? 0;
    const found = byId.get(u.categoryId);
    if (found) {
      found.count += 1;
      if (price > 0 && (found.fromPrice === 0 || price < found.fromPrice)) found.fromPrice = price;
    } else {
      byId.set(u.categoryId, {
        id: u.categoryId,
        name: u.categoryName ?? '',
        icon: u.categoryIcon ?? null,
        color: u.categoryColor ?? null,
        sort: u.categorySort ?? 0,
        count: 1,
        fromPrice: price,
      });
    }
  }
  return [...byId.values()].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
}
