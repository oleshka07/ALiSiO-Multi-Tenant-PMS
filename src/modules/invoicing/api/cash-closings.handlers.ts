/**
 * The Kassenabschluss over HTTP. `manage_documents`, like the rest of the
 * till: closing the day is reception's evening ritual, not an owner-only
 * ceremony.
 */
import { NextResponse } from 'next/server';
import { withPermission } from '@core/auth/session';
// Рід відмови несе ВОНА САМА, а не список візерунків.
//
// Тут стояв власний `refuse(e)` з `/not found|already closed|must be/` —
// рівно той візерунок, який сусідній модуль уже визнав програшним
// (AGENTS §3.2.1): нова відмова, що не збіглась із жодним рядком, ставала
// «Failed» зі статусом 500, тобто ПОЛОМКОЮ там, де було правило. Спільний
// `handleError` робить те саме і ще й кладе стек у лог та Sentry — друга
// копія правила тут не потрібна.
import { handleError } from '@core/http/errors';
import { requestPropertyScope } from '@core/auth/property-scope';
import * as closings from '../data/cash-closings.repo';

export const listCashClosings = withPermission('manage_documents', async (request: Request, _ctx, actor) => {
  try {
    const url = new URL(request.url);
    // Спільні двері замість власного `get('property_id')`: чужий обʼєкт — 404,
    // сказане `all` — усі обʼєкти, а не ідентифікатор (Д49).
    //
    // І `catch` ОБІЙМАЄ їх (П14, ревізія 16.09.2026): `PropertyNotFound` —
    // названа відмова зі статусом 404, але без обробника вона летіла повз
    // маршрут і Next віддавав 500. Тобто «не той будинок» виглядало як
    // поломка сервера — той самий INC-029, поверхом вище.
    const scope = await requestPropertyScope(request, actor.organizationId);
    return NextResponse.json({
      closings: await closings.listClosings(scope, {
        from: url.searchParams.get('from') || undefined,
        to: url.searchParams.get('to') || undefined,
      }),
    });
  } catch (e) { return handleError('modules/invoicing/api/cash-closings list', e); }
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
  } catch (e) { return handleError('modules/invoicing/api/cash-closings close', e); }
});

/** The till journal as CSV — the raw material of a DSFinV-K export. */
export const exportTillJournal = withPermission('manage_documents', async (request: Request, _ctx, actor) => {
  try {
    const url = new URL(request.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    if (!url.searchParams.get('property_id') || !from || !to) {
      return NextResponse.json({ error: 'property_id, from and to are required' }, { status: 400 });
    }
    // Чужий обʼєкт — 404, а не порожній CSV зі статусом 200 (INC-029, П14).
    // Орендар у запиті названий, тож чужого й не було видно, — але «нічого не
    // знайшлось» і «це не ваш обʼєкт» це різні відповіді, і друга лікується
    // інакше. Двері ті самі, що в списку закриттів.
    const scope = await requestPropertyScope(request, actor.organizationId);
    const propertyId = scope.kind === 'one' ? scope.id : null;
    if (!propertyId) {
      return NextResponse.json({ error: 'Журнал каси ведеться по ОДНОМУ обʼєкту — назвіть його' }, { status: 400 });
    }
    const csv = await closings.tillJournalCsv({ propertyId, from, to });
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="till-journal_${from}_${to}.csv"`,
      },
    });
  } catch (e) { return handleError('modules/invoicing/api/cash-closings export', e); }
});
