/**
 * GET  /api/invoices/[id]   — returns invoice HTML (existing)
 * DELETE /api/invoices/[id] — permanently deletes the invoice
 */
import { getInvoiceHtml } from '@finance';
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { requireOwner } from '@core/security/route-guard';

export const GET = getInvoiceHtml;

export const DELETE = requireOwner(_DELETE);
async function _DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    const sql = getSql();

    // Fetch invoice info before deletion (for logging)
    const inv = await sql.row<{ invoice_number: string; amount: number; currency: string }>(
      'SELECT invoice_number, amount, currency FROM invoices WHERE id = ?',
      [id],
    );

    if (!inv) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    await sql.run('DELETE FROM invoices WHERE id = ?', [id]);

    console.log(`[InvoiceDelete] Deleted ${inv.invoice_number} (${id}) amount=${inv.amount} ${inv.currency}`);

    return NextResponse.json({ ok: true, deletedNumber: inv.invoice_number });

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[InvoiceDelete] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
