import { integrationCredentials } from '@core/integration-credentials';
import { currentOrganizationId } from '@core/auth/tenant-context';
import { connectionInTenant } from '../data/connections.repo';
import { recentSends } from '../data/outbox.repo';
import { runFullSync, type FullSyncReport } from '../data/full-sync';
import { ariPublisherFor, adapterFor } from '../providers';
import type { FlushReport } from '../domain/ari-batch.ts';

/**
 * Один прохід батчера по одному зʼєднанню — з боку модуля.
 *
 * Та сама двері, що `syncConnectionCatalogFor`: орендар, ключ, вибір
 * адаптера за рядком `provider` (И1). Викликач сьогодні один —
 * `scripts/channex-ari-live.mjs`, який ганяє прохід проти живого staging.
 * Крон, що обійде всі зʼєднання, і кнопка в майстрі викличуть саме цю
 * функцію; жоден із них не додається наперед — крон без екрана застряглих
 * координат це черга, про яку ніхто не дізнається (§Фаза 4).
 */
export async function flushConnectionOutboxFor(
  connectionId: string,
  options: { today?: string } = {},
): Promise<FlushReport> {
  const organizationId = currentOrganizationId();
  if (!organizationId) throw new Error('ari: flush without a tenant');

  // Чуже й неіснуюче однаково дають `null` — 404, не 403 (інваріант 5).
  const connection = await connectionInTenant(connectionId);
  if (!connection) throw new Error('ari: connection not found');

  const publisher = ariPublisherFor(connection.provider);
  if (!publisher) throw new Error(`ari: unknown provider ${connection.provider}`);

  const credentials = await integrationCredentials('channel_manager', organizationId);
  const apiKey = credentials?.accessToken;
  if (!apiKey) throw new Error('ari: no channel manager key for this organization');

  return publisher(connectionId, apiKey, options);
}

/**
 * Черга вихідних змін — двері для решти модулів і для екрана оператора.
 *
 * `enqueueChannelChange` кличеться В ТІЙ САМІЙ транзакції, що й сама зміна
 * (бронь, ціна): черга, яка поповнюється окремим кроком, розходиться зі
 * станом при першому ж падінні між ними. Застряглі координати
 * (`stuckChannelChanges`) — це стан «потребує уваги»; назад у чергу їх
 * повертає лише рука оператора (`retryStuckChannelChanges`).
 */
export {
  enqueueChange as enqueueChannelChange,
  pendingCount as pendingChannelChanges,
  queuedChanges as queuedChannelChanges,
  stuckChanges as stuckChannelChanges,
  retryStuck as retryStuckChannelChanges,
} from '../data/outbox.repo';
export type { ClaimedChange as ChannelChange } from '../data/outbox.repo';
export type { FlushReport } from '../domain/ari-batch.ts';
export type { SendsVerification, Mismatch as SendMismatch } from '../domain/verify.ts';
export type { FullSyncReport, FullSyncPlan } from '../data/full-sync';

/**
 * Повний синк (П5): весь стан зʼєднання одним діапазоном на адресата → один
 * прохід → рівно два виклики. Кличуть кнопка в майстрі й увімкнення розсилки;
 * таймера тут немає і не буде (И6, `check-no-timer-fullsync.mjs`).
 */
export async function fullSyncConnectionFor(
  connectionId: string,
  options: { today?: string } = {},
): Promise<FullSyncReport> {
  return runFullSync(connectionId, (id) => flushConnectionOutboxFor(id, { today: options.today }), options.today);
}

/**
 * Звірка П6: останні відправлення проти календаря менеджера каналів.
 *
 * Розписка каже «взяв», не «застосував», а ендпоінта стану задачі у вендора
 * немає — «доїхало» доводить лише читання назад. Розбіжне повертається в
 * чергу з причиною і поїде наступним проходом; не віддане названо окремо.
 * Кличуть кнопка «Звірити з каналом» і живий прохід; таймера тут немає і
 * не буде — звірка читає календар, і пів року щохвилини це не звірка, а
 * навантаження.
 */
export async function verifyConnectionSendsFor(
  connectionId: string,
  options: { limit?: number; minAgeSeconds?: number; today?: string } = {},
) {
  const organizationId = currentOrganizationId();
  if (!organizationId) throw new Error('ari: verify without a tenant');
  const connection = await connectionInTenant(connectionId);
  if (!connection) throw new Error('ari: connection not found');
  const adapter = adapterFor(connection.provider);
  if (!adapter) throw new Error(`ari: unknown provider ${connection.provider}`);
  const credentials = await integrationCredentials('channel_manager', organizationId);
  const apiKey = credentials?.accessToken;
  if (!apiKey) throw new Error('ari: no channel manager key for this organization');
  return adapter.verify(connectionId, apiKey, options);
}

/** Останні відправлені координати зʼєднання з розписками вендора (П6) — для екрана, форми й живого прогону. */
export async function recentChannelSends(connectionId: string, limit = 50) {
  const connection = await connectionInTenant(connectionId);
  if (!connection) throw new Error('cm: connection not found');
  return recentSends(connectionId, limit);
}
