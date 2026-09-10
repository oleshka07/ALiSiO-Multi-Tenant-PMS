import { getSql } from '@core/db/async';
import { currentOrganizationId } from '@core/auth/tenant-context';
import { ALL_PROPERTIES, propertyScopeFilter } from '@core/property-scope';

/**
 * Зʼєднання з менеджером каналів — завжди в межах орендаря.
 *
 * ── Чому не просто `WHERE id = ?` ───────────────────────────────────────
 *
 * Бо `connection_id` приходить іззовні: з URL вебхука, з рядка черги, з
 * аргументу крона. Запит за самим лише id — це запит без орендаря, і на
 * Postgres його рятує політика, а на SQLite не рятує НІЩО. SQLite стоїть на
 * кожній машині розробника, під `npm run dev` і в тому завданні CI, яке
 * піднімає застосунок, — тобто «працює на проді» тут нічого не доводить, а
 * «працює локально» доводить рівно протилежне тому, що здається.
 *
 * Це клас INC-010 (`audit-by-id-scope`): не діра в RLS, а звичка писати
 * запит, який тримається на тому, що хтось інший його обмежить.
 *
 * ── Немає контексту — відмова, а не «все» ───────────────────────────────
 *
 * Інваріант 13. Порожній орендар на Postgres дає порожній результат, тобто
 * функцію, яка «зникла»; тут він дав би СВОБОДУ — на SQLite запит без
 * орендаря повернув би чуже. Тому відсутність контексту це помилка, а не
 * послаблення.
 */
export interface Connection {
  id: string;
  organizationId: string;
  propertyId: string;
  provider: string;
  environment: string;
  remotePropertyId: string | null;
  /** Вебхук у вендора, якщо зареєстрований (Р8.1). Без секретів: ті йдуть окремою дорогою. */
  remoteWebhookId: string | null;
  isEnabled: boolean;
  /**
   * Зсув цієї точки збуту у відсотках (Ц7). Знакове: `-10` дешевше, `+10`
   * дорожче; нуль — «як база».
   *
   * Читає батчер ARI: ціну називає лише `priceNights()`, а точка збуту її
   * ЗСУВАЄ. Модифікатор сайту сюди не потрапляє й потрапити не може — це і є
   * визначення «прямо дешевше».
   */
  pricingModifierPercent: number;
  /** Коли останній повний синк ЗАВЕРШИВСЯ (усе поїхало); `null` — ще не робився (П5). */
  lastFullSyncAt: string | null;
}

/**
 * Мітка часу назовні — завжди ISO з секундною точністю в UTC.
 *
 * SQLite віддає рядок як записано; драйвер Postgres форматує TIMESTAMPTZ у
 * `YYYY-MM-DD HH:MM:SS` без зони (і без часток секунди). Без нормалізації
 * той самий рядок читався б двома різними текстами залежно від двигуна, а
 * екран здогадувався б про зону. Записуємо секундами (`nowStamp`) — тоді
 * прочитане дорівнює записаному на обох двигунах.
 */
export function isoStamp(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) return value.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const s = String(value);
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/.exec(s);
  if (!m) return s;
  const zone = m[3];
  if (!zone || zone === 'Z' || /^[+-]00:?00$/.test(zone)) return `${m[1]}T${m[2]}Z`;
  return new Date(`${m[1]}T${m[2]}${zone}`).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Зараз — ISO з секундною точністю: те, що `isoStamp` прочитає назад без змін. */
export const nowStamp = (): string => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Зʼєднання, якщо воно НАШЕ. Чуже й неіснуюче однаково дають `null`. */
function toConnection(row: Record<string, any>): Connection {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    propertyId: String(row.property_id),
    provider: String(row.provider),
    environment: String(row.environment),
    remotePropertyId: row.remote_property_id == null ? null : String(row.remote_property_id),
    remoteWebhookId: row.remote_webhook_id == null ? null : String(row.remote_webhook_id),
    isEnabled: Boolean(Number(row.is_enabled)),
    pricingModifierPercent: Number(row.pricing_modifier_percent) || 0,
    lastFullSyncAt: isoStamp(row.last_full_sync_at),
  };
}

/**
 * Вісь обʼєкта для читань САМОГО зʼєднання — навмисно `ALL_PROPERTIES`.
 *
 * `cm_connections` має `property_id`, тож гейт осі (INC-029) рахує кожне
 * читання цієї таблиці як своє. Але рядок, який тут читають, і Є носієм осі:
 * зʼєднання належить рівно одному будинку і саме воно каже якому. Звузити ці
 * запити по будинку можна було б лише взявши будинок із цього ж рядка —
 * спитати відповідь у питання.
 *
 * Чотири вживання, і в кожного своя причина бути «усіма»:
 *
 *   `connectionInTenant`   — за первинним ключем; далі саме воно й дає
 *                            `conn.propertyId`, яким звужується все інше
 *                            (К19, `inbound-bookings.repo.ts`);
 *   `connectionsInTenant`  — екран «Канал-менеджер» показує зʼєднання ВСЬОГО
 *                            рахунку, згруповані по будинках: це його
 *                            питання, і звужений до одного він перестав би
 *                            на нього відповідати;
 *   `connectionByWebhookToken` — вхід вебхука, де орендаря ще немає взагалі:
 *                            токен і є те, що шукають (політика 0060);
 *   `webhookRegistration`  — за первинним ключем, перед походом до вендора.
 *
 * Сказано дверима, а не мовчанням.
 */
const CONNECTION_IS_THE_AXIS = propertyScopeFilter(ALL_PROPERTIES, '');

export async function connectionInTenant(connectionId: string): Promise<Connection | null> {
  const organizationId = currentOrganizationId();
  if (!organizationId) throw new Error('cm: connection lookup without a tenant');

  const sql = getSql();
  const row = await sql.row<any>(
    `SELECT id, organization_id, property_id, provider, environment,
            remote_property_id, remote_webhook_id, is_enabled, pricing_modifier_percent, last_full_sync_at
       FROM cm_connections
      WHERE id = ? AND organization_id = ? AND ${CONNECTION_IS_THE_AXIS.sql}`,
    [connectionId, organizationId, ...CONNECTION_IS_THE_AXIS.params],
  ) as Record<string, unknown> | undefined;

  if (!row) return null;

  return toConnection(row);
}

/**
 * Запамʼятати, під яким ідентифікатором наш обʼєкт живе на тому боці.
 *
 * ── Навіщо окрема колонка, коли є дзеркало ──────────────────────────────
 *
 * `cm_mappings` тримає ту саму відповідність рядком `entity_type='property'`.
 * Колонка на зʼєднанні — не дубль заради дубля, а гаряча координата: її
 * читає КОЖНЕ опитування стрічки (`filter[property_id]` обовʼязковий, И11), і
 * ходити за нею в дзеркало на кожен прохід крона означало б зайвий запит по
 * рядок, який не змінюється ніколи.
 *
 * ── Чому це не «UPDATE … SET» і все ─────────────────────────────────────
 *
 * Зʼєднання, яке вже вказує на ІНШИЙ обʼєкт, — це не привід тихо
 * переприсвоїти. Це означає, що або дзеркало перебудували, або зʼєднання
 * перецілили руками; у будь-якому разі наступний синк ARI поїхав би в чужий
 * обʼєкт. Тому розбіжність — відмова (інваріант 13), а не перезапис.
 */
export async function rememberRemoteProperty(
  connectionId: string,
  remotePropertyId: string,
): Promise<void> {
  const organizationId = currentOrganizationId();
  if (!organizationId) throw new Error('cm: connection update without a tenant');
  if (!remotePropertyId) throw new Error('cm: refusing to store an empty remote property');

  const sql = getSql();
  const current = await connectionInTenant(connectionId);
  if (!current) throw new Error('cm: connection not found');
  if (current.remotePropertyId === remotePropertyId) return;
  if (current.remotePropertyId) {
    throw new Error('cm: connection already points at a different remote property');
  }

  await sql.run(
    `UPDATE cm_connections
        SET remote_property_id = ?, updated_at = ?
      WHERE id = ? AND organization_id = ?`,
    [remotePropertyId, new Date().toISOString(), connectionId, organizationId],
  );
}

/**
 * Повний синк завершився — усе поїхало (П5). Повертає записану мітку.
 *
 * Ставиться лише проходом, який нічого не повернув у чергу: половина стану —
 * не повний синк, і дата збрехала б оператору. Мітка — ISO-рядок: той самий
 * формат, що в `updated_at`, і його читає екран без здогадок про зону.
 */
export async function rememberFullSync(connectionId: string, at: string = nowStamp()): Promise<string> {
  const organizationId = currentOrganizationId();
  if (!organizationId) throw new Error('cm: connection update without a tenant');

  const sql = getSql();
  const current = await connectionInTenant(connectionId);
  if (!current) throw new Error('cm: connection not found');

  await sql.run(
    `UPDATE cm_connections
        SET last_full_sync_at = ?, updated_at = ?
      WHERE id = ? AND organization_id = ?`,
    [at, new Date().toISOString(), connectionId, organizationId],
  );
  return at;
}

/**
 * Каталог цього зʼєднання щойно поїхав до вендора (0130, Р15.1).
 *
 * Окремо від `rememberFullSync`: та мітка про ARI — наявність і ціни, —
 * а ця про КАТАЛОГ, тобто про сам обʼєкт, типи номерів і тарифи. Змішати їх
 * означало б, що нічна розсилка цін «полагодила» рід житла, якого ніхто не
 * надсилав.
 *
 * Ставиться в кінці успішного проходу, а не на початку: перерваний синк
 * лишає мітку старою, і оператор бачить «каталог розійшовся» — що правда.
 */
export async function rememberCatalogSync(connectionId: string, at: string = nowStamp()): Promise<string> {
  const organizationId = currentOrganizationId();
  if (!organizationId) throw new Error('cm: connection update without a tenant');

  const sql = getSql();
  const current = await connectionInTenant(connectionId);
  if (!current) throw new Error('cm: connection not found');

  await sql.run(
    `UPDATE cm_connections
        SET catalog_synced_at = ?, updated_at = ?
      WHERE id = ? AND organization_id = ?`,
    [at, new Date().toISOString(), connectionId, organizationId],
  );
  return at;
}

/**
 * Чи розійшовся каталог обʼєкта з тим, що ми востаннє відправили вендору.
 *
 * ── Чому локально, без походу до вендора ────────────────────────────────
 *
 * Бо це підказка на ЕКРАНІ. Екран не має права ходити в чужий API, щоб
 * намалювати рядок тексту: це чужий бюджет запитів, чужа затримка і ще одна
 * причина, з якої сторінка може не відкритись. `propertyDrift` (справжня
 * звірка з вендором) лишається там, де їй місце — усередині синку.
 *
 * ── Чому `updated_at` обʼєкта, а не знімок надісланих полів ─────────────
 *
 * Усе, що ми взагалі відправляємо (`PROPERTY_FIELDS_WE_OWN` — назва,
 * валюта, країна, місто, адреса, індекс, пошта, телефон, пояс, рід житла),
 * лежить на тому самому рядку `properties` і рухає той самий `updated_at`.
 * Тобто мітка не бреше — вона лише трохи щедріша: правка телефону теж
 * скаже «розійшлося», і це правда, бо телефон ми вендору теж шлемо.
 *
 * `catalog_synced_at IS NULL` — НЕ розходження: обʼєкта у вендора ще немає,
 * розходитись нема з чим. Інакше кожен готель до першого синку носив би
 * попередження, яке нічого не означає.
 */
export async function propertyCatalogStale(propertyId: string): Promise<boolean> {
  const organizationId = currentOrganizationId();
  if (!organizationId) throw new Error('cm: catalog staleness without a tenant');

  const sql = getSql();
  const row = await sql.row<any>(
    `SELECT COUNT(*) AS n
       FROM cm_connections c
       JOIN properties p ON p.id = c.property_id AND p.organization_id = c.organization_id
      WHERE c.property_id = ? AND c.organization_id = ?
        AND c.catalog_synced_at IS NOT NULL
        AND p.updated_at > c.catalog_synced_at`,
    [propertyId, organizationId],
  );
  return Number(row?.n ?? 0) > 0;
}

/**
 * Усі зʼєднання обʼєкта — для писачів черги: бронь, ціна, блокування кажуть
 * «змінилось» кожному менеджеру каналів цього обʼєкта.
 *
 * ── Вимкнені теж, і це навмисно ─────────────────────────────────────────
 *
 * Вимкнене зʼєднання нічого не шле (батчер це тримає), але чергу отримує:
 * вимкнення буває тимчасовим, і після вмикання канал має отримати ПОТОЧНИЙ
 * стан кожної координати, що змінилась за цей час. Фільтрувати тут означало
 * б, що після вмикання канал продає за старими цінами, доки хтось не зробить
 * повний синк — а «хтось» у такому реченні завжди ніхто. Черга обмежена
 * координатами (індекс злиття), тож вимкнене зʼєднання її не роздує.
 *
 * Орендар — із сесії, і в SQL явно (див. шапку файла).
 */
export async function connectionsForProperty(propertyId: string): Promise<Connection[]> {
  const organizationId = currentOrganizationId();
  if (!organizationId) throw new Error('cm: connection lookup without a tenant');

  const sql = getSql();
  const rows = await sql.rows<any>(
    `SELECT id, organization_id, property_id, provider, environment,
            remote_property_id, remote_webhook_id, is_enabled, pricing_modifier_percent, last_full_sync_at
       FROM cm_connections
      WHERE property_id = ? AND organization_id = ?
      ORDER BY id`,
    [propertyId, organizationId],
  ) as Record<string, unknown>[];
  return rows.map(toConnection);
}

/** Усі зʼєднання орендаря — для екрана «Канал-менеджер». Орендар — із сесії. */
export async function connectionsInTenant(): Promise<Connection[]> {
  const organizationId = currentOrganizationId();
  if (!organizationId) throw new Error('cm: connection lookup without a tenant');

  const sql = getSql();
  const rows = await sql.rows<any>(
    `SELECT id, organization_id, property_id, provider, environment,
            remote_property_id, remote_webhook_id, is_enabled, pricing_modifier_percent, last_full_sync_at
       FROM cm_connections
      WHERE organization_id = ? AND ${CONNECTION_IS_THE_AXIS.sql}
      ORDER BY property_id, id`,
    [organizationId, ...CONNECTION_IS_THE_AXIS.params],
  ) as Record<string, unknown>[];
  return rows.map(toConnection);
}

// ── Вебхук: токен відкриває рядок, секрет відкриває двері ────────────────

/** Те, що знають лише двері вебхука. Секрет тут — і більше ніде не виходить. */
export interface WebhookGate {
  id: string;
  organizationId: string;
  provider: string;
  webhookSecret: string;
}

/**
 * Зʼєднання за токеном з адреси вебхука — ДО того, як орендар відомий.
 *
 * Це єдиний запит модуля без `organization_id` у WHERE, і він навмисно
 * такий: орендар тут і є те, що шукають. На Postgres рядок відкриває
 * політика за `app.public_token` (міграція 0060) — тому викликач ставить
 * токен на зʼєднання (`runWithPublicToken`), а не просто питає. Токен
 * коротший за 16 знаків не шукається взагалі: це не токен, це здогадка.
 */
export async function connectionByWebhookToken(token: string): Promise<WebhookGate | null> {
  if (!token || token.length < 16) return null;
  const row = await getSql().row<any>(
    `SELECT id, organization_id, provider, webhook_secret FROM cm_connections
      WHERE webhook_token = ? AND ${CONNECTION_IS_THE_AXIS.sql}`,
    [token, ...CONNECTION_IS_THE_AXIS.params],
  );
  if (!row) return null;
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    provider: String(row.provider),
    webhookSecret: String(row.webhook_secret ?? ''),
  };
}

/** Що потрібно адаптеру, щоб зареєструвати вебхук у вендора. В межах орендаря. */
export interface WebhookRegistration {
  connectionId: string;
  environment: string;
  remotePropertyId: string | null;
  remoteWebhookId: string | null;
  token: string;
  secret: string;
}

export async function webhookRegistration(connectionId: string): Promise<WebhookRegistration | null> {
  const organizationId = currentOrganizationId();
  if (!organizationId) throw new Error('cm: webhook registration read without a tenant');
  const row = await getSql().row<any>(
    `SELECT id, environment, remote_property_id, remote_webhook_id, webhook_token, webhook_secret
       FROM cm_connections
      WHERE id = ? AND organization_id = ? AND ${CONNECTION_IS_THE_AXIS.sql}`,
    [connectionId, organizationId, ...CONNECTION_IS_THE_AXIS.params],
  );
  if (!row) return null;
  return {
    connectionId: String(row.id),
    environment: String(row.environment),
    remotePropertyId: row.remote_property_id == null ? null : String(row.remote_property_id),
    remoteWebhookId: row.remote_webhook_id == null ? null : String(row.remote_webhook_id),
    token: String(row.webhook_token),
    secret: String(row.webhook_secret),
  };
}

/** Запамʼятати (або стерти — `null`) ідентифікатор вебхука на тому боці. */
export async function rememberRemoteWebhook(connectionId: string, remoteWebhookId: string | null): Promise<void> {
  const organizationId = currentOrganizationId();
  if (!organizationId) throw new Error('cm: connection update without a tenant');
  const result = await getSql().run(
    `UPDATE cm_connections SET remote_webhook_id = ?, updated_at = ? WHERE id = ? AND organization_id = ?`,
    [remoteWebhookId, new Date().toISOString(), connectionId, organizationId],
  );
  if (!result.changes) throw new Error('cm: connection not found');
}

/**
 * Новий секрет вебхука — ПІСЛЯ того, як вендор його прийняв. У зворотному
 * порядку база була б упевнена в секреті, якого вендор не знає, і кожна
 * доставка діставала б 401 без жодного сліду на тому боці.
 */
export async function storeWebhookSecret(connectionId: string, secret: string): Promise<void> {
  const organizationId = currentOrganizationId();
  if (!organizationId) throw new Error('cm: connection update without a tenant');
  if (!secret || secret.length < 32) throw new Error('cm: refusing a short webhook secret');
  const result = await getSql().run(
    `UPDATE cm_connections SET webhook_secret = ?, updated_at = ? WHERE id = ? AND organization_id = ?`,
    [secret, new Date().toISOString(), connectionId, organizationId],
  );
  if (!result.changes) throw new Error('cm: connection not found');
}
