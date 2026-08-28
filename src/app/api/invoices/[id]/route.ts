/**
 * GET  /api/invoices/[id]   — returns invoice HTML (existing)
 * DELETE /api/invoices/[id] — permanently deletes the invoice
 */
import { getInvoiceHtml } from '@invoicing';
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { requireFinanceAccess } from '@core/security/route-guard';
import type { Actor } from '@core/auth/session';
import { isPeriodLocked } from '@invoicing';
import { serverError } from '@core/http/errors';

export const GET = getInvoiceHtml;

/**
 * Deleting an invoice, with the two conditions the rest of the module enforces
 * and this endpoint did not.
 *
 * It read `WHERE id = ?` — no organization — so on SQLite an owner could
 * delete another hotel's invoice, and the id is all it takes. Worse, it
 * checked neither `locked` nor whether the accounting period is closed, while
 * every other write path does: `folio.repo.ts` and `invoice-batch` both refuse
 * a locked period. So a closed month — closed precisely so its numbering and
 * totals stop moving — could be changed after the fact through this one route,
 * leaving a gap in a sequence a tax authority expects to be unbroken.
 *
 * A wrongly issued invoice is reversed with a storno document, which the module
 * already supports. That is the difference between an accounting system and a
 * spreadsheet.
 */
export const DELETE = requireFinanceAccess(_DELETE);
async function _DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
  actor: Actor,
): Promise<NextResponse> {
  try {
    const { id } = await params;
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    const sql = getSql();

    const inv = await sql.row<{
      invoice_number: string; amount: number; currency: string;
      locked: boolean | number; series: string | null; period: string | null;
    }>(
      `SELECT invoice_number, amount, currency, locked, series, period
       FROM invoices WHERE id = ? AND organization_id = ?`,
      [id, actor.organizationId],
    );

    if (!inv) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    if (inv.locked) {
      return NextResponse.json(
        { error: 'Рахунок замкнено. Помилковий документ виправляють сторно, а не видаленням.' },
        { status: 409 },
      );
    }

    const period = inv.period || null;
    if (period && await isPeriodLocked(sql, actor.organizationId, inv.series || 'HOUSE', period)) {
      return NextResponse.json(
        { error: `Період ${period} закрито. Помилковий документ виправляють сторно, а не видаленням.` },
        { status: 409 },
      );
    }

    await sql.run('DELETE FROM invoices WHERE id = ? AND organization_id = ?', [id, actor.organizationId]);

    console.log(`[InvoiceDelete] Deleted ${inv.invoice_number} (${id}) amount=${inv.amount} ${inv.currency}`);

    return NextResponse.json({ ok: true, deletedNumber: inv.invoice_number });
  } catch (e: unknown) {
    return serverError('app/api/invoices/[id] DELETE', e, 'Не вдалося видалити рахунок');
  }
}
