/**
 * Folding somebody else's contact form into the four columns we have.
 *
 * `public/widget/collector.js` is pasted into a hotel's own website and
 * serialises whatever form it finds there. That form was not written for us:
 * it is a Czech agency's block, a Wix widget, something hand-written in 2014.
 * The field is `jmeno` as often as `name` and `zprava` as often as `message`,
 * and it may well ask three questions we have never heard of.
 *
 * `site_incoming_leads` has exactly four content columns — full_name, email,
 * phone, message. It used to have `raw_data` and `source_url`; both are in the
 * dead-column registry because nothing ever read them, and they are gone from
 * the schema. So there is nowhere to put the leftovers except the message, and
 * that is what happens here: an unmatched field becomes a «label: value» line
 * rather than disappearing. Losing part of what a guest wrote is the same
 * failure as losing all of it, only harder to notice.
 *
 * Pure on purpose — no database, no request — so lead-form.check.ts can pin
 * the behaviour without a server.
 */

/** Must match `HP` in public/widget/collector.js. */
export const HONEYPOT = '_hp_trap';

/** Keys the collector adds itself; never guest content. */
const ENVELOPE = new Set(['siteid', 'sourceurl', HONEYPOT]);

/**
 * Matching on a list of known names in four languages is not elegant, and it
 * is still the right trade: the alternative is asking every hotel to rename
 * the inputs on its own website before its contact form starts working.
 */
const ALIASES: Record<'full_name' | 'email' | 'phone' | 'message', string[]> = {
  full_name: ['name', 'fullname', 'full_name', 'yourname', 'your_name',
    'jmeno', 'jméno', 'prijmeni', 'příjmení',
    'imya', 'імя', "ім'я", 'имя',
    'vorname', 'nachname'],
  email: ['email', 'e-mail', 'e_mail', 'mail', 'youremail', 'your_email',
    'emailaddress', 'email_address', 'posta', 'pošta', 'пошта', 'почта'],
  phone: ['phone', 'tel', 'telephone', 'telefon', 'mobile', 'mobil', 'cellphone',
    'phonenumber', 'phone_number', 'телефон'],
  message: ['message', 'msg', 'text', 'comment', 'comments', 'note', 'notes',
    'question', 'enquiry', 'inquiry', 'body',
    'zprava', 'zpráva', 'dotaz', 'poznamka', 'poznámka',
    'nachricht', 'anfrage', 'mitteilung',
    'повідомлення', 'запитання', 'сообщение'],
};

const normalise = (k: string) => k.toLowerCase().replace(/[\s\-]+/g, '');

const MATCH = new Map<string, keyof typeof ALIASES>();
for (const [column, names] of Object.entries(ALIASES)) {
  for (const n of names) MATCH.set(normalise(n), column as keyof typeof ALIASES);
}

const cap = (v: unknown, n: number) =>
  (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);

export type Lead = {
  full_name: string | null;
  email: string | null;
  phone: string | null;
  message: string | null;
};

/** True when the honeypot was filled in, which only a bot does. */
export function isTrapped(fields: Record<string, unknown>): boolean {
  const trap = fields[HONEYPOT];
  return typeof trap === 'string' && trap.trim() !== '';
}

/** Nothing to answer and nobody to answer to — a row like this is inbox noise. */
export function isEmptyLead(lead: Lead): boolean {
  return !lead.email && !lead.phone && !lead.message;
}

export function foldFormIntoLead(fields: Record<string, unknown>): Lead {
  const lead: Lead = { full_name: null, email: null, phone: null, message: null };
  const extras: string[] = [];
  const nameParts: string[] = [];

  for (const [rawKey, rawValue] of Object.entries(fields)) {
    const key = normalise(rawKey);
    if (ENVELOPE.has(key)) continue;
    const value = typeof rawValue === 'string' ? rawValue.trim() : '';
    if (!value) continue;

    const column = MATCH.get(key);
    if (!column) { extras.push(`${rawKey}: ${value}`); continue; }
    // Forms that split the name in two (`vorname` + `nachname`) are common.
    if (column === 'full_name') { nameParts.push(value); continue; }
    // First match wins: a form carrying both `message` and `note` keeps the
    // first and turns the second into an extra line, which is visible —
    // rather than overwriting what the guest typed above it.
    if (lead[column]) { extras.push(`${rawKey}: ${value}`); continue; }
    lead[column] = value;
  }

  if (nameParts.length) lead.full_name = nameParts.join(' ');

  const body = [lead.message, ...extras].filter(Boolean).join('\n');
  lead.message = body || null;

  return {
    full_name: cap(lead.full_name, 200),
    email: cap(lead.email, 254),
    phone: cap(lead.phone, 40),
    message: cap(lead.message, 5000),
  };
}
