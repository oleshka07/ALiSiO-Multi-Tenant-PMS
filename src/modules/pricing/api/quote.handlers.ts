/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { calculateQuote } from '../data/quote.repo';
import { assertRatePlanForPayer } from '../data/company-rate-plans.repo';
import { withActor } from '@core/auth/session';
import { getSql } from '@core/db/async';
import { handleError } from '@core/http/errors';

export const getQuote = withActor(async (request: NextRequest, _ctx, actor): Promise<NextResponse> => {
  try {
    const body = await request.json();
    const { unitTypeId, checkIn, checkOut, adults = 2, children = 0, ratePlanId = null, promoCode = null, companyId = null } = body;

    if (!unitTypeId || !checkIn || !checkOut) {
      return NextResponse.json({ error: 'unitTypeId, checkIn, checkOut required' }, { status: 400 });
    }

    const start = new Date(checkIn);
    const end = new Date(checkOut);
    if (end <= start) return NextResponse.json({ error: 'checkOut must be after checkIn' }, { status: 400 });

    // Тип номера мусить належати цьому готелю.
    //
    // Тут не було нічого. `withActor` питає лише «чи є сесія», а `unitTypeId`
    // приходить із тіла запиту — тож будь-хто залогінений міг порахувати
    // квоту на чужий тип номера й побачити чужі ціни та збори. На Postgres це
    // ховала RLS; на SQLite політик НЕМАЄ, і дірка була справжня — її й знайшла
    // проба ізоляції, коли до квоти нарешті додались збори.
    //
    // Перевірка явна в SQL, а не через RLS, саме тому: покладатись на політику
    // означає мати дірку на одному з двох двигунів (той самий урок, що C1–C14).
    const owned = await getSql().row(
      `SELECT ut.id
         FROM unit_types ut
         JOIN properties p ON p.id = ut.property_id
        WHERE ut.id = ? AND p.organization_id = ?`,
      [unitTypeId, actor.organizationId]);
    if (!owned) return NextResponse.json({ error: 'Unit type not found' }, { status: 404 });

    // Тариф і промокод (Ц31) — за бажанням; тариф чужого обʼєкта котирування
    // саме відкине (рядок тарифу звіряється з обʼєктом типу).
    //
    // А ФІРМОВИЙ тариф відкидається тут, і саме тут (INC-205). `ratePlanId`
    // приходить із ТІЛА запиту, тобто звузити список тарифів на екрані —
    // не варта: хто знає ідентифікатор, називає його сам і дістає фірмову
    // ціну. Це четвертий випадок того самого класу за три доби (INC-201…203:
    // читач полагоджений, писач відчинений), і закривається він тим самим
    // комітом, що й список.
    const plan = typeof ratePlanId === 'string' && ratePlanId ? ratePlanId : null;
    await assertRatePlanForPayer(plan, actor.organizationId,
      typeof companyId === 'string' && companyId ? companyId : null);

    return NextResponse.json(await calculateQuote(unitTypeId, checkIn, checkOut, adults, children, {
      ratePlanId: plan,
      promoCode: typeof promoCode === 'string' && promoCode.trim() ? promoCode.trim() : null,
    }));
  } catch (error: any) {
    return handleError('POST /api/pricing/quote', error);
  }
});
