/* eslint-disable @typescript-eslint/no-explicit-any */
import { getSql } from './db/async.ts';

/**
 * What day it is at the hotel.
 *
 * Everything that means «today» computed `new Date().toISOString()` — which is
 * UTC. `organizations.timezone` exists, defaults to Europe/Prague, and nothing
 * read it.
 *
 * Prague is UTC+1 in winter and UTC+2 in summer, Kyiv +2/+3. So between
 * midnight and 01:00 (or 02:00, or 03:00) local time, the server still thinks
 * it is yesterday:
 *
 *   - the arrivals list shows the people who came yesterday, and not the ones
 *     due in a few hours;
 *   - the departures list is a day behind, so the front desk chases guests who
 *     already left;
 *   - occupancy is computed for the wrong day;
 *   - the no-show auto-archive at 00:30 measures against yesterday, so a
 *     booking that failed to arrive is archived a day late — or, going the
 *     other way in a negative offset, a day early, while the guest is still
 *     on their way.
 *
 * A night receptionist starting at midnight is the person this hurts, and
 * «the list is wrong for the first hour of every shift» is exactly the kind of
 * thing that gets worked around rather than reported.
 *
 * `Intl.DateTimeFormat` with `en-CA` yields `YYYY-MM-DD` directly, which is
 * the format every query here compares against.
 */

/** Today at this hotel, as YYYY-MM-DD. */
export function todayIn(timezone: string | null | undefined, now: Date = new Date()): string {
  const tz = timezone || 'UTC';
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(now);
  } catch {
    // An unknown zone must not take the dashboard down. UTC is what this used
    // to do everywhere, so falling back to it is no worse than before.
    console.error(`[hotel-day] unknown timezone ${tz}, falling back to UTC`);
    return now.toISOString().slice(0, 10);
  }
}

/**
 * A DATE column as YYYY-MM-DD, whichever driver returned it.
 *
 * SQLite hands back the string it stored; the Postgres driver builds a Date in
 * the server's local zone. `String(aDate)` is «Mon Jun 15 2026 …», so slicing
 * it silently yields nonsense — the two engines have to be told apart.
 */
export function dayString(v: unknown): string {
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(v ?? '').slice(0, 10);
}

/** Whole days from `from` to `to`, both YYYY-MM-DD. Negative means the past. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/** N days from today at this hotel, as YYYY-MM-DD. */
export function shiftDays(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** N months from a day, as YYYY-MM-DD. A short month rolls forward, as Date does. */
export function shiftMonths(day: string, months: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + months, d)).toISOString().slice(0, 10);
}

/**
 * Часовий пояс країни — там, де він у країни ОДИН.
 *
 * Навіщо: `organizations.timezone` вирішує, де проходить межа доби, а канал
 * торгує саме датами заїзду. Готель, заведений без пояса, отримував
 * `'Europe/Prague'` — і для українського готелю це не косметика: доба
 * закінчується на годину раніше, тобто «сьогодні» в списках приїздів і
 * виїздів, у нічному архіві неявок і в каталозі, який їде вендору, — чуже.
 *
 * Чому мапа, а не бібліотека: потрібен один факт про країну, і він рідко
 * змінюється. Повний реєстр IANA важить мегабайти і тягне своє оновлення.
 *
 * Чому не всі країни: у переліку лише ті, де пояс ОДИН. Іспанія (материк і
 * Канари), Португалія (Азори), Франція, США, Росія, Казахстан, Бразилія,
 * Австралія, Канада мають по кілька — здогад для них був би тим самим
 * мовчазним дефолтом, лише з іншим числом. Для них пояс називають явно, і
 * заведення відмовляє, поки його не назвали.
 *
 * Це НЕ порушення інваріанта 22 («юрисдикція — модуль, ядро нейтральне»):
 * тут немає правил країни — ні податку, ні документа, ні чека. Тут факт
 * календаря, того самого роду, що код валюти ISO 4217. Правила лишаються в
 * модулях юрисдикції.
 */
const COUNTRY_TIMEZONE: Record<string, string> = {
  UA: 'Europe/Kyiv', CZ: 'Europe/Prague', SK: 'Europe/Bratislava',
  PL: 'Europe/Warsaw', DE: 'Europe/Berlin', AT: 'Europe/Vienna',
  HU: 'Europe/Budapest', SI: 'Europe/Ljubljana', HR: 'Europe/Zagreb',
  RS: 'Europe/Belgrade', BA: 'Europe/Sarajevo', ME: 'Europe/Podgorica',
  MK: 'Europe/Skopje', AL: 'Europe/Tirane', RO: 'Europe/Bucharest',
  BG: 'Europe/Sofia', GR: 'Europe/Athens', IT: 'Europe/Rome',
  NL: 'Europe/Amsterdam', BE: 'Europe/Brussels', LU: 'Europe/Luxembourg',
  DK: 'Europe/Copenhagen', SE: 'Europe/Stockholm', NO: 'Europe/Oslo',
  FI: 'Europe/Helsinki', EE: 'Europe/Tallinn', LV: 'Europe/Riga',
  LT: 'Europe/Vilnius', IE: 'Europe/Dublin', GB: 'Europe/London',
  CH: 'Europe/Zurich', TR: 'Europe/Istanbul', CY: 'Asia/Nicosia',
  MT: 'Europe/Malta', MD: 'Europe/Chisinau', IS: 'Atlantic/Reykjavik',
  GE: 'Asia/Tbilisi', AM: 'Asia/Yerevan', AZ: 'Asia/Baku',
};

/** Пояс країни, або `null` — країна невідома чи має кілька поясів. */
export function timezoneForCountry(country: string | null | undefined): string | null {
  const code = country?.trim().toUpperCase();
  if (!code) return null;
  return COUNTRY_TIMEZONE[code] ?? null;
}

/** Чи знає система такий пояс. Порожнє й вигадане — ні. */
export function isKnownTimezone(timezone: string | null | undefined): boolean {
  if (!timezone) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The organization's timezone, or the schema default.
 *
 * Cached per call site rather than globally: this is one indexed read by
 * primary key, and a stale timezone after an operator changes it would be a
 * worse bug than the read.
 */
export async function organizationTimezone(organizationId: string): Promise<string> {
  const sql = getSql();
  const row = await sql.row<any>(
    'SELECT timezone FROM organizations WHERE id = ?', [organizationId]);
  return row?.timezone || 'Europe/Prague';
}

/** Today at this organization's hotel, in one call. */
export async function todayFor(organizationId: string): Promise<string> {
  return todayIn(await organizationTimezone(organizationId));
}
