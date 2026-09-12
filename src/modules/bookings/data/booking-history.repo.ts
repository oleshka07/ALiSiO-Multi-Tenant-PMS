/**
 * Історія змін броні — одні двері на всіх писачів.
 *
 * `booking_activity_log` пишуть три місця: обробники броні (статус, дати,
 * ціна, номер), платежі й ревізії з каналу. До 03.09.2026 писав лише
 * перший, тож зміна, що прийшла з Booking.com, у картці не лишала сліду —
 * рецепція бачила нові дати і не знала, хто їх поставив. Тепер кожен
 * запис називає автора: людину з сесії або канал із кодом броні.
 *
 * `organization_id` — підзапитом від броні (інваріант 12): запис без
 * орендаря — запис, якого жоден орендар не прочитає.
 */
import type { Sql } from '@core/db/async';
import { getSql } from '@core/db/async';

export interface HistoryActor {
  /** Ідентифікатор користувача; для каналу — порожньо. */
  id: string | null;
  /** Як показати автора: імʼя людини або «Booking.com · Channex». */
  name: string;
}

export interface BookingChange {
  reservationId: string;
  /** Словник дій — див. `HISTORY_ACTIONS`. */
  action: string;
  /** Один рядок для людини: що сталось. */
  details: string;
  actor: HistoryActor | null;
  before?: unknown;
  after?: unknown;
  /** Підпис броні, який переживе її видалення; за замовчуванням складається з рядка. */
  bookingLabel?: string;
}

/** Дії, які зʼявляються в історії. Ключ — не текст: картка перекладає сама. */
export const HISTORY_ACTIONS = [
  'created', 'deleted', 'status_change', 'payment_status_change', 'price_change',
  'unit_change', 'dates_change', 'registration_change', 'notes_change', 'internal_notes_change',
  // Заселеність змінено рукою (Блок 4, «перерахувати ціну за новою заселеністю»).
  'guests_change',
  'payment', 'note',
  // Дописані 12.09.2026: власник приймав оплату й міняв платника,
  // а «Історія змін» лишалась порожньою. `payment_marker` писався в базу
  // ще й доті, але в цьому словнику його не було.
  'payment_marker', 'payer_change', 'rate_plan_change', 'discount_change', 'breakfast_change',
  'registration_added', 'registration_removed',
  'channel_created', 'channel_modified', 'channel_cancelled',
] as const;

/** Підпис броні для журналу: гість · номер · дати. Переживає видалення броні. */
export async function bookingLabel(sql: Sql, reservationId: string): Promise<string> {
  try {
    const row = await sql.row<any>(`
      SELECT r.check_in, r.check_out, u.code AS unit_code, g.first_name, g.last_name
      FROM reservations r
      LEFT JOIN guests g ON r.guest_id = g.id
      LEFT JOIN units u ON r.unit_id = u.id
      WHERE r.id = ?
    `, [reservationId]);
    if (!row) return reservationId;
    return `${row.first_name || ''} ${row.last_name || ''} · ${row.unit_code || ''} · ${day(row.check_in)}–${day(row.check_out)}`.trim();
  } catch {
    return reservationId;
  }
}

/**
 * Записати зміну. Ніколи не кидає: історія — не причина зірвати саму зміну,
 * але відмова лишається в журналі сервера.
 */
export async function recordBookingChange(sqlOrChange: Sql | BookingChange, maybeChange?: BookingChange): Promise<void> {
  const sql = maybeChange ? (sqlOrChange as Sql) : getSql();
  const change = (maybeChange ?? sqlOrChange) as BookingChange;
  const id = `bal_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  try {
    const label = change.bookingLabel || await bookingLabel(sql, change.reservationId);
    await sql.run(`
      INSERT INTO booking_activity_log
        (id, organization_id, reservation_id, action, details, user_id, user_name, before_json, after_json, booking_label)
      VALUES (?, (SELECT organization_id FROM reservations WHERE id = ?), ?, ?, ?, ?, ?, ?, ?, ?)
    `, [id, change.reservationId, change.reservationId, change.action, change.details,
      change.actor?.id ?? null, change.actor?.name ?? null,
      change.before ? JSON.stringify(change.before) : null,
      change.after ? JSON.stringify(change.after) : null,
      label]);
  } catch (e: any) {
    console.error('[booking_activity_log] write failed (non-fatal):', e?.message);
  }
}

/**
 * Знімок броні для історії — рядок плюс назви там, де в рядку лише id:
 * тип номера, код номера, імʼя гостя. Саме так знімок читається на картці
 * без другого запиту.
 */
export async function bookingSnapshot(sql: Sql, reservationId: string): Promise<Record<string, unknown> | null> {
  const row = await sql.row<any>(`
    SELECT r.*, ut.name AS unit_type_name, u.code AS unit_code,
           TRIM(COALESCE(g.first_name, '') || ' ' || COALESCE(g.last_name, '')) AS guest_name
    FROM reservations r
    LEFT JOIN unit_types ut ON ut.id = r.unit_type_id
    LEFT JOIN units u ON u.id = r.unit_id
    LEFT JOIN guests g ON g.id = r.guest_id
    WHERE r.id = ?
  `, [reservationId]);
  return row ?? null;
}

function day(v: unknown): string {
  if (!v) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}
