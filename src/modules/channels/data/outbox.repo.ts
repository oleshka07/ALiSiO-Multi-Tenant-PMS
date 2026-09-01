import { getSql } from '@core/db/async';
import { currentOrganizationId } from '@core/auth/tenant-context';
import { connectionInTenant } from './connections.repo';

/**
 * Черга вихідних змін: що змінилося, а не на що.
 *
 * ── Чому тут немає значень ──────────────────────────────────────────────
 *
 * Рядок — це координата: «наявність типу X на дату D змінилась». Поточне
 * число батчер читає з джерела (`availabilityByDay()`, `priceNights()` —
 * інваріант 16). Колонки під значення в схемі немає, і це не забудькуватість:
 * два записи за 40 секунд дали б дві відправки з РІЗНИМИ числами, і яке
 * доїде останнім — питання порядку в черзі, а не стану готелю.
 *
 * ── Дві смуги ───────────────────────────────────────────────────────────
 *
 * Менеджер каналів обробляє наявність окремим, швидшим шляхом і просить
 * слати її окремо. Змішати означає сповільнити найтерміновіше: застаріла
 * наявність продає номер, якого немає, а застаріла ціна — лише неправильні
 * гроші.
 *
 * ── Захоплення без FOR UPDATE SKIP LOCKED ───────────────────────────────
 *
 * Той Postgres-only, а розробка й CI ходять і по SQLite. Тому позначаємо
 * `claimed_at` умовним `UPDATE` і читаємо позначене — однаково на обох.
 *
 * З цього ж випливає найтонше правило файла: зміна, що прийшла ПІСЛЯ
 * захоплення, НЕ зливається із захопленим рядком. Той уже в польоті зі
 * старим числом; злиття означало б, що нова ціна не поїде ніколи — і жодної
 * помилки при цьому не станеться.
 */

export type ChangeKind = 'availability' | 'rate';

export interface Change {
  kind: ChangeKind;
  /** Тип номера. Для наявності — обовʼязковий, вона висить саме на ньому. */
  unitTypeId?: string | null;
  /** Тариф. Для наявності порожній: вона не залежить від тарифу. */
  ratePlanId?: string | null;
  /** Доба проживання, `YYYY-MM-DD`. */
  date: string;
}

export interface ClaimedChange {
  id: string;
  kind: ChangeKind;
  unitTypeId: string | null;
  ratePlanId: string | null;
  date: string;
  attempts: number;
  lastError: string | null;
}

/**
 * Поставити координату в чергу.
 *
 * Викликається В ТІЙ САМІЙ транзакції, що й сама зміна: черга, яка
 * поповнюється окремим кроком, розходиться зі станом при першому ж падінні
 * між ними.
 *
 * Повторна зміна тієї самої координати НЕ додає рядка, поки попередній не
 * захоплений: значення однаково читається з джерела, тож другий рядок — це
 * зайвий виклик із ліміту 10 на хвилину. Але щойно рядок захоплено, нова
 * зміна створює НОВИЙ — див. шапку.
 */
export async function enqueueChange(connectionId: string, change: Change): Promise<void> {
  const conn = await connectionInTenant(connectionId);
  if (!conn) throw new Error('cm_outbox: connection not found');

  const sql = getSql();
  const unitTypeId = change.unitTypeId ?? null;
  const ratePlanId = change.ratePlanId ?? null;

  // `IS ?` не буває, а `= ?` не збігається з NULL на жодному двигуні — тому
  // порівняння через COALESCE: координата з порожнім тарифом (наявність) має
  // впізнаватися так само надійно, як із заповненим.
  const existing = await sql.row<any>(
    `SELECT id FROM cm_outbox
      WHERE connection_id = ? AND organization_id = ? AND kind = ?
        AND COALESCE(unit_type_id, '') = COALESCE(?, '')
        AND COALESCE(rate_plan_id, '') = COALESCE(?, '')
        AND stay_date = ?
        AND sent_at IS NULL AND claimed_at IS NULL`,
    [connectionId, conn.organizationId, change.kind, unitTypeId, ratePlanId, change.date],
  ) as { id: string } | undefined;
  if (existing) return;

  await sql.run(
    `INSERT INTO cm_outbox
       (id, organization_id, connection_id, kind, unit_type_id, rate_plan_id, stay_date)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [crypto.randomUUID(), conn.organizationId, connectionId,
      change.kind, unitTypeId, ratePlanId, change.date],
  );
}

/** Скільки координат чекає відправлення. Захоплені не рахуються — вони в польоті. */
export async function pendingCount(connectionId: string, kind?: ChangeKind): Promise<number> {
  const organizationId = currentOrganizationId();
  if (!organizationId) throw new Error('cm_outbox: read without a tenant');

  const sql = getSql();
  const row = await sql.row<any>(
    `SELECT COUNT(*) AS n FROM cm_outbox
      WHERE connection_id = ? AND organization_id = ?
        AND sent_at IS NULL AND claimed_at IS NULL
        ${kind ? 'AND kind = ?' : ''}`,
    kind ? [connectionId, organizationId, kind] : [connectionId, organizationId],
  ) as { n: number | string };
  return Number(row?.n ?? 0);
}

/**
 * Забрати пачку однієї смуги — позначити своєю і повернути.
 *
 * Двоє батчерів не отримають один рядок: другий `UPDATE` не побачить його
 * серед `claimed_at IS NULL`. Це заміна `FOR UPDATE SKIP LOCKED`, яка працює
 * на обох двигунах.
 *
 * Мітка одна на пачку — за нею ж рядки й читаються назад. Читати «останні N
 * захоплених» не можна: між двома батчерами це та сама гонка, тільки на крок
 * пізніше.
 */
export async function claimBatch(
  connectionId: string,
  kind: ChangeKind,
  limit: number,
): Promise<ClaimedChange[]> {
  const organizationId = currentOrganizationId();
  if (!organizationId) throw new Error('cm_outbox: claim without a tenant');

  const sql = getSql();
  const mark = `claim:${crypto.randomUUID()}`;

  // Спершу обираємо кандидатів, потім позначаємо їх поіменно: `UPDATE … LIMIT`
  // існує не в кожній збірці SQLite і не в Postgres, а `IN (SELECT … LIMIT)`
  // на Postgres читає без блокування — саме та гонка, від якої ми тут і
  // захищаємось. Умова `claimed_at IS NULL` у самому `UPDATE` лишається
  // арбітром: хто дописав першим, той і забрав.
  const candidates = await sql.rows<any>(
    `SELECT id FROM cm_outbox
      WHERE connection_id = ? AND organization_id = ? AND kind = ?
        AND sent_at IS NULL AND claimed_at IS NULL
      ORDER BY created_at
      LIMIT ?`,
    [connectionId, organizationId, kind, limit],
  ) as { id: string }[];
  if (candidates.length === 0) return [];

  const holes = candidates.map(() => '?').join(', ');
  await sql.run(
    `UPDATE cm_outbox SET claimed_at = ?, last_error = NULL
      WHERE id IN (${holes}) AND claimed_at IS NULL AND sent_at IS NULL`,
    [mark, ...candidates.map((c) => c.id)],
  );

  const rows = await sql.rows<any>(
    `SELECT id, kind, unit_type_id, rate_plan_id, stay_date, attempts, last_error
       FROM cm_outbox
      WHERE claimed_at = ? AND organization_id = ?
      ORDER BY created_at`,
    [mark, organizationId],
  ) as Record<string, unknown>[];

  return rows.map((r) => ({
    id: String(r.id),
    kind: String(r.kind) as ChangeKind,
    unitTypeId: r.unit_type_id == null ? null : String(r.unit_type_id),
    ratePlanId: r.rate_plan_id == null ? null : String(r.rate_plan_id),
    date: String(r.stay_date).slice(0, 10),
    attempts: Number(r.attempts) || 0,
    lastError: r.last_error == null ? null : String(r.last_error),
  }));
}

/** Пачка доїхала. Рядок лишається — він доказ у суперечці «ми це слали». */
export async function markSent(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const organizationId = currentOrganizationId();
  if (!organizationId) throw new Error('cm_outbox: write without a tenant');

  const sql = getSql();
  const holes = ids.map(() => '?').join(', ');
  await sql.run(
    `UPDATE cm_outbox SET sent_at = CURRENT_TIMESTAMP
      WHERE id IN (${holes}) AND organization_id = ?`,
    [...ids, organizationId],
  );
}

/**
 * Пачка не доїхала — повернути в чергу.
 *
 * Без цього захоплений і незданий рядок лишається захопленим НАЗАВЖДИ: зміна
 * не поїде, черга виглядає порожньою, і ніхто про це не дізнається. Лічильник
 * спроб — щоб вічний цикл було видно числом, а не здогадом.
 */
export async function releaseFailed(ids: string[], reason: string): Promise<void> {
  if (ids.length === 0) return;
  const organizationId = currentOrganizationId();
  if (!organizationId) throw new Error('cm_outbox: write without a tenant');

  const sql = getSql();
  const holes = ids.map(() => '?').join(', ');
  await sql.run(
    `UPDATE cm_outbox
        SET claimed_at = NULL, attempts = attempts + 1, last_error = ?
      WHERE id IN (${holes}) AND organization_id = ? AND sent_at IS NULL`,
    [reason.slice(0, 500), ...ids, organizationId],
  );
}
