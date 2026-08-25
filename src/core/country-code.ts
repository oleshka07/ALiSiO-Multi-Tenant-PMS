/**
 * One spelling of a country, so the law can be applied to it.
 *
 * Citizenship arrives in this system three ways and they do not agree:
 *
 *   - the MRZ on a passport, which ISO 9303 says is alpha-3 — `DEU`, `CZE`;
 *   - the guest registration form, whose own placeholder suggests alpha-3;
 *   - a hotel typing it by hand, which produces anything at all.
 *
 * And every rule that reads it compares against alpha-2: `nationality === 'DE'`
 * decides whether a Meldeschein is required, `nationality != 'CZ'` decides who
 * is a foreigner in the Czech Evidenční kniha. `'DEU' === 'DE'` is false, so:
 *
 *   a German guest was NEVER exempt from the Meldeschein — the hotel filled in
 *   a form the law does not ask for, for every one of its own nationals;
 *   a Czech guest was ALWAYS a foreigner in the register the police read.
 *
 * Both are compliance failures produced by three characters instead of two,
 * and neither shows up as an error anywhere — the form prints, the register
 * exports, the numbers are simply wrong.
 *
 * So there is one function, and every rule calls it. The table below is the
 * countries this product actually meets: the EU/EEA, the UK, Switzerland, and
 * the handful outside Europe that appear in the pilots' guest lists. An
 * unknown alpha-3 is returned uppercased rather than dropped — a wrong-looking
 * code is a thing a human can see and correct, and silently emptying the field
 * would turn a typo into "nationality unknown", which changes what the law
 * requires.
 */

/** ISO 3166-1 alpha-3 → alpha-2, for the countries this product sees. */
const ALPHA3: Record<string, string> = {
  // EU
  AUT: 'AT', BEL: 'BE', BGR: 'BG', HRV: 'HR', CYP: 'CY', CZE: 'CZ',
  DNK: 'DK', EST: 'EE', FIN: 'FI', FRA: 'FR', DEU: 'DE', GRC: 'GR',
  HUN: 'HU', IRL: 'IE', ITA: 'IT', LVA: 'LV', LTU: 'LT', LUX: 'LU',
  MLT: 'MT', NLD: 'NL', POL: 'PL', PRT: 'PT', ROU: 'RO', SVK: 'SK',
  SVN: 'SI', ESP: 'ES', SWE: 'SE',
  // EEA + Switzerland + the UK
  ISL: 'IS', LIE: 'LI', NOR: 'NO', CHE: 'CH', GBR: 'GB',
  // Neighbours and frequent guests
  UKR: 'UA', MDA: 'MD', SRB: 'RS', BIH: 'BA', MNE: 'ME', MKD: 'MK',
  ALB: 'AL', TUR: 'TR', GEO: 'GE', ARM: 'AM', AZE: 'AZ', KAZ: 'KZ',
  BLR: 'BY', RUS: 'RU',
  // Elsewhere
  USA: 'US', CAN: 'CA', MEX: 'MX', BRA: 'BR', ARG: 'AR', CHL: 'CL',
  AUS: 'AU', NZL: 'NZ', JPN: 'JP', KOR: 'KR', CHN: 'CN', TWN: 'TW',
  IND: 'IN', IDN: 'ID', THA: 'TH', VNM: 'VN', PHL: 'PH', SGP: 'SG',
  MYS: 'MY', ISR: 'IL', ARE: 'AE', SAU: 'SA', EGY: 'EG', ZAF: 'ZA',
  MAR: 'MA', TUN: 'TN', NGA: 'NG', KEN: 'KE',
};

/**
 * A country as alpha-2, from alpha-2, alpha-3 or nothing.
 *
 * Empty in, empty out: «unknown» is a real answer that the Meldeschein rule
 * treats differently from any country, and it must not be invented.
 */
export function alpha2(value: string | null | undefined): string {
  const raw = String(value ?? '').trim().toUpperCase();
  if (!raw) return '';
  if (raw.length === 2) return raw;
  if (raw.length === 3) return ALPHA3[raw] || raw;
  return raw;
}

/** True when both refer to the same country, whichever spelling each used. */
export function sameCountry(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = alpha2(a);
  const y = alpha2(b);
  return !!x && x === y;
}
