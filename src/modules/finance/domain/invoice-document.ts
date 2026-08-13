/**
 * What an invoice must say, before anything decides how it looks.
 *
 * The existing generator is a Czech document with `cs-CZ` formatting and Czech
 * labels baked into 575 lines of layout. Adding German by branching inside it
 * would produce a file where two countries' rules are interleaved and neither
 * can be read.
 *
 * So the content is assembled here and the layout consumes it. This module
 * knows the LAW — which fields §14 UStG requires, when a simplified invoice is
 * allowed, how the recapitulation is laid out — and nothing about millimetres.
 *
 * The locale comes from the organization, never from the operator's interface
 * language: a Czech accountant filing a German hotel's invoice must see the
 * same document the German tax office does. That separation is already a CI
 * gate (check-i18n-leak).
 */

export type InvoiceLocale = 'de-DE' | 'cs-CZ' | 'en-GB';

export interface Party {
  name: string;
  address?: string | null;
  /** Steuernummer (DE) / DIČ (CZ) — the tax number the invoice must print. */
  taxNumber?: string | null;
  /** USt-IdNr / VAT ID for cross-border supplies. */
  vatId?: string | null;
  registrationNo?: string | null;
  iban?: string | null;
  bankName?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface DocumentLine {
  position: number;
  service_date: string;
  description: string;
  guest_name?: string | null;
  unit_code?: string | null;
  quantity: number;
  unit_price_gross: number;
  total_gross: number;
  net_amount: number;
  tax_amount: number;
  vat_rate: number;
}

export interface DocumentTaxTotal {
  vat_rate: number;
  gross_amount: number;
  net_amount: number;
  tax_amount: number;
}

export interface InvoiceDocumentInput {
  number: string;
  issueDate: string;
  /** Period of supply — check-in to check-out. §14 requires it. */
  serviceFrom?: string | null;
  serviceTo?: string | null;
  status: 'issued' | 'storno' | 'corrected' | 'cancelled';
  correctsNumber?: string | null;
  currency: string;
  locale: InvoiceLocale;
  seller: Party;
  buyer?: Party | null;
  lines: DocumentLine[];
  taxTotals: DocumentTaxTotal[];
  paid?: number;
  /** Gross above which a simplified invoice is no longer allowed. */
  smallAmountLimit?: number | null;
}

export interface InvoiceDocument extends InvoiceDocumentInput {
  gross: number;
  net: number;
  tax: number;
  outstanding: number;
  /** §33 UStDV: below the limit, buyer details may be omitted. */
  isSmallAmount: boolean;
  labels: Labels;
  formatMoney(n: number): string;
  formatDate(iso: string): string;
}

export interface Labels {
  invoice: string;
  storno: string;
  number: string;
  issueDate: string;
  servicePeriod: string;
  seller: string;
  buyer: string;
  taxNumber: string;
  vatId: string;
  position: string;
  description: string;
  guest: string;
  room: string;
  serviceDate: string;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
  vatRate: string;
  recap: string;
  net: string;
  tax: string;
  gross: string;
  total: string;
  paid: string;
  outstanding: string;
  reverses: string;
  smallAmountNote: string;
}

const LABELS: Record<InvoiceLocale, Labels> = {
  'de-DE': {
    invoice: 'Rechnung', storno: 'Stornorechnung', number: 'Rechnungsnummer',
    issueDate: 'Rechnungsdatum', servicePeriod: 'Leistungszeitraum',
    seller: 'Rechnungssteller', buyer: 'Rechnungsempfänger',
    taxNumber: 'Steuernummer', vatId: 'USt-IdNr.',
    position: 'Pos.', description: 'Bezeichnung', guest: 'Gastname', room: 'Zi-Nr',
    serviceDate: 'Leist-Datum', quantity: 'Menge', unitPrice: 'Einzelpreis',
    lineTotal: 'Betrag', vatRate: 'MwSt',
    recap: 'MwSt-Übersicht', net: 'Netto', tax: 'MwSt-Betrag', gross: 'Brutto',
    total: 'Gesamtbetrag', paid: 'Zahlungen', outstanding: 'Offener Betrag',
    reverses: 'Storniert Rechnung',
    smallAmountNote: 'Kleinbetragsrechnung gemäß § 33 UStDV',
  },
  'cs-CZ': {
    invoice: 'Faktura', storno: 'Opravný daňový doklad', number: 'Číslo dokladu',
    issueDate: 'Datum vystavení', servicePeriod: 'Období plnění',
    seller: 'Dodavatel', buyer: 'Odběratel',
    taxNumber: 'DIČ', vatId: 'DIČ',
    position: 'Poz.', description: 'Popis', guest: 'Host', room: 'Pokoj',
    serviceDate: 'Datum plnění', quantity: 'Množství', unitPrice: 'Cena za j.',
    lineTotal: 'Částka', vatRate: 'DPH',
    recap: 'Rekapitulace DPH', net: 'Základ', tax: 'DPH', gross: 'Celkem',
    total: 'Celkem k úhradě', paid: 'Uhrazeno', outstanding: 'Zbývá uhradit',
    reverses: 'Opravuje doklad',
    smallAmountNote: 'Zjednodušený daňový doklad',
  },
  'en-GB': {
    invoice: 'Invoice', storno: 'Credit note', number: 'Invoice number',
    issueDate: 'Invoice date', servicePeriod: 'Period of supply',
    seller: 'Supplier', buyer: 'Customer',
    taxNumber: 'Tax number', vatId: 'VAT ID',
    position: 'No.', description: 'Description', guest: 'Guest', room: 'Room',
    serviceDate: 'Supply date', quantity: 'Qty', unitPrice: 'Unit price',
    lineTotal: 'Amount', vatRate: 'VAT',
    recap: 'VAT summary', net: 'Net', tax: 'VAT', gross: 'Gross',
    total: 'Total', paid: 'Paid', outstanding: 'Outstanding',
    reverses: 'Reverses invoice',
    smallAmountNote: 'Simplified invoice',
  },
};

/**
 * Assemble the document.
 *
 * The totals come from the tax groups, not from adding the lines — the two
 * differ by a cent and the group figure is the one the tax office has seen.
 * See invoice-vat.ts.
 */
export function buildInvoiceDocument(input: InvoiceDocumentInput): InvoiceDocument {
  const gross = round(input.taxTotals.reduce((s, t) => s + t.gross_amount, 0));
  const net = round(input.taxTotals.reduce((s, t) => s + t.net_amount, 0));
  const tax = round(input.taxTotals.reduce((s, t) => s + t.tax_amount, 0));
  const paid = round(input.paid ?? 0);

  // §33 UStDV applies to the gross of the document, and only where the
  // organization has set a limit. No limit means the simplified form is not
  // available in this jurisdiction — Czechia has no equivalent.
  const limit = input.smallAmountLimit ?? null;
  const isSmallAmount = limit != null && Math.abs(gross) <= limit;

  const locale = input.locale;
  const nf = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });

  return {
    ...input,
    gross, net, tax,
    outstanding: round(gross - paid),
    isSmallAmount,
    labels: LABELS[locale] ?? LABELS['en-GB'],
    formatMoney: (n: number) => `${nf.format(n)} ${input.currency}`,
    formatDate: (iso: string) => formatDate(iso, locale),
  };
}

/**
 * Which §14 UStG fields are missing.
 *
 * Returns names, not a boolean: an invoice refused for "incomplete" tells the
 * operator nothing, and this list is what the message should say. Empty means
 * the document may be issued.
 *
 * Only enforced for de-DE. Other jurisdictions have their own lists, and
 * asserting Germany's against a Czech document would refuse valid invoices.
 */
export function missingMandatoryFields(doc: InvoiceDocument): string[] {
  if (doc.locale !== 'de-DE') return [];
  const missing: string[] = [];

  if (!doc.seller.name) missing.push('seller.name');
  if (!doc.seller.address) missing.push('seller.address');
  // §14 Abs. 4 Nr. 2: the Steuernummer OR the USt-IdNr, not necessarily both.
  if (!doc.seller.taxNumber && !doc.seller.vatId) missing.push('seller.taxNumber/vatId');
  if (!doc.number) missing.push('number');
  if (!doc.issueDate) missing.push('issueDate');
  if (!doc.lines.length) missing.push('lines');
  if (!doc.taxTotals.length) missing.push('taxTotals');
  // The period of supply is mandatory and is the field most often forgotten,
  // because a hotel invoice "obviously" covers the stay.
  if (!doc.serviceFrom && !doc.lines.some((l) => l.service_date)) missing.push('servicePeriod');

  // A simplified invoice may omit the buyer; a full one may not.
  if (!doc.isSmallAmount) {
    if (!doc.buyer?.name) missing.push('buyer.name');
    if (!doc.buyer?.address) missing.push('buyer.address');
  }

  return missing;
}

function round(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function formatDate(iso: string, locale: InvoiceLocale): string {
  const d = String(iso).slice(0, 10);
  const [y, m, day] = d.split('-');
  if (!y || !m || !day) return d;
  // Written out rather than via Intl: a date on a legal document must not
  // depend on which ICU data the server was built with.
  if (locale === 'de-DE') return `${day}.${m}.${y}`;
  if (locale === 'cs-CZ') return `${Number(day)}. ${Number(m)}. ${y}`;
  return `${day}/${m}/${y}`;
}
