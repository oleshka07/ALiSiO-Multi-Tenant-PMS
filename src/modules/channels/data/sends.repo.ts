import { getSql } from '@core/db/async';
import { currentOrganizationId } from '@core/auth/tenant-context';

/**
 * Журнал відправлень з ТІЛОМ: що саме пішло до менеджера каналів, коли, з
 * яким статусом і якою розпискою (Блок 0.5 п.4; у Hoteliera — `last_sent`,
 * Sync Inspector).
 *
 * ── Чого не вистачало розписці на координаті ─────────────────────────────
 *
 * `cm_outbox.receipt` (П6, 0061) каже, ЩО поїхало, — координата й task id.
 * Він не каже, З ЯКИМИ ПОЛЯМИ. Лист Channex від 05.09.2026 відхилив
 * сертифікацію саме за поля в тілі («несе весь стан, не дельту»), а ми не
 * мали чим це побачити до подання: звірити task id з таблицею тесту можна
 * лише маючи тіло. Тому кожен виклик лягає рядком — тіло дослівно, статус,
 * розписка, скільки значень і які ключі.
 *
 * ── Невдалий виклик — теж рядок ─────────────────────────────────────────
 *
 * Зі статусом і без task id. Журнал, у якому видно лише успіхи, — це не
 * журнал: «чому ціна не доїхала» відповідається саме тут, поруч із тілом,
 * яке вендор відхилив, а не в журналі сервера.
 *
 * ── Що в тілі й чого там немає ──────────────────────────────────────────
 *
 * Ціни, обмеження, наявність, чужі ідентифікатори тарифів і типів. Жодного
 * ПІБ і жодного секрету: ключ API живе в заголовку, а не в тілі. Тому
 * ретенція — 90 днів (`SEND_LOG_RETENTION_DAYS`), кроном GDPR разом із
 * решткою планового прибирання, а не «назавжди»: доказ у суперечці з
 * вендором потрібен тижнями, не роками.
 *
 * ── Орендар ─────────────────────────────────────────────────────────────
 *
 * Пишеться лише в контексті орендаря (батчер ходить у ньому), з явним
 * `organization_id` (інваріант 12). Чуже зʼєднання читає порожньо: політика
 * на Postgres і `organization_id` у WHERE — на SQLite.
 */

export type SendLane = 'availability' | 'rate';

/** Що було в тілі — НАШИМИ координатами, поруч із чужими в самому тілі. */
export interface SendSummary {
  /** Ключі значень у тілі, крім адресних і дат — те, що звіряє контролер із таблицею тесту. */
  fields: string[];
  /** Наші типи номерів, яких торкнулось тіло. */
  unitTypeIds: string[];
  /** Наші пари тип × тариф (лише смуга цін). */
  pairs: { ratePlanId: string; unitTypeId: string }[];
  /** Перша й остання ніч у тілі. */
  from: string | null;
  to: string | null;
}

export interface SendRecord {
  connectionId: string;
  lane: SendLane;
  /** Тіло дослівно — те, що пішло на дріт. */
  requestBody: unknown;
  /** HTTP-статус відповіді; `null` — до відповіді не дійшло (мережа, власна пауза). */
  responseStatus: number | null;
  /** Розписка вендора; кілька — через кому. `null` — виклик не вдався. */
  taskId: string | null;
  /** Причина невдачі — коротко, для рядка. */
  error: string | null;
  /** Скільки значень у тілі. */
  rowsCount: number;
  summary: SendSummary;
}

export interface SendLogRow extends SendRecord {
  id: string;
  sentAt: string;
}

/** Скільки днів живе рядок журналу. Тіло без ПІБ, але й не назавжди. */
export const SEND_LOG_RETENTION_DAYS = 90;

export async function recordSend(rec: SendRecord): Promise<void> {
  const organizationId = currentOrganizationId();
  if (!organizationId) throw new Error('cm_sends: write without a tenant');
  await getSql().run(
    `INSERT INTO cm_sends
       (id, organization_id, connection_id, lane, sent_at, task_id, request_body, response_status, error, rows_count, summary)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [crypto.randomUUID(), organizationId, rec.connectionId, rec.lane, new Date().toISOString(),
      rec.taskId, JSON.stringify(rec.requestBody), rec.responseStatus, rec.error ? rec.error.slice(0, 500) : null,
      rec.rowsCount, JSON.stringify(rec.summary)],
  );
}

const parse = <T>(text: unknown, fallback: T): T => {
  if (text == null) return fallback;
  if (typeof text === 'object') return text as T;
  try { return JSON.parse(String(text)) as T; } catch { return fallback; }
};

/** Останні виклики зʼєднання, найновіший першим. Чуже — порожньо. */
export async function recentSendLog(connectionId: string, limit = 50): Promise<SendLogRow[]> {
  const organizationId = currentOrganizationId();
  if (!organizationId) throw new Error('cm_sends: read without a tenant');
  const rows = await getSql().rows<any>(
    `SELECT id, connection_id, lane, sent_at, task_id, request_body, response_status, error, rows_count, summary
       FROM cm_sends
      WHERE connection_id = ? AND organization_id = ?
      ORDER BY sent_at DESC, id DESC
      LIMIT ?`,
    [connectionId, organizationId, Math.max(1, Math.min(500, limit))],
  );
  return rows.map((r) => ({
    id: String(r.id),
    connectionId: String(r.connection_id),
    lane: String(r.lane) as SendLane,
    sentAt: r.sent_at instanceof Date ? r.sent_at.toISOString() : String(r.sent_at),
    taskId: r.task_id == null ? null : String(r.task_id),
    requestBody: parse<unknown>(r.request_body, null),
    responseStatus: r.response_status == null ? null : Number(r.response_status),
    error: r.error == null ? null : String(r.error),
    rowsCount: Number(r.rows_count) || 0,
    summary: parse<SendSummary>(r.summary, { fields: [], unitTypeIds: [], pairs: [], from: null, to: null }),
  }));
}

/**
 * Прибрати рядки, старші за `days`, — ЦЬОГО орендаря. Кличеться в його
 * контексті: на Postgres `DELETE` без орендаря не видалив би нічого і не
 * сказав би про це (клас INC-014).
 */
export async function purgeSendLog(days = SEND_LOG_RETENTION_DAYS): Promise<number> {
  const organizationId = currentOrganizationId();
  if (!organizationId) throw new Error('cm_sends: purge without a tenant');
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const res = await getSql().run(
    'DELETE FROM cm_sends WHERE organization_id = ? AND sent_at < ?',
    [organizationId, cutoff],
  );
  return Number(res.changes ?? 0);
}
