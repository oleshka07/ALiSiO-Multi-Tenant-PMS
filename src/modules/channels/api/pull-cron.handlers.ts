import { getSql } from '@core/db/async';
import { runWithOrganization, currentOrganizationId } from '@core/auth/tenant-context';
import { hasFeature } from '@core/features';
import { integrationCredentials } from '@core/integration-credentials';
import { pullAllConnections, type PullAllReport } from '../data/pull-all';
import { connectionInTenant } from '../data/connections.repo';
import { unprocessedEvents, markEventsProcessed } from '../data/events.repo';
import { channelsSyncedAt } from '../data/channels.repo';
import { refreshConnectionChannelsFor, channelsMirrorAgeMs } from './channels.handlers';
import type { PullReport } from '../data/pull-bookings';
import { pullerFor, adapterFor } from '../providers';

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

    // У контексті названої організації — див. publish-cron (INC-014).
    hasChannels: (organizationId) => runWithOrganization(organizationId, () => hasFeature(organizationId, 'channels')),

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

    // Рівень OTA (К2) освіжається тим самим проходом, не частіше разу на
    // годину: інакше дзеркало `cm_channels` міняється лише від кнопки
    // «Оновити», і канал, підключений учора у вікні вендора, для екрана не
    // існує. Вік — із самого дзеркала, тож перезапуск контейнера нічого не
    // скидає.
    // Читання мітки — тим самим розбором, що й екран: своя копія розійшлася б
    // із ним на форматі SQLite («YYYY-MM-DD HH:MM:SS» без зони), і дзеркало
    // «старіло» б на три години раніше на сервері за Києвом.
    mirrorAgeMs: async (connectionId) => channelsMirrorAgeMs(await channelsSyncedAt(connectionId)),
    refreshChannels: (connectionId, apiKey) => refreshConnectionChannelsFor(connectionId, apiKey),

    // Після проходу — зняти з журналу сигнали, які цей прохід і обслужив.
    pull: async (puller, connectionId, apiKey) => {
      const report = await puller(connectionId, apiKey);
      await settleBookingEvents(connectionId);
      return report;
    },
  });
}

/**
 * Один прохід стрічки ОДНОГО зʼєднання — за сигналом вебхука.
 *
 * Те саме, що робить крон для кожного зʼєднання, тим самим адаптером:
 * вебхук лише пришвидшує, стрічка гарантує (Ц20). Викликається ВСЕРЕДИНІ
 * `runWithOrganization` — засувка (`data/wake.ts`) ставить орендаря з рядка
 * зʼєднання. Вимкнене зʼєднання або готель без модуля — `null`, як і крон
 * їх пропускає; решта відмов названа винятком, який засувка журналює.
 */
export async function pullConnectionNow(connectionId: string): Promise<PullReport | null> {
  const organizationId = currentOrganizationId();
  if (!organizationId) throw new Error('cm: wake pull without a tenant');
  if (!await hasFeature(organizationId, 'channels')) return null;

  const connection = await connectionInTenant(connectionId);
  if (!connection || !connection.isEnabled) return null;

  const adapter = adapterFor(connection.provider);
  if (!adapter) throw new Error(`cm: unknown provider ${connection.provider}`);

  const creds = await integrationCredentials('channel_manager', organizationId);
  const apiKey = creds?.accessToken;
  if (!apiKey) throw new Error('cm: no channel manager key for this organization');

  const report = await adapter.pull(connectionId, apiKey);
  await settleBookingEvents(connectionId);
  return report;
}

/**
 * Зняти з журналу сигнали, які прохід стрічки щойно обслужив.
 *
 * Бронь-події зроблені самим проходом; луна — нікому не потрібна. Решта
 * («увага») лишається необробленою до руки оператора на екрані
 * «Канал-менеджер». Що є чим — каже адаптер (И1); невідомий провайдер
 * нічого не знімає: нехай оператор побачить і це.
 */
async function settleBookingEvents(connectionId: string): Promise<void> {
  const connection = await connectionInTenant(connectionId);
  const adapter = connection ? adapterFor(connection.provider) : null;
  if (!adapter) return;
  const pending = await unprocessedEvents(connectionId);
  const ids = pending
    .filter((e) => { const kind = adapter.classifyEvent(e.eventType); return kind === 'booking' || kind === 'ignore'; })
    .map((e) => e.id);
  if (ids.length) await markEventsProcessed(connectionId, { ids });
}
