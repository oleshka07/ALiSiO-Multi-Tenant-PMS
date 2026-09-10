/**
 * Заселення, виселення і призначення номера — одні двері на всіх писачів.
 *
 * ── Навіщо фасад, якщо PATCH це вже вміє ────────────────────────────────
 *
 * Бо вміє ЛИШЕ він. До кіоска в системі був один писач заселення —
 * `PATCH /api/bookings/[id]` — і правило жило в його тілі: перелік
 * оплачених статусів, порівняння `registration_status`, читання
 * `cleaning_status`. Термінал у холі — другий писач, і скопійоване в нього
 * правило розійшлося б із оригіналом при першій же правці одного з двох.
 *
 * Тому правило переїхало в `domain/checkin-policy.ts` (чисте рішення), а
 * тут — його єдиний спосіб дізнатися факти. PATCH більше НЕ носить копії:
 * він кличе `decideCheckIn` і показує рецепції той самий текст, що й раніше.
 *
 * ── Чому PATCH кличе `decideCheckIn`, а не `checkIn` ────────────────────
 *
 * Свідомо, і це не половина роботи. PATCH міняє за один запит більше, ніж
 * статус: номер, дати, платника, знижку — і все це має лягти ОДНИМ
 * `UPDATE` в одній транзакції (`writeReservationChange`, інваріант 11).
 * Якби він кликав `checkIn()`, вийшло б два записи на один запит: спершу
 * фасад пише `status = 'checked_in'`, потім хендлер пише решту — і між ними
 * вікно, у якому бронь заселена, але ще не переселена. Тож ділиться саме
 * рішення: варта одна на двох, а запис у кожного свій — там, де він у нього
 * вже цілий.
 *
 * Кіоск міняє рівно одне (він і не вміє більше), тому кличе `checkIn()`
 * цілком і дістає запис у тій самій транзакції, що й решта.
 *
 * ── Що фасад НЕ робить ──────────────────────────────────────────────────
 *
 * Не пише подій кіоска (`kiosk_events` — таблиця застосунку, і модуль про
 * неї не знає), не шле листів, не рахує фоліо. Він відповідає на одне
 * питання — «чи можна, і що при цьому змінилось у базі».
 *
 * Сцена — `checkin.repo.check.ts` (осі: політика × писач × стан номера).
 */
import { getSql, type Sql } from '@core/db/async';
import { generateGuestToken } from '@core/db';
import { freeUnitsForRange } from '@properties/kernel';
import { writeReservationChange } from './reservation-write.repo';
import { decideCheckout } from './checkout.repo';
import type { CheckoutDecision } from '../domain/checkout-balance';
import {
  checkinDecision, readCheckinPolicy,
  type CheckinActorKind, type CheckinDecision, type CheckinRefusal,
} from '../domain/checkin-policy';

/**
 * Хто діє — і В ЯКОМУ БУДИНКУ.
 *
 * `propertyId` обовʼязковий, і це не формальність. Термінал стоїть у холі
 * ОДНОГО корпусу (§3.4: «бронь іншого обʼєкта того ж рахунку → 404»), а
 * перевірка орендаря цієї осі не бачить взагалі: обидва корпуси належать
 * одному рахунку, тож `organization_id` збігається — і термінал корпусу 1
 * заселив би гостя корпусу 2, отримавши код від кімнати, у якій він не живе.
 * Це INC-029 дослівно.
 *
 * Рецепція називає той самий будинок, що й бронь, — його щойно віддала
 * `ownedReservation`. Для неї це не обмеження, а декларація: «я дію в цьому
 * будинку». Для термінала — справжня межа.
 *
 * `deviceId` тут не читається: він потрібен викликачеві, щоб записати свою
 * подію в журнал застосунку, про який модуль не знає.
 */
export interface FacadeActor {
  kind: CheckinActorKind;
  organizationId: string;
  /** Будинок, у якому діє актор. Бронь іншого — «немає» (інваріант 5). */
  propertyId: string;
  /** Автор рядка журналу прибирання при виселенні; у пристрою людини немає. */
  userId?: string | null;
}

/** Бронь, як її бачить варта заселення. Порожньо — броні цієї організації немає. */
interface CheckinRow {
  id: string;
  property_id: string;
  unit_id: string | null;
  unit_type_id: string | null;
  check_in: string;
  check_out: string;
  status: string;
  payment_status: string | null;
  registration_status: string | null;
  currency: string | null;
  total_price: number | null;
  guest_page_token: string | null;
  checkin_payment_policy: string | null;
  cleaning_status: string | null;
}

/**
 * Бронь + політика її обʼєкта + стан призначеного номера, одним запитом.
 *
 * `organization_id` у WHERE, хоч на Postgres те саме зробила б політика:
 * SQLite політик не має, а вона стоїть на кожній машині розробника і в
 * завданні `live` (AGENTS §7). Обидва двигуни мусять відмовляти однаково.
 */
async function readForCheckin(sql: Sql, actor: FacadeActor, reservationId: string): Promise<CheckinRow | undefined> {
  return await sql.row<CheckinRow>(`
    SELECT r.id, r.property_id, r.unit_id, r.unit_type_id, r.check_in, r.check_out,
           r.status, r.payment_status, r.registration_status, r.currency, r.total_price,
           r.guest_page_token,
           p.checkin_payment_policy,
           u.cleaning_status
      FROM reservations r
      JOIN properties p ON p.id = r.property_id
      LEFT JOIN units u ON u.id = r.unit_id AND u.property_id = r.property_id
     WHERE r.id = ? AND r.organization_id = ? AND p.organization_id = ?
       AND r.property_id = ?
  `, [reservationId, actor.organizationId, actor.organizationId, actor.propertyId]);
}

export type CheckinAnswer =
  | { ok: true; warning: 'unit_dirty' | null; unitId: string | null }
  | { ok: false; refusal: CheckinRefusal | 'not_found' };

/**
 * Варта заселення — і нічого, крім неї. Читає факти, віддає рішення домену.
 *
 * Броні немає (чужа організація, неіснуючий id, обʼєкт без рядка) —
 * `not_found`, а не «політики немає, отже можна» (інваріант 13). Чужий id →
 * 404, не 403 (інваріант 5): звідси одне слово на обидва випадки.
 */
export async function decideCheckIn(sql: Sql, input: {
  reservationId: string;
  actor: FacadeActor;
  /** Статус оплати, який стане чинним разом із заселенням (тіло PATCH). */
  paymentStatus?: string | null;
  /** Номер, у який заселяють, якщо він приходить тим самим запитом. */
  unitId?: string | null;
}): Promise<{ decision: CheckinDecision; row: CheckinRow } | 'not_found'> {
  const row = await readForCheckin(sql, input.actor, input.reservationId);
  if (!row) return 'not_found';

  // Номер із тіла запиту переважає той, що в рядку: PATCH уміє переселити й
  // заселити одним викликом, і питати стан СТАРОЇ кімнати в такому запиті
  // означало б перевірити не ту кімнату. Власність цього номера доводить
  // викликач (`ownedUnit`) — тут лише його стан.
  let cleaning = row.cleaning_status ?? null;
  if (input.unitId !== undefined && input.unitId !== null && input.unitId !== row.unit_id) {
    const u = await sql.row<{ cleaning_status: string }>(
      `SELECT u.cleaning_status FROM units u JOIN properties p ON p.id = u.property_id
        WHERE u.id = ? AND p.organization_id = ? AND u.property_id = ?`,
      [String(input.unitId), input.actor.organizationId, input.actor.propertyId]);
    // Номер не цього будинку — стану немає, тобто «номера немає»: терміналу
    // це відмова (`no_unit`), рецепції — заселення без попередження, як і
    // було до фасаду, коли номер не знаходився зовсім.
    cleaning = u?.cleaning_status ?? null;
  }

  const decision = checkinDecision({
    policy: readCheckinPolicy(row.checkin_payment_policy),
    paymentStatus: input.paymentStatus ?? row.payment_status,
    registrationStatus: row.registration_status,
    cleaningStatus: cleaning,
    actor: input.actor.kind,
  });
  return { decision, row };
}

/**
 * Заселити. Варта — та сама; запис — статус, час і токен гостьової сторінки,
 * якщо його ще немає (та сама гілка, що в PATCH: заселена бронь мусить мати
 * сторінку, на яку кіоск покаже QR).
 *
 * Ідемпотентно: бронь уже `checked_in` віддає `ok` без другого запису. Гість
 * тицьнув «Заселитися» двічі — це один заїзд, а не два (§3.4).
 */
export async function checkIn(reservationId: string, opts: { actor: FacadeActor }): Promise<CheckinAnswer> {
  const sql = getSql();
  const seen = await decideCheckIn(sql, { reservationId, actor: opts.actor });
  if (seen === 'not_found') return { ok: false, refusal: 'not_found' };
  const { decision, row } = seen;

  if (row.status === 'checked_in') {
    return { ok: true, warning: null, unitId: row.unit_id };
  }
  if (!decision.allowed) return { ok: false, refusal: decision.refusal };

  const sets = ['status = ?', 'updated_at = CURRENT_TIMESTAMP'];
  const values: unknown[] = ['checked_in'];
  if (!row.guest_page_token) {
    sets.splice(1, 0, 'guest_page_token = ?');
    values.push(generateGuestToken());
  }
  // Орендар у самому UPDATE, хоч власність уже доведена читанням вище.
  // Це INC-010 дослівно: доказ і запис розділені рештою функції, а на SQLite
  // політики немає взагалі — тож умова стоїть там, де виконується запис.
  values.push(reservationId, opts.actor.organizationId);

  await writeReservationChange(sql, {
    organizationId: opts.actor.organizationId,
    reservationId,
    statement: `UPDATE reservations SET ${sets.join(', ')} WHERE id = ? AND organization_id = ?`,
    values,
    // Статус рухає ночі в каналі так само, як номер і дати: скасована й
    // заселена бронь — різні відповіді на «чи вільна ця кімната».
    movesStay: true,
    cascade: { status: 'checked_in' },
    checkout: null,
  });

  return { ok: true, warning: decision.warning, unitId: row.unit_id };
}

export type CheckoutAnswer =
  | { ok: true; warning: CheckoutDecision['warning']; balance: number; currency: string | null }
  | { ok: false; refusal: 'not_found' | 'balance_blocking'; balance?: number; currency?: string | null };

/**
 * Виселити. Рішення — `decideCheckout` як є (політика обʼєкта проти боргу,
 * 0091): другого правила виселення не заводиться, бо перше вже є і воно
 * правильне. Номер бруднить `writeReservationChange`, тією ж транзакцією і
 * тим самим `setCleaningStatus`, що й PATCH.
 *
 * Ідемпотентно з тієї ж причини, що заселення.
 */
export async function checkOut(reservationId: string, opts: { actor: FacadeActor }): Promise<CheckoutAnswer> {
  const sql = getSql();
  const row = await readForCheckin(sql, opts.actor, reservationId);
  if (!row) return { ok: false, refusal: 'not_found' };
  if (row.status === 'checked_out') {
    return { ok: true, warning: null, balance: 0, currency: row.currency };
  }

  const decision = await decideCheckout(sql, {
    organizationId: opts.actor.organizationId,
    propertyId: row.property_id,
    reservationId,
    paymentStatus: row.payment_status,
    totalPrice: Number(row.total_price) || 0,
  });
  if (decision === 'not_found') return { ok: false, refusal: 'not_found' };
  if (!decision.allowed) {
    return { ok: false, refusal: 'balance_blocking', balance: decision.balance, currency: row.currency };
  }

  await writeReservationChange(sql, {
    organizationId: opts.actor.organizationId,
    reservationId,
    statement: 'UPDATE reservations SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?',
    values: ['checked_out', reservationId, opts.actor.organizationId],
    movesStay: true,
    cascade: { status: 'checked_out' },
    checkout: { changedBy: opts.actor.userId ?? null },
  });

  return { ok: true, warning: decision.warning, balance: decision.balance, currency: row.currency };
}

export type AssignAnswer =
  | { ok: true; unitId: string; alreadyAssigned: boolean }
  | { ok: false; refusal: 'not_found' | 'no_unit_type' | 'no_free_unit' | 'no_clean_unit' };

/**
 * Призначити номер: вільний на ВЕСЬ заїзд, потрібного типу, чистий.
 *
 * Вільні беруться з `freeUnitsForRange` (`properties/data/availability.ts`) —
 * тобто з ТОГО САМОГО джерела, що відповідає віджету й каналу. Свій запит
 * «де немає броні на ці дати» був би другим розрахунком наявності, а це вже
 * коштувало проєкту подвійного продажу (інваріант И3).
 *
 * Дві різні відмови на «нема чого дати»: `no_free_unit` — кімнат цього типу
 * на ці дати немає взагалі; `no_clean_unit` — вільні є, але всі брудні. Для
 * гостя це один екран «зверніться на рецепцію», а для рецепції — дві різні
 * дії: продати інший тип чи послати покоївку. Одне слово на обидва випадки
 * стерло б цю різницю саме там, де вона потрібна.
 *
 * `prefer: 'clean'` — єдиний режим, який сьогодні є, і він названий
 * аргументом навмисно: наступний («будь-який, рецепція розбереться») додасть
 * значення, а не другу функцію поруч.
 */
export async function assignUnit(reservationId: string, opts: {
  actor: FacadeActor;
  prefer: 'clean';
}): Promise<AssignAnswer> {
  const sql = getSql();
  const row = await readForCheckin(sql, opts.actor, reservationId);
  if (!row) return { ok: false, refusal: 'not_found' };
  if (row.unit_id) return { ok: true, unitId: row.unit_id, alreadyAssigned: true };
  if (!row.unit_type_id) return { ok: false, refusal: 'no_unit_type' };

  // Кандидати — свого обʼєкта, свого типу, живі й не службові. Службовий
  // фонд (`is_pool`) тримає багато броней навмисно і кімнатою не є.
  const candidates = (await sql.rows<{ id: string; cleaning_status: string | null }>(`
    SELECT u.id, u.cleaning_status
      FROM units u
      JOIN properties p ON p.id = u.property_id
     WHERE u.property_id = ? AND u.unit_type_id = ?
       AND p.organization_id = ?
       AND u.is_active = TRUE
       AND (u.is_pool IS NULL OR u.is_pool = FALSE)
     ORDER BY u.sort_order, u.id
  `, [row.property_id, row.unit_type_id, opts.actor.organizationId])) as { id: string; cleaning_status: string | null }[];
  if (candidates.length === 0) return { ok: false, refusal: 'no_free_unit' };

  // Сама бронь виключається з тиску: вона ще без номера, тобто входить у
  // власну ємнісну зайнятість і з'їдає одну кімнату свого ж типу (клас
  // INC-045). Без цього готель на дві кімнати не призначив би останню
  // вільну ніколи.
  const free = await freeUnitsForRange(candidates.map((c) => c.id), row.check_in, row.check_out, reservationId);
  const freeRows = candidates.filter((c) => free.has(c.id));
  if (freeRows.length === 0) return { ok: false, refusal: 'no_free_unit' };

  const clean = freeRows.find((c) => c.cleaning_status === 'clean');
  if (!clean) return { ok: false, refusal: 'no_clean_unit' };

  await writeReservationChange(sql, {
    organizationId: opts.actor.organizationId,
    reservationId,
    statement: 'UPDATE reservations SET unit_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?',
    values: [clean.id, reservationId, opts.actor.organizationId],
    movesStay: true,
    cascade: {},
    checkout: null,
  });

  return { ok: true, unitId: clean.id, alreadyAssigned: false };
}
