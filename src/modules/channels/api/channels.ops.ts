/**
 * Рівень OTA без `next/*` — двері для крона, скриптів і живих проходів.
 *
 * ── Навіщо окремий файл ─────────────────────────────────────────────────
 *
 * Той самий розклад, що `connect.ops.ts` і `webhook-admin.ops.ts`, і та сама
 * причина: Next standalone вирізає `next/*` із `node_modules`, а
 * `scripts/channex-*-live.mjs` і крон стрічки виконуються ВСЕРЕДИНІ образу.
 * Поки `refreshConnectionChannelsFor` жила в `channels.handlers.ts`, вона
 * тягла за собою `next/server` — і `pull-cron.handlers`, який її кличе,
 * тягнув його в кожен живий вхід через `@channels/live`.
 *
 * Знайшлось перебазуванням на голову гілки робіт: `check-entry-imports`
 * назвав два входи (`channex-stop-sell-live`, `channex-webhook-live`) і
 * ланцюжок до `next/server`. Обидві половини писались правильно — просто в
 * різних гілках, і зустрілись уперше тут.
 *
 * Тут немає жодного `NextResponse` і жодної варти: варта лишається на
 * маршруті (`channels.handlers.ts`), бо вона про СЕСІЮ, а сесії в крона
 * немає. Орендар мусить бути вже встановлений викликачем
 * (`runWithOrganization`) — зʼєднання читається через нього, не за самим id.
 */
import { catalogUnitTypes } from '@properties/live';
// Вузькі двері, не повні фасади: обидва тягнуть next/server через свої
// обробники, а цей файл читають живі входи (check-entry-imports).
import { propertyRatePlans } from '@pricing/plans';
import { adapterFor } from '../providers';
import { connectionInTenant } from '../data/connections.repo';
import { connectionMirror } from '../data/mappings.repo';
import { channelsOf, channelsSyncedAt, putChannels } from '../data/channels.repo';

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
export const REFRESH_EVERY_MS = 60 * 60 * 1000;

/** Скільки минуло від мітки. `null` — ще не питали. */
export function channelsMirrorAgeMs(syncedAt: string | null): number | null {
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
export async function screen(connectionId: string, propertyId: string) {
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
    ageMs: channelsMirrorAgeMs(syncedAt),
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

