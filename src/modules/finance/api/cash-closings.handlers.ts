/**
 * The Kassenabschluss over HTTP. `manage_documents`, like the rest of the
 * till: closing the day is reception's evening ritual, not an owner-only
 * ceremony.
 */
import { NextResponse } from 'next/server';
import { withPermission } from '@core/auth/session';
import * as closings from '../data/cash-closings.repo';

function refuse(e: unknown) {
  const message = e instanceof Error ? e.message : 'Failed';
  const expected = /not found|already closed|must be/i.test(message);
  if (!expected) console.error('[cash-closings]', e);
  return NextResponse.json(
    { error: expected ? message : 'Failed' },
    { status: expected ? 409 : 500 },
  );
}

export const listCashClosings = withPermission('manage_documents', async (request: Request) => {
  const url = new URL(request.url);
  return NextResponse.json({
    closings: await closings.listClosings({
      propertyId: url.searchParams.get('property_id') || undefined,
      from: url.searchParams.get('from') || undefined,
      to: url.searchParams.get('to') || undefined,
    }),
  });
});

export const createCashClosing = withPermission('manage_documents', async (
  request: Request, _ctx, actor,
) => {
  const body = await request.json().catch(() => ({})) as any;
  if (!body.property_id || !body.date) {
    return NextResponse.json({ error: 'property_id and date are required' }, { status: 400 });
  }
  try {
    return NextResponse.json(await closings.closeDay({
      propertyId: String(body.property_id),
      date: String(body.date),
      closedBy: actor.user.id,
      notes: body.notes ?? null,
    }), { status: 201 });
  } catch (e) { return refuse(e); }
});

/** The till journal as CSV — the raw material of a DSFinV-K export. */
export const exportTillJournal = withPermission('manage_documents', async (request: Request) => {
  const url = new URL(request.url);
  const propertyId = url.searchParams.get('property_id');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if (!propertyId || !from || !to) {
    return NextResponse.json({ error: 'property_id, from and to are required' }, { status: 400 });
  }
  const csv = await closings.tillJournalCsv({ propertyId, from, to });
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="till-journal_${from}_${to}.csv"`,
    },
  });
});
