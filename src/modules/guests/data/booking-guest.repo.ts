/**
 * Хто саме гість цієї броні — коли рецепція НАЗВАЛА його, і коли ні.
 *
 * ── Навіщо окремі двері ─────────────────────────────────────────────────
 *
 * `findOrCreateGuest` вгадує людину за ланцюжком пошта → телефон → точне
 * імʼя. Для віджета, каналу й імпорту це правильно: там людину ніхто не
 * обирав, є лише рядки з чужої системи.
 *
 * Але у рецепції, яка бачить список і тицяє в потрібного, вгадування —
 * ГІРШЕ за вибір, і остання ланка ланцюжка каже чому: збіг за самим лише
 * імʼям. Двоє «Іванів Петренків» без пошти й телефону — одна людина для
 * дедупу і дві для готелю. Поки вибору не було, це просто траплялось; щойно
 * зʼявився вибір, мовчки його перекрити означало б показати портьє один
 * рядок, а бронь почепити на інший.
 *
 * Тому: НАЗВАНИЙ гість береться як названий і не звіряється з ланцюжком.
 * Не названий — усе як було.
 *
 * ── Що при цьому перевіряється ──────────────────────────────────────────
 *
 * Ідентифікатор приходить з КЛІЄНТА, тож він не доказ. Два питання, і обидва
 * мусять мати відповідь тут, а не в політиці бази: чи цей гість НАШОГО
 * готелю (на SQLite політик немає взагалі — AGENTS §7), і чи він ЖИВИЙ.
 *
 * Злитий рядок — не людина, а слід від неї (INC-300). `findOrCreateGuest`
 * у такому разі мовчки переходить на живого, і для вгадування це правильно.
 * Тут — ні: портьє обрав рядок зі списку, а список злитих не показує, тож
 * названий злитий id означає застарілий екран. Мовчки підмінити його —
 * знову «показали одного, записали іншого». Відмовляємо і кажемо чому.
 */
import { getSql } from '@core/db/async';
import { refuse } from '@core/http/refusal';
import { findOrCreateGuest, type GuestDedupArgs, type GuestDedupResult } from './guest-dedup.repo';

export interface BookingGuestArgs extends GuestDedupArgs {
  /**
   * Гість, якого НАЗВАЛА людина, обравши зі списку. `undefined`/`null` —
   * не називали, і тоді все як було: вгадування за ланцюжком.
   */
  guestId?: string | null;
}

/** Той самий результат, що в дедупу, плюс рід `chosen` — обрали руками. */
export type BookingGuestResult =
  | GuestDedupResult
  | { id: string; isNew: false; matchedBy: 'chosen' };

export async function resolveBookingGuest(args: BookingGuestArgs): Promise<BookingGuestResult> {
  const chosen = typeof args.guestId === 'string' ? args.guestId.trim() : '';
  if (!chosen) return await findOrCreateGuest(args);

  const sql = getSql();
  // Орендар у WHERE, а не покладання на політику: на SQLite її немає, і
  // чужий ідентифікатор знайшовся б (той самий довід, що в `guest-search`).
  const row = await sql.row<{ id: string; merged_into: string | null }>(
    'SELECT id, merged_into FROM guests WHERE id = ? AND organization_id = ?',
    [chosen, args.organizationId]);

  // Чужий або неіснуючий — 404, не 403: інакше відповідь каже, що такий
  // рядок є в когось іншого (інваріант 5).
  if (!row) refuse('Guest not found', 404);
  if (row.merged_into) {
    refuse('Цього гостя злито з іншим — оновіть сторінку і оберіть його ще раз', 409);
  }
  return { id: row.id, isNew: false, matchedBy: 'chosen' };
}
