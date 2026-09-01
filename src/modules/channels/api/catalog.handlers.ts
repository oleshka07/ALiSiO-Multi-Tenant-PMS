import { integrationCredentials } from '@core/integration-credentials';
import { currentOrganizationId } from '@core/auth/tenant-context';
import { connectionInTenant } from '../data/connections.repo';
import { catalogSyncerFor } from '../providers';
import type { CatalogReport } from '../domain/catalog.ts';

/**
 * Завести каталог обʼєкта в менеджері каналів — з боку модуля.
 *
 * ── Чому це в api/, хоч маршруту ще немає ───────────────────────────────
 *
 * Бо викликач уже є: `scripts/channex-catalog-live.mjs` ганяє каталог проти
 * живого staging, і без цієї двері він мусив би імпортувати нутрощі модуля й
 * ходити в `cm_connections` навпростець — рівно те, що ловить храповик
 * `check-boundaries`. Гейт тут не формальність: наступний такий викликач
 * зробив би це трохи інакше, і два місця розійшлися б у тому, звідки береться
 * ключ і чий це орендар.
 *
 * Маршрут — окрема справа і НЕ додається наперед: маршрут без варти й без
 * екрана це кнопка, яка створює сутності в чужому акаунті. Коли зʼявиться
 * майстер підключення, він викличе саме цю функцію.
 *
 * ── Що тут є, а чого немає ──────────────────────────────────────────────
 *
 * Є шов зі світом: орендар, ключ, вибір адаптера за рядком `provider`.
 * Немає нічого про Channex — хто обслуговує зʼєднання, вирішує РЯДОК у базі
 * (інваріант И1), і жодне ім'я вендора сюди не доходить.
 *
 * Три роди відмови названі окремо, бо вони означають різне для оператора:
 * чуже зʼєднання, невідомий провайдер, і куплений модуль без ключа. Злити їх
 * в одну помилку означає лишити людину гадати, що саме полагодити.
 */
export async function syncConnectionCatalogFor(connectionId: string): Promise<CatalogReport> {
  const organizationId = currentOrganizationId();
  if (!organizationId) throw new Error('catalog: sync without a tenant');

  // Чуже й неіснуюче однаково дають `null` — 404, не 403 (інваріант 5).
  const connection = await connectionInTenant(connectionId);
  if (!connection) throw new Error('catalog: connection not found');

  const syncer = catalogSyncerFor(connection.provider);
  if (!syncer) throw new Error(`catalog: unknown provider ${connection.provider}`);

  // Ключ лежить під нейтральним іменем `channel_manager`, не під іменем
  // вендора (рішення Р9): який саме менеджер обслуговує готель, каже
  // `cm_connections.provider`, а не назва поля в ядрі.
  const credentials = await integrationCredentials('channel_manager', organizationId);
  const apiKey = credentials?.accessToken;
  if (!apiKey) throw new Error('catalog: no channel manager key for this organization');

  return syncer(connectionId, apiKey);
}

/** Зʼєднання, якщо воно наше. Для екранів і інструментів оператора. */
export { connectionInTenant as channelConnection } from '../data/connections.repo';

/** Дзеркало зʼєднання цілком — для звірки каталогу (фаза 7 читатиме те саме). */
export { connectionMirror } from '../data/mappings.repo';
