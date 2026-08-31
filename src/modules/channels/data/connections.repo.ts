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
}

/** Зʼєднання, якщо воно НАШЕ. Чуже й неіснуюче однаково дають `null`. */
export async function connectionInTenant(connectionId: string): Promise<Connection | null> {
  const organizationId = currentOrganizationId();
  if (!organizationId) throw new Error('cm: connection lookup without a tenant');

  const sql = getSql();
  const row = await sql.row<any>(
    `SELECT id, organization_id, property_id, provider, environment,
            remote_property_id, is_enabled
       FROM cm_connections
      WHERE id = ? AND organization_id = ?`,
    [connectionId, organizationId],
  ) as Record<string, unknown> | undefined;

  if (!row) return null;

  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    propertyId: String(row.property_id),
    provider: String(row.provider),
    environment: String(row.environment),
    remotePropertyId: row.remote_property_id == null ? null : String(row.remote_property_id),
    isEnabled: Boolean(Number(row.is_enabled)),
  };
}
