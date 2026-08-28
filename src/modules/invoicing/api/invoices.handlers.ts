/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * ALiSiO ERP — Invoice Handlers (Finance Module)
 *
 * Generates and serves Faktury (invoices) for paid reservations.
 * For an issuer that is not a VAT payer (neplátce DPH),
 * so these are regular Faktury, not Daňové doklady.
 *
 * Auto-trigger: called from payments.handlers.ts and reservation.handlers.ts
 * when reservation.payment_status transitions to 'paid'.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { renderInvoiceHtml, type InvoiceData } from '@/modules/invoicing/domain/invoice-template';
import { convertToCzkAuto, foreignNote } from '@/modules/invoicing/domain/fx';
import { allocateInvoiceNumber, isInvoiceLocked } from '@/modules/invoicing/domain/invoice-numbering';
import type { Actor } from '@core/auth/session';
import {
  generateInvoiceForReservation,
  reissueInvoiceForReservation,
  resolveDocumentDate,
} from '@/modules/invoicing/data/reservation-invoice.repo';
import { loadInvoiceDocument } from '@/modules/invoicing/data/invoice-document.repo';
import { generateGermanInvoicePdf } from '@/modules/invoicing/domain/invoice-pdf-de';

// `currency` у цих рядках — NOT NULL (invoices, fin_operations, reservations:
// усі три `TEXT NOT NULL`), тож `|| 'CZK'` тут не спрацьовував ніколи. Він не
// був захистом — він був схожий на рішення: читач бачив «якщо валюти немає,
// це крони» і вірив, що такий випадок буває. Прибрано, щоб у коді лишилось
// рівно одне джерело валюти документа — сам рядок.

// Raising and replacing a stay's invoice moved to data/reservation-invoice.repo.ts:
// none of it needs a request or a response, and behind this module's
// `next/server` import it could not be reached by a self-check run under bare
// node. Re-exported so every caller and the module's public surface (@finance)
// stay exactly as they were.
export {
  generateInvoiceForReservation,
  reissueInvoiceForReservation,
  resolveDocumentDate,
};

// ─── API Handlers ─────────────────────────────────────────────────────────────

/**
 * GET /api/invoices — list all invoices
 */
export async function listInvoices(_request: NextRequest, _ctx: unknown, actor: Actor): Promise<NextResponse> {
  try {
    const sql = getSql();
    const rows = await sql.rows<any>(`
      SELECT
        i.id, i.invoice_number, i.issued_at, i.due_date,
        i.amount, i.currency, i.status, i.reservation_id,
        g.first_name as guest_first_name, g.last_name as guest_last_name,
        u.name as unit_name
      FROM invoices i
      JOIN reservations r ON i.reservation_id = r.id
      JOIN guests g ON r.guest_id = g.id
      JOIN units u ON r.unit_id = u.id
      WHERE i.organization_id = ?
      ORDER BY i.issued_at DESC, i.invoice_number DESC
      LIMIT 200
    `, [actor.organizationId]);
    return NextResponse.json(rows);
  } catch (e: any) {
    console.error('[Invoices] listInvoices error:', e.message);
    return NextResponse.json({ error: 'Failed to fetch invoices' }, { status: 500 });
  }
}

/**
 * GET /api/invoices/[id] — render invoice as HTML (for browser view/print/PDF)
 * ?format=download — serve as attachment
 */
export async function getInvoiceHtml(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
  actor: Actor,
): Promise<NextResponse> {
  try {
    const sql = getSql();
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const asDownload = searchParams.get('format') === 'download';

    // The view button opens this route in a browser tab. A German property's
    // invoice has no HTML form — its document is the §14 PDF — so the tab gets
    // the PDF inline instead of a Czech template filled with German data.
    // Everything the assembler cannot answer honestly (no lines, no property)
    // returns null here and renders through the legacy HTML below.
    const deDoc = await loadInvoiceDocument(id);
    if (deDoc && deDoc.locale === 'de-DE') {
      const pdf = await generateGermanInvoicePdf(deDoc);
      return new NextResponse(new Uint8Array(pdf), {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `${asDownload ? 'attachment' : 'inline'}; filename="rechnung-${deDoc.number}.pdf"`,
          'Cache-Control': 'no-store',
        },
      });
    }

    // LEFT JOIN units/guests so a deleted unit or guest doesn't drop the entire
    // row and turn into a misleading 404. The template tolerates null fields.
    const data = await sql.row<any>(`
      SELECT
        i.id, i.invoice_number, i.issued_at, i.due_date,
        i.amount, i.currency, i.status, i.reservation_id,
        r.check_in, r.check_out, r.nights, r.adults, r.children,
        u.name as unit_name, u.code as unit_code,
        g.first_name as guest_first_name, g.last_name as guest_last_name,
        g.email as guest_email,
        COALESCE(NULLIF(g.address,''), rg.address) as guest_address,
        COALESCE(NULLIF(g.city,''),    rg.city)    as guest_city,
        COALESCE(NULLIF(g.country,''),rg.country)  as guest_country,
        r.invoice_company_name, r.invoice_company_ico, r.invoice_company_dic,
        r.invoice_company_address, r.invoice_company_city, r.invoice_company_country,
        r.invoice_company_email,
        p.method as payment_method, NULL as payment_notes, p.paid_at as payment_date
      FROM invoices i
      JOIN reservations r ON i.reservation_id = r.id
      LEFT JOIN units u ON r.unit_id = u.id
      LEFT JOIN guests g ON r.guest_id = g.id
      LEFT JOIN (
        SELECT gr.reservation_id,
               rg2.address, rg2.city, rg2.country
        FROM guest_registrations gr
        JOIN guests rg2 ON gr.guest_id = rg2.id
        WHERE (rg2.address IS NOT NULL AND rg2.address != '')
           OR (rg2.city IS NOT NULL AND rg2.city != '')
        ORDER BY gr.registered_at ASC
        LIMIT 1
      ) rg ON rg.reservation_id = r.id
      -- Оплата — з fin_folio_payments, а НЕ з fin_operations.
      --
      -- Тут стояв журнал обліку, і це був єдиний рядок у всьому
      -- фактуруванні, який туди заглядав. Він же й неправильний: журнал
      -- обліку знає бронь, а не фактуру, тож при двох фактурах на одну
      -- бронь (наприклад, депозит і решта) обидві отримували ОДНУ й ту саму
      -- останню оплату. fin_folio_payments має invoice_id — прямий
      -- звʼязок із документом, за яким платили.
      --
      -- Побічно це і є шов між модулями: після нього фактурування не читає
      -- жодної таблиці обліку, і облік можна вимкнути, не зачепивши фактур.
      LEFT JOIN fin_folio_payments p
        ON p.invoice_id = i.id
        AND p.organization_id = i.organization_id
      WHERE i.id = ? AND i.organization_id = ?
      ORDER BY p.paid_at DESC
      LIMIT 1
    `, [id, actor.organizationId]) as InvoiceData | undefined;

    if (!data) {
      console.error('[Invoices] getInvoiceHtml: no row for invoice id', id);
      return NextResponse.json({ error: 'Invoice not found', invoice_id: id }, { status: 404 });
    }

    // Real accounting date + CZK conversion for foreign-currency (OTA) invoices.
    data.document_date = resolveDocumentDate(data);
    const conv = await convertToCzkAuto(data.amount || 0, data.currency, data.document_date);
    if (conv.converted) {
      data.amount = conv.amountCzk;
      data.currency = 'CZK';
      data.foreign_note = foreignNote(conv);
    }

    const html = await renderInvoiceHtml(data);

    if (asDownload) {
      return new NextResponse(html, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Disposition': `attachment; filename="faktura-${data.invoice_number}.html"`,
        },
      });
    }

    return new NextResponse(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  } catch (e: any) {
    const msg = e?.message || String(e);
    console.error('[Invoices] getInvoiceHtml error:', msg, e?.stack);
    return NextResponse.json(
      { error: 'Failed to render invoice', detail: msg },
      { status: 500 }
    );
  }
}

/**
 * GET /api/bookings/[id]/invoice
 * Returns the current (issued) invoice for a reservation, or null.
 */
export async function getInvoiceByReservation(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
  actor: Actor,
): Promise<NextResponse> {
  try {
    const sql = getSql();
    const { id } = await params;
    const row = await sql.row<any>(`
      -- The STAY's own invoice, not a payer's.
      --
      -- What this answers sits next to a "reissue" button, and that button now
      -- acts on exactly this set (folio_id IS NULL). Showing a payer's invoice
      -- here would put a document under a control that cannot touch it.
      -- Invoices raised per payer are listed in the booking's invoice tab,
      -- where each has its own storno.
      SELECT id, invoice_number, issued_at, amount, currency, status
      FROM invoices
      WHERE reservation_id = ? AND organization_id = ? AND status = 'issued'
        AND folio_id IS NULL
      ORDER BY issued_at DESC
      LIMIT 1
    `, [id, actor.organizationId]) as { id: string; invoice_number: string; issued_at: string; amount: number; currency: string; status: string } | undefined;
    return NextResponse.json(row ?? null);
  } catch (e: any) {
    console.error('[Invoices] getInvoiceByReservation error:', e.message);
    return NextResponse.json(null);
  }
}

/**
 * POST /api/bookings/[id]/invoice/reissue
 * Cancels the current invoice and generates a new one with fresh data.
 */
export async function reissueInvoiceHandler(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
  actor: Actor,
): Promise<NextResponse> {
  const sql = getSql();
  try {
    const { id } = await params;
    // The reservation id comes from the URL; reissuing someone else's invoice
    // would cancel their document and burn a number out of their sequence.
    const owned = await sql.row<any>('SELECT 1 FROM reservations r JOIN properties p ON p.id = r.property_id WHERE r.id = ? AND p.organization_id = ?', [id, actor.organizationId]);
    if (!owned) return NextResponse.json({ error: 'Reservation not found' }, { status: 404 });

    const newInvoiceId = await reissueInvoiceForReservation(id);
    if (!newInvoiceId) {
      return NextResponse.json({ error: 'Failed to reissue invoice' }, { status: 500 });
    }
    const invoice = await sql.row<any>('SELECT id, invoice_number, issued_at, amount, currency FROM invoices WHERE id = ?', [newInvoiceId]) as { id: string; invoice_number: string; issued_at: string; amount: number; currency: string };
    return NextResponse.json({ success: true, invoice });
  } catch (e: any) {
    console.error('[Invoices] reissueInvoiceHandler error:', e.message);
    return NextResponse.json({ error: 'Reissue failed' }, { status: 500 });
  }
}
