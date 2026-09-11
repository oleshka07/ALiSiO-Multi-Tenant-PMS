/**
 * How a folio was paid — the fact KassenSichV keeps asking about.
 *
 * Two questions only the DOCUMENT can answer, and until this table it could
 * answer neither: does this beleg need a TSE signature at all (cash and
 * card-at-the-desk do, a bank transfer does not), and which Zahlungsart goes
 * into the DSFinV-K export. `fin_operations.method` knows the word, but the
 * journal is not the beleg. TSE spec: docs/TSE-KASSENSICHV.md §6.4, Block A.
 *
 * THE GUARD, and why it refuses instead of warning: until `fiscal_de` is
 * enabled for a German organization, recording a cash or card-terminal
 * payment here would make this PMS the "elektronisches Aufzeichnungssystem"
 * of §146a AO — an unregistered till. The agreed transition is that on-site
 * money stays in the hotel's old system until TSE is live, so the refusal IS
 * the agreement, enforced. This is not a pilot hack: the next German hotel
 * gets the same refusal until its fiscal module is switched on.
 *
 * There is no deletePayment on purpose. A payment is a till movement; a
 * wrong one is corrected by a counter-entry with the opposite sign, the same
 * way an invoice is corrected by storno, and DSFinV-K expects exactly that.
 */
import { getSql } from '@core/db/async';
// `@core/http/refusal`, не `errors`: цей файл читають перевірки під ГОЛИМ
// node, а `errors.ts` тягне `next/server` (див. шапку refusal.ts, П3).
import { refuse } from '@core/http/refusal';
import { requireOrganizationId } from '@core/auth/tenant-context';
import { propertyOrSharedFilter, type PropertyScope } from '@core/property-scope';
import { hasFeature } from '@core/features';
import { integrationCredentials } from '@core/integration-credentials';
import type { FiscalDevice, FiscalSignature, VatAmount } from '../domain/fiscal/fiscal-device';
import { fiskalyDevice } from './fiskaly-sign-de';

export const PAYMENT_METHODS = ['cash', 'card_terminal', 'transfer', 'voucher'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** The methods that count toward the till — the ones §146a AO signs. */
export const TILL_METHODS: ReadonlySet<PaymentMethod> = new Set(['cash', 'card_terminal']);

/** Походження імпортованої оплати: система і її LNR. Інших джерел імпорту поки немає. */
export const IMPORT_ORIGIN = /^winhotel:\d+$/;

export interface FolioPayment {
  id: string;
  folio_id: string;
  property_id: string | null;
  invoice_id: string | null;
  amount: number;
  method: PaymentMethod;
  paid_at: string;
  received_by: string | null;
  /** `'import'` — перенесена з попередньої системи (З34); інакше null — наша каса. */
  source: 'import' | null;
  origin: string | null;
}

/**
 * `deps.device` exists for exactly one caller: the check, which must prove
 * the signing path without a live TSE. Production resolves fiskaly from the
 * organization's credentials and the property's fin_fiscal_settings.
 */
export async function recordPayment(input: {
  folioId: string;
  amount: number;
  /**
   * Клас. Можна не називати, якщо названо `methodId`: тоді він БЕРЕТЬСЯ з
   * рядка довідника, а не приймається поруч із ним.
   */
  method?: string;
  /** Рядок довідника способів оплати (0141, Д61). */
  methodId?: string | null;
  invoiceId?: string | null;
  paidAt?: string | null;
  receivedBy?: string | null;
  /**
   * `'import'` — оплата, перенесена з попередньої системи готелю (З34). Вона
   * вже підписана ТІЄЮ касою і в нашій не відбувалась, тому йде повз
   * фіскальну варту і не підписується — але лише з позначкою походження
   * `origin` виду `winhotel:<LNR>`: імпортна оплата без походження відмовляється,
   * інакше слово «import» стало б обхідним шляхом для будь-кого.
   */
  source?: 'import' | null;
  origin?: string | null;
}, deps?: { device?: FiscalDevice }): Promise<string> {
  const organizationId = await requireOrganizationId();
  const sql = getSql();

  // ── Злиття 11.09: ОБИДВІ правки цього місця чинні ──────────────────────
  //
  // Бета принесла довідник способів оплати (Д61) — клас береться з рядка, а
  // не приймається поруч. Ця гілка перевела кидання на названі відмови
  // (`refuse`, інваріант 6), бо глухий `throw` доїжджав до портьє як
  // {"error":"Failed"} / 500. Одна з двох відмов довідника була рівно серед
  // тих пʼяти, що не збігались зі списком візерунків у `folio.handlers`, —
  // тобто без цієї правки новий довідник успадкував би стару ваду з першого
  // ж дня.
  // ── Клас іде З РЯДКА, а не поруч із ним (Д61) ──────────────────────────
  //
  // Якби `method` і `method_id` приймались незалежно, вони б розійшлися: рядок
  // «Visa» з класом `card_terminal` і `method='transfer'` поруч дали б платіж,
  // який каса не бачить, а бухгалтерія числить карткою. Тому названий
  // `methodId` ВИЗНАЧАЄ клас, а `method` при ньому лише звіряється.
  //
  // Чужий або неіснуючий рядок — відмова, не мовчазний перехід на клас
  // (інваріант 13: не знайшли — відмовляємо).
  let method = String(input.method ?? '');
  let methodId: string | null = input.methodId ? String(input.methodId) : null;
  if (methodId) {
    const row = await sql.row<{ kind: string; is_active: unknown }>(
      'SELECT kind, is_active FROM fin_payment_methods WHERE id = ? AND organization_id = ?',
      [methodId, organizationId]);
    if (!row) refuse('Payment method not found', 409);
    if (input.method && String(input.method) !== String(row.kind)) {
      refuse(`Payment method «${row.kind}» does not match the class «${input.method}» given beside it`, 409);
    }
    method = String(row.kind);
  }

  if (!PAYMENT_METHODS.includes(method as PaymentMethod)) {
    refuse(`method must be one of ${PAYMENT_METHODS.join(', ')}`, 409);
  }
  const imported = input.source === 'import';
  if (input.source != null && !imported) refuse("source must be 'import' or absent", 409);
  if (imported && !IMPORT_ORIGIN.test(String(input.origin ?? ''))) {
    refuse('An imported payment must name its origin (winhotel:<LNR>) — without it the import label would bypass the till guard', 409);
  }
  if (!imported && input.origin) refuse('origin is only for imported payments', 409);
  const amount = Number(input.amount);
  // Zero is not a payment; negative IS one — cash handed back is a till
  // movement with its sign, not a deleted row.
  if (!Number.isFinite(amount) || amount === 0) {
    refuse('amount must be a non-zero number', 409);
  }

  // The folio's property: directly for a reservation-less folio (events),
  // through the stay otherwise. Both in one query so the answer cannot
  // disagree with the invoice's own jurisdiction resolution.
  const folio = await sql.row<any>(
    `SELECT f.id, COALESCE(r.property_id, f.property_id) AS property_id
       FROM fin_folios f
       LEFT JOIN reservations r ON r.id = f.reservation_id
      WHERE f.id = ? AND f.organization_id = ?`,
    [input.folioId, organizationId]);
  if (!folio) refuse('Folio not found', 409);

  let mustSign = false;
  // Дві правки одного рядка, і обидві чинні: імпортована оплата — не наш
  // касовий оборот (варту й підпис не проходить), а КЛАС береться з рядка
  // довідника (Д61), не з поля запиту.
  if (!imported && TILL_METHODS.has(method as PaymentMethod)) {
    // Cash belongs to a till and a till belongs to a property — that is
    // where §146a AO looks. A folio that does not know its property cannot
    // prove its till is NOT German, so it fails closed: organizations do not
    // carry a country, only properties do.
    if (!folio.property_id) {
      refuse('Cash and card payments need a folio with a property — the till belongs to a place', 409);
    }
    const place = await sql.row<any>(
      'SELECT country FROM properties WHERE id = ?', [folio.property_id]);
    const country = String(place?.country || '').toUpperCase();
    if (country === 'DE') {
      if (!(await hasFeature(organizationId, 'fiscal_de'))) {
        refuse(
          'Cash and card payments for a German property are still recorded in the old till system — the fiscal module (TSE) is not enabled yet', 409);
      }
      mustSign = true;
    }
  }

  if (input.invoiceId) {
    const inv = await sql.row<any>(
      'SELECT id FROM invoices WHERE id = ? AND organization_id = ?',
      [input.invoiceId, organizationId]);
    if (!inv) refuse('Invoice not found', 409);
  }

  // The beleg the guest receives IS the invoice — Belegausgabepflicht wants
  // a document at the moment of payment anyway, and its VAT split is the
  // only honest source for the receipt's tax buckets. A German cash payment
  // with no invoice would have to invent one, so it is refused instead.
  let vatAmounts: VatAmount[] = [];
  if (mustSign) {
    if (!input.invoiceId) {
      refuse('A German cash or card payment must name its invoice — the invoice is the beleg being signed', 409);
    }
    vatAmounts = (await sql.rows<any>(
      `SELECT vat_rate, gross_amount FROM fin_invoice_tax_totals
        WHERE invoice_id = ? AND organization_id = ?`,
      [input.invoiceId, organizationId]))
      .map((r) => ({ rate: Number(r.vat_rate), amount: Number(r.gross_amount) }));
  }

  // The signature is taken BEFORE the row exists and lands with it in one
  // INSERT: a beleg must never be handed out first and signed after. When
  // the TSE cannot be reached the payment still goes through — checkout is
  // never blocked — but loudly: tse_failed on the row, an entry in the
  // outage journal with both timestamps, and no signature fields invented.
  let signature: FiscalSignature | null = null;
  let tseStatus: string | null = null;
  if (mustSign) {
    const startedAt = new Date().toISOString();
    try {
      const device = deps?.device ?? await resolveFiskaly(organizationId, folio.property_id);
      signature = await device.signReceipt({
        amount, method: method as 'cash' | 'card_terminal', vatAmounts,
      });
      tseStatus = 'signed';
    } catch (e) {
      tseStatus = 'tse_failed';
      await sql.run(
        `INSERT INTO fin_fiscal_outages (id, organization_id, property_id, started_at, ended_at, note)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [crypto.randomUUID(), organizationId, folio.property_id, startedAt,
         new Date().toISOString(), (e instanceof Error ? e.message : 'TSE unavailable').slice(0, 500)]);
    }
  }

  const id = crypto.randomUUID();
  await sql.run(
    `INSERT INTO fin_folio_payments
       (id, organization_id, property_id, folio_id, invoice_id, amount, method, method_id, paid_at, received_by, source, origin,
        tse_status, tse_serial, tse_tx_number, tse_signature_counter, tse_signature,
        tse_start_time, tse_end_time, tse_qr_payload, tse_client_id, tse_process_type, tse_process_data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, organizationId, folio.property_id ?? null, input.folioId,
     input.invoiceId ?? null, amount, method, methodId,
     input.paidAt ?? null, input.receivedBy ?? null,
     imported ? 'import' : null, imported ? String(input.origin) : null,
     tseStatus,
     signature?.tseSerial ?? null, signature?.txNumber ?? null,
     signature?.signatureCounter ?? null, signature?.signature ?? null,
     signature?.startTime ?? null, signature?.endTime ?? null,
     signature?.qrPayload ?? null, signature?.clientId ?? null,
     signature?.processType ?? null, signature?.processData ?? null]);
  return id;
}

/** The unsigned till operations reception must see — acceptance §6.4 п.3. */
export async function unsignedPayments(scope: PropertyScope): Promise<FolioPayment[]> {
  const organizationId = await requireOrganizationId();
  // Каса стоїть у будинку (INC-029). Рецепція обʼєкта А, дивлячись на
  // непідписані операції обох, або підписує чуже, або лишає своє
  // непідписаним — і те, і те видно аж при перевірці.
  //
  // `propertyOrSharedFilter`: колонка нульова, і оплата без будинку при
  // звичайному фільтрі зникла б з обох списків (Д51).
  const axis = propertyOrSharedFilter(scope, '');
  return await getSql().rows<FolioPayment>(
    `SELECT * FROM fin_folio_payments
      WHERE organization_id = ? AND ${axis.sql} AND tse_status = 'tse_failed'
      ORDER BY paid_at DESC`,
    [organizationId, ...axis.params]);
}

/**
 * fiskaly from this organization's credentials and this property's TSE
 * identifiers. Anything missing throws — the caller turns that into
 * tse_failed + an outage entry, because a misconfigured till must be VISIBLE
 * at the desk, not a silent unsigned beleg.
 */
async function resolveFiskaly(organizationId: string, propertyId: string): Promise<FiscalDevice> {
  const sql = getSql();
  const creds = await integrationCredentials('fiskaly', organizationId);
  if (!creds?.clientId || !creds.clientSecret) {
    throw new Error('fiskaly credentials are not configured (Settings → Integrations)');
  }
  const settings = await sql.row<any>(
    'SELECT tss_id, tse_client_id FROM fin_fiscal_settings WHERE property_id = ? AND organization_id = ?',
    [propertyId, organizationId]);
  if (!settings?.tss_id || !settings?.tse_client_id) {
    throw new Error('TSE identifiers (tss_id, client_id) are not configured for this property');
  }
  return fiskalyDevice({
    apiKey: creds.clientId,
    apiSecret: creds.clientSecret,
    tssId: settings.tss_id,
    clientId: settings.tse_client_id,
  });
}

export async function listPayments(folioId: string): Promise<FolioPayment[]> {
  const organizationId = await requireOrganizationId();
  return await getSql().rows<FolioPayment>(
    `SELECT * FROM fin_folio_payments
      WHERE folio_id = ? AND organization_id = ?
      ORDER BY paid_at, created_at`,
    [folioId, organizationId]);
}
