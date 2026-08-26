/**
 * GET /api/invoices/export?source=all&from=&to=&format=csv
 *
 * Exports all invoices as a CSV file (UTF-8 with BOM for Excel compatibility).
 * Columns: Číslo faktury, Datum vystavení, Datum splatnosti, Zdroj, Kupující,
 *          IČO, DIČ, Adresa, Popis, Suma, Měna, Stav, Rezervace ID
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { requireFinanceAccess } from '@core/security/route-guard';
import type { Actor } from '@core/auth/session';

export const GET = requireFinanceAccess(_GET);
async function _GET(req: NextRequest, _ctx: unknown, actor: Actor): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(req.url);
    const source  = searchParams.get('source')  || 'all';
    const from    = searchParams.get('from')    || null;
    const to      = searchParams.get('to')      || null;

    const sql = getSql();

    // Build query. The organization is not optional here: this writes every
    // matching invoice into a file, and unqualified it wrote every hotel's.
    const conditions: string[] = ['i.organization_id = ?'];
    const params: (string | number)[] = [actor.organizationId];

    // Source filter
    if (source !== 'all') {
      if (source === 'manual') {
        conditions.push('(i.is_custom = TRUE AND i.is_credit_note = FALSE)');
      } else if (source === 'pms') {
        conditions.push('(i.is_custom = FALSE AND i.is_credit_note = FALSE AND i.reservation_id IS NOT NULL)');
      } else if (source === 'refund') {
        conditions.push('i.is_credit_note = TRUE');
      } else {
        // airbnb, booking, teya
        conditions.push(`lower(coalesce(r.source,'')) = ?`);
        params.push(source.toLowerCase());
      }
    }

    if (from) { conditions.push('i.issued_at >= ?'); params.push(from); }
    if (to)   { conditions.push('i.issued_at <= ?'); params.push(to + 'T23:59:59'); }

    const where = 'WHERE ' + conditions.join(' AND ');

    const rows = await sql.rows<Record<string, unknown>>(`
      SELECT
        i.invoice_number,
        i.issued_at,
        i.due_date,
        CASE
          WHEN i.is_credit_note = TRUE THEN 'Storno'
          WHEN i.is_custom = TRUE       THEN 'Vručnu'
          WHEN r.source IS NOT NULL  THEN r.source
          ELSE 'PMS'
        END AS source,
        COALESCE(
          i.custom_buyer_name,
          g.first_name || ' ' || g.last_name
        ) AS buyer_name,
        COALESCE(i.custom_buyer_ico, '') AS buyer_ico,
        COALESCE(i.custom_buyer_dic, '') AS buyer_dic,
        COALESCE(
          CASE WHEN i.custom_buyer_address IS NOT NULL
            THEN i.custom_buyer_address || ', ' || COALESCE(i.custom_buyer_city,'')
          END, ''
        ) AS buyer_address,
        COALESCE(i.custom_description, u.name, '') AS description,
        i.amount,
        i.currency,
        i.status,
        COALESCE(i.reservation_id, '') AS reservation_id
      FROM invoices i
      LEFT JOIN reservations r ON r.id = i.reservation_id
      LEFT JOIN guests g ON g.id = r.guest_id
      LEFT JOIN units u ON u.id = r.unit_id
      ${where}
      ORDER BY i.issued_at DESC
    `, params);

    // Build CSV
    const HEADERS = [
      'Číslo faktury', 'Datum vystavení', 'Datum splatnosti', 'Zdroj',
      'Kupující', 'IČO', 'DIČ', 'Adresa',
      'Popis', 'Suma', 'Měna', 'Stav', 'Rezervace ID',
    ];

    const escCsv = (v: unknown): string => {
      const s = v == null ? '' : String(v);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    };

    const csvLines = [
      HEADERS.map(escCsv).join(','),
      ...rows.map(r => [
        r.invoice_number, r.issued_at, r.due_date ?? '', r.source,
        r.buyer_name ?? '', r.buyer_ico, r.buyer_dic, r.buyer_address,
        r.description, r.amount, r.currency, r.status, r.reservation_id,
      ].map(escCsv).join(',')),
    ];

    // UTF-8 BOM for correct Excel opening
    const bom = '\uFEFF';
    const csv = bom + csvLines.join('\r\n');

    const filename = `faktury-export-${new Date().toISOString().slice(0,10)}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type':        'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control':       'no-store',
      },
    });

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[InvoiceExport] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
