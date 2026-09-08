/**
 * Вебхук зʼєднання БЕЗ HTTP — для живого прогону й інструментів оператора.
 *
 * Відщеплено від `webhook-admin.handlers.ts` 07.09.2026: той імпортує
 * `next/server`, якого немає в прод-образі Next standalone, а
 * `scripts/channex-webhook-live.mjs` запускають саме в образі. Правило файлу
 * те саме, що в `connect.ops.ts`: ні `NextResponse`, ні варти маршруту —
 * орендар приходить від викликача (`runWithOrganization`).
 */
import { currentOrganizationId } from '@core/auth/tenant-context';
import { adapterFor } from '../providers';
import { connectionInTenant } from '../data/connections.repo';
import { apiKeyOf } from './connect.ops';



async function armedFor(connectionId: string) {
  const organizationId = currentOrganizationId();
  if (!organizationId) throw new Error('webhook: call without a tenant');
  const connection = await connectionInTenant(connectionId);
  if (!connection) throw new Error('webhook: connection not found');
  const adapter = adapterFor(connection.provider);
  if (!adapter) throw new Error(`webhook: unknown provider ${connection.provider}`);
  const apiKey = await apiKeyOf(organizationId);
  if (!apiKey) throw new Error('webhook: no channel manager key for this organization');
  return { adapter, apiKey };
}

export async function ensureConnectionWebhookFor(connectionId: string) {
  const { adapter, apiKey } = await armedFor(connectionId);
  return adapter.ensureWebhook(connectionId, apiKey);
}

export async function removeConnectionWebhookFor(connectionId: string) {
  const { adapter, apiKey } = await armedFor(connectionId);
  return adapter.removeWebhook(connectionId, apiKey);
}

export async function testConnectionWebhookFor(connectionId: string) {
  const { adapter, apiKey } = await armedFor(connectionId);
  return adapter.testWebhook(connectionId, apiKey);
}
