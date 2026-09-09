export { listIcalChannels, createIcalChannel } from './ical-channels.handlers';
export { updateIcalChannel, deleteIcalChannel } from './ical-channel.handlers';
export { syncIcal } from './ical-sync.handlers';
export { runIcalCron } from './ical-cron.handlers';
export { exportIcal } from './ical-export.handlers';
export { runChannelPullCron } from './pull-cron.handlers';
export { runChannelPublishCron } from './publish-cron.handlers';
export { syncConnectionCatalogFor, channelConnection, connectionMirror } from './catalog.handlers';
// Зʼєднання обʼєкта — для Setup progress (крок 8 «Канал або сайт»): читає
// модуль обʼєктів через фасад, а не SQL до cm_connections.
export { connectionsForProperty } from '../data/connections.repo';
export {
  flushConnectionOutboxFor, enqueueChannelChange, pendingChannelChanges,
  queuedChannelChanges, stuckChannelChanges, retryStuckChannelChanges, recentChannelSends,
  verifyConnectionSendsFor, fullSyncConnectionFor, recentChannelSendLog, purgeChannelSendLogs,
} from './ari.handlers';
export type { SendLogPurgeReport } from './ari.handlers';
export type { SendLogRow, SendSummary } from '../data/sends.repo';
export type { ChannelChange, FlushReport, SendsVerification, SendMismatch, FullSyncReport, FullSyncPlan } from './ari.handlers';
export { noteAvailabilityChanged, noteRatesChanged, lastNight } from './outbox';
export type { AvailabilityNote, RateNote } from './outbox';
export { listChannelConnections, retryChannelOutbox, verifyChannelSends } from './outbox-state.handlers';
export {
  getChannelSetup, getChannelCatalogState, saveChannelKey, createChannelConnection, syncChannelCatalog,
  channelFrame, reconcileChannelCatalog, setChannelConnectionEnabled, fullSyncChannelConnection,
} from './connect.handlers';
export {
  probeChannelKeyFor, channelFrameUrlFor, reconcileConnectionCatalogFor,
  channelSetupState, ensureChannelConnection,
} from './connect.handlers';
export { receiveChannelWebhook } from './webhook.handlers';
export { pullConnectionNow } from './pull-cron.handlers';
export {
  ensureChannelWebhook, removeChannelWebhook, testChannelWebhook, rotateChannelWebhookSecret,
  dismissChannelEvents, disconnectChannelConnection,
  ensureConnectionWebhookFor, removeConnectionWebhookFor, testConnectionWebhookFor,
} from './webhook-admin.handlers';
export { recordVendorResponses } from '../providers';
export type { VendorResponseSample } from '../providers';

/*
 * Рід житла фасадом НЕ віддається, і це навмисно.
 *
 * Перелік родів житла живе в ядрі (`@core/lodging-kinds`) — його читають
 * форма обʼєкта і писач, яким модуль каналів не потрібен (Р13.15). Мапа в
 * `property_type` вендора — знання адаптера, і далі `channex/` не виходить:
 * тримає `check-vendor-isolation --strict`, який на першій редакції цієї
 * правки і почервонів, коли мапа була виставлена сюди.
 */
// Рівень OTA (К2) — лише читання; запис мапінгу це ЧЕКПОІНТ рецензента.
export { listConnectionChannels, refreshConnectionChannels } from './channels.handlers';
// Ці дві — з `channels.ops`: вони без `next/*`, і саме їх кличуть крон і живі
// скрипти. Через `channels.handlers` фасад тягнув би `next/server`.
export { refreshConnectionChannelsFor, connectionChannelsFor } from './channels.ops';
