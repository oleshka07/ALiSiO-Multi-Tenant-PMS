import { NextResponse, type NextRequest } from 'next/server';
import { withPermission, type Actor } from '@core/auth/session';
import { serverError } from '@core/http/errors';
import { connectionInTenant, connectionsInTenant } from '../data/connections.repo';
import { pendingCount, stuckChanges, retryStuck, recentSends } from '../data/outbox.repo';
import { unprocessedEvents } from '../data/events.repo';
import { adapterFor } from '../providers';
import { apiKeyOf } from './connect.handlers';
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
      // Події вендора, які чекають ока оператора: мапінг, підтвердження,
      // синк, канали. Бронь-події зняв прохід стрічки; луну ніхто не бачить.
      // Що є чим — каже адаптер; невідомий провайдер показує все.
      const adapter = adapterFor(c.provider);
      const attention = (await unprocessedEvents(c.id))
        .filter((e) => !adapter || adapter.classifyEvent(e.eventType) === 'attention' || adapter.classifyEvent(e.eventType) === 'message')
        .map((e) => ({ id: e.id, eventType: e.eventType, receivedAt: e.receivedAt }));
      // Останні відправлення з розписками вендора (П6): це те, що йде у форму
      // сертифікації, і єдина нитка від нашої координати до їхньої задачі.
      const sent = (await recentSends(c.id, 20)).map((row) => ({
        id: row.id, kind: row.kind, date: row.date, dateTo: row.dateTo, sentAt: row.sentAt, receipt: row.receipt,
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
        webhookRegistered: !!c.remoteWebhookId,
        pricingModifierPercent: c.pricingModifierPercent,
        pending: await pendingCount(c.id),
        stuck,
        attention,
        sent,
      });
    }
    return NextResponse.json(out);
  } catch (error: unknown) {
    return serverError('modules/channels/api/outbox-state listChannelConnections', error);
  }
});

/**
 * POST /api/channels/connections/[id]/verify — звірка П6 рукою оператора.
 *
 * Читає календар того боку для останніх відправлень і порівнює з нашими
 * джерелами; розбіжне повертає в чергу з причиною. Відповідь — кодами типів
 * і тарифів, не ідентифікаторами: оператор читає «DBL × BAR», а помилки —
 * кодами, які екран перекладає сам.
 */
export const verifyChannelSends = withPermission('manage_properties', async (
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
  actor: Actor,
) => {
  try {
    const { id } = await params;
    const connection = await connectionInTenant(id);
    if (!connection) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!connection.remotePropertyId) return NextResponse.json({ error: 'catalog_not_synced' }, { status: 409 });
    const adapter = adapterFor(connection.provider);
    if (!adapter) return NextResponse.json({ error: 'unknown_provider' }, { status: 409 });
    const apiKey = await apiKeyOf(actor.organizationId);
    if (!apiKey) return NextResponse.json({ error: 'no_key' }, { status: 409 });

    const report = await adapter.verify(id, apiKey);
    const unitTypes = new Map((await catalogUnitTypes(connection.propertyId)).map((u) => [u.id, u.code]));
    const ratePlans = new Map((await propertyRatePlans(connection.propertyId)).map((r) => [r.id, r.code]));
    return NextResponse.json({
      ...report,
      mismatches: report.mismatches.map((m) => ({
        ...m,
        unitTypeCode: unitTypes.get(m.unitTypeId) ?? m.unitTypeId,
        ratePlanCode: m.ratePlanId ? (ratePlans.get(m.ratePlanId) ?? m.ratePlanId) : null,
      })),
    });
  } catch (error: unknown) {
    return serverError('modules/channels/api/outbox-state verifyChannelSends', error);
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
