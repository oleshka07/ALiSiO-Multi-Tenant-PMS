import { getSql } from '@core/db/async';
import { ChannexClient, type ChannexEnvironment } from './client';
import { mapRevision } from './revision-map';
import { connectionInTenant } from '../data/connections.repo';
import { mappingMirror } from '../data/mappings.repo';
import { applyRevision } from '../data/inbound-bookings.repo';
import { pullBookings, type PullReport } from '../data/pull-bookings';

/**
 * Шов: клієнт вендора з одного боку, доменний цикл з іншого.
 *
 * Це єдине місце, де ці двоє зустрічаються, і воно навмисно тонке. Цикл
 * (`../data/pull-bookings.ts`) не знає імені вендора взагалі — він отримує
 * готові доменні записи; клієнт не знає ні про транзакції, ні про журнал.
 * Усе, що тут відбувається, — переклад в один бік і виклик у другий.
 *
 * ── Порядок, який не можна переставляти ─────────────────────────────────
 *
 * Стрічка ДОЧИТУЄТЬСЯ повністю ДО першого підтвердження. Змішати їх —
 * значить зсувати вікно під ногами: стрічка віддає лише непідтверджені, тож
 * кожен `ack` між сторінками перенумеровує решту, і сторінка 2 перескочить
 * через записи. Тому спершу `fetchAllBookingRevisions`, і лише потім цикл.
 *
 * ── Чому обʼєкт обовʼязковий ────────────────────────────────────────────
 *
 * Один ключ API обслуговує ВСІ готелі акаунта. Стрічка без
 * `filter[property_id]` віддала б ревізії чужих орендарів у транзакцію
 * цього. Тому зʼєднання без `remote_property_id` не опитується взагалі —
 * відмова, а не «спитаємо все» (інваріант 13).
 */

/**
 * Прочитати стрічку одного зʼєднання і завести з неї броні.
 *
 * Викликається ВСЕРЕДИНІ `runWithOrganization` — зʼєднання, дзеркало
 * мапінгу й журнал усі читаються в межах орендаря.
 */
export async function pullConnection(connectionId: string, apiKey: string): Promise<PullReport> {
  const conn = await connectionInTenant(connectionId);
  if (!conn) throw new Error('connection not found');
  if (!conn.remotePropertyId) throw new Error('connection has no remote property');

  const client = new ChannexClient({
    apiKey,
    environment: conn.environment as ChannexEnvironment,
  });

  const sql = getSql();

  return await pullBookings(connectionId, {
    // Дочитуємо стрічку цілком, ПОТІМ перекладаємо. Мапер не кидає винятків
    // на кривому повідомленні — він віддає названу відмову, і саме тому одна
    // зіпсована ревізія не ховає наступні броні.
    fetchFeed: async () => {
      const roomTypes = await mappingMirror(connectionId, 'unit_type');
      const raw = await client.fetchAllBookingRevisions(connectionId, conn.remotePropertyId!);
      return raw.map((r) => mapRevision(r, roomTypes));
    },

    tx: (fn) => sql.tx(() => fn()),

    apply: (id, rev) => applyRevision(id, rev),

    // Аж після коміту. `ackToken` — це `id` ревізії, а не ключ дедуплікації:
    // переплутати означає 404 на кожне підтвердження й ревізію, яка не зникне
    // зі стрічки ніколи.
    ack: (_id, ackToken) => client.ackBookingRevision(connectionId, ackToken),
  });
}
