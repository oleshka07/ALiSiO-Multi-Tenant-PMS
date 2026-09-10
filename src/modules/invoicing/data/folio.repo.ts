/**
 * Folios, their charges, and turning them into an invoice.
 *
 * The one operation worth reading carefully is `issueInvoice`. It does four
 * things that must happen together or not at all: take the next number from
 * the series, freeze the charges into invoice lines, write the recapitulation,
 * and mark the charges as invoiced. Any one of those happening without the
 * others leaves a legal document in an impossible state — a number with no
 * lines, or lines that can still be edited.
 */
import { getSql } from '@core/db/async';
import type { Sql } from '@core/db/async';
import { requireOrganizationId } from '@core/auth/tenant-context';
import { propertyOrSharedFilter, type PropertyScope } from '@core/property-scope';
import { recordPayment } from './folio-payments.repo';
import { allocateInvoiceNumber, isPeriodLocked, seriesForChannel, invoicePropertyId } from '../domain/invoice-numbering';
import { buildSnapshot, buildStorno, type FolioItem } from '../domain/invoice-snapshot';

/**
 * Будинок документа: бронь, а якщо її немає — сам рахунок (INC-038).
 *
 * Порядок той самий, що в `INVOICE_PROPERTY` нумератора, і це не збіг: два
 * місця, які відповідають на те саме питання по-різному, дають серію при
 * виписуванні і ІНШУ серію при закритті місяця. `fin_folios.property_id`
 * заповнюють лише рахункам без броні (подія, компанія) — у решти будинок
 * приходить із броні.
 */
async function folioProperty(
  sql: Sql,
  organizationId: string,
  folio: { reservation_id?: string | null; property_id?: string | null },
): Promise<string | null> {
  if (folio.reservation_id) {
    const res = await sql.row<{ property_id: string | null }>(
      'SELECT property_id FROM reservations WHERE id = ? AND organization_id = ?',
      [folio.reservation_id, organizationId]);
    if (res?.property_id) return res.property_id;
  }
  return folio.property_id ?? null;
}

export interface Folio {
  id: string;
  reservation_id: string | null;
  payer_kind: 'guest' | 'company';
  payer_name: string | null;
  status: 'open' | 'settled';
  label: string | null;
}

export async function listFolios(reservationId: string | undefined, scope: PropertyScope): Promise<Folio[]> {
  const organizationId = await requireOrganizationId();
  const sql = getSql();
  // Awaited, not returned as a promise from a ternary: check-await.mjs reads a
  // seam call without `await` as the bug it usually is, and being right nine
  // times out of ten is worth writing the tenth explicitly.
  if (reservationId) {
    return await sql.rows<Folio>(
      'SELECT * FROM fin_folios WHERE organization_id = ? AND reservation_id = ? ORDER BY created_at',
      [organizationId, reservationId]);
  }
  // Список УСІХ рахунків готелю — тут вісь обʼєкта і є (INC-029). Гілка вище
  // її не потребує: бронь уже визначає будинок.
  //
  // `propertyOrSharedFilter`, не `propertyScopeFilter`: `fin_folios.property_id`
  // НУЛЬОВИЙ, і рахунок без будинку (подія, рахунок компанії) при звичайному
  // фільтрі зник би з КОЖНОГО списку — гроші, яких не бачить ніхто. Ціна
  // вибору названа: такий рядок видно з обох обʼєктів (Д51).
  const axis = propertyOrSharedFilter(scope, '');
  return await sql.rows<Folio>(
    `SELECT * FROM fin_folios WHERE organization_id = ? AND ${axis.sql} ORDER BY created_at DESC`,
    [organizationId, ...axis.params]);
}

export async function createFolio(input: {
  reservationId?: string | null;
  /** For a folio with no reservation (events): where its invoice's jurisdiction comes from. */
  propertyId?: string | null;
  payerKind?: 'guest' | 'company';
  payerName?: string | null;
  payerAddress?: string | null;
  payerVatNo?: string | null;
  payerDebtorNo?: string | null;
  label?: string | null;
}): Promise<string> {
  const organizationId = await requireOrganizationId();
  const id = crypto.randomUUID();
  const currency = await resolveCurrency(organizationId, input.reservationId ?? null);
  await getSql().run(
    `INSERT INTO fin_folios
       (id, organization_id, reservation_id, property_id, payer_kind, payer_name, payer_address, payer_vat_no, payer_debtor_no, label, currency)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, organizationId, input.reservationId ?? null, input.propertyId ?? null, input.payerKind ?? 'guest',
     input.payerName ?? null, input.payerAddress ?? null, input.payerVatNo ?? null,
     input.payerDebtorNo ?? null, input.label ?? null, currency],
  );
  return id;
}

/**
 * Фоліо цієї броні — наявне або щойно створене (В3).
 *
 * Фоліо — єдина книга проживання, тож гроші, що прийшли за бронь, мають куди
 * лягти НАВІТЬ тоді, коли рецепція ще не відкривала вкладку «Фінанси». Доти
 * готівковий внесок жив у `fin_operations` поруч із книгою, і виселення
 * показувало повний борг при сплачених трьох тисячах.
 *
 * Перше за створенням, а не «якесь»: бронь із поділом рахунку між платниками
 * має кілька фоліо, і платіж без явного вибору належить тому, що відкрили
 * першим — інакше він щоразу потрапляв би в різні.
 */
export async function ensureReservationFolio(reservationId: string, t?: Sql): Promise<string> {
  const organizationId = await requireOrganizationId();
  const sql = t ?? getSql();
  const existing = await sql.row<{ id: string }>(
    'SELECT id FROM fin_folios WHERE organization_id = ? AND reservation_id = ? ORDER BY created_at ASC, id ASC LIMIT 1',
    [organizationId, reservationId]);
  if (existing) return String(existing.id);
  return createFolio({ reservationId });
}

/**
 * Записати платіж за бронь у фоліо — і НЕ лишити порожньої книги, якщо він
 * не записався.
 *
 * `ensureReservationFolio` + `recordPayment` двома кроками дали найгірше з
 * можливого на німецькому обʼєкті без TSE: фіскальна варта відмовляє готівці
 * навмисно (гроші там досі в старій касі), місток відмову ковтав — і по собі
 * лишалась ПОРОЖНЯ книга. А порожня книга відчиняла виселення боржникові, бо
 * борг із неї виходив нуль.
 *
 * Тому створення й запис — одні двері: не записалось, і книгу завели ми в
 * цьому ж виклику, і вона досі порожня — книгу прибрано, помилка піднята
 * вище. Наявне фоліо не чіпається ніколи: воно старше за цей виклик.
 */
export async function recordReservationPayment(input: {
  reservationId: string;
  amount: number;
  method: string;
  paidAt?: string | null;
  /** Імпорт із попередньої системи — повз фіскальну варту, з походженням (З34, `recordPayment`). */
  source?: 'import' | null;
  origin?: string | null;
}): Promise<{ paymentId: string; folioId: string }> {
  const organizationId = await requireOrganizationId();
  const sql = getSql();
  const before = await sql.row<{ id: string }>(
    'SELECT id FROM fin_folios WHERE organization_id = ? AND reservation_id = ? ORDER BY created_at ASC, id ASC LIMIT 1',
    [organizationId, input.reservationId]);
  const folioId = before ? String(before.id) : await createFolio({ reservationId: input.reservationId });
  try {
    const paymentId = await recordPayment({
      folioId, amount: input.amount, method: input.method, paidAt: input.paidAt ?? null,
      source: input.source ?? null, origin: input.origin ?? null,
    });
    return { paymentId, folioId };
  } catch (e) {
    if (!before) {
      const empty = await sql.row<{ n: number }>(
        `SELECT (SELECT COUNT(*) FROM fin_folio_items WHERE folio_id = ?)
              + (SELECT COUNT(*) FROM fin_folio_payments WHERE folio_id = ?) AS n`,
        [folioId, folioId]);
      if (Number(empty?.n) === 0) {
        await sql.run('DELETE FROM fin_folios WHERE id = ? AND organization_id = ?', [folioId, organizationId]);
      }
    }
    throw e;
  }
}

/**
 * Зняти з книги гостя ОДИН названий платіж — ЗУСТРІЧНИМ рядком.
 *
 * `fin_folio_payments` не має видалення за задумом: рахунок гостя не
 * переписується заднім числом, помилковий клік виправляється зустрічним
 * рядком. Але видалення фінансової операції чистило лише `fin_operations`, і
 * перерахунок далі бачив у фоліо гроші, яких уже ніде немає, — бронь
 * лишалась `paid`. Стан «гроші є в одній книзі й немає в іншій» виникав із
 * НОРМАЛЬНОЇ дії оператора, а не з падіння.
 *
 * Приймається ІДЕНТИФІКАТОР ПЛАТЕЖУ, не бронь із сумою (Р10.6). Стара форма
 * знімала «стільки-то з першого фоліо броні», і це було неправильно двічі:
 *   - викликач не мав чим довести, що ці гроші клав саме він, тож видалення
 *     ручної проводки бухгалтера забирало з рахунку гостя ЧУЖІ гроші;
 *   - `LIMIT 1` по фоліо знімав із першої книги, тоді як на роздільному
 *     рахунку платіж міг лежати в другій.
 * Названий рядок відповідає на обидва: знімається саме те, що клали, і саме
 * там, де воно лежить.
 *
 * Спосіб і документ зустрічного рядка беруться З ТОГО САМОГО платежу, а не
 * підставляються (`'cash'` тут стояло літералом). Це не косметика: німецький
 * обʼєкт з увімкненим `fiscal_de` вимагає для готівки назвати фактуру, тож
 * зустрічний рядок без неї не проходив НІКОЛИ — саме для сегмента, заради
 * якого фіскальний модуль і будується (Р10.8).
 *
 * Сума обмежена тим, що фоліо справді тримає: знімати більше, ніж там є,
 * означало б завести борг із повітря. Повторний виклик не знімає вдруге —
 * зустрічний рядок уже зменшив залишок.
 */
export async function reverseFolioPayment(folioPaymentId: string): Promise<number> {
  const organizationId = await requireOrganizationId();
  const sql = getSql();
  const row = await sql.row<{
    folio_id: string; amount: number; method: string; invoice_id: string | null; paid: number;
  }>(
    `SELECT p.folio_id AS folio_id, p.amount AS amount, p.method AS method, p.invoice_id AS invoice_id,
            COALESCE((SELECT SUM(q.amount) FROM fin_folio_payments q WHERE q.folio_id = p.folio_id), 0) AS paid
       FROM fin_folio_payments p
      WHERE p.id = ? AND p.organization_id = ?`,
    [folioPaymentId, organizationId]);
  if (!row) return 0;
  const held = Number(row.paid) || 0;
  const take = Math.min(Math.abs(Number(row.amount) || 0), held);
  if (!(take > 0)) return 0;
  await recordPayment({
    folioId: String(row.folio_id),
    amount: -take,
    method: String(row.method),
    invoiceId: row.invoice_id ?? undefined,
  });
  return take;
}

/**
 * Which money this folio counts.
 *
 * The reservation first — a booking taken in crowns is billed in crowns even
 * if the hotel later changes its default. Then the organization. Never a
 * literal: `?? 'EUR'` here is what handed a Czech hotel's guest a euro
 * invoice over a crown sum, silently, for every split bill and every hall.
 *
 * Frozen into the row at creation, so the answer cannot move under a document
 * that was already issued. Rows older than migration 0031 have NULL and are
 * resolved the same way at read time.
 */
export async function resolveCurrency(organizationId: string, reservationId: string | null): Promise<string> {
  const sql = getSql();
  if (reservationId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res: any = await sql.row<any>(
      'SELECT currency FROM reservations WHERE id = ? AND organization_id = ?',
      [reservationId, organizationId]);
    if (res?.currency) return String(res.currency);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const org: any = await sql.row<any>(
    'SELECT default_currency FROM organizations WHERE id = ?', [organizationId]);
  if (org?.default_currency) return String(org.default_currency);
  // Both empty means the organization row is broken, and guessing a currency
  // for a legal document is worse than refusing to write one.
  throw new Error(`No currency for organization ${organizationId}: set organizations.default_currency`);
}

export interface NewCharge {
  /**
   * Ідентифікатор рядка, коли він потрібен викликачу НАПЕРЕД.
   *
   * Зали посилаються на свій рядок зали (`event_bookings.hall_charge_item_id`),
   * щоб не виставити ту саму залу двічі. Дізнатись id постфактум ніяк:
   * запит «останній ручний рядок цього фоліо» вгадує, а не знає. Пропущено —
   * генерується тут, як і раніше.
   */
  id?: string;
  folioId: string;
  reservationId?: string | null;
  /** The order this came from, so posting the same one twice adds nothing. */
  serviceOrderId?: string | null;
  serviceDate: string;
  kind: 'lodging' | 'service' | 'fee' | 'city_tax' | 'manual';
  description: string;
  guestName?: string | null;
  unitCode?: string | null;
  quantity: number;
  unitPriceGross: number;
  totalGross: number;
  vatRate: number;
  source?: 'nightly' | 'ota_split' | 'manual' | 'restaurant' | 'import' | 'service';
}

/** Add charges to a folio. Several at once, because a split produces three. */
export async function addCharges(charges: readonly NewCharge[], t?: Sql): Promise<number> {
  if (charges.length === 0) return 0;
  const organizationId = await requireOrganizationId();
  const sql = t ?? getSql();
  for (const c of charges) {
    await sql.run(
      `INSERT INTO fin_folio_items
         (id, organization_id, folio_id, reservation_id, service_order_id, service_date, kind, description,
          guest_name, unit_code, quantity, unit_price_gross, total_gross, vat_rate, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [c.id ?? crypto.randomUUID(), organizationId, c.folioId, c.reservationId ?? null,
       c.serviceOrderId ?? null, c.serviceDate,
       c.kind, c.description, c.guestName ?? null, c.unitCode ?? null, c.quantity,
       c.unitPriceGross, c.totalGross, c.vatRate, c.source ?? 'manual'],
    );
  }
  return charges.length;
}

/** Charges on a folio that no invoice has taken yet. */
export async function openCharges(folioId: string, t?: Sql): Promise<FolioItem[]> {
  const organizationId = await requireOrganizationId();
  return (t ?? getSql()).rows<FolioItem>(
    `SELECT id, service_date, description, guest_name, unit_code,
            quantity, unit_price_gross, total_gross, vat_rate
       FROM fin_folio_items
      WHERE organization_id = ? AND folio_id = ? AND invoice_id IS NULL AND voided_by_item_id IS NULL
      ORDER BY service_date, created_at`,
    [organizationId, folioId],
  );
}

/**
 * Move uninvoiced charges onto another folio of the same stay.
 *
 * This is the verb behind splitting a bill: the room's charges land on one
 * folio, reception drags half of them onto the second payer's, each folio
 * becomes its own invoice. Only the folio_id moves — amounts, dates and VAT
 * stay exactly as posted, because splitting who PAYS must not be able to
 * change what is OWED.
 *
 * Refused, not filtered, when a charge is already invoiced: its line is frozen
 * under a numbered document, and silently skipping it would leave reception
 * believing the guest's share moved when part of it did not.
 */
export async function moveCharges(itemIds: readonly string[], toFolioId: string): Promise<number> {
  const organizationId = await requireOrganizationId();
  const sql = getSql();
  if (!itemIds.length) return 0;

  const target = await sql.row<any>(
    'SELECT id, reservation_id FROM fin_folios WHERE id = ? AND organization_id = ?',
    [toFolioId, organizationId]);
  if (!target) throw new Error('Folio not found');

  let moved = 0;
  await sql.tx(async (t) => {
    for (const itemId of itemIds) {
      const item = await t.row<any>(
        `SELECT id, folio_id, reservation_id, invoice_id, voided_by_item_id
           FROM fin_folio_items WHERE id = ? AND organization_id = ?`,
        [itemId, organizationId]);
      if (!item) throw new Error('Charge not found');
      if (item.invoice_id) throw new Error('Charge is already invoiced — storno the invoice first');
      if (item.voided_by_item_id) throw new Error('Charge is voided');
      // Same stay on both sides. Money moving between two bookings' bills is
      // not a split, it is a transfer nobody asked for.
      if (item.reservation_id && target.reservation_id
          && item.reservation_id !== target.reservation_id) {
        throw new Error('Charge and folio belong to different reservations');
      }
      await t.run(
        'UPDATE fin_folio_items SET folio_id = ? WHERE id = ? AND organization_id = ?',
        [toFolioId, itemId, organizationId]);
      moved += 1;
    }
  });
  return moved;
}

/**
 * Everything the split-bill screen needs about one stay, in one query burst:
 * each folio with its payer, its still-open charges and the invoices already
 * raised from it. The alternative — the UI stitching this from three endpoints
 * per folio — is N+1 over HTTP with loading flicker as the failure mode.
 */
export async function foliosOverview(reservationId: string): Promise<Array<Folio & {
  openGross: number;
  openItems: FolioItem[];
  invoices: Array<{ id: string; invoice_number: string; status: string; amount: number }>;
}>> {
  const organizationId = await requireOrganizationId();
  const sql = getSql();
  const heads = await sql.rows<Folio>(
    'SELECT * FROM fin_folios WHERE organization_id = ? AND reservation_id = ? ORDER BY created_at',
    [organizationId, reservationId]);

  const out = [];
  for (const folio of heads) {
    const openItems = await openCharges(folio.id);
    const invoices = await sql.rows<any>(
      `SELECT id, invoice_number, status, amount FROM invoices
        WHERE organization_id = ? AND folio_id = ? ORDER BY issued_at, invoice_number`,
      [organizationId, folio.id]);
    out.push({
      ...folio,
      openItems,
      openGross: Math.round(openItems.reduce((s, i) => s + Number(i.total_gross), 0) * 100) / 100,
      invoices: invoices.map((i: any) => ({ ...i, amount: Number(i.amount) })),
    });
  }
  return out;
}

export interface IssueResult {
  invoiceId: string;
  invoiceNumber: string;
  series: string;
  gross: number;
  lines: number;
}

/**
 * Freeze a folio into an invoice.
 *
 * Refuses, rather than half-succeeds, on three things:
 *
 *   - nothing to invoice. An invoice with no lines is a number burned out of a
 *     legal sequence for nothing;
 *   - the accounting month is locked. That is the whole point of locking it:
 *     after the monthly export, corrections go through a storno, not through a
 *     new document slipped into a closed period;
 *   - anything failing mid-way. All four writes are one transaction, so a
 *     number is never allocated without the lines that justify it.
 */
export async function issueInvoice(input: {
  folioId: string;
  channel?: string | null;
  issueDate?: string;
}): Promise<IssueResult> {
  const organizationId = await requireOrganizationId();
  const sql = getSql();
  const issueDate = input.issueDate ?? new Date().toISOString().slice(0, 10);
  const month = issueDate.slice(0, 7);
  const year = Number(issueDate.slice(0, 4));

  const folio = await sql.row<any>(
    'SELECT * FROM fin_folios WHERE id = ? AND organization_id = ?',
    [input.folioId, organizationId]);
  if (!folio) throw new Error('Folio not found');

  const items = await openCharges(input.folioId);
  if (items.length === 0) throw new Error('Nothing to invoice on this folio');

  // Будинок документа — до першого питання про серію: і серія, і замок місяця
  // тепер належать обʼєктові (INC-038, Д54).
  const property = await folioProperty(sql, organizationId, folio);

  const { series } = seriesForChannel(input.channel);
  if (await isPeriodLocked(sql, organizationId, property, series, month)) {
    throw new Error(`The accounting month ${month} is closed — issue a storno instead`);
  }

  const snapshot = buildSnapshot(items);
  // The folio's own answer if it has one; a folio older than migration 0031
  // resolves it now, from its reservation and then its organization.
  const invoiceCurrency = folio.currency
    ? String(folio.currency)
    : await resolveCurrency(organizationId, folio.reservation_id ?? null);
  const invoiceId = crypto.randomUUID();
  let number = '';
  let allocatedSeries = '';

  await sql.tx(async (t) => {
    const allocated = await allocateInvoiceNumber(t, organizationId, property, input.channel ?? 'house', year);
    number = allocated.invoiceNumber;
    allocatedSeries = allocated.series;

    await t.run(
      // folio_id, not only reservation_id. The reservation says which room the
      // charges came from; the folio says whose document this is. When two
      // guests split one room, that is the only thing telling their invoices
      // apart — and the only thing stopping a correction to one of them from
      // cancelling the other.
      `INSERT INTO invoices (id, organization_id, invoice_number, issued_at, amount, currency, status, reservation_id, folio_id)
       VALUES (?, ?, ?, ?, ?, ?, 'issued', ?, ?)`,
      [invoiceId, organizationId, number, issueDate, snapshot.gross,
       invoiceCurrency, folio.reservation_id, folio.id],
    );

    for (const l of snapshot.lines) {
      await t.run(
        `INSERT INTO fin_invoice_lines
           (id, organization_id, invoice_id, position, service_date, description, guest_name, unit_code,
            quantity, unit_price_gross, total_gross, net_amount, tax_amount, vat_rate, source_item_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [crypto.randomUUID(), organizationId, invoiceId, l.position, l.service_date, l.description,
         l.guest_name, l.unit_code, l.quantity, l.unit_price_gross, l.total_gross,
         l.net_amount, l.tax_amount, l.vat_rate, l.source_item_id],
      );
    }

    for (const g of snapshot.taxTotals) {
      await t.run(
        `INSERT INTO fin_invoice_tax_totals
           (id, organization_id, invoice_id, vat_rate, gross_amount, net_amount, tax_amount)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [crypto.randomUUID(), organizationId, invoiceId, g.vat_rate,
         g.gross_amount, g.net_amount, g.tax_amount],
      );
    }

    // The charges are taken. Anything added to the folio after this belongs to
    // the next invoice, which is what makes a mid-stay invoice possible.
    for (const item of items) {
      await t.run(
        'UPDATE fin_folio_items SET invoice_id = ? WHERE id = ? AND organization_id = ?',
        [invoiceId, item.id, organizationId],
      );
    }
  });

  return {
    invoiceId,
    invoiceNumber: number,
    series: allocatedSeries,
    gross: snapshot.gross,
    lines: snapshot.lines.length,
  };
}

/**
 * Reverse an issued invoice.
 *
 * The original is never touched: it keeps its number, its lines and its place
 * in the sequence. The storno is a second document with its own number and
 * mirrored amounts, and the charges it releases become invoiceable again — so
 * a corrected invoice is "storno, fix the folio, issue again", three visible
 * steps rather than one silent edit.
 */
export async function stornoInvoice(input: {
  invoiceId: string;
  channel?: string | null;
  issueDate?: string;
}): Promise<IssueResult> {
  const organizationId = await requireOrganizationId();
  const sql = getSql();
  const issueDate = input.issueDate ?? new Date().toISOString().slice(0, 10);
  const year = Number(issueDate.slice(0, 4));

  const original = await sql.row<any>(
    'SELECT * FROM invoices WHERE id = ? AND organization_id = ?',
    [input.invoiceId, organizationId]);
  if (!original) throw new Error('Invoice not found');
  if (original.status === 'storno') throw new Error('This invoice is already a reversal');

  const lines = await sql.rows<any>(
    `SELECT position, service_date, description, guest_name, unit_code, quantity,
            unit_price_gross, total_gross, net_amount, tax_amount, vat_rate, source_item_id
       FROM fin_invoice_lines WHERE invoice_id = ? AND organization_id = ? ORDER BY position`,
    [input.invoiceId, organizationId]);
  const totals = await sql.rows<any>(
    'SELECT vat_rate, gross_amount, net_amount, tax_amount FROM fin_invoice_tax_totals WHERE invoice_id = ? AND organization_id = ?',
    [input.invoiceId, organizationId]);

  const mirrored = buildStorno({
    lines: lines.map((l) => ({ ...l, quantity: Number(l.quantity) })),
    taxTotals: totals.map((t) => ({
      vat_rate: Number(t.vat_rate), gross_amount: Number(t.gross_amount),
      net_amount: Number(t.net_amount), tax_amount: Number(t.tax_amount),
    })),
    gross: Number(original.amount), net: 0, tax: 0,
  });

  const stornoId = crypto.randomUUID();
  let number = '';
  let series = '';

  // Сторно належить будинкові того документа, який воно скасовує: інша серія
  // тут означала б виправлення, що не сходиться з виправленим.
  const property = await invoicePropertyId(sql, organizationId, input.invoiceId);

  await sql.tx(async (t) => {
    const allocated = await allocateInvoiceNumber(t, organizationId, property, input.channel ?? 'house', year);
    number = allocated.invoiceNumber;
    series = allocated.series;

    await t.run(
      // The reversal inherits the folio of what it reverses: a credit note for
      // one guest belongs to that guest's document trail, not to the room's.
      `INSERT INTO invoices (id, organization_id, invoice_number, issued_at, amount, currency, status, reservation_id, folio_id, corrects_invoice_id)
       VALUES (?, ?, ?, ?, ?, ?, 'storno', ?, ?, ?)`,
      // NOT `?? 'EUR'`. A reversal must be denominated in exactly what it
      // reverses; `invoices.currency` is NOT NULL, so a missing value here
      // means the original row is broken, and quietly stamping euro on a
      // credit note is how the same mistake would survive in the correction
      // that was supposed to fix it.
      [stornoId, organizationId, number, issueDate, mirrored.gross,
       original.currency, original.reservation_id, original.folio_id ?? null, input.invoiceId],
    );

    for (const l of mirrored.lines) {
      await t.run(
        `INSERT INTO fin_invoice_lines
           (id, organization_id, invoice_id, position, service_date, description, guest_name, unit_code,
            quantity, unit_price_gross, total_gross, net_amount, tax_amount, vat_rate, source_item_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [crypto.randomUUID(), organizationId, stornoId, l.position, l.service_date, l.description,
         l.guest_name, l.unit_code, l.quantity, l.unit_price_gross, l.total_gross,
         l.net_amount, l.tax_amount, l.vat_rate, l.source_item_id],
      );
    }
    for (const g of mirrored.taxTotals) {
      await t.run(
        `INSERT INTO fin_invoice_tax_totals
           (id, organization_id, invoice_id, vat_rate, gross_amount, net_amount, tax_amount)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [crypto.randomUUID(), organizationId, stornoId, g.vat_rate,
         g.gross_amount, g.net_amount, g.tax_amount],
      );
    }

    // The original is marked, not modified: its number and lines stay exactly
    // as they were printed.
    await t.run(
      "UPDATE invoices SET status = 'corrected' WHERE id = ? AND organization_id = ?",
      [input.invoiceId, organizationId]);

    // And its charges go back on the folio, free to be invoiced again.
    await t.run(
      'UPDATE fin_folio_items SET invoice_id = NULL WHERE invoice_id = ? AND organization_id = ?',
      [input.invoiceId, organizationId]);
  });

  return { invoiceId: stornoId, invoiceNumber: number, series, gross: mirrored.gross, lines: mirrored.lines.length };
}
