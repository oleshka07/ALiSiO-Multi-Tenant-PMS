/**
 * Folios over HTTP: the running bill, and turning it into a document.
 *
 * `manage_documents`, not owner-only: adding a bar charge to a folio and
 * handing a guest their invoice are reception's job, twenty times a day. A
 * hotel where only the owner may print an invoice is a hotel where the owner
 * is on reception.
 *
 * That permission already exists and already governs invoices; a new one for
 * folios would mean every customer has to grant it before their staff can do
 * what they did yesterday.
 */
import { NextResponse } from 'next/server';
import { withPermission } from '@core/auth/session';
import { requestPropertyScope } from '@core/auth/property-scope';
import * as folios from '../data/folio.repo';
import * as payments from '../data/folio-payments.repo';
import { reservationFolioSummary } from '../data/folio-summary.repo';
import { postCatalogService } from '../data/stay-charges.repo';

/** An error a person should read, and one they should not. */
function refuse(e: unknown) {
  const message = e instanceof Error ? e.message : 'Failed';
  // These are decisions, not faults: the caller asked for something the rules
  // do not allow, and the sentence explains which rule.
  //
  // ⚠ Це список ВІЗЕРУНКІВ, а не властивість (AGENTS §3.2.1), і він уже
  // програв рівно тим способом, який там описаний: нова названа відмова
  // «Charge belongs to another payer» (0140) не збіглась із жодним рядком
  // списку, і екран показував «Failed» зі статусом 500 замість причини —
  // тобто портьє бачив ПОЛОМКУ там, де було правило. Виміряно, не помічено
  // очима: прогін тексту відмови через цей самий регулярний вираз.
  //
  // Правильна форма в проєкті вже є — `refuse(текст, статус)` при киданні і
  // `handleError(scope, err)` у `catch` (`@core/http`, інваріант 6, Ц43):
  // рід відмови називається НА МІСЦІ, і список тут стає непотрібним. Перехід
  // на неї означає переписати всі 12 місць кидання в `folio.repo.ts` — це
  // окрема зміна, і робиться вона цілком, а не по одному рядку. До того
  // список поповнюється разом із кожною новою відмовою, і НЕ мовчки.
  const expected = /not found|Nothing to invoice|is closed|already a reversal|already invoiced|is voided|different reservations|another payer|no payment terms|must be|old till system/i.test(message);
  if (!expected) console.error('[folio]', e);
  return NextResponse.json(
    { error: expected ? message : 'Failed' },
    { status: expected ? 409 : 500 },
  );
}

export const listFolios = withPermission('manage_documents', async (request: Request, _ctx, actor) => {
  const url = new URL(request.url);
  const reservationId = url.searchParams.get('reservation_id') || undefined;
  // The split-bill screen wants each folio with its open charges and its
  // invoices in one response; everything else keeps the flat list.
  if (reservationId && url.searchParams.get('overview') === '1') {
    return NextResponse.json({ folios: await folios.foliosOverview(reservationId) });
  }
  // Вкладка «Фінанси» картки броні (Блок 4): усі рядки, оплати, документи
  // і залишок кожного фоліо — одним запитом, з підсумком по броні.
  if (reservationId && url.searchParams.get('summary') === '1') {
    return NextResponse.json(await reservationFolioSummary(reservationId));
  }
  // Без броні це список УСІХ рахунків готелю, тож область приходить із запиту
  // (INC-029). З бронню вісь уже в ній, і область не звужує нічого зайвого.
  const scope = await requestPropertyScope(request, actor.organizationId);
  return NextResponse.json({ folios: await folios.listFolios(reservationId, scope) });
});

/** Move uninvoiced charges onto this folio — the verb behind splitting a bill. */
export const moveFolioCharges = withPermission('manage_documents', async (
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const body = await request.json().catch(() => ({})) as any;
  const itemIds = (Array.isArray(body.item_ids) ? body.item_ids : [])
    .map(String).filter(Boolean);
  if (!itemIds.length) {
    return NextResponse.json({ error: 'item_ids is required' }, { status: 400 });
  }
  try {
    return NextResponse.json({ moved: await folios.moveCharges(itemIds, id) });
  } catch (e) { return refuse(e); }
});

export const createFolio = withPermission('manage_documents', async (request: Request) => {
  const body = await request.json().catch(() => ({})) as any;
  const id = await folios.createFolio({
    reservationId: body.reservation_id ?? null,
    payerKind: body.payer_kind === 'company' ? 'company' : 'guest',
    payerName: body.payer_name ?? null,
    payerAddress: body.payer_address ?? null,
    payerVatNo: body.payer_vat_no ?? null,
    payerDebtorNo: body.payer_debtor_no ?? null,
    label: body.label ?? null,
  });
  return NextResponse.json({ id }, { status: 201 });
});

export const getFolioCharges = withPermission('manage_documents', async (
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  return NextResponse.json({ items: await folios.openCharges(id) });
});

export const addFolioCharges = withPermission('manage_documents', async (
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const body = await request.json().catch(() => ({})) as any;

  // Послуга з каталогу (Блок 4, вкладка «Фінанси»): картка називає послугу,
  // кількість і дату; назву, ціну і ставку ПДВ за датою бере база — ціни в
  // тілі запиту немає навмисно.
  if (body.service_id) {
    const serviceDate = String(body.service_date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) {
      return NextResponse.json({ error: 'service_date must be YYYY-MM-DD' }, { status: 400 });
    }
    const result = await postCatalogService({
      folioId: id, reservationId: body.reservation_id ?? null,
      serviceId: String(body.service_id), quantity: Number(body.quantity ?? 1), serviceDate,
    });
    if ('reason' in result) {
      const status = result.reason === 'no_folio' || result.reason === 'no_service' ? 404 : 409;
      return NextResponse.json({ error: result.reason, detail: result }, { status });
    }
    return NextResponse.json({ added: result.posted, gross: result.gross }, { status: 201 });
  }

  const raw = Array.isArray(body.items) ? body.items : [body];

  const charges = raw.map((c: any) => ({
    folioId: id,
    reservationId: c.reservation_id ?? null,
    serviceDate: String(c.service_date || '').slice(0, 10),
    kind: c.kind || 'manual',
    description: String(c.description || '').trim(),
    guestName: c.guest_name ?? null,
    unitCode: c.unit_code ?? null,
    quantity: Number(c.quantity ?? 1),
    unitPriceGross: Number(c.unit_price_gross ?? 0),
    totalGross: Number(c.total_gross ?? Number(c.quantity ?? 1) * Number(c.unit_price_gross ?? 0)),
    vatRate: Number(c.vat_rate ?? 0),
    source: c.source || 'manual',
  }));

  // A charge with no date has no VAT rate and no day report; a charge with no
  // description is a line the guest cannot dispute.
  for (const c of charges) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(c.serviceDate)) {
      return NextResponse.json({ error: 'service_date must be YYYY-MM-DD' }, { status: 400 });
    }
    if (!c.description) {
      return NextResponse.json({ error: 'description is required' }, { status: 400 });
    }
  }

  return NextResponse.json({ added: await folios.addCharges(charges) }, { status: 201 });
});

export const getFolioPayments = withPermission('manage_documents', async (
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  return NextResponse.json({ payments: await payments.listPayments(id) });
});

/**
 * Record how the folio was paid. This is where the fiscal guard lives: a
 * German property with the fiscal module off gets a refusal for cash and
 * card-at-the-desk, not a row — see folio-payments.repo.
 */
export const addFolioPayment = withPermission('manage_documents', async (
  request: Request,
  { params }: { params: Promise<{ id: string }> },
  actor,
) => {
  const { id } = await params;
  const body = await request.json().catch(() => ({})) as any;
  try {
    const paymentId = await payments.recordPayment({
      folioId: id,
      amount: Number(body.amount),
      method: String(body.method || ''),
      invoiceId: body.invoice_id ?? null,
      paidAt: body.paid_at ?? null,
      // Who took the money is the session's fact, never the client's claim.
      receivedBy: actor.user.id,
    });
    return NextResponse.json({ id: paymentId }, { status: 201 });
  } catch (e) { return refuse(e); }
});

export const issueFolioInvoice = withPermission('manage_documents', async (
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const body = await request.json().catch(() => ({})) as any;
  try {
    return NextResponse.json(await folios.issueInvoice({
      folioId: id, channel: body.channel ?? null, issueDate: body.issue_date,
    }), { status: 201 });
  } catch (e) { return refuse(e); }
});

export const stornoInvoice = withPermission('manage_documents', async (
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const body = await request.json().catch(() => ({})) as any;
  try {
    return NextResponse.json(await folios.stornoInvoice({
      invoiceId: id, channel: body.channel ?? null, issueDate: body.issue_date,
    }), { status: 201 });
  } catch (e) { return refuse(e); }
});
