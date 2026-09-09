import { NextResponse, type NextRequest } from 'next/server';
import { withPermission, type Actor } from '@core/auth/session';
import { hasFeature } from '@core/features';
import { serverError } from '@core/http/errors';
import { connectionInTenant } from '../data/connections.repo';
// Спільне з кроном і скриптами — з `channels.ops.ts`: воно без `next/*`,
// і саме тому живі входи його бачать (`check-entry-imports`).
import { adapterFor } from '../providers';
import { channelsSyncedAt, putChannels } from '../data/channels.repo';
import {
  REFRESH_EVERY_MS, channelsMirrorAgeMs, screen,
  refreshConnectionChannelsFor, connectionChannelsFor,
} from './channels.ops';
import { apiKeyOf } from './connect.handlers';

/**
 * Рівень OTA — читання (К2).
 *
 * ── Що екран показує і звідки це береться ───────────────────────────────
 *
 * «Підключені» і «У налаштуванні» — з дзеркала `cm_channels`, тобто з
 * відповіді вендора. «Доступні» — з каталогу адаптерів вендора, який ніде не
 * зберігається: перелік належить йому і росте.
 *
 * Головне — третій стовпчик: які НАШІ пари «тип × тариф» продаються на
 * кожному каналі. Канал знає лише чужі ідентифікатори тарифів; переклад у
 * наші — через `cm_mappings`, і саме він перетворює Ц8 з інструкції
 * готельєру на число на екрані.
 *
 * ── Чого тут немає навмисно ─────────────────────────────────────────────
 *
 * ЗАПИСУ. Ні підключити канал, ні змінити його налаштування, ні змапити
 * тариф звідси не можна — це ЧЕКПОІНТ рецензента (К2): мапінг у кожного OTA
 * свій, і писати його наосліп означає зламати те, що готельєр налаштував
 * руками. Кнопка веде у вбудоване вікно вендора (Ц19), де це й робиться.
 *
 * `POST …/channels` тут — це «перечитати», а не «записати».
 */

interface IdParams { params: Promise<{ id: string }> }

async function moduleOff(actor: Actor): Promise<NextResponse | null> {
  if (await hasFeature(actor.organizationId, 'channels')) return null;
  return NextResponse.json({ error: 'module_disabled' }, { status: 409 });
}

/** GET /api/channels/connections/[id]/channels — рівень OTA з дзеркала. */
export const listConnectionChannels = withPermission('manage_properties', async (_request: NextRequest, { params }: IdParams, actor: Actor) => {
  try {
    const off = await moduleOff(actor);
    if (off) return off;
    const { id } = await params;
    // Чуже зʼєднання — 404, не 403 (інваріант 5): існування чужого рядка теж
    // відповідь.
    const connection = await connectionInTenant(id);
    if (!connection) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const adapter = adapterFor(connection.provider);
    return NextResponse.json({
      ...(await screen(id, connection.propertyId)),
      provider: adapter?.label ?? connection.provider,
      // Каталог доступних OTA не зберігається, тож у читанні з дзеркала його
      // немає: він приїжджає з «Оновити». Порожній список означає «ще не
      // питали», і екран каже саме це, а не «каналів не буває».
      catalog: [],
    });
  } catch (error: unknown) {
    return serverError('modules/channels/api/channels listConnectionChannels', error);
  }
});

/**
 * POST /api/channels/connections/[id]/channels — перечитати рівень OTA.
 *
 * Не «записати»: запис мапінгу з нашого боку — ЧЕКПОІНТ рецензента (К2).
 * Тіло не читається взагалі.
 */
export const refreshConnectionChannels = withPermission('manage_properties', async (request: NextRequest, { params }: IdParams, actor: Actor) => {
  try {
    const off = await moduleOff(actor);
    if (off) return off;
    const { id } = await params;
    const connection = await connectionInTenant(id);
    if (!connection) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!connection.remotePropertyId) return NextResponse.json({ error: 'catalog_not_synced' }, { status: 409 });

    const adapter = adapterFor(connection.provider);
    if (!adapter) return NextResponse.json({ error: 'unknown_provider' }, { status: 409 });
    const apiKey = await apiKeyOf(actor.organizationId);
    if (!apiKey) return NextResponse.json({ error: 'no_key' }, { status: 409 });

    // Лімітер: не частіше разу на годину, і його можна обійти лише свідомо
    // (`?force=1` з екрана — кнопка «все одно оновити»). Це не захист від
    // зловмисника, а захист бюджету обʼєкта від екрана, який перечитують.
    const force = new URL(request.url).searchParams.get('force') === '1';
    const age = channelsMirrorAgeMs(await channelsSyncedAt(id));
    if (!force && age !== null && age < REFRESH_EVERY_MS) {
      return NextResponse.json({
        error: 'too_soon',
        retryAfterMs: REFRESH_EVERY_MS - age,
        ...(await screen(id, connection.propertyId)),
      }, { status: 429 });
    }

    const snapshot = await adapter.channels(id, apiKey);
    await putChannels(id, snapshot.rows);

    return NextResponse.json({
      ...(await screen(id, connection.propertyId)),
      provider: adapter.label,
      catalog: snapshot.catalog,
      // Канал, якого не вдалося прочитати, називається, а не зникає мовчки.
      skipped: snapshot.skipped,
    });
  } catch (error: unknown) {
    return serverError('modules/channels/api/channels refreshConnectionChannels', error);
  }
});

// Реекспорт заради тих, хто вже імпортує ці імена звідси (фасад модуля).
// Живуть вони в `channels.ops.ts` — див. коментар до імпорту вище.
export { channelsMirrorAgeMs, refreshConnectionChannelsFor, connectionChannelsFor };
