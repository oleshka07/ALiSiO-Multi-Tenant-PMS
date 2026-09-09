import type { Sql } from '@core/db/async';

/**
 * Зняти рядок кімнати групи — або сказати, чому не зняли.
 *
 * ── Навіщо ці двері ─────────────────────────────────────────────────────
 *
 * Кімнати групи прибирає не лише рецепція: коли канал присилає ревізію без
 * якоїсь кімнати, її рядок має зникнути й там. Але `reservation_sub_bookings`
 * — таблиця БРОНЕЙ, і на ній висять ще дві таблиці броней; модуль каналів до
 * них не дотягується за побудовою (`check-boundaries`). Тому знання «як саме
 * знімається рядок» живе тут, а канал кличе одну функцію.
 *
 * Вузькі двері (`api/`, без `next/*`), як `@bookings/history`: цей шлях
 * виконує і крон, і живі проходи голим node.
 *
 * ── Дві речі на рядку, і різниця в ОБОРОТНОСТІ ──────────────────────────
 *
 * `reservation_guests.sub_booking_id` — ключ БЕЗ `ON DELETE`. Гість,
 * прописаний на кімнату, робив `DELETE` неможливим:
 *
 *   ERROR: update or delete on table "reservation_sub_bookings" violates
 *          foreign key constraint "fk_reservation_guests_sub_booking_id_1"
 *
 * З боку каналу це коштувало нескінченного циклу: виняток валив `apply`,
 * стрічка писала `apply_failed:` і йшла далі, `ack` не виконувався НІКОЛИ, і
 * готель отримував `non_acked_booking` кожним проходом. Сценарій буденний —
 * рецепція прописала гостя на кімнату 2, канал цю кімнату прибрав (рецензія
 * раунду 21, Б2). Гість тут ВІДʼЄДНУЄТЬСЯ: він лишається на броні, просто
 * більше не на кімнаті, якої немає. Це оборотно.
 *
 * `reservation_line_items.sub_booking_id` — `ON DELETE CASCADE`, тобто
 * виставлені позиції фоліо зникли б МОВЧКИ разом із рядком. Це вже
 * незворотно, і питання «чи можна стирати виставлені позиції з волі каналу»
 * не технічне — воно поставлене власнику. **Доти рядок із позиціями
 * лишається**: ревізія проходить і підтверджується, а зайву кімнату оператор
 * бачить у картці й знімає сам, якщо вважає за потрібне.
 *
 * Рядок без позицій знімається одразу — там стирати нема чого.
 */
export type GroupRoomRelease = 'removed' | 'kept_has_charges';

export async function releaseGroupRoom(sql: Sql, subBookingId: string): Promise<GroupRoomRelease> {
  await sql.run(
    'UPDATE reservation_guests SET sub_booking_id = NULL WHERE sub_booking_id = ?',
    [subBookingId]);

  const charged = await sql.row<{ n: number }>(
    'SELECT COUNT(*) AS n FROM reservation_line_items WHERE sub_booking_id = ?',
    [subBookingId]);
  if (Number(charged?.n ?? 0) > 0) return 'kept_has_charges';

  await sql.run('DELETE FROM reservation_sub_bookings WHERE id = ?', [subBookingId]);
  return 'removed';
}
