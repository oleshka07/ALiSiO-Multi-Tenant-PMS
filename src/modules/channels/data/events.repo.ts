import crypto from 'node:crypto';
import { getSql, type Sql } from '@core/db/async';
import { currentOrganizationId } from '@core/auth/tenant-context';

/**
 * Сирі події менеджера каналів — `cm_events`.
 *
 * Це і журнал, і черга. Двері вебхука кладуть рядок як є (сигнал, не дані:
 * тіло на віру не береться, підпису у вендора немає) і відповідають; прохід
 * стрічки знімає booking-події після себе; решта чекає ока оператора на
 * екрані «Канал-менеджер» і знімається його рукою.
 *
 * Тип події — непрозорий текст: імена — справа адаптера (И1), тут він лише
 * ключ. Орендар — у КОЖНОМУ запиті явно, як усюди в модулі (`connections.repo`
 * пояснює чому: політика прикриває лише Postgres, а SQLite стоїть у розробки).
 */

export interface ChannelEvent {
  id: string;
  connectionId: string;
  eventType: string;
  /** Сирий JSON — рядком на обох двигунах (на Postgres колонка JSONB). */
  payload: string;
  receivedAt: string;
  processedAt: string | null;
}

export interface RecordEventInput {
  connectionId: string;
  /** Названий явно — двері знають його з рядка зʼєднання, а не з сесії. */
  organizationId: string;
  eventType: string;
  payload: unknown;
}

/** Записати сиру подію. Повертає її id. Ручка `t` — щоб лягти в чужу транзакцію. */
export async function recordEvent(input: RecordEventInput, t: Sql = getSql()): Promise<string> {
  const id = crypto.randomBytes(16).toString('hex');
  await t.run(
    `INSERT INTO cm_events (id, organization_id, connection_id, event_type, payload)
     VALUES (?, ?, ?, ?, ?)`,
    [id, input.organizationId, input.connectionId, input.eventType, JSON.stringify(input.payload ?? null)],
  );
  return id;
}

function toEvent(row: Record<string, any>): ChannelEvent {
  return {
    id: String(row.id),
    connectionId: String(row.connection_id),
    eventType: String(row.event_type),
    payload: typeof row.payload === 'string' ? row.payload : JSON.stringify(row.payload ?? null),
    receivedAt: row.received_at instanceof Date ? row.received_at.toISOString() : String(row.received_at),
    processedAt: row.processed_at == null ? null : (row.processed_at instanceof Date ? row.processed_at.toISOString() : String(row.processed_at)),
  };
}

/** Необроблені події зʼєднання, від найстарішої. Чуже зʼєднання — порожньо. */
export async function unprocessedEvents(connectionId: string): Promise<ChannelEvent[]> {
  const organizationId = currentOrganizationId();
  if (!organizationId) throw new Error('cm: events read without a tenant');
  const rows = await getSql().rows<any>(
    `SELECT id, connection_id, event_type, payload, received_at, processed_at
       FROM cm_events
      WHERE connection_id = ? AND organization_id = ? AND processed_at IS NULL
      ORDER BY received_at ASC, id ASC`,
    [connectionId, organizationId],
  );
  return rows.map(toEvent);
}

/**
 * Позначити обробленим — за id або за типом. Порожній фільтр не позначає
 * нічого: «все» треба назвати. Повертає, скільки рядків справді змінилось.
 */
export async function markEventsProcessed(
  connectionId: string,
  filter: { ids?: string[]; eventTypes?: string[] },
): Promise<number> {
  const organizationId = currentOrganizationId();
  if (!organizationId) throw new Error('cm: events update without a tenant');

  const clauses: string[] = [];
  const params: unknown[] = [new Date().toISOString(), connectionId, organizationId];
  if (filter.ids?.length) {
    clauses.push(`id IN (${filter.ids.map(() => '?').join(', ')})`);
    params.push(...filter.ids);
  }
  if (filter.eventTypes?.length) {
    clauses.push(`event_type IN (${filter.eventTypes.map(() => '?').join(', ')})`);
    params.push(...filter.eventTypes);
  }
  if (clauses.length === 0) return 0;

  const result = await getSql().run(
    `UPDATE cm_events
        SET processed_at = ?
      WHERE connection_id = ? AND organization_id = ? AND processed_at IS NULL
        AND (${clauses.join(' OR ')})`,
    params,
  );
  return Number(result.changes ?? 0);
}
