import { getSql } from '@core/db/async';
import { runWithOrganization } from '@core/auth/tenant-context';
import { hasFeature } from '@core/features';
import { integrationCredentials } from '@core/integration-credentials';
import { pullAllConnections, type PullAllReport } from '../data/pull-all';
import { pullerFor } from '../providers';

/**
 * Прохід крона по стрічках бронювань — з боку модуля.
 *
 * Маршрут (`app/api/cron/channels-pull`) — це автентифікація й відповідь;
 * усе, що знає про `cm_connections`, ключі й контекст орендаря, живе тут.
 * Межа не формальна: щойно маршрут почне сам ходити в таблиці модуля, наступний
 * такий маршрут зробить це трохи інакше, і два місця розійдуться в тому, кого
 * пропускати, а про кого кричати.
 *
 * ── Чому крон, а не вебхук ──────────────────────────────────────────────
 *
 * Вебхук тут — стук у двері, а не дані: він каже «щось сталося», і по ньому
 * йдуть читати стрічку. Стрічка віддає лише НЕПІДТВЕРДЖЕНІ ревізії, тобто
 * самоочищається — пропущений вебхук не означає пропущену броню, і крон сам
 * собі страховка. Зворотне не працює: вебхук без крона означав би, що одна
 * втрачена доставка це втрачений гість.
 *
 * Розкладка на «пропущено / зламано / порожньо» — у `pullAllConnections()`,
 * і там же перевірка. Тут лише шов зі світом.
 */
export async function runChannelPullCron(): Promise<PullAllReport> {
  const sql = getSql();

  return await pullAllConnections({
    organizations: async () =>
      (await sql.rows<{ id: string }>('SELECT id FROM organizations')).map((o) => o.id),

    hasChannels: (organizationId) => hasFeature(organizationId, 'channels'),

    withOrganization: (organizationId, fn) => runWithOrganization(organizationId, fn),

    // Уже всередині контексту організації — але `organization_id` у WHERE
    // однаково названо: політика прикриває лише Postgres, а SQLite стоїть у
    // розробки, під `npm run dev` і в CI.
    connections: async (organizationId) => {
      const rows = await sql.rows<{ id: string; provider: string; is_enabled: unknown }>(
        'SELECT id, provider, is_enabled FROM cm_connections WHERE organization_id = ?',
        [organizationId],
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

    // Хто обслуговує зʼєднання, вирішує РЯДОК у базі, а не імпорт: жодне ім'я
    // менеджера каналів сюди не доходить (інваріант И1).
    pullerFor,
    pull: (puller, connectionId, apiKey) => puller(connectionId, apiKey),
  });
}
