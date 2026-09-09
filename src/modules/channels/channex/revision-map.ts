/**
 * Ревізія Channex → ревізія домену.
 *
 * Єдине місце, де живуть імена вендора: `system_id`, `booking_id`,
 * `room_type_id`, `ota_reservation_code`. Вище за течією — тільки
 * `../port.ts` і доменні слова (інваріант И1).
 *
 * ── Чотири речі, які тут легко зробити неправильно ──────────────────────
 *
 * 1. **Дедуплікує `system_id`, а ПІДТВЕРДЖУЄ `id`.** Обидва змінюються з
 *    кожною ревізією, тож обидва «працюють» — доки не доходить до справи.
 *    Вендор прямо каже, що `system_id` «used to detect have we that message
 *    or not»: це його контракт, і саме на ньому стоїть CP4. Але шлях
 *    підтвердження — `POST /booking_revisions/:id/ack`, тобто `id`. У
 *    прикладі стрічки видно, що це навіть не однакові за формою рядки:
 *    `id` — UUID `03dd7198-…`, `system_id` — `"12331233123"`.
 *
 *    Тому мапер віддає обидва: `remoteRevisionId` і `ackToken`. Переплутати
 *    їх означає 404 на кожне підтвердження — ревізія не зникає зі стрічки
 *    ніколи, а готель кожні 30 хвилин отримує лист `non_acked_booking`.
 *
 * 2. **`room_type_id: null` означає «не змаплено», а не «немає типу».**
 *    Така бронь усе одно приймається: гість уже заплатив, вона фізично
 *    існує, і відкинути її — значить створити овербукінг власноруч. Вона
 *    лягає з `unmapped`, щоб оператор побачив і домапив.
 *
 * 3. **`days` — це рядки.** `{"2019-05-09": "100.00"}` виміряно на живому
 *    API. Складати рядки як числа тут не треба взагалі: суму дає `amount`,
 *    а розбивка по днях лишається в payload.
 *
 * 4. **Кімнат може бути кілька.** Одна бронь Channex із двома `rooms[]` —
 *    це дві наші броні, бо `reservations` це рядок на кімнату. Мапер віддає
 *    масив як є і НЕ вибирає з нього першу: мовчки загублена друга кімната
 *    — це гість, який приїде в готель, що про нього не знає.
 *
 *    `ota_unique_id` кімнати — єдине, чим вона впізнається в наступній
 *    редакції, і дає його не кожен OTA («right now only Booking.com
 *    supported»). Мапер віддає його як є; що робити, коли його немає, вирішує
 *    домен (`groupRoomKeys`), і це правильне місце: правило стосується
 *    редакції цілком, а не одного поля.
 *
 * 5. **Заселеність бронювання і заселеність кімнати — різні числа.** У
 *    бронювання на дві кімнати `occupancy` зверху каже, скільки людей
 *    приїде всього, а `rooms[].occupancy` — скільки в кожній. Складати перше
 *    з другого не можна: три дорослі в двох кімнатах це `2 + 1` усередині і
 *    `3` зверху, і батьківська бронь групи описує саме бронювання.
 *
 * Результат — доменні типи з `../domain/feed.ts`, а не власні. Напрямок
 * залежності саме такий: адаптер знає домен, домен про адаптер не чув
 * (інваріант И1).
 */
import type { FeedEntry, FeedRevision, FeedRoom } from '../domain/feed.ts';

/** Ревізія в тому вигляді, як її віддає стрічка. Поля — за виміряним §5.1. */
export interface ChannexRevision {
  id?: string;
  system_id?: string;
  booking_id?: string;
  property_id?: string;
  ota_reservation_code?: string;
  ota_name?: string;
  status?: string;
  arrival_date?: string;
  departure_date?: string;
  amount?: string | number;
  currency?: string;
  occupancy?: { adults?: number; children?: number; infants?: number };
  customer?: { name?: string; surname?: string; mail?: string; email?: string };
  rooms?: ChannexRoom[];
  [key: string]: unknown;
}

export interface ChannexRoom {
  checkin_date?: string;
  checkout_date?: string;
  /** `null`, якщо номер не змаплено. */
  room_type_id?: string | null;
  rate_plan_id?: string | null;
  occupancy?: { adults?: number; children?: number; infants?: number };
  amount?: string | number;
  [key: string]: unknown;
}

/**
 * Що віддає мапер — доменні типи, під доменними іменами.
 *
 * Аліаси лишились, бо цей файл і його перевірка ними розмовляють; самі типи
 * живуть у `../domain/feed.ts` і належать домену, не вендору.
 */
export type MappedRoom = FeedRoom;
export type MappedRevision = FeedRevision;
export type MapFailure = { ok: false; reason: string };
export type MapResult = FeedEntry;

/** Гроші приходять рядком («100.00») або числом — обидва бачені на живому API. */
function money(v: unknown): number {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : 0;
}

function count(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

/**
 * Перекласти ревізію.
 *
 * `roomTypeByRemote` — дзеркало мапінгу: чужий `room_type_id` → наш
 * `unit_type_id`. Порожня мапа — нормальний стан щойно підключеного обʼєкта,
 * і тоді все приходить `unmapped`.
 *
 * Відмова, а не виняток: ревізія без ідентифікатора — це зіпсоване
 * повідомлення, і про нього треба сказати оператору, а не впасти посеред
 * циклу й лишити решту стрічки необробленою.
 */
export function mapRevision(
  raw: ChannexRevision,
  roomTypeByRemote: ReadonlyMap<string, string>,
): MapResult {
  const remoteRevisionId = raw.system_id;
  if (!remoteRevisionId) return { ok: false, reason: 'missing_system_id' };
  // `id` — те, чим ревізія ПІДТВЕРДЖУЄТЬСЯ: шлях `/booking_revisions/:id/ack`
  // складається саме з нього, а не з `system_id`. Ревізія без `id` не має
  // чим підтверджуватись, і прийняти її означало б вічний цикл: застосуємо,
  // підтвердити не зможемо, отримаємо знову.
  if (!raw.id) return { ok: false, reason: 'missing_id' };
  if (!raw.booking_id) return { ok: false, reason: 'missing_booking_id' };

  const status = raw.status;
  if (status !== 'new' && status !== 'modified' && status !== 'cancelled') {
    return { ok: false, reason: `unknown_status:${status ?? 'none'}` };
  }

  const rooms: MappedRoom[] = (raw.rooms ?? []).map((r) => ({
    unitTypeId: r.room_type_id ? (roomTypeByRemote.get(r.room_type_id) ?? null) : null,
    checkIn: r.checkin_date ?? raw.arrival_date,
    checkOut: r.checkout_date ?? raw.departure_date,
    adults: count(r.occupancy?.adults ?? raw.occupancy?.adults) || 1,
    children: count(r.occupancy?.children ?? raw.occupancy?.children),
    amount: money(r.amount),
    otaUniqueId: typeof r.ota_unique_id === 'string' && r.ota_unique_id.trim() !== ''
      ? r.ota_unique_id.trim() : undefined,
  }));

  return {
    ok: true,
    revision: {
      remoteRevisionId,
      ackToken: raw.id,
      remoteBookingId: raw.booking_id,
      status,
      otaReservationCode: raw.ota_reservation_code,
      otaName: raw.ota_name,
      currency: raw.currency,
      totalAmount: money(raw.amount),
      unmapped: rooms.some((r) => r.unitTypeId === null),
      rooms,
      // Заселеність БРОНЮВАННЯ — не сума кімнат (див. п. 5 у шапці). Порожньо,
      // якщо вендор її не назвав: вигадати суму кімнат тут означало б, що
      // батьківська бронь групи впевнено показує число, якого ніхто не казав.
      adults: raw.occupancy?.adults !== undefined ? count(raw.occupancy.adults) : undefined,
      children: raw.occupancy?.children !== undefined ? count(raw.occupancy.children) : undefined,
      guestFirstName: raw.customer?.name,
      guestLastName: raw.customer?.surname,
      guestEmail: raw.customer?.mail ?? raw.customer?.email,
      raw,
    },
  };
}
