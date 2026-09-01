import { getSql } from '@core/db/async';
import { currentOrganizationId } from '@core/auth/tenant-context';
import { connectionInTenant } from './connections.repo';

/**
 * Дзеркало мапінгу: що з нашого чим стало на тому боці.
 *
 * ── Що тут НЕ відбувається ──────────────────────────────────────────────
 *
 * Сам мапінг. Його робить оператор в iFrame менеджера каналів (рішення §7
 * ТЗ), і це не лінощі: у кожного OTA своя модель — Booking.com мапить на
 * пари «номер + тариф», Airbnb на лістинги з власною ціновою моделлю, VRBO
 * на лістинги з іншими ідентифікаторами. Один спільний екран на всі канали
 * не працює, а чотири екрани — це чотири екрани.
 *
 * Тут — рівень, який потрібен НАМ САМИМ: бронювання приїжджає з чужим
 * ідентифікатором типу номера, і без цієї таблиці перекласти його нема чим.
 * Бронь тоді лягає без типу (`unmapped`), наявність її не бачить, і
 * зіставляти доводиться руками на кожну броню.
 *
 * ── Заселеність — окремий рядок ─────────────────────────────────────────
 *
 * `entity_type = 'rate_plan_option'` з `occupancy > 0`: живий
 * `GET /restrictions` індексований не тарифом, а ОПЦІЄЮ заселеності
 * (INVENTORY §4.5 — три тарифи віддали вісім ключів). Основна опція має той
 * самий id, що й тариф; решта мають власні UUID, які не повертаються ніде,
 * крім `options[]` самого тарифу. Без цих рядків власні ціни неможливо
 * прочитати назад.
 *
 * `occupancy = 0` означає «сама сутність, не опція». Не NULL: `UNIQUE` не
 * обмежує NULL ні в SQLite, ні в Postgres, і на цьому вже обпікся
 * `price_occupancy` у цій самій базі.
 */

export type MappedEntity = 'property' | 'unit_type' | 'rate_plan' | 'rate_plan_option';

export interface MappingRow {
  entityType: MappedEntity;
  /** НАШ ідентифікатор. */
  localId: string;
  /**
   * Другий бік пари «тип номера × тариф». Порожньо для обʼєкта й типу номера.
   *
   * У нас тариф належить обʼєкту, у менеджера каналів — ТИПУ НОМЕРА, тож наш
   * тариф із цінами на трьох типах стає трьома тарифами на тому боці (Ц6).
   * Ключ без типу затирав би попередній рядок на кожному наступному типі, і
   * дві третини фонду лишились би без обміну — беззвучно.
   */
  unitTypeId?: string;
  /** Заселеність опції; `0` — сама сутність. */
  occupancy?: number;
  /** Ідентифікатор на тому боці. */
  remoteId: string;
}

/**
 * Записати відповідність, перезаписавши наявну.
 *
 * Мапінг перечитується щоразу після синхронізації каталогу, тож `INSERT` на
 * кожен прохід дав би два рядки на один тип номера — і який із них виграє,
 * стало б питанням порядку читання.
 *
 * Конфлікт можливий із двох боків, і обидва означають одне: «цей звʼязок уже
 * описаний, онови його». Тому спершу прибираємо чужу пару за віддаленим
 * id — інакше перенесення типу на інший `remote_id` лишало б осиротілий
 * рядок, який далі перекладав би броні в те, чого вже немає.
 */
export async function putMapping(connectionId: string, row: MappingRow): Promise<void> {
  const sql = getSql();
  const occupancy = row.occupancy ?? 0;
  const unitTypeId = row.unitTypeId ?? '';

  // Чуже зʼєднання не існує для нас — і це відмова, а не «немає обмежень,
  // отже можна» (інваріант 13). Обмеження тут явне, а не покладене на
  // політику: на SQLite політик немає, а SQLite стоїть у розробки й у CI.
  const conn = await connectionInTenant(connectionId);
  if (!conn) throw new Error('cm_mappings: connection not found');

  await sql.run(
    `DELETE FROM cm_mappings
      WHERE connection_id = ? AND organization_id = ? AND entity_type = ?
        AND (remote_id = ? OR (local_id = ? AND unit_type_id = ? AND occupancy = ?))`,
    [connectionId, conn.organizationId, row.entityType, row.remoteId,
      row.localId, unitTypeId, occupancy],
  );

  await sql.run(
    `INSERT INTO cm_mappings
       (id, organization_id, connection_id, entity_type, local_id, unit_type_id,
        occupancy, remote_id, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [crypto.randomUUID(), conn.organizationId, connectionId,
      row.entityType, row.localId, unitTypeId, occupancy, row.remoteId],
  );
}

/**
 * Дзеркало одного роду сутностей: **чужий id → наш**.
 *
 * Напрямок саме такий, бо саме так його читають: бронювання приносить чужий
 * `room_type_id`, і питання завжди «а це який наш тип». Зворотний напрямок
 * потрібен при відправленні ARI — його дає `remoteIdOf()`.
 *
 * Порожня мапа — нормальний стан щойно підключеного обʼєкта, не помилка.
 */
export async function mappingMirror(
  connectionId: string,
  entityType: MappedEntity,
): Promise<Map<string, string>> {
  const organizationId = currentOrganizationId();
  if (!organizationId) throw new Error('cm_mappings: read without a tenant');

  const sql = getSql();
  const rows = await sql.rows<any>(
    `SELECT remote_id, local_id FROM cm_mappings
      WHERE connection_id = ? AND organization_id = ? AND entity_type = ?`,
    [connectionId, organizationId, entityType],
  ) as { remote_id: string; local_id: string }[];

  return new Map(rows.map((r) => [r.remote_id, r.local_id]));
}

/**
 * Наш id → чужий. Для того, що ми ВІДПРАВЛЯЄМО. `null`, якщо не змаплено.
 *
 * `unitTypeId` — другий бік пари для тарифів і їхніх опцій. Обʼєкт і тип
 * номера пари не мають, тож для них він порожній, і це не «будь-який»:
 * запит із порожнім типом НЕ знайде рядок тарифу, і навпаки. Ключ,
 * зіставлений наполовину, віддав би чужий тариф як свій.
 */
export async function remoteIdOf(
  connectionId: string,
  entityType: MappedEntity,
  localId: string,
  occupancy = 0,
  unitTypeId = '',
): Promise<string | null> {
  const organizationId = currentOrganizationId();
  if (!organizationId) throw new Error('cm_mappings: read without a tenant');

  const sql = getSql();
  const row = await sql.row<any>(
    `SELECT remote_id FROM cm_mappings
      WHERE connection_id = ? AND organization_id = ? AND entity_type = ?
        AND local_id = ? AND unit_type_id = ? AND occupancy = ?`,
    [connectionId, organizationId, entityType, localId, unitTypeId, occupancy],
  ) as { remote_id: string } | undefined;

  return row?.remote_id ?? null;
}

/** Один рядок дзеркала, як його читає звірка. */
export interface MirrorRow {
  entityType: MappedEntity;
  localId: string;
  /** Другий бік ПАРИ. Порожньо для обʼєкта й типу номера. */
  unitTypeId: string;
  /** 0 — сама сутність, не опція заселеності. */
  occupancy: number;
  remoteId: string;
}

/**
 * Усе дзеркало зʼєднання — для звірки, а не для перекладу.
 *
 * `mappingMirror()` віддає мапу «чужий → наш» одного роду: цього досить, щоб
 * перекласти бронь, і НЕ досить, щоб звірити каталог. Звірка питає інше — чи
 * кожна наша пара «тип × тариф» стала окремим тарифом на тому боці (Ц10) і
 * чи всі опції заселеності на місці (И13), — а для цього потрібні саме ті
 * колонки, які мапа відкидає: `unit_type_id` і `occupancy`.
 *
 * Порожній список — нормальний стан незаведеного каталогу, не помилка.
 */
export async function connectionMirror(connectionId: string): Promise<MirrorRow[]> {
  const organizationId = currentOrganizationId();
  if (!organizationId) throw new Error('cm_mappings: read without a tenant');

  const sql = getSql();
  const rows = await sql.rows<any>(
    `SELECT entity_type, local_id, unit_type_id, occupancy, remote_id
       FROM cm_mappings
      WHERE connection_id = ? AND organization_id = ?
      ORDER BY entity_type, local_id, unit_type_id, occupancy`,
    [connectionId, organizationId],
  ) as Record<string, unknown>[];

  return rows.map((r) => ({
    entityType: String(r.entity_type) as MappedEntity,
    localId: String(r.local_id),
    unitTypeId: String(r.unit_type_id ?? ''),
    occupancy: Number(r.occupancy) || 0,
    remoteId: String(r.remote_id),
  }));
}
