/**
 * Ревізія Channex → ревізія домену.
 *
 * Єдине місце, де живуть імена вендора: `system_id`, `booking_id`,
 * `room_type_id`, `ota_reservation_code`. Вище за течією — тільки
 * `../port.ts` і доменні слова (інваріант И1).
 *
 * ── Чотири речі, які тут легко зробити неправильно ──────────────────────
 *
 * 1. **Дедуплікує `system_id`, а не `id`.** Обидва змінюються з кожною
 *    ревізією, тож обидва «працюють» — але вендор прямо каже, що
 *    `system_id` «used to detect have we that message or not». Це його
 *    контракт, і саме на ньому стоїть CP4. `id` лишається в сирому
 *    payload, якщо колись знадобиться.
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
 */

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

/** Одна кімната броні, приведена до наших слів. */
export interface MappedRoom {
  /** НАШ id типу номера, або null, якщо тип не змаплено. */
  unitTypeId: string | null;
  checkIn?: string;
  checkOut?: string;
  adults: number;
  children: number;
  amount: number;
}

/** Ревізія домену: те, що з неї треба `applyRevision()`. */
export interface MappedRevision {
  remoteRevisionId: string;
  remoteBookingId: string;
  status: 'new' | 'modified' | 'cancelled';
  otaReservationCode?: string;
  otaName?: string;
  currency?: string;
  totalAmount: number;
  /** Хоча б одна кімната без змапленого типу. */
  unmapped: boolean;
  rooms: MappedRoom[];
  guestFirstName?: string;
  guestLastName?: string;
  guestEmail?: string;
  raw: unknown;
}

export type MapFailure = { ok: false; reason: string };
export type MapResult = { ok: true; revision: MappedRevision } | MapFailure;

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
  }));

  return {
    ok: true,
    revision: {
      remoteRevisionId,
      remoteBookingId: raw.booking_id,
      status,
      otaReservationCode: raw.ota_reservation_code,
      otaName: raw.ota_name,
      currency: raw.currency,
      totalAmount: money(raw.amount),
      unmapped: rooms.some((r) => r.unitTypeId === null),
      rooms,
      guestFirstName: raw.customer?.name,
      guestLastName: raw.customer?.surname,
      guestEmail: raw.customer?.mail ?? raw.customer?.email,
      raw,
    },
  };
}
