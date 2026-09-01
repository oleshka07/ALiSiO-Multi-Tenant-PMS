import { ChannexClient, type ChannexEnvironment } from './client';
import { channexCatalogTarget } from './catalog-target';
import { connectionInTenant } from '../data/connections.repo';
import { syncConnectionCatalog } from '../data/catalog-sync';
import type { CatalogReport } from '../domain/catalog.ts';

/**
 * Завести каталог одного зʼєднання — з боку вендора.
 *
 * Дзеркальний близнюк `pull-adapter.ts`, і навмисно тієї ж форми:
 * `(connectionId, apiKey) => звіт`. Той бік будується ТУТ, бо тільки тут
 * дозволено знати, з чого він складається (інваріант И1); порядок дій живе
 * в `domain/catalog.ts` і жодного з цих слів не бачить.
 *
 * ── Чому ключем лімітера є зʼєднання ────────────────────────────────────
 *
 * Один ключ API обслуговує всі готелі акаунта, а квота в Channex — на
 * ОБʼЄКТ (10+10 на хвилину). Ключувати паузу ключем API означало б, що
 * жвавий обмін в одного готелю душить решту.
 */
export async function catalogSync(connectionId: string, apiKey: string): Promise<CatalogReport> {
  const connection = await connectionInTenant(connectionId);
  if (!connection) throw new Error('connection not found');

  const client = new ChannexClient({
    apiKey,
    environment: connection.environment as ChannexEnvironment,
  });

  return syncConnectionCatalog(connectionId, {
    target: channexCatalogTarget(client, connectionId),
  });
}
