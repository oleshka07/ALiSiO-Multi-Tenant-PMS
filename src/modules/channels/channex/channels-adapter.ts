/**
 * Канали обʼєкта в менеджера каналів → доменні рядки дзеркала (К2).
 *
 * Єдине місце, де живуть імена вендора для рівня OTA: `channel`, `is_active`,
 * `rate_plans`, `settings`. Вище за течією — тільки доменні слова (И1).
 *
 * ── Що саме тут легко зробити неправильно ───────────────────────────────
 *
 * 1. **`channel` — це КОД адаптера, а не назва.** `title` готельєр міняє як
 *    хоче («Booking основний», «Букінг — не чіпати»), а код лишається кодом.
 *    Показувати треба обидва, а зіставляти — лише код: «Some channels appear
 *    in the list several times under different name variants — match by the
 *    code, not by the name» (`channel-codes.md`).
 *
 * 2. **`rate_plans` — це мапінг-АЙТЕМИ, а не тарифи.** Кожен несе власний
 *    `id` мапінгу і `rate_plan_id` тарифу; нам потрібен другий. Узяти перший
 *    означає зіставляти з `cm_mappings` те, чого там нема, і показати
 *    «жоден тариф не змаплений» на цілком змапленому каналі.
 *
 * 3. **Порожній `rate_plans` — законний стан.** «Empty while the connection
 *    is unmapped»: канал підключено, тарифи ще не змаплені. Це рівно та
 *    діра, яку Ц8 закривав інструкцією готельєру, і показати її треба, а не
 *    сховати.
 *
 * 4. **Список каналів фільтрується обʼєктом.** `filter[property_id]`
 *    обовʼязковий: без нього відповідь іде по ВСЬОМУ акаунту, тобто по всіх
 *    наших готелях разом (межа И11). Клієнт це вже робить — тут воно
 *    записане, щоб наступний читач не «спростив».
 */
import type { ChannelMirrorRow, ChannelCatalogEntry, ChannelsSnapshot } from '../data/channels.repo';
import { ChannexClient } from './client';
import { connectionInTenant } from '../data/connections.repo';

/** Канал у тому вигляді, як його віддає список. Поля — за схемою Channel API. */
export interface ChannexChannel {
  id?: string;
  attributes?: {
    title?: string;
    channel?: string;
    is_active?: boolean;
    settings?: Record<string, unknown>;
    rate_plans?: { id?: string; rate_plan_id?: string }[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * Перекласти список каналів.
 *
 * Канал без ідентифікатора пропускається з назвою причини, а не валить
 * переклад: одна крива відповідь не має ховати решту каналів готелю — той
 * самий довід, що в стрічці ревізій.
 */
export function mapChannels(raw: ChannexChannel[]): { rows: ChannelMirrorRow[]; skipped: string[] } {
  const rows: ChannelMirrorRow[] = [];
  const skipped: string[] = [];

  for (const item of raw ?? []) {
    const id = item?.id;
    if (!id || typeof id !== 'string') { skipped.push('missing_id'); continue; }
    const a = item.attributes ?? {};
    rows.push({
      remoteChannelId: id,
      // Код, а не назва: назву готельєр міняє, код — ні.
      otaCode: typeof a.channel === 'string' ? a.channel : '',
      title: typeof a.title === 'string' ? a.title : '',
      isActive: a.is_active === true,
      settings: a.settings && typeof a.settings === 'object' && !Array.isArray(a.settings)
        ? a.settings as Record<string, unknown> : {},
      // `rate_plan_id` мапінг-айтема, не його власний `id`.
      mappedRemoteRatePlanIds: (Array.isArray(a.rate_plans) ? a.rate_plans : [])
        .map((m) => (typeof m?.rate_plan_id === 'string' ? m.rate_plan_id : ''))
        .filter(Boolean),
    });
  }

  return { rows, skipped };
}

/**
 * Каталог адаптерів вендора → «доступні OTA».
 *
 * Він НЕ зберігається: перелік належить вендору, росте, і копія протухла б
 * так само, як протухла б копія налаштувань каналу (§4.3). Читається на
 * відкриття екрана й лишається в тій самій відповіді.
 */
export function mapChannelCatalog(raw: { code?: unknown; title?: unknown; kind?: unknown; message_support?: unknown }[]): ChannelCatalogEntry[] {
  return (raw ?? [])
    .filter((a) => typeof a?.code === 'string' && a.code !== '')
    .map((a) => ({
      code: String(a.code),
      title: typeof a.title === 'string' && a.title !== '' ? a.title : String(a.code),
      kind: typeof a.kind === 'string' ? a.kind : '',
      messaging: a.message_support === true,
    }));
}

/**
 * Прочитати рівень OTA зʼєднання: канали обʼєкта і каталог доступних.
 *
 * Двома читаннями, бо це два різні питання: що підключено ЦЬОМУ обʼєкту і що
 * взагалі буває в цього менеджера каналів. Ліміт вендора тут не витрачається —
 * він на ARI, а це не ARI; але бюджет обʼєкта один, тому як часто питати,
 * вирішує викликач (не частіше разу на годину), а не цей файл.
 */
export async function readChannels(connectionId: string, apiKey: string): Promise<ChannelsSnapshot> {
  const connection = await connectionInTenant(connectionId);
  if (!connection) throw new Error('channels: connection not found');
  if (!connection.remotePropertyId) throw new Error('channels: property not created yet');

  const client = new ChannexClient({
    apiKey,
    environment: connection.environment === 'production' ? 'production' : 'staging',
  });
  const [raw, catalogRaw] = await Promise.all([
    client.listChannelsRaw(apiKey, connection.remotePropertyId),
    client.listChannelAdapters(apiKey),
  ]);
  const { rows, skipped } = mapChannels(raw as ChannexChannel[]);
  return { rows, skipped, catalog: mapChannelCatalog(catalogRaw as never) };
}
