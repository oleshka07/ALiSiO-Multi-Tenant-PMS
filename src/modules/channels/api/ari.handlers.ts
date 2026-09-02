import { integrationCredentials } from '@core/integration-credentials';
import { currentOrganizationId } from '@core/auth/tenant-context';
import { connectionInTenant } from '../data/connections.repo';
import { recentSends } from '../data/outbox.repo';
import { ariPublisherFor } from '../providers';
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

/** Останні відправлені координати зʼєднання з розписками вендора (П6) — для екрана, форми й живого прогону. */
export async function recentChannelSends(connectionId: string, limit = 50) {
  const connection = await connectionInTenant(connectionId);
  if (!connection) throw new Error('cm: connection not found');
  return recentSends(connectionId, limit);
}
