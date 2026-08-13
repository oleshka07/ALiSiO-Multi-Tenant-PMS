/**
 * What an invoice number looks like — as a per-organization template.
 *
 * The shape was hardcoded: `${prefix}${year}-${seq padded to 3}`, which gives
 * `BKG-2026-001` and `2026-001`. That is one country's habit. The German pilot's
 * current system issues `22.421` — no prefix, no year, a plain running number.
 * A hotel cannot be told what its invoice numbers look like; that is a decision
 * its accountant already made, sometimes decades ago.
 *
 * So the shape becomes data. Tokens:
 *
 *   {prefix}   the series prefix, empty for a series that has none
 *   {year}     four digits
 *   {yy}       two digits
 *   {seq}      the counter, unpadded
 *   {seq:N}    the counter, zero-padded to N digits
 *
 * Anything else in the template is literal, so `RG-{year}/{seq:5}` and
 * `{seq}` are both valid and neither needs code.
 *
 * DELIBERATELY NOT SUPPORTED: digit grouping (`22.421`). Whether a new system
 * continues a previous system's run of numbers — and prints them the same way —
 * is a question for the customer's Steuerberater, not a formatting feature to
 * invent. Ask before building it.
 */

export interface NumberParts {
  prefix: string;
  year: number;
  seq: number;
}

/** The shape every existing invoice in this product already has. */
export const DEFAULT_TEMPLATE = '{prefix}{year}-{seq:3}';

export function formatInvoiceNumber(template: string, parts: NumberParts): string {
  return (template || DEFAULT_TEMPLATE).replace(
    /\{(prefix|year|yy|seq)(?::(\d+))?\}/g,
    (_all, token: string, pad?: string) => {
      switch (token) {
        case 'prefix': return parts.prefix ?? '';
        case 'year': return String(parts.year);
        case 'yy': return String(parts.year).slice(-2);
        case 'seq': return pad ? String(parts.seq).padStart(Number(pad), '0') : String(parts.seq);
        default: return '';
      }
    },
  );
}
