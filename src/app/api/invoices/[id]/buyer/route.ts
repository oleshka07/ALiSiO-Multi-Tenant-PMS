/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * PATCH /api/invoices/[id]/buyer
 *
 * Updates the buyer (custom_buyer_name) on a batch-created invoice.
 * Used when a Teya transaction has amount >= 10 000 CZK and the user
 * needs to supply the actual guest/company name.
 *
 * Body: { guest_name: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { requirePermission } from '@core/security/route-guard';

export const PATCH = requirePermission('manage_documents', _PATCH);
async function _PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const body = await request.json() as { guest_name?: string };
    const name = (body.guest_name ?? '').trim();

    if (!name) {
      return NextResponse.json({ error: 'guest_name required' }, { status: 400 });
    }

    const sql = getSql();
    const invoice = await sql.row<{ id: string }>(
      "SELECT id FROM invoices WHERE id = ? AND status = 'issued' LIMIT 1",
      [id],
    );

    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    await sql.run(
      "UPDATE invoices SET custom_buyer_name = ? WHERE id = ?",
      [name, id],
    );

    return NextResponse.json({ ok: true, id, guest_name: name });
  } catch (e: any) {
    console.error('[invoices/buyer] PATCH error:', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
