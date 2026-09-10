import { getSql } from '@core/db/async';
import { runWithOrganization } from '@core/auth/tenant-context';
import { hasFeature } from '@core/features';
import { integrationCredentials } from '@core/integration-credentials';
import { publishAllConnections, type PublishAllReport } from '../data/publish-all';
import { ariPublisherFor } from '../providers';
import { ALL_PROPERTIES, propertyScopeFilter } from '@core/property-scope';

/**
 * Прохід крона розсилки наявності й цін — з боку модуля.
 *
 * Близнюк `runChannelPullCron`: маршрут (`app/api/cron/channels-publish`) — це
 * автентифікація й відповідь; усе, що знає про `cm_connections`, ключі й
 * контекст орендаря, живе тут. Розкладка «пропущено / зламано / порожньо» —
 * у `publishAllConnections()`, і там же перевірка.
 *
 * Раз на хвилину (`deploy/setup-backup-cron.sh`): вендор просить збирати
 * зміни пачками по 30–60 с і після помилки не чіпати обʼєкт хвилину — крон
 * раз на хвилину і є та пауза. Застрягле (`needsAttention`) доповідається,
 * але крон від нього не червоніє: це справа екрана «Канал-менеджер».
 */
/**
 * Крон обходить УСІ будинки всіх рахунків — і це сказано дверима.
 *
 * `ALL_PROPERTIES` тут не поступка гейту, а опис роботи: планова робота не
 * має ні сесії, ні обраного обʼєкта, і звужена до одного будинку вона
 * перестала б бути кроном (INC-029, К19).
 */
const EVERY_HOUSE = propertyScopeFilter(ALL_PROPERTIES, '');

export async function runChannelPublishCron(): Promise<PublishAllReport> {
  const sql = getSql();

  return await publishAllConnections({
    organizations: async () =>
      (await sql.rows<{ id: string }>('SELECT id FROM organizations')).map((o) => o.id),

    // У контексті названої організації: прапорець прикритий політикою, а
    // цикл питає його ДО входу в орендаря — і на Postgres читав дефолт,
    // пропускаючи готель із повною чергою (INC-014). `hasFeature()` тепер
    // робить це сам; тут — явно, бо саме цей виклик мовчав.
    hasChannels: (organizationId) => runWithOrganization(organizationId, () => hasFeature(organizationId, 'channels')),

    withOrganization: (organizationId, fn) => runWithOrganization(organizationId, fn),

    // Уже всередині контексту організації — але `organization_id` у WHERE
    // однаково названо: політика прикриває лише Postgres.
    connections: async (organizationId) => {
      const rows = await sql.rows<{ id: string; provider: string; is_enabled: unknown }>(
        `SELECT id, provider, is_enabled FROM cm_connections
          WHERE organization_id = ? AND ${EVERY_HOUSE.sql}`,
        [organizationId, ...EVERY_HOUSE.params],
      );
      return rows.map((r) => ({
        id: r.id,
        provider: r.provider,
        isEnabled: Boolean(Number(r.is_enabled)),
      }));
    },

    apiKey: async (organizationId) => {
      const creds = await integrationCredentials('channel_manager', organizationId);
      return creds?.accessToken ?? null;
    },

    // Хто обслуговує зʼєднання, вирішує РЯДОК у базі (інваріант И1).
    publisherFor: ariPublisherFor,
    publish: (publisher, connectionId, apiKey) => publisher(connectionId, apiKey),
  });
}
