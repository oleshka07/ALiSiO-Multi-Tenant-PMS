import { NextResponse, type NextRequest } from 'next/server';
import { withPermission, type Actor } from '@core/auth/session';
import { hasFeature } from '@core/features';
import { serverError } from '@core/http/errors';
import { catalogUnitTypes } from '@properties';
import { propertyRatePlans } from '@pricing';
import { adapterFor } from '../providers';
import { connectionInTenant } from '../data/connections.repo';
import { connectionMirror } from '../data/mappings.repo';
import { channelsOf, channelsSyncedAt, putChannels } from '../data/channels.repo';
import { apiKeyOf } from './connect.handlers';

/**
 * Рівень OTA — читання (К2).
 *
 * ── Що екран показує і звідки це береться ───────────────────────────────
 *
 * «Підключені» і «У налаштуванні» — з дзеркала `cm_channels`, тобто з
 * відповіді вендора. «Доступні» — з каталогу адаптерів вендора, який ніде не
 * зберігається: перелік належить йому і росте.
 *
 * Головне — третій стовпчик: які НАШІ пари «тип × тариф» продаються на
 * кожному каналі. Канал знає лише чужі ідентифікатори тарифів; переклад у
 * наші — через `cm_mappings`, і саме він перетворює Ц8 з інструкції
 * готельєру на число на екрані.
 *
 * ── Чого тут немає навмисно ─────────────────────────────────────────────
 *
 * ЗАПИСУ. Ні підключити канал, ні змінити його налаштування, ні змапити
 * тариф звідси не можна — це ЧЕКПОІНТ рецензента (К2): мапінг у кожного OTA
 * свій, і писати його наосліп означає зламати те, що готельєр налаштував
 * руками. Кнопка веде у вбудоване вікно вендора (Ц19), де це й робиться.
 *
 * `POST …/channels` тут — це «перечитати», а не «записати».
 */

interface IdParams { params: Promise<{ id: string }> }

/**
 * Як часто можна питати вендора про канали.
 *
 * Година, і це не обережність заради обережності: перелік каналів не ARI й
 * під ліміт 10/хв не підпадає, але бюджет у вендора один на обʼєкт, і екран,
 * який питає його на кожне відкриття, зʼїдає той самий бюджет, з якого їдуть
 * ціни. Канали при цьому міняються не щохвилини — їх підключають руками.
 *
 * Прострочене читається з дзеркала й позначається віком: «дані годину як
 * застарілі» видно, і кнопка «Оновити» поруч.
 */
const REFRESH_EVERY_MS = 60 * 60 * 1000;

async function moduleOff(actor: Actor): Promise<NextResponse | null> {
  if (await hasFeature(actor.organizationId, 'channels')) return null;
  return NextResponse.json({ error: 'module_disabled' }, { status: 409 });
}

/** Скільки минуло від мітки. `null` — ще не питали. */
function ageMs(syncedAt: string | null): number | null {
  if (!syncedAt) return null;
  // Мітка приходить із бази: Postgres віддає ISO з зоною, SQLite —
  // `YYYY-MM-DD HH:MM:SS` в UTC без неї. Без `Z` друге читається як місцевий
  // час, і на сервері за Києвом дзеркало «постаріло» б на три години раніше.
  const normalized = /[Zz]|[+-]\d\d:?\d\d$/.test(syncedAt) ? syncedAt : `${syncedAt.replace(' ', 'T')}Z`;
  const at = Date.parse(normalized);
  return Number.isFinite(at) ? Date.now() - at : null;
}

/**
 * Зібрати відповідь екрана з дзеркала й наших назв.
 *
 * Коди замість ідентифікаторів — бо ідентифікатор нічого не каже людині, а
 * екран цей читає готельєр, а не ми (`reconcileChannelCatalog` робить так
 * само).
 */
async function screen(connectionId: string, propertyId: string) {
  const [channels, syncedAt, mirror, unitTypes, ratePlans] = await Promise.all([
    channelsOf(connectionId),
    channelsSyncedAt(connectionId),
    connectionMirror(connectionId),
    catalogUnitTypes(propertyId),
    propertyRatePlans(propertyId),
  ]);

  const unitTypeCode = new Map(unitTypes.map((u) => [u.id, u.code]));
  const ratePlanCode = new Map(ratePlans.map((r) => [r.id, r.code]));
  const pairs = mirror.filter((m) => m.entityType === 'rate_plan');

  const named = (p: { localId: string; unitTypeId: string; remoteId: string }) => ({
    ratePlanId: p.localId,
    unitTypeId: p.unitTypeId,
    ratePlanCode: ratePlanCode.get(p.localId) ?? p.localId,
    unitTypeCode: unitTypeCode.get(p.unitTypeId) ?? p.unitTypeId,
  });

  const withPairs = channels.map((c) => ({
    remoteChannelId: c.remoteChannelId,
    otaCode: c.otaCode,
    title: c.title,
    isActive: c.isActive,
    settings: c.settings,
    // Наші пари, що продаються на цьому каналі. Порожньо — канал підключено,
    // але нічого з нашого на нього не змаплено: рівно та діра, яку Ц8
    // закривав інструкцією.
    pairs: pairs.filter((p) => c.mappedRemoteRatePlanIds.includes(p.remoteId)).map(named),
    /** Тарифи каналу, яких немає в НАШОМУ дзеркалі: змаплені повз наш каталог. */
    foreignRatePlans: c.mappedRemoteRatePlanIds.filter((id) => !pairs.some((p) => p.remoteId === id)).length,
  }));

  // Звірка Ц8 числом: пара, заведена у вендора й не продавана ніде.
  const soldAnywhere = new Set(channels.flatMap((c) => c.mappedRemoteRatePlanIds));
  const soldActive = new Set(channels.filter((c) => c.isActive).flatMap((c) => c.mappedRemoteRatePlanIds));

  return {
    channels: withPairs,
    syncedAt,
    ageMs: ageMs(syncedAt),
    staleAfterMs: REFRESH_EVERY_MS,
    totalPairs: pairs.length,
    // «Тариф є в дзеркалі, але не змаплений на жоден канал» — і окремо
    // «змаплений лише на вимкнений»: лікуються вони по-різному, і змішати їх
    // означає послати людину не туди (той самий довід, що в `reconcile.ts`).
    unmapped: pairs.filter((p) => !soldAnywhere.has(p.remoteId)).map(named),
    onlyInactive: pairs.filter((p) => soldAnywhere.has(p.remoteId) && !soldActive.has(p.remoteId)).map(named),
  };
}

/**
 * Двері модуля: перечитати рівень OTA одного зʼєднання і повернути екранний вигляд.
 *
 * Те саме, що робить маршрут, тільки без сесії — для крона й живих скриптів.
 * Двері, а не внутрішність: скрипт, який імпортує `data/` і `channex/` навпростець,
 * пробиває межу модуля (`check-boundaries`), і саме на цьому впала перша
 * редакція `channex-channels-live.mjs`.
 *
 * Орендар мусить бути вже встановлений викликачем (`runWithOrganization`):
 * зʼєднання читається ЧЕРЕЗ нього, а не за самим лише id (INC-010).
 */
export async function refreshConnectionChannelsFor(connectionId: string, apiKey: string) {
  const connection = await connectionInTenant(connectionId);
  if (!connection) throw new Error('channels: connection not found');
  const adapter = adapterFor(connection.provider);
  if (!adapter) throw new Error(`channels: unknown provider ${connection.provider}`);

  const snapshot = await adapter.channels(connectionId, apiKey);
  await putChannels(connectionId, snapshot.rows);
  return {
    ...(await screen(connectionId, connection.propertyId)),
    catalog: snapshot.catalog,
    skipped: snapshot.skipped,
  };
}

/** Рівень OTA з дзеркала, без походу до вендора — для скриптів і звітів. */
export async function connectionChannelsFor(connectionId: string) {
  const connection = await connectionInTenant(connectionId);
  if (!connection) throw new Error('channels: connection not found');
  return { ...(await screen(connectionId, connection.propertyId)), catalog: [] };
}

/** GET /api/channels/connections/[id]/channels — рівень OTA з дзеркала. */
export const listConnectionChannels = withPermission('manage_properties', async (_request: NextRequest, { params }: IdParams, actor: Actor) => {
  try {
    const off = await moduleOff(actor);
    if (off) return off;
    const { id } = await params;
    // Чуже зʼєднання — 404, не 403 (інваріант 5): існування чужого рядка теж
    // відповідь.
    const connection = await connectionInTenant(id);
    if (!connection) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const adapter = adapterFor(connection.provider);
    return NextResponse.json({
      ...(await screen(id, connection.propertyId)),
      provider: adapter?.label ?? connection.provider,
      // Каталог доступних OTA не зберігається, тож у читанні з дзеркала його
      // немає: він приїжджає з «Оновити». Порожній список означає «ще не
      // питали», і екран каже саме це, а не «каналів не буває».
      catalog: [],
    });
  } catch (error: unknown) {
    return serverError('modules/channels/api/channels listConnectionChannels', error);
  }
});

/**
 * POST /api/channels/connections/[id]/channels — перечитати рівень OTA.
 *
 * Не «записати»: запис мапінгу з нашого боку — ЧЕКПОІНТ рецензента (К2).
 * Тіло не читається взагалі.
 */
export const refreshConnectionChannels = withPermission('manage_properties', async (request: NextRequest, { params }: IdParams, actor: Actor) => {
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

    // Лімітер: не частіше разу на годину, і його можна обійти лише свідомо
    // (`?force=1` з екрана — кнопка «все одно оновити»). Це не захист від
    // зловмисника, а захист бюджету обʼєкта від екрана, який перечитують.
    const force = new URL(request.url).searchParams.get('force') === '1';
    const age = ageMs(await channelsSyncedAt(id));
    if (!force && age !== null && age < REFRESH_EVERY_MS) {
      return NextResponse.json({
        error: 'too_soon',
        retryAfterMs: REFRESH_EVERY_MS - age,
        ...(await screen(id, connection.propertyId)),
      }, { status: 429 });
    }

    const snapshot = await adapter.channels(id, apiKey);
    await putChannels(id, snapshot.rows);

    return NextResponse.json({
      ...(await screen(id, connection.propertyId)),
      provider: adapter.label,
      catalog: snapshot.catalog,
      // Канал, якого не вдалося прочитати, називається, а не зникає мовчки.
      skipped: snapshot.skipped,
    });
  } catch (error: unknown) {
    return serverError('modules/channels/api/channels refreshConnectionChannels', error);
  }
});
