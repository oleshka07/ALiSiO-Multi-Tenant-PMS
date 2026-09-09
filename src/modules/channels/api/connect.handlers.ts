import { NextResponse, type NextRequest } from 'next/server';
import { withPermission, type Actor } from '@core/auth/session';
import { hasFeature } from '@core/features';
import { integrationCredentials, saveIntegrationCredentials } from '@core/integration-credentials';
import { currentOrganizationId } from '@core/auth/tenant-context';
import { serverError, handleError } from '@core/http/errors';
import { catalogUnitTypes } from '@properties';
import { propertyRatePlans } from '@pricing';
import { adapterFor, knownProviders } from '../providers';
import { apiKeyOf, registerWebhookSoftly } from './connect.ops';
import { connectionInTenant, connectionsForProperty, propertyCatalogStale } from '../data/connections.repo';
import { ensureConnection, propertiesInTenant, setConnectionEnabled, setupState } from '../data/connect';
import { syncConnectionCatalogFor } from './catalog.handlers';
import { fullSyncConnectionFor } from './ari.handlers';
import type { FullSyncReport } from '../data/full-sync';

/**
 * Майстер підключення менеджера каналів — з боку модуля.
 *
 * ── Що тут є, а чого немає ──────────────────────────────────────────────
 *
 * Є: варта (`manage_properties` — те саме право, що в екрана черги), фіча
 * `channels` (И8 — куплений модуль, а не намір), орендар із сесії, ключ з
 * облікових даних організації, вибір адаптера за рядком `provider`.
 *
 * Немає імені вендора (И1) і немає ключа в браузері: перевірка ключа і
 * кування разового токена — на сервері; клієнту йде лише «так/ні» і адреса
 * вікна. Адреса — перепустка на 15 хвилин, тож вона не журналюється.
 *
 * Помилки — кодами, не реченнями: екран перекладає їх сам (`check-i18n-leak`).
 */

const ENVIRONMENTS = new Set(['staging', 'production']);
/** Мови вбудованого вікна, що збігаються з мовами продукту. Решта — `en`, і це рішення (§3.6). */
const FRAME_LANGUAGES = new Set(['en', 'de']);

async function moduleOff(actor: Actor): Promise<NextResponse | null> {
  if (await hasFeature(actor.organizationId, 'channels')) return null;
  return NextResponse.json({ error: 'module_disabled' }, { status: 409 });
}

/** GET /api/channels/setup?property_id=… — на якому кроці майстер. */
export const getChannelSetup = withPermission('manage_properties', async (request: NextRequest, _ctx: unknown, actor: Actor) => {
  try {
    const off = await moduleOff(actor);
    if (off) return off;
    const propertyId = new URL(request.url).searchParams.get('property_id');
    const properties = await propertiesInTenant();
    const state = propertyId ? await setupState(propertyId) : null;
    if (propertyId && !state?.property) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ properties, providers: knownProviders(), state });
  } catch (error: unknown) {
    return serverError('modules/channels/api/connect getChannelSetup', error);
  }
});

/**
 * GET /api/channels/catalog-state?property_id=… — чи каталог розійшовся.
 *
 * ── Навіщо окремий маршрут, а не поле у відповіді збереження обʼєкта ────
 *
 * Бо форму обʼєкта зберігає `PATCH /api/properties/:id`, а він у БАЗОВОМУ
 * модулі. Дати йому знання про канали означало б завести залежність
 * `properties → channels` ще в одному файлі — рівно те, що храповик
 * `check-boundaries --strict` (друга вісь) тримає на трьох місцях, і рівно
 * те, від чого Р13.15 щойно позбавлялись. Готель без модуля каналів не має
 * ні платити за це знання, ні бачити його.
 *
 * Тому питає ЕКРАН — після того, як збереження пройшло. Шар застосунку
 * ходить у парадну модуля законно; ядро — ні.
 *
 * ── Чому мітка, а не звірка з вендором ─────────────────────────────────
 *
 * `propertyCatalogStale` рахує локально: «обʼєкт змінили після того, як ми
 * востаннє відправили каталог». Справжня звірка (`propertyDrift` — `GET`
 * обʼєкта у вендора) лишається всередині синку: екран не має права ходити в
 * чужий API, щоб намалювати рядок тексту.
 *
 * Модуль вимкнено — 409, як і решта маршрутів каналів: не 404, бо обʼєкт
 * існує, і не 200 з `false`, бо це була б неправда про стан.
 */
export const getChannelCatalogState = withPermission('manage_properties', async (request: NextRequest, _ctx: unknown, actor: Actor) => {
  try {
    const off = await moduleOff(actor);
    if (off) return off;
    const propertyId = new URL(request.url).searchParams.get('property_id');
    // Публічного дефолту тут немає (інваріант 8): не назвали обʼєкт — 400,
    // а не «візьмемо перший».
    if (!propertyId) return NextResponse.json({ error: 'property_id_required' }, { status: 400 });

    const connections = await connectionsForProperty(propertyId);
    // Чужий або неіснуючий обʼєкт: `connectionsForProperty` обмежений
    // орендарем, тож порожньо означає і «немає зʼєднань», і «не наш».
    // Обидва читаються однаково — каналу тут нема чого розходитись.
    // Ідентифікатори зʼєднань — щоб кнопка «синхронізувати зараз» мала куди
    // слати, не питаючи вдруге. Більше нічого зі зʼєднання не віддається:
    // токен вебхука і ключ у браузер не потрапляють.
    return NextResponse.json({
      connections: connections.map((c) => c.id),
      connected: connections.length > 0,
      stale: connections.length > 0 && await propertyCatalogStale(propertyId),
    });
  } catch (error: unknown) {
    return handleError('modules/channels/api/connect getChannelCatalogState', error);
  }
});

/**
 * POST /api/channels/setup/key { apiKey, provider, environment }
 *
 * Один GET до вендора одразу після вставки: помилковий ключ падає в полі
 * вводу, а не тихо через добу на першому проході крона. Простій вендора —
 * не «ключ неправильний»: 503, і людина не йде шукати помилку в кабінеті.
 */
export const saveChannelKey = withPermission('manage_properties', async (request: NextRequest, _ctx: unknown, actor: Actor) => {
  try {
    const off = await moduleOff(actor);
    if (off) return off;
    const body = (await request.json().catch(() => ({}))) ?? {};
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
    const provider = typeof body.provider === 'string' ? body.provider : '';
    const environment = typeof body.environment === 'string' ? body.environment : 'production';
    if (!apiKey) return NextResponse.json({ error: 'key_required' }, { status: 400 });
    if (!ENVIRONMENTS.has(environment)) return NextResponse.json({ error: 'bad_environment' }, { status: 400 });
    const adapter = adapterFor(provider);
    if (!adapter) return NextResponse.json({ error: 'unknown_provider' }, { status: 400 });

    let valid: boolean;
    try {
      valid = await adapter.probeKey(apiKey, environment);
    } catch (error: unknown) {
      console.error('[channels] key probe: vendor unavailable', error instanceof Error ? error.message : error);
      return NextResponse.json({ error: 'vendor_unavailable' }, { status: 503 });
    }
    if (!valid) return NextResponse.json({ error: 'invalid_key' }, { status: 422 });

    // Ключ лягає під нейтральним іменем `channel_manager` (Р9) — і майстер
    // не знає, чиї пальці його набрали: свій чи вписаний за готель.
    await saveIntegrationCredentials(actor.organizationId, 'channel_manager', { accessToken: apiKey });
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    return serverError('modules/channels/api/connect saveChannelKey', error);
  }
});

/** POST /api/channels/setup/connection { propertyId, provider, environment } — одне зʼєднання, скільки б разів не заходили. */
export const createChannelConnection = withPermission('manage_properties', async (request: NextRequest, _ctx: unknown, actor: Actor) => {
  try {
    const off = await moduleOff(actor);
    if (off) return off;
    const body = (await request.json().catch(() => ({}))) ?? {};
    const propertyId = typeof body.propertyId === 'string' ? body.propertyId : '';
    const provider = typeof body.provider === 'string' ? body.provider : '';
    const environment = typeof body.environment === 'string' ? body.environment : 'production';
    if (!propertyId) return NextResponse.json({ error: 'property_required' }, { status: 400 });
    if (!adapterFor(provider)) return NextResponse.json({ error: 'unknown_provider' }, { status: 400 });
    if (!ENVIRONMENTS.has(environment)) return NextResponse.json({ error: 'bad_environment' }, { status: 400 });
    if (!await apiKeyOf(actor.organizationId)) return NextResponse.json({ error: 'no_key' }, { status: 409 });

    try {
      const connection = await ensureConnection({ propertyId, provider, environment: environment as 'staging' | 'production' });
      return NextResponse.json(connection);
    } catch (error: unknown) {
      if (error instanceof Error && /not found/.test(error.message)) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      throw error;
    }
  } catch (error: unknown) {
    return serverError('modules/channels/api/connect createChannelConnection', error);
  }
});

type IdParams = { params: Promise<{ id: string }> };

/** POST /api/channels/connections/[id]/catalog — завести каталог; другий раз створює нуль. */
export const syncChannelCatalog = withPermission('manage_properties', async (_request: NextRequest, { params }: IdParams, actor: Actor) => {
  try {
    const off = await moduleOff(actor);
    if (off) return off;
    const { id } = await params;
    if (!await connectionInTenant(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!await apiKeyOf(actor.organizationId)) return NextResponse.json({ error: 'no_key' }, { status: 409 });
    return NextResponse.json(await syncConnectionCatalogFor(id));
  } catch (error: unknown) {
    // `handleError`, не `serverError`: варти каталогу (рід житла, пояс,
    // валюта) кидають НАЗВАНУ відмову, і саме її текст готель має побачити.
    // `serverError` затирав його до «Внутрішня помилка сервера» — тобто вся
    // мотивація тих варт помирала тут, на маршруті (Р13.10).
    return handleError('modules/channels/api/connect syncChannelCatalog', error);
  }
});

/**
 * GET /api/channels/connections/[id]/frame?lng=xx — адреса вбудованого вікна.
 *
 * Токен кується на сервері; ключ у браузер не потрапляє. Відповідь не
 * журналюється: адреса і є перепусткою.
 */
export const channelFrame = withPermission('manage_properties', async (request: NextRequest, { params }: IdParams, actor: Actor) => {
  try {
    const off = await moduleOff(actor);
    if (off) return off;
    const { id } = await params;
    const connection = await connectionInTenant(id);
    if (!connection) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!connection.remotePropertyId) return NextResponse.json({ error: 'catalog_not_synced' }, { status: 409 });
    const adapter = adapterFor(connection.provider);
    if (!adapter) return NextResponse.json({ error: 'unknown_provider' }, { status: 409 });
    const apiKey = await apiKeyOf(actor.organizationId);
    if (!apiKey) return NextResponse.json({ error: 'no_key' }, { status: 409 });

    const asked = new URL(request.url).searchParams.get('lng') ?? '';
    const lng = FRAME_LANGUAGES.has(asked) ? asked : 'en';
    const url = await adapter.frameUrl(id, apiKey, { username: actor.user.email, lng });
    return NextResponse.json({ url }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error: unknown) {
    return serverError('modules/channels/api/connect channelFrame', error);
  }
});

/** GET /api/channels/connections/[id]/reconcile — «N з N тарифів не змаплені», з кодами замість id. */
export const reconcileChannelCatalog = withPermission('manage_properties', async (_request: NextRequest, { params }: IdParams, actor: Actor) => {
  try {
    const off = await moduleOff(actor);
    if (off) return off;
    const { id } = await params;
    const connection = await connectionInTenant(id);
    if (!connection) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!connection.remotePropertyId) return NextResponse.json({ error: 'catalog_not_synced' }, { status: 409 });
    const adapter = adapterFor(connection.provider);
    if (!adapter) return NextResponse.json({ error: 'unknown_provider' }, { status: 409 });
    const apiKey = await apiKeyOf(actor.organizationId);
    if (!apiKey) return NextResponse.json({ error: 'no_key' }, { status: 409 });

    const report = await adapter.reconcile(id, apiKey);
    const unitTypes = new Map((await catalogUnitTypes(connection.propertyId)).map((u) => [u.id, u.code]));
    const ratePlans = new Map((await propertyRatePlans(connection.propertyId)).map((r) => [r.id, r.code]));
    const named = (pairs: typeof report.unmapped) => pairs.map((p) => ({
      ...p,
      unitTypeCode: unitTypes.get(p.unitTypeId) ?? p.unitTypeId,
      ratePlanCode: ratePlans.get(p.ratePlanId) ?? p.ratePlanId,
    }));
    return NextResponse.json({ ...report, unmapped: named(report.unmapped), onlyInactive: named(report.onlyInactive) });
  } catch (error: unknown) {
    return serverError('modules/channels/api/connect reconcileChannelCatalog', error);
  }
});

/** POST /api/channels/connections/[id]/enabled { enabled } */
export const setChannelConnectionEnabled = withPermission('manage_properties', async (request: NextRequest, { params }: IdParams, actor: Actor) => {
  try {
    const off = await moduleOff(actor);
    if (off) return off;
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) ?? {};
    if (typeof body.enabled !== 'boolean') return NextResponse.json({ error: 'enabled_required' }, { status: 400 });
    const current = await connectionInTenant(id);
    if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    // Увімкнути можна лише те, що є куди слати: обʼєкт на тому боці заведено.
    if (body.enabled && !current.remotePropertyId) return NextResponse.json({ error: 'catalog_not_synced' }, { status: 409 });
    const connection = await setConnectionEnabled(id, body.enabled);
    if (!body.enabled) return NextResponse.json({ ...connection, webhook: null });

    // Вебхук — частина «увімкнено»: без нього бронь з OTA чекає на крон, а
    // інтервал крона — це вікно овербукінгу (Ц20). Але НЕ умова: локальна
    // розробка вебхуків не отримує, вендор буває лежить — зʼєднання
    // вмикається, а стан вебхука повертається назвою, щоб екран показав його
    // і дав кнопку «зареєструвати ще раз». Крон тим часом працює.
    const webhook = await registerWebhookSoftly(id, current.provider, actor.organizationId);
    // Повний синк — теж частина «увімкнено» (П5, Ц23): канал має отримати
    // ПОТОЧНИЙ стан на 500 ночей, а не чекати, поки щось зміниться. І так само
    // не умова: вендор лежить — зʼєднання ввімкнене, стан лишається в черзі й
    // поїде наступним проходом, а результат повертається назвою.
    const fullSync = await fullSyncSoftly(id);
    return NextResponse.json({ ...connection, webhook, fullSync });
  } catch (error: unknown) {
    return serverError('modules/channels/api/connect setChannelConnectionEnabled', error);
  }
});

/** Результат повного синку після спроби — ніколи не виняток. */
export type FullSyncAttempt =
  | { ok: true; report: FullSyncReport }
  | { ok: false; error: 'catalog_not_synced' | 'full_sync_failed' };

export async function fullSyncSoftly(connectionId: string): Promise<FullSyncAttempt> {
  try {
    return { ok: true, report: await fullSyncConnectionFor(connectionId) };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (/catalog not synced/i.test(message)) return { ok: false, error: 'catalog_not_synced' };
    console.error('[channels] full sync failed', message);
    return { ok: false, error: 'full_sync_failed' };
  }
}

/**
 * POST /api/channels/connections/[id]/full-sync — рукою оператора (П5).
 *
 * Увесь стан на 500 ночей двома викликами; розписки й дата завершення — у
 * відповіді. Вимкнене зʼєднання не шле (батчер), тож кнопка є лише для
 * ввімкненого — а тут це 409, не мовчазна черга без відправлення.
 */
export const fullSyncChannelConnection = withPermission('manage_properties', async (_request: NextRequest, { params }: IdParams, actor: Actor) => {
  try {
    const off = await moduleOff(actor);
    if (off) return off;
    const { id } = await params;
    const connection = await connectionInTenant(id);
    if (!connection) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!connection.remotePropertyId) return NextResponse.json({ error: 'catalog_not_synced' }, { status: 409 });
    if (!connection.isEnabled) return NextResponse.json({ error: 'connection_disabled' }, { status: 409 });
    if (!await apiKeyOf(actor.organizationId)) return NextResponse.json({ error: 'no_key' }, { status: 409 });
    const report = await fullSyncConnectionFor(id);
    return NextResponse.json(report);
  } catch (error: unknown) {
    return serverError('modules/channels/api/connect fullSyncChannelConnection', error);
  }
});

// Двері без HTTP переїхали у `connect.ops.ts` (07.09.2026): цей файл імпортує
// `next/server`, а живі проходи й `apply-hotel` запускають у прод-образі, де
// вхідних точок `next/*` немає. Поки вони лежали тут, кожен, хто їх
// імпортував, тягнув із собою `next/server`. Реекспорт лишається, щоб наявні
// викликачі не переписувались; ті, кого запускають у образі, беруть
// `@channels/live`. Тримає `scripts/check-entry-imports.mjs`.
export {
  apiKeyOf, webhookErrorCode, registerWebhookSoftly,
  probeChannelKeyFor, channelFrameUrlFor, reconcileConnectionCatalogFor,
  channelSetupState, ensureChannelConnection,
} from './connect.ops';
export type { WebhookAttempt } from './connect.ops';
