/**
 * Двері для ВХОДІВ, які запускають у прод-образі.
 *
 *   import { channelConnection, connectionMirror } from '@channels/live';
 *
 * Той самий рід дверей, що `@channels/outbox` і `@pricing/plans`, і з тієї
 * самої причини — але для іншого викликача. `outbox` існує, бо писачі кличуть
 * чергу з гарячого шляху; ці двері існують, бо `scripts/channex-*-live.mjs`,
 * `apply-hotel` та решта інструментів оператора виконуються ВСЕРЕДИНІ
 * контейнера, а Next standalone вирізає з `node_modules` вхідні точки
 * `next/*`. Повний фасад `@channels` тягне `ical-channels.handlers` першим же
 * рядком, той — `next/server`, і живий прохід ARI не запускався в образі
 * взагалі: перегравання сертифікації стояло на цьому.
 *
 * Тут лише реекспорт із шарів БЕЗ обробників (`data/`, `providers/`,
 * `*.ops.ts`, і ті `*.handlers.ts`, що самі `next/*` не імпортують). Нового
 * коду в цьому файлі не буває: він мусить лишатися списком, який видно очима.
 *
 * Тримає `scripts/check-entry-imports.mjs` — він піднімає кожен вхід із
 * гачком, що відмовляє на `next/*`, як образ.
 */
export { connectionInTenant as channelConnection } from '../data/connections.repo';
export { connectionMirror } from '../data/mappings.repo';
export { connectionsForProperty } from '../data/connections.repo';
export { syncConnectionCatalogFor } from './catalog.handlers';
export {
  flushConnectionOutboxFor, fullSyncConnectionFor, verifyConnectionSendsFor,
  recentChannelSends, recentChannelSendLog,
} from './ari.handlers';
export {
  enqueueChange as enqueueChannelChange,
  pendingCount as pendingChannelChanges,
  queuedChanges as queuedChannelChanges,
  stuckChanges as stuckChannelChanges,
} from '../data/outbox.repo';
export { pullConnectionNow } from './pull-cron.handlers';
export {
  apiKeyOf, probeChannelKeyFor, channelFrameUrlFor, reconcileConnectionCatalogFor,
  channelSetupState, ensureChannelConnection,
} from './connect.ops';
export {
  ensureConnectionWebhookFor, removeConnectionWebhookFor, testConnectionWebhookFor,
} from './webhook-admin.ops';
export { recordVendorResponses } from '../providers';
export type { VendorResponseSample } from '../providers';
export type { FlushReport, FullSyncReport, FullSyncPlan, SendsVerification, SendMismatch, ChannelChange } from './ari.handlers';
// Рівень OTA (К2). З `channels.ops`, не з `channels.handlers`: варта на
// маршруті лишається там, а сюди їде лише те, що вміє працювати без сесії.
export { refreshConnectionChannelsFor, connectionChannelsFor, channelsMirrorAgeMs } from './channels.ops';
