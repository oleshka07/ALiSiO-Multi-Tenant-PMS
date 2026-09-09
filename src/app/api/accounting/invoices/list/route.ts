/**
 * GET /api/accounting/invoices/list
 *
 * Returns all invoices (reservation-linked + batch/custom) with unified
 * buyer name, source label, and optional search + source filter.
 *
 * Query params:
 *   source  = all | airbnb | booking | teya | manual | pms
 *   search  = free-text (matches invoice_number, buyer_name, amount)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { requireOrganizationId } from '@core/auth/tenant-context';
import { requireFinanceAccess } from '@core/security/route-guard';
import { serverError } from '@core/http/errors';
import { requestPropertyScope } from '@core/auth/property-scope';
import { propertyOrSharedFilter } from '@core/property-scope';

export const GET = requireFinanceAccess(accountingInvoiceList);

/**
 * Тіло маршруту, названо і експортовано — щоб перевірка могла його покликати.
 *
 * `requireFinanceAccess` читає сесію через `next/headers`, а `cookies()` поза
 * запитом Next кидає; отже загорнутий маршрут недосяжний для `.check.ts` під
 * голим node. Той самий рух і той самий довід, що в
 * `data/reservation-invoice.repo.ts` і в двох вивантаженнях поруч.
 */
export async function accountingInvoiceList(request: NextRequest): Promise<NextResponse> {
  try {
    const sql = getSql();
    const { searchParams } = new URL(request.url);
    const source = searchParams.get('source') || 'all';
    const search = (searchParams.get('search') || '').trim();

    const from   = searchParams.get('from');
    const to     = searchParams.get('to');

    // Build the base query — LEFT JOINs so custom/batch invoices without
    // reservation_id are still returned.
    const orgId = await requireOrganizationId();
    // Вісь обʼєкта у пакеті документів (INC-029, Д52). Коментар нижче вже
    // фіксує половину того самого класу — «on SQLite an unscoped month took
    // every hotel's documents with it»; ту половину (орендар) полагоджено, а
    // вісь ОБʼЄКТА лишалась відкритою, і бухгалтер обʼєкта А діставав у ZIP
    // документи обʼєкта Б.
    //
    // `propertyOrSharedFilter`: `invoices` не має `property_id`, обʼєкт
    // приходить від броні `LEFT JOIN`-ом, а фактура без броні (вручну, сторно)
    // обʼєкта не має — звичайний фільтр викинув би її з КОЖНОГО пакета (Д51).
    const scope = await requestPropertyScope(request, orgId);
    const axis = propertyOrSharedFilter(scope, 'r');
    const rows: any[] = await sql.rows<any>(`
      SELECT
        i.id,
        i.invoice_number,
        i.issued_at,
        i.due_date,
        i.amount,
        i.currency,
        i.status,
        i.is_custom,
        i.is_credit_note,
        i.notes,
        i.custom_description,
        -- Unified buyer name
        COALESCE(
          NULLIF(TRIM(i.custom_buyer_name), ''),
          CASE
            WHEN g.first_name IS NOT NULL THEN TRIM(g.first_name || ' ' || g.last_name)
            ELSE NULL
          END
        ) as buyer_name,
        -- Source badge
        CASE
          WHEN i.notes LIKE 'airbnb:%'  THEN 'airbnb'
          WHEN i.notes LIKE 'booking:%' THEN 'booking'
          WHEN i.notes LIKE 'teya:%'    THEN 'teya'
          WHEN i.is_custom = TRUE          THEN 'manual'
          WHEN i.reservation_id IS NOT NULL THEN 'pms'
          ELSE 'manual'
        END as source,
        u.name as unit_name
      FROM invoices i
      LEFT JOIN reservations r ON i.reservation_id = r.id
      LEFT JOIN guests      g ON r.guest_id = g.id
      LEFT JOIN units       u ON r.unit_id  = u.id
      -- The tenant is named here, not left to the policy: on SQLite there is
      -- none, and this list carried invoice numbers, buyers and amounts.
      WHERE i.organization_id = ? AND ${axis.sql}
      ORDER BY i.issued_at DESC, i.invoice_number DESC
      LIMIT 1000
    `, [orgId, ...axis.params]);

    // Apply source + search filters in JS (simpler than dynamic SQL for SQLite)
    let filtered = rows;

    if (source !== 'all') {
      filtered = filtered.filter(r => r.source === source);
    }

    if (from) {
      filtered = filtered.filter(r => r.issued_at >= from);
    }

    if (to) {
      filtered = filtered.filter(r => r.issued_at <= to);
    }

    if (search) {      const q = search.toLowerCase();
      filtered = filtered.filter(r => {
        const name   = (r.buyer_name || '').toLowerCase();
        const num    = (r.invoice_number || '').toLowerCase();
        const desc   = (r.custom_description || '').toLowerCase();
        const amount = String(Math.abs(r.amount || 0));
        return name.includes(q) || num.includes(q) || desc.includes(q) || amount.includes(q);
      });
    }

    return NextResponse.json(filtered);
  } catch (e: any) {
    console.error('[accounting/invoices/list]', e.message);
    return serverError('app/api/accounting/invoices/list _GET', e);
  }
}
