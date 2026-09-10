import { getSql } from '@core/db/async';
import { currentOrganizationId } from '@core/auth/tenant-context';
import { ALL_PROPERTIES, propertyScopeFilter } from '@core/property-scope';
import { connectionInTenant } from './connections.repo';

/**
 * Дзеркало каналів (OTA) зʼєднання — і воно ДЗЕРКАЛО, а не скарбничка.
 *
 * ── Що тут не відбувається ──────────────────────────────────────────────
 *
 * Підключення каналу, його налаштування і мапінг тарифів на нього. Це робить
 * готельєр у вбудованому вікні вендора (Ц19): у кожного OTA своя модель, і
 * один спільний екран на всі канали не працює.
 *
 * Тут — те, що потрібно НАМ: відповідь на питання «що з нашого фонду і куди
 * взагалі продається». `cm_mappings` каже лише «наша пара тип × тариф = ось
 * цей тариф на тому боці»; який OTA той тариф побачить, вирішують мапінг-
 * айтеми всередині менеджера каналів. Досі це закривалося інструкцією
 * готельєру (Ц8) — тепер читається.
 *
 * ── Чому перезапис цілком, а не оновлення по одному ─────────────────────
 *
 * Бо §4.3 ТЗ прибрав цю таблицю колись саме зі страху «наша копія протухне
 * мовчки»: оператор змінить канал у вікні вендора, а ми покажемо старе, і
 * відповідь на «чи ввімкнено канал» залежатиме від того, кого спитали.
 *
 * Довід чинний, і він задає механізм: `putChannels` замінює дзеркало
 * зʼєднання ЦІЛКОМ. Канал, якого немає у відповіді, зникає й у нас. Тобто
 * найгірший можливий стан — «дані годину як застарілі» (лімітер оновлення),
 * а не «дані розходяться назавжди».
 *
 * ── Нічого свого ────────────────────────────────────────────────────────
 *
 * У рядку немає жодного НАШОГО поля: ні прапорця, ні замітки, ні
 * налаштування, яке можна змінити тільки тут. Щойно таке зʼявиться, перезапис
 * цілком почне його стирати — і саме тоді доведеться вирішувати заново, що
 * робити з протуханням. Доти правило просте: усе, що тут лежить, приїхало
 * звідти.
 */

/** Один канал, як його віддав менеджер каналів. Переклад — справа адаптера (И1). */
export interface ChannelMirrorRow {
  /** Ідентифікатор підключення каналу на тому боці. */
  remoteChannelId: string;
  /** Код адаптера каналу: Booking.com, Airbnb, Expedia… */
  otaCode: string;
  title: string;
  /** Вимкнене підключення не обмінюється з каналом даними. Стан ЇХНІЙ. */
  isActive: boolean;
  /** Налаштування підключення, як їх віддав вендор. Читає їх людина. */
  settings?: Record<string, unknown>;
  /** Тарифи вендора, змаплені на цей канал. Через `cm_mappings` → наші пари. */
  mappedRemoteRatePlanIds: string[];
}

/** Рядок дзеркала, як його читає екран. */
export interface StoredChannel extends ChannelMirrorRow {
  settings: Record<string, unknown>;
  syncedAt: string | null;
}

/**
 * Один адаптер каналу з каталогу менеджера каналів — «доступні OTA».
 *
 * Живе тут, а не в теці вендора, з однієї причини: цей тип перетинає шов
 * композиції (`providers.ts`), а шву не можна знати шляху до вендора навіть
 * в `import type`. У базі його немає й не буде — каталог належить вендору,
 * росте, і копія протухла б так само, як копія налаштувань каналу (§4.3).
 */
export interface ChannelCatalogEntry {
  code: string;
  title: string;
  /** `ota`, `meta` (метапошук) або `cm` (інший менеджер каналів). */
  kind: string;
  /** Чи підтримує канал листування з гостем. */
  messaging: boolean;
}

/** Рівень OTA одним читанням: канали обʼєкта плюс каталог доступних. */
export interface ChannelsSnapshot {
  rows: ChannelMirrorRow[];
  /** Канали, які не вдалося перекласти, з причиною. */
  skipped: string[];
  catalog: ChannelCatalogEntry[];
}

/**
 * Замінити дзеркало каналів зʼєднання ЦІЛКОМ.
 *
 * Порожній список — законна відповідь: «готельєр не підключив жодного
 * каналу». Мітка часу при цьому ставиться однаково, бо «нуль каналів» і «ще
 * не питали» — різні стани, і плутати їх означає показати порожній екран там,
 * де насправді просто не спитали.
 */
export async function putChannels(connectionId: string, rows: ChannelMirrorRow[]): Promise<number> {
  const sql = getSql();

  // Чуже зʼєднання не існує для нас — і це відмова, а не «немає обмежень,
  // отже можна» (інваріант 13). Обмеження явне, а не покладене на політику:
  // на SQLite політик немає, а SQLite стоїть у розробки й у CI (INC-010).
  const conn = await connectionInTenant(connectionId);
  if (!conn) throw new Error('cm_channels: connection not found');

  await sql.tx(async (t) => {
    // Заміна цілком, і в одній транзакції: прохід, що впав між видаленням і
    // вставкою, лишив би готельєра з порожнім екраном каналів і висновком,
    // що він нічого не продає.
    await t.run('DELETE FROM cm_channels WHERE connection_id = ? AND organization_id = ?',
      [connectionId, conn.organizationId]);
    for (const row of rows) {
      await t.run(
        `INSERT INTO cm_channels
           (id, organization_id, connection_id, remote_channel_id, ota_code, title,
            is_active, settings_json, mapped_json, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [crypto.randomUUID(), conn.organizationId, connectionId,
          row.remoteChannelId, row.otaCode ?? '', row.title ?? '',
          row.isActive ? true : false,
          JSON.stringify(row.settings ?? {}),
          JSON.stringify(row.mappedRemoteRatePlanIds ?? [])],
      );
    }
    // Мітка живе на зʼєднанні, а не лише на рядках: інакше порожня відповідь
    // («каналів нуль») не лишала б сліду, і лімітер оновлення питав би
    // вендора щоразу заново.
    await t.run('UPDATE cm_connections SET channels_synced_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?',
      [connectionId, conn.organizationId]);
  });

  return rows.length;
}

/** Канали зʼєднання з дзеркала. Порожньо — законний стан, не помилка. */
export async function channelsOf(connectionId: string): Promise<StoredChannel[]> {
  const organizationId = currentOrganizationId();
  if (!organizationId) throw new Error('cm_channels: read without a tenant');

  const sql = getSql();
  const rows = await sql.rows<any>(
    `SELECT remote_channel_id, ota_code, title, is_active, settings_json, mapped_json, synced_at
       FROM cm_channels
      WHERE connection_id = ? AND organization_id = ?
      ORDER BY title, remote_channel_id`,
    [connectionId, organizationId],
  ) as Record<string, unknown>[];

  return rows.map((r) => ({
    remoteChannelId: String(r.remote_channel_id),
    otaCode: String(r.ota_code ?? ''),
    title: String(r.title ?? ''),
    isActive: Boolean(Number(r.is_active)),
    settings: parseObject(r.settings_json),
    mappedRemoteRatePlanIds: parseList(r.mapped_json),
    syncedAt: r.synced_at ? String(r.synced_at) : null,
  }));
}

/**
 * Вісь обʼєкта для читання САМОГО зʼєднання — навмисно `ALL_PROPERTIES`.
 *
 * Рідкісний випадок, коли «усі» — правда, а звуження було б неправдою.
 * `cm_connections` має `property_id`, тож гейт осі рахує це читання як своє;
 * але рядок, який ми читаємо, і Є носієм осі: зʼєднання належить рівно
 * одному будинку, і саме воно каже якому. Звузити запит по будинку можна
 * було б лише взявши будинок із цього ж рядка — тобто спитавши відповідь у
 * питання.
 *
 * Виклик приходить із екрана, який уже обрав обʼєкт (`connectionForProperty`
 * шукає ЗА `property_id`), або з крона, що обходить зʼєднання рахунку. Обидва
 * дають сюди готовий `connectionId`; орендаря тримає `organization_id` у
 * запиті, а чуже зʼєднання не існує для нас — це `connectionInTenant` у
 * сусідніх дверях. Сказано словом, а не мовчанням.
 */
const CONNECTION_IS_THE_AXIS = propertyScopeFilter(ALL_PROPERTIES, '');

/**
 * Коли дзеркало востаннє оновлювали. `null` — ще жодного разу.
 *
 * На це спирається лімітер «не частіше разу на годину»: перелік каналів не
 * ARI, але бюджет у вендора один на обʼєкт, і екран, який питає його на кожне
 * відкриття, зʼїдає той самий бюджет, з якого їдуть ціни.
 */
export async function channelsSyncedAt(connectionId: string): Promise<string | null> {
  const organizationId = currentOrganizationId();
  if (!organizationId) throw new Error('cm_channels: read without a tenant');

  const sql = getSql();
  const row = await sql.row<any>(
    `SELECT channels_synced_at FROM cm_connections
      WHERE id = ? AND organization_id = ? AND ${CONNECTION_IS_THE_AXIS.sql}`,
    [connectionId, organizationId, ...CONNECTION_IS_THE_AXIS.params],
  ) as { channels_synced_at?: unknown } | undefined;

  return row?.channels_synced_at ? String(row.channels_synced_at) : null;
}

/** JSON із бази: Postgres віддає JSONB обʼєктом, SQLite — рядком. */
function parseObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string' || value === '') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

function parseList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== 'string' || value === '') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch { return []; }
}
