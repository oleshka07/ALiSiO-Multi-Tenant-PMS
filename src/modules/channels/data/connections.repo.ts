import { getSql } from '@core/db/async';
import { currentOrganizationId } from '@core/auth/tenant-context';

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
}

/** Зʼєднання, якщо воно НАШЕ. Чуже й неіснуюче однаково дають `null`. */
function toConnection(row: Record<string, any>): Connection {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    propertyId: String(row.property_id),
    provider: String(row.provider),
    environment: String(row.environment),
    remotePropertyId: row.remote_property_id == null ? null : String(row.remote_property_id),
    isEnabled: Boolean(Number(row.is_enabled)),
    pricingModifierPercent: Number(row.pricing_modifier_percent) || 0,
  };
}

export async function connectionInTenant(connectionId: string): Promise<Connection | null> {
  const organizationId = currentOrganizationId();
  if (!organizationId) throw new Error('cm: connection lookup without a tenant');

  const sql = getSql();
  const row = await sql.row<any>(
    `SELECT id, organization_id, property_id, provider, environment,
            remote_property_id, is_enabled, pricing_modifier_percent
       FROM cm_connections
      WHERE id = ? AND organization_id = ?`,
    [connectionId, organizationId],
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
            remote_property_id, is_enabled, pricing_modifier_percent
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
            remote_property_id, is_enabled, pricing_modifier_percent
       FROM cm_connections
      WHERE organization_id = ?
      ORDER BY property_id, id`,
    [organizationId],
  ) as Record<string, unknown>[];
  return rows.map(toConnection);
}
