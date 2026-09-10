/**
 * GET /api/invoices/[id]/isdoc
 * Downloads ISDOC v6.0.2 XML for an existing invoice record.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { generateIsdocXml, invoiceSettings } from '@invoicing';
import { requireOrganizationId } from '@core/auth/tenant-context';
import { ALL_PROPERTIES, propertyOrSharedFilter } from '@core/property-scope';
import type { InvoiceData } from '@invoicing';
import { requirePermission } from '@core/security/route-guard';
import { convertToCzkAuto, foreignNote } from '@invoicing';
import { showBuyerName, dueDateFor } from '@invoicing';

// `currency` у цих рядках — NOT NULL (invoices, fin_operations, reservations:
// усі три `TEXT NOT NULL`), тож `|| 'CZK'` тут не спрацьовував ніколи. Він не
// був захистом — він був схожий на рішення: читач бачив «якщо валюти немає,
// це крони» і вірив, що такий випадок буває. Прибрано, щоб у коді лишилось
// рівно одне джерело валюти документа — сам рядок.

export const GET = requirePermission('manage_documents', invoiceIsdoc);
// Тіло іменованим експортом — щоб сцена кликала МАРШРУТ (див. `invoice-pdf`).
export async function invoiceIsdoc(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  // Правила бланка ЦЬОГО готеля — замість колишніх констант із чеського
  // закону. Організація вже на зʼєднанні: маршрут під вартою.
  const rules = await invoiceSettings(await requireOrganizationId());  // орендар нижче — той самий

  try {
    const { id } = await params;
  /**
   * ── Орендар у цьому запиті (INC-043) ──────────────────────────────────
   *
   * Стояло голе `WHERE i.id = ?`. Ідентифікатор фактури приходить із адреси,
   * тобто від того, хто питає; на Postgres чуже ховала політика, на SQLite не
   * ховало ніщо. Це третій маршрут того самого інциденту поруч із пакетним ZIP
   * і PDF — і всі три читають ОДНУ таблицю однією формою запиту.
   *
   * Вісь обʼєкта — `ALL_PROPERTIES` і це сказано: документ читається за
   * первинним ключем, належність доводить орендар, а посилання стоїть у картці
   * броні. `propertyOrSharedFilter`, а не звичайний: `invoices` не має
   * `property_id`, і фактура без броні обʼєкта не має взагалі (Д51).
   */
  const organizationId = await requireOrganizationId();
  const axis = propertyOrSharedFilter(ALL_PROPERTIES, 'r');
    const sql = getSql();

    // Full invoice data (same query as getInvoiceHtml)
    const data = await sql.row<InvoiceData>(`
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
        p.method as payment_method, p.paid_at as payment_date
      FROM invoices i
      LEFT JOIN reservations r ON i.reservation_id = r.id
      LEFT JOIN units u ON r.unit_id = u.id
      LEFT JOIN guests g ON r.guest_id = g.id
      LEFT JOIN (
        SELECT gr.reservation_id, rg2.address, rg2.city, rg2.country
        FROM guest_registrations gr
        JOIN guests rg2 ON gr.guest_id = rg2.id
        WHERE (rg2.address IS NOT NULL AND rg2.address != '')
           OR (rg2.city IS NOT NULL AND rg2.city != '')
        ORDER BY gr.registered_at ASC LIMIT 1
      ) rg ON rg.reservation_id = r.id
      LEFT JOIN fin_operations p
        ON p.reservation_id = r.id AND p.op_type = 'income' AND p.status = 'completed'
      WHERE i.id = ? AND i.organization_id = ? AND ${axis.sql}
      ORDER BY p.paid_at DESC LIMIT 1
    `, [id, organizationId, ...axis.params]);

    if (!data || !data.invoice_number) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    // Real accounting date: check-in → payment → creation (never import date).
    const documentDate = (data.check_in || data.payment_date || data.issued_at || '').slice(0, 10);
    // Foreign-currency (OTA/EUR) → CZK at the rate effective on the document date.
    const conv = await convertToCzkAuto(data.amount || 0, data.currency, documentDate);
    const czkAmount = conv.converted ? conv.amountCzk : (data.amount || 0);

    // Buyer: explicit company always; personal guest only at/above 9900 CZK.
    const hasCompany = !!data.invoice_company_name?.trim();
    let buyer = hasCompany ? {
      name:    data.invoice_company_name as string,
      ico:     data.invoice_company_ico  || undefined,
      dic:     data.invoice_company_dic  || undefined,
      street:  data.invoice_company_address || undefined,
      city:    data.invoice_company_city    || undefined,
      country: data.invoice_company_country || undefined,
    } : undefined;
    if (!buyer && showBuyerName(czkAmount, false, rules)) {
      const gname = `${data.guest_first_name || ''} ${data.guest_last_name || ''}`.trim();
      if (gname) buyer = { name: gname, ico: undefined, dic: undefined, street: data.guest_address || undefined, city: data.guest_city || undefined, country: data.guest_country || undefined };
    }

    // Description line
    let desc = 'Ubytování';
    if (data.unit_name) desc += ` — ${data.unit_name}`;
    if (data.check_in && data.check_out) {
      const fmt = (d: string) => new Date(d).toLocaleDateString('cs-CZ', { day: '2-digit', month: '2-digit', year: 'numeric' });
      desc += ` (${fmt(data.check_in)} – ${fmt(data.check_out)})`;
    }

    const xml = await generateIsdocXml({
      invoiceNumber:  data.invoice_number,
      issueDate:      documentDate || (data.issued_at || '').slice(0, 10),
      // DUZP + строк оплати = дата видачі + стільки днів, скільки задав
      // готель. Було жорстко 14 — чеський звичай, накинутий усім.
      taxPointDate:   dueDateFor(documentDate || (data.issued_at || '').slice(0, 10), rules),
      description:    desc,
      amount:         conv.converted ? conv.amountCzk : (data.amount || 0),
      currency:       conv.converted ? 'CZK' : (data.currency),
      buyer,
      paymentMethod:  data.payment_method || undefined,
      paymentDueDate: dueDateFor(documentDate || (data.issued_at || '').slice(0, 10), rules),
      foreignNote:    conv.converted ? foreignNote(conv) : undefined,
    });

    const filename = `faktura-${data.invoice_number}.isdoc`;
    return new NextResponse(xml, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: 'ISDOC generation failed', detail: msg }, { status: 500 });
  }
}
