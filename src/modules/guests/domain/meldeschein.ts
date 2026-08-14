/**
 * The German registration form, and — more importantly — when there isn't one.
 *
 * Until 2025 every guest of a German hotel filled in a Meldeschein. The
 * Bürokratieentlastungsgesetz IV changed that from **1 January 2025**: guests
 * with **German nationality no longer register at all**, and the hotel's
 * obligation to keep their forms disappeared with it. For everyone else the
 * duty stands — §§ 29, 30 BMG, kept because EU rules require it.
 *
 * That asymmetry is the whole point of this file. A form printed for a German
 * guest is not a harmless extra: it is paperwork the law abolished, collected
 * without a legal basis, and then stored for a year. The pilot is leaving a
 * system that printed one for everybody, and "it still prints them" would be a
 * migration that moved the bureaucracy rather than removing it.
 *
 * Nothing here is written for one hotel. The rule is Germany's, so it is asked
 * of the PROPERTY's country: a Czech property answers "not applicable" and
 * keeps using its own Evidenční kniha, which exists already.
 *
 * Note for whoever revisits this: whether treating German and foreign guests
 * differently survives EU anti-discrimination law is not settled — the question
 * is expected at the ECJ. If it goes the other way, the change is one function.
 */

/** ISO-3166-1 alpha-2, upper case, or null when nobody said. */
export type CountryCode = string | null | undefined;

export interface MeldescheinNeed {
  required: boolean;
  /** Why — for a screen, not for a log. */
  reason: 'not_germany' | 'german_national' | 'foreign_national' | 'nationality_unknown';
}

/**
 * Does this guest need a Meldeschein?
 *
 * `nationality_unknown` is deliberately REQUIRED rather than skipped. Missing
 * nationality is a gap in the data, not evidence of German citizenship, and
 * guessing "German" would silently drop the one guest the law is actually
 * about. Reception sees the reason and fills the field in.
 */
export function meldescheinNeeded(input: {
  propertyCountry: CountryCode;
  guestNationality: CountryCode;
}): MeldescheinNeed {
  const property = norm(input.propertyCountry);
  if (property !== 'DE') return { required: false, reason: 'not_germany' };

  const nationality = norm(input.guestNationality);
  if (!nationality) return { required: true, reason: 'nationality_unknown' };
  if (nationality === 'DE') return { required: false, reason: 'german_national' };
  return { required: true, reason: 'foreign_national' };
}

/**
 * What § 30 Abs. 2 BMG says a form must contain.
 *
 * Only these. The law is explicit that a Meldeschein carries the mandatory
 * items and nothing else — a hotel may not use it to collect a car
 * registration or an e-mail address for its newsletter.
 */
export const MELDESCHEIN_FIELDS = [
  'arrival',        // Datum der Ankunft
  'departure',      // Datum der voraussichtlichen Abreise
  'last_name',      // Familienname
  'first_name',     // Vorname
  'date_of_birth',  // Geburtsdatum
  'nationality',    // Staatsangehörigkeiten
  'address',        // Anschrift
  'companions',     // Zahl der Mitreisenden
  'document_number', // Seriennummer des Passes — nur bei ausländischen Personen
] as const;

export type MeldescheinField = (typeof MELDESCHEIN_FIELDS)[number];

export interface MeldescheinData {
  arrival: string;
  departure: string;
  last_name: string;
  first_name: string;
  date_of_birth?: string | null;
  nationality?: string | null;
  address?: string | null;
  companions: number;
  document_number?: string | null;
}

/**
 * Which mandatory fields are still empty.
 *
 * Names, not a boolean: a form refused as "incomplete" tells reception
 * nothing, and this list is what the message should say. `companions` is never
 * missing — zero is an answer.
 */
export function missingFields(data: MeldescheinData): MeldescheinField[] {
  const missing: MeldescheinField[] = [];
  if (!data.arrival) missing.push('arrival');
  if (!data.departure) missing.push('departure');
  if (!data.last_name) missing.push('last_name');
  if (!data.first_name) missing.push('first_name');
  if (!data.date_of_birth) missing.push('date_of_birth');
  if (!data.nationality) missing.push('nationality');
  if (!data.address) missing.push('address');
  // The passport number is mandatory for foreign guests, and a form is only
  // produced for foreign guests — so it is always required here.
  if (!data.document_number) missing.push('document_number');
  return missing;
}

/**
 * The day the form may be destroyed.
 *
 * § 30: kept one year from the day of DEPARTURE, then destroyed within three
 * months. Returned as the two ends of that window rather than one date,
 * because both are obligations: keeping it a day less is a breach, and keeping
 * it beyond the second is another one.
 */
export function retentionWindow(departure: string): { keepUntil: string; destroyBy: string } {
  return { keepUntil: addMonths(departure, 12), destroyBy: addMonths(departure, 15) };
}

function norm(v: CountryCode): string {
  return String(v ?? '').trim().toUpperCase();
}

/** ISO date + n months, clamped to the end of a shorter month. */
function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  // Day 0 of the following month is the last day of the target one, which is
  // how 31 January + 1 month becomes 28 February rather than 3 March.
  const lastOfTarget = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + months, Math.min(d, lastOfTarget)))
    .toISOString().slice(0, 10);
}
