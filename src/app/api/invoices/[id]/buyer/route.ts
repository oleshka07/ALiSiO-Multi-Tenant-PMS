/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * PATCH /api/invoices/[id]/buyer
 *
 * Updates the buyer (custom_buyer_name) on a batch-created invoice.
 * Used when a Teya transaction has amount >= 10 000 CZK and the user
 * needs to supply the actual guest/company name.
 *
 * Body: { guest_name: string }
 *
 * Обидва запити НАЗИВАЮТЬ орендаря (INC-010). Тут стояло `WHERE id = ?` —
 * рахунок шукався і переписувався по одному лише ідентифікатору, тобто
 * маршрут покладався на те, що чужого id ніхто не знає. На Postgres його
 * рятувала політика RLS: `requirePermission` загортає хендлер у
 * `runWithOrganization`, тож чужий рахунок не збігався з жодним рядком і
 * PATCH віддавав 404. На SQLite — тобто під `npm run dev` — політик немає,
 * і той самий код переписував покупця на чужому рахунку. Захист бази —
 * друга лінія, а не перша: маршрут мусить називати орендаря сам
 * (AGENTS §3, інваріант 5: чужий id → 404).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { requirePermission } from '@core/security/route-guard';
import { serverError } from '@core/http/errors';
import type { Actor } from '@core/auth/session';

export const PATCH = requirePermission('manage_documents', _PATCH);
async function _PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
  actor: Actor,
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
      "SELECT id FROM invoices WHERE id = ? AND organization_id = ? AND status = 'issued' LIMIT 1",
      [id, actor.organizationId],
    );

    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    await sql.run(
      "UPDATE invoices SET custom_buyer_name = ? WHERE id = ? AND organization_id = ?",
      [name, id, actor.organizationId],
    );

    return NextResponse.json({ ok: true, id, guest_name: name });
  } catch (e: any) {
    console.error('[invoices/buyer] PATCH error:', e.message);
    return serverError('app/api/invoices/[id]/buyer _PATCH', e);
  }
}
