import { NextResponse, type NextRequest } from 'next/server';
import { withPermission, type Actor } from '@core/auth/session';
import { hasFeature } from '@core/features';
import { currentOrganizationId } from '@core/auth/tenant-context';
import { serverError } from '@core/http/errors';
import { adapterFor, type ProviderAdapter } from '../providers';
import { connectionInTenant } from '../data/connections.repo';
import { markEventsProcessed } from '../data/events.repo';
import { setConnectionEnabled } from '../data/connect';
import { apiKeyOf, registerWebhookSoftly, webhookErrorCode } from './connect.handlers';

/**
 * Вебхук очима оператора: зареєструвати, перевірити, замінити секрет,
 * прибрати; і зняти з журналу те, що він побачив.
 *
 * Усе під `manage_properties` і фічею `channels`, як решта майстра; id
 * зʼєднання з URL — через `connectionInTenant` (чуже — 404). Двері
 * прийому (`webhook.handlers.ts`) живуть окремо і навмисно не знають цього
 * файла: їм мережа не потрібна (И7), а тут вона є.
 */

type IdParams = { params: Promise<{ id: string }> };

async function moduleOff(actor: Actor): Promise<NextResponse | null> {
  if (await hasFeature(actor.organizationId, 'channels')) return null;
  return NextResponse.json({ error: 'module_disabled' }, { status: 409 });
}

type Armed =
  | { fail: NextResponse; adapter?: undefined; apiKey?: undefined }
  | { fail?: undefined; adapter: ProviderAdapter; apiKey: string };

/** Спільний вступ: зʼєднання орендаря, адаптер, ключ — або готова відмова. */
async function armed(actor: Actor, id: string): Promise<Armed> {
  const connection = await connectionInTenant(id);
  if (!connection) return { fail: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
  const adapter = adapterFor(connection.provider);
  if (!adapter) return { fail: NextResponse.json({ error: 'unknown_provider' }, { status: 409 }) };
  const apiKey = await apiKeyOf(actor.organizationId);
  if (!apiKey) return { fail: NextResponse.json({ error: 'no_key' }, { status: 409 }) };
  return { adapter, apiKey };
}

function vendorFailure(scope: string, error: unknown): NextResponse {
  const code = webhookErrorCode(error);
  if (code === 'app_url_not_configured' || code === 'catalog_not_synced') return NextResponse.json({ error: code }, { status: 409 });
  if (/not registered/i.test(error instanceof Error ? error.message : '')) return NextResponse.json({ error: 'webhook_not_registered' }, { status: 409 });
  console.error(`[channels] ${scope}`, error instanceof Error ? error.message : error);
  return NextResponse.json({ error: code === 'webhook_inactive' ? 'webhook_inactive' : 'vendor_unavailable' }, { status: code === 'webhook_inactive' ? 502 : 503 });
}

/** POST /api/channels/connections/[id]/webhook — зареєструвати або полагодити; стан назвою, не винятком. */
export const ensureChannelWebhook = withPermission('manage_properties', async (_request: NextRequest, { params }: IdParams, actor: Actor) => {
  try {
    const off = await moduleOff(actor);
    if (off) return off;
    const { id } = await params;
    const connection = await connectionInTenant(id);
    if (!connection) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(await registerWebhookSoftly(id, connection.provider, actor.organizationId));
  } catch (error: unknown) {
    return serverError('modules/channels/api/webhook-admin ensureChannelWebhook', error);
  }
});

/** DELETE /api/channels/connections/[id]/webhook — прибрати у вендора і стерти слід. */
export const removeChannelWebhook = withPermission('manage_properties', async (_request: NextRequest, { params }: IdParams, actor: Actor) => {
  try {
    const off = await moduleOff(actor);
    if (off) return off;
    const { id } = await params;
    const a = await armed(actor, id);
    if (a.fail) return a.fail;
    try {
      return NextResponse.json(await a.adapter.removeWebhook(id, a.apiKey));
    } catch (error: unknown) {
      return vendorFailure('removeChannelWebhook', error);
    }
  } catch (error: unknown) {
    return serverError('modules/channels/api/webhook-admin removeChannelWebhook', error);
  }
});

/** POST /api/channels/connections/[id]/webhook/test — вендор стукає в наші двері і каже, що побачив (И27). */
export const testChannelWebhook = withPermission('manage_properties', async (_request: NextRequest, { params }: IdParams, actor: Actor) => {
  try {
    const off = await moduleOff(actor);
    if (off) return off;
    const { id } = await params;
    const a = await armed(actor, id);
    if (a.fail) return a.fail;
    try {
      return NextResponse.json(await a.adapter.testWebhook(id, a.apiKey), { headers: { 'Cache-Control': 'no-store' } });
    } catch (error: unknown) {
      return vendorFailure('testChannelWebhook', error);
    }
  } catch (error: unknown) {
    return serverError('modules/channels/api/webhook-admin testChannelWebhook', error);
  }
});

/** POST /api/channels/connections/[id]/webhook/rotate — новий секрет: спершу вендор, потім база. */
export const rotateChannelWebhookSecret = withPermission('manage_properties', async (_request: NextRequest, { params }: IdParams, actor: Actor) => {
  try {
    const off = await moduleOff(actor);
    if (off) return off;
    const { id } = await params;
    const a = await armed(actor, id);
    if (a.fail) return a.fail;
    try {
      await a.adapter.rotateWebhookSecret(id, a.apiKey);
      return NextResponse.json({ ok: true });
    } catch (error: unknown) {
      return vendorFailure('rotateChannelWebhookSecret', error);
    }
  } catch (error: unknown) {
    return serverError('modules/channels/api/webhook-admin rotateChannelWebhookSecret', error);
  }
});

/** POST /api/channels/connections/[id]/events/dismiss { ids } — оператор побачив; лічильник чесний. */
export const dismissChannelEvents = withPermission('manage_properties', async (request: NextRequest, { params }: IdParams, actor: Actor) => {
  try {
    const off = await moduleOff(actor);
    if (off) return off;
    const { id } = await params;
    if (!await connectionInTenant(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const body = (await request.json().catch(() => ({}))) ?? {};
    const ids = Array.isArray(body.ids) ? body.ids.filter((x: unknown): x is string => typeof x === 'string' && x.length > 0) : [];
    if (ids.length === 0) return NextResponse.json({ error: 'ids_required' }, { status: 400 });
    return NextResponse.json({ dismissed: await markEventsProcessed(id, { ids }) });
  } catch (error: unknown) {
    return serverError('modules/channels/api/webhook-admin dismissChannelEvents', error);
  }
});

/**
 * POST /api/channels/connections/[id]/disconnect — відʼєднати: вебхук у
 * вендора прибрано, розсилку вимкнено. Рядок лишається: під ним висять
 * прийняті броні (`cm_inbound_bookings` — доказ у суперечці), і каскад
 * видалення забрав би їх із собою. Вимкнене зʼєднання нічого не шле і не
 * читає; повторне ввімкнення — знову через майстер.
 */
export const disconnectChannelConnection = withPermission('manage_properties', async (_request: NextRequest, { params }: IdParams, actor: Actor) => {
  try {
    const off = await moduleOff(actor);
    if (off) return off;
    const { id } = await params;
    const a = await armed(actor, id);
    if (a.fail) return a.fail;
    try {
      // Спершу вендор: інакше в акаунті готельєра лишається вебхук, що
      // стукає у вимкнене зʼєднання — мертвий виклик, який ніхто не бачить.
      const webhook = await a.adapter.removeWebhook(id, a.apiKey);
      const connection = await setConnectionEnabled(id, false);
      return NextResponse.json({ ...connection, webhook });
    } catch (error: unknown) {
      return vendorFailure('disconnectChannelConnection', error);
    }
  } catch (error: unknown) {
    return serverError('modules/channels/api/webhook-admin disconnectChannelConnection', error);
  }
});

// Двері без HTTP переїхали у `webhook-admin.ops.ts` (07.09.2026) — з тієї
// самої причини, що й у `connect.ops.ts`: цей файл імпортує `next/server`,
// якого прод-образ не має, а живий прохід вебхука запускають саме там.
export { ensureConnectionWebhookFor, removeConnectionWebhookFor, testConnectionWebhookFor } from './webhook-admin.ops';
