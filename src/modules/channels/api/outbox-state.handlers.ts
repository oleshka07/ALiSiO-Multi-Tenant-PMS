import { NextResponse, type NextRequest } from 'next/server';
import { withPermission } from '@core/auth/session';
import { serverError } from '@core/http/errors';
import { connectionInTenant, connectionsInTenant } from '../data/connections.repo';
import { pendingCount, stuckChanges, retryStuck } from '../data/outbox.repo';
import { catalogUnitTypes } from '@properties';
import { propertyRatePlans } from '@pricing';

/**
 * Черга каналів очима оператора: що чекає, що застрягло, і кнопка «повернути».
 *
 * Без цього екрана крон — це черга, про яку ніхто не дізнається: застрягла
 * координата (Ц14) не червонить крон навмисно, тож єдине місце, де її видно,
 * — тут. Читання йде через `connectionsInTenant` / `stuckChanges` з
 * орендарем у SQL; id зʼєднання з URL проходить через `connectionInTenant`
 * (чуже й неіснуюче — 404, інваріант 5).
 */
export const listChannelConnections = withPermission('manage_properties', async () => {
  try {
    const connections = await connectionsInTenant();
    const out = [];
    for (const c of connections) {
      // Оператор читає коди, не ідентифікатори: «DBL × BAR», а не два uuid.
      const unitTypes = new Map((await catalogUnitTypes(c.propertyId)).map((u) => [u.id, u.code]));
      const ratePlans = new Map((await propertyRatePlans(c.propertyId)).map((r) => [r.id, r.code]));
      const stuck = (await stuckChanges(c.id)).map((row) => ({
        ...row,
        unitTypeCode: row.unitTypeId ? (unitTypes.get(row.unitTypeId) ?? row.unitTypeId) : null,
        ratePlanCode: row.ratePlanId ? (ratePlans.get(row.ratePlanId) ?? row.ratePlanId) : null,
      }));
      out.push({
        id: c.id,
        propertyId: c.propertyId,
        provider: c.provider,
        environment: c.environment,
        isEnabled: c.isEnabled,
        remotePropertyId: c.remotePropertyId,
        pricingModifierPercent: c.pricingModifierPercent,
        pending: await pendingCount(c.id),
        stuck,
      });
    }
    return NextResponse.json(out);
  } catch (error: unknown) {
    return serverError('modules/channels/api/outbox-state listChannelConnections', error);
  }
});

/** Повернути застрягле в чергу — рукою оператора, після того як причину усунено. */
export const retryChannelOutbox = withPermission('manage_properties', async (
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const { id } = await params;
    const connection = await connectionInTenant(id);
    if (!connection) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    await retryStuck(id);
    return NextResponse.json({
      ok: true,
      pending: await pendingCount(id),
      stuck: (await stuckChanges(id)).length,
    });
  } catch (error: unknown) {
    return serverError('modules/channels/api/outbox-state retryChannelOutbox', error);
  }
});
