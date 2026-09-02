import { ChannexClient, type ChannexEnvironment } from './client';
import { connectionInTenant } from '../data/connections.repo';
import { connectionMirror } from '../data/mappings.repo';
import { reconcileMappings, type CatalogReconciliation } from '../domain/reconcile.ts';

/**
 * Майстер підключення — з боку вендора: перевірка ключа, вікно, звірка.
 *
 * Тієї ж форми, що решта адаптерів (`connectionId, apiKey`), і з тієї ж
 * причини: імʼя вендора, адреса його сервера й форма разового токена живуть
 * лише тут (И1). Порядок кроків і стан майстра — у `data/connect.ts`, і
 * вони жодного з цих слів не бачать.
 */

/** Чи справжній ключ — один GET, до збереження. */
export function probeKey(apiKey: string, environment: string): Promise<boolean> {
  return new ChannexClient({ apiKey, environment: environment as ChannexEnvironment }).probeKey(apiKey);
}

/**
 * Адреса вбудованого вікна `/channels` — токен кується тут, ключ у браузер
 * не йде. Не журналюється: адреса і є перепусткою на 15 хвилин.
 */
export async function frameUrl(
  connectionId: string,
  apiKey: string,
  options: { username: string; lng?: string },
): Promise<string> {
  const connection = await connectionInTenant(connectionId);
  if (!connection) throw new Error('connection not found');
  if (!connection.remotePropertyId) throw new Error('catalog not synced: the connection has no remote property yet');

  const client = new ChannexClient({ apiKey, environment: connection.environment as ChannexEnvironment });
  return client.channelsFrameUrl(apiKey, connection.remotePropertyId, options);
}

/** Звірка Ц8: які з наших пар змаплені на канали, а які продаються нікуди. */
export async function reconcile(connectionId: string, apiKey: string): Promise<CatalogReconciliation> {
  const connection = await connectionInTenant(connectionId);
  if (!connection) throw new Error('connection not found');
  if (!connection.remotePropertyId) throw new Error('catalog not synced: the connection has no remote property yet');

  const client = new ChannexClient({ apiKey, environment: connection.environment as ChannexEnvironment });
  const channels = await client.listChannels(apiKey, connection.remotePropertyId);
  const pairs = (await connectionMirror(connectionId))
    .filter((m) => m.entityType === 'rate_plan')
    .map((m) => ({ ratePlanId: m.localId, unitTypeId: m.unitTypeId, remoteId: m.remoteId }));
  return reconcileMappings(pairs, channels);
}
