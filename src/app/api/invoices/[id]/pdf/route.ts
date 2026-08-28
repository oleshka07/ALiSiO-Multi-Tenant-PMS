/**
 * GET /api/invoices/[id]/pdf
 * Downloads a PDF for any stored invoice (reservation-based or custom).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { generateInvoicePdf, invoiceSettings } from '@invoicing';
import { requireOrganizationId } from '@core/auth/tenant-context';
import { requirePermission } from '@core/security/route-guard';
import { convertToCzkAuto, foreignNote } from '@invoicing';
import { showBuyerName, dueDateFor } from '@invoicing';
import { loadInvoiceDocument } from '@invoicing';
import { generateGermanInvoicePdf } from '@invoicing';
import { documentLanguage } from '@core/i18n/resolve';

export const GET = requirePermission('manage_documents', _GET);
async function _GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  // Правила бланка ЦЬОГО готеля — замість колишніх констант із чеського
  // закону. Організація вже на зʼєднанні: маршрут під вартою.
  const rules = await invoiceSettings(await requireOrganizationId());

  try {
    const { id } = await params;
    const sql    = getSql();

    // A German property's invoice renders through the German layout — §14
    // fields, MwSt-Übersicht, Stornorechnung wording.
    const doc = await loadInvoiceDocument(id);
    if (doc && doc.locale === 'de-DE') {
      const pdf = await generateGermanInvoicePdf(doc);
      return new NextResponse(new Uint8Array(pdf), {
        status: 200,
        headers: {
          'Content-Type':        'application/pdf',
          'Content-Disposition': `attachment; filename="rechnung-${doc.number}.pdf"`,
          'Cache-Control':       'no-store',
        },
      });
    }

    // ── Німецький обʼєкт НІКОЛИ не друкується чеським рендерером ──────────
    //
    // Тут стояв мовчазний фолбек: не зібрався документ — падаємо нижче. Нижче
    // живе чеський рахунок, і він не просто іншою мовою. Він пише «Ubytování»,
    // форматує дати як `cs-CZ`, не робить розбивки МПДВ по ставках — і
    // `convertToCzkAuto` ПЕРЕРАХОВУЄ суму в крони. Німецький готель діставав
    // документ чужої юрисдикції, чужою мовою і в чужій валюті, без жодної
    // помилки на екрані.
    //
    // Саме це й сталося на пілоті: `properties.country` лишився зі значенням
    // за замовчуванням, юрисдикція вирахувалась як CZ, локаль — не `de-DE`, і
    // фолбек тихо видав гостю чеську фактуру в кронах.
    //
    // Рахунок — документ із номером у книзі. Відмова гучна й полагоджувана;
    // неправильний рахунок треба сторнувати. Тому тепер краще не видати
    // нічого й назвати причину.
    // Обʼєкта може не бути зовсім — фоліо без броні й без property_id. Це рівно
    // той випадок, у якому `loadInvoiceDocument` віддає null, тож питати лише
    // обʼєкт означало б лишити відкритою ту саму дірку. Тоді юрисдикцію
    // називає організація: у неї одна мова на всіх її обʼєктів.
    const juris = await sql.row<{ property_id: string | null; org_language: string | null }>(
      `SELECT COALESCE(r.property_id, f.property_id) AS property_id,
              o.language AS org_language
         FROM invoices i
         LEFT JOIN fin_folios f ON f.id = i.folio_id
         LEFT JOIN reservations r ON r.id = i.reservation_id
         LEFT JOIN organizations o ON o.id = i.organization_id
        WHERE i.id = ?`, [id]);
    const language = juris?.property_id
      ? await documentLanguage(juris.property_id)
      : (juris?.org_language ?? null);
    if (language === 'de') {
      console.error(`[invoice-pdf] ${id}: юрисдикція німецька, а документ не зібрався`
        + ` (${doc ? `локаль ${doc.locale}` : 'loadInvoiceDocument → null'};`
        + ` обʼєкт ${juris?.property_id ?? 'невідомий'})`);
      return NextResponse.json({
        error: 'This property issues German invoices and the document could not be assembled.'
          + ' Check the property country and that the invoice has line items.',
      }, { status: 409 });
    }

    const row = await sql.row<Record<string, unknown>>(`
      SELECT
        i.id, i.invoice_number, i.issued_at, i.due_date,
        i.amount, i.currency, i.is_custom,
        i.custom_buyer_name, i.custom_buyer_ico, i.custom_buyer_dic,
        i.custom_buyer_address, i.custom_buyer_city, i.custom_buyer_country,
        i.custom_description,
        r.check_in, r.check_out,
        u.name as unit_name,
        g.first_name as guest_first_name, g.last_name as guest_last_name,
        r.invoice_company_name, r.invoice_company_ico, r.invoice_company_dic,
        r.invoice_company_address, r.invoice_company_city, r.invoice_company_country,
        p.method as payment_method, p.paid_at as payment_date
      FROM invoices i
      LEFT JOIN reservations r  ON i.reservation_id = r.id
      LEFT JOIN units u         ON r.unit_id = u.id
      LEFT JOIN guests g        ON r.guest_id = g.id
      LEFT JOIN fin_operations p
        ON p.reservation_id = r.id AND p.op_type = 'income' AND p.status = 'completed'
      WHERE i.id = ?
      ORDER BY p.paid_at DESC LIMIT 1
    `, [id]);

    if (!row) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    // Build description
    let description = (row.custom_description as string | null) || '';
    if (!description) {
      description = 'Ubytování';
      if (row.unit_name) description += ` — ${row.unit_name}`;
      if (row.check_in && row.check_out) {
        const fmt = (d: string) =>
          new Date(d).toLocaleDateString('cs-CZ', { day: '2-digit', month: '2-digit', year: 'numeric' });
        description += ` (${fmt(row.check_in as string)} – ${fmt(row.check_out as string)})`;
      }
    }

    // Real accounting date: check-in → payment → creation (never import date).
    const documentDate = ((row.check_in as string | null) || (row.payment_date as string | null) || (row.issued_at as string | null) || '').slice(0, 10);
    // Foreign-currency (OTA/EUR) → CZK at the rate effective on the document date.
    const conv = await convertToCzkAuto((row.amount as number) || 0, (row.currency as string) || 'CZK', documentDate);
    const czkAmount = conv.converted ? conv.amountCzk : ((row.amount as number) || 0);

    // Build buyer — explicit company/custom always shown; a personal guest only
    // at/above the 9900 CZK threshold, otherwise the invoice stays anonymous.
    const companyName = (row.custom_buyer_name || row.invoice_company_name) as string | null;
    let buyer = companyName?.trim() ? {
      name:    companyName,
      ico:     (row.custom_buyer_ico  || row.invoice_company_ico)  as string | undefined,
      dic:     (row.custom_buyer_dic  || row.invoice_company_dic)  as string | undefined,
      address: (row.custom_buyer_address || row.invoice_company_address) as string | undefined,
      city:    (row.custom_buyer_city    || row.invoice_company_city)    as string | undefined,
      country: (row.custom_buyer_country || row.invoice_company_country) as string | undefined,
    } : undefined;
    if (!buyer && showBuyerName(czkAmount, false, rules)) {
      const gname = `${row.guest_first_name || ''} ${row.guest_last_name || ''}`.trim();
      if (gname) buyer = { name: gname, ico: undefined, dic: undefined, address: undefined, city: undefined, country: undefined };
    }

    const pdfBuffer = await generateInvoicePdf({
      invoiceNumber:  row.invoice_number as string,
      issueDate:      documentDate || (row.issued_at as string).slice(0, 10),
      // Строк оплати = дата видачі + стільки днів, скільки задав готель
      // (organization_invoicing.due_days). Було жорстко 14 для всіх.
      dueDate:        dueDateFor(documentDate || (row.issued_at as string).slice(0, 10), rules),
      paymentMethod:  (row.payment_method as string | null) || 'Příkazem',
      description,
      amount:         conv.converted ? conv.amountCzk : (row.amount as number),
      currency:       conv.converted ? 'CZK' : ((row.currency as string) || 'CZK'),
      buyer,
      foreignNote:    conv.converted ? foreignNote(conv) : undefined,
    });

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        'Content-Type':        'application/pdf',
        'Content-Disposition': `attachment; filename="faktura-${row.invoice_number}.pdf"`,
        'Cache-Control':       'no-store',
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
