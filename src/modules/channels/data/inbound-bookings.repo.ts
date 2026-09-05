import type { Sql } from '@core/db/async';
import { connectionInTenant } from './connections.repo';
import { noteAvailabilityChanged, lastNight } from './outbox-notes';
import { recordBookingChange, bookingSnapshot, describeChanges, changesToText } from '@bookings/history';

/**
 * Ревізія бронювання з менеджера каналів стає бронню — рівно один раз.
 *
 * ── Чому це не «створити бронь» ─────────────────────────────────────────
 *
 * Менеджер каналів віддає СТРІЧКУ РЕВІЗІЙ, а не список броней:
 * `remote_booking_id` стабільний між ревізіями, `remote_revision_id` — ні.
 * Одна бронь дає ревізію на створення, ще одну на кожну зміну і ще одну на
 * скасування.
 *
 * До того ж вебхуки приходять **не в тому порядку, у якому сталися події** —
 * це сказано в документації Channex дослівно, — а підтвердження (`ack`) ми
 * шлемо ПІСЛЯ коміту. Отже та сама ревізія цілком нормально приїде вдруге:
 * процес упав між комітом і ack, мережа повторила запит, оператор натиснув
 * «синхронізувати». Кожен із цих випадків — буденність, не аварія.
 *
 * Тому тут **звірка, а не вставка**. `INSERT` на кожну ревізію дав би дві
 * броні на одного гостя, і побачив би це готель — за одним столом сніданку
 * на два номери.
 *
 * ── Що саме захищає від дубля ───────────────────────────────────────────
 *
 * `UNIQUE(connection_id, remote_revision_id)` у журналі. Не перевірка «а чи
 * є вже такий рядок» перед вставкою: між перевіркою і вставкою вміщається
 * другий процес, і саме там дубль і зʼявляється. Обмеження бази цього вікна
 * не має.
 *
 * ── Порядок, який не можна переставляти (інваріант И5) ──────────────────
 *
 * Записати ревізію → звести з бронню → **коміт** → і лише тоді `ack`.
 * Підтвердили раніше, процес упав — бронювання втрачено назавжди: стрічка
 * віддає лише непідтверджені, більше його ніхто не покаже. Тому `ack` тут
 * НЕ викликається взагалі: ця функція повертає, що саме треба підтвердити, а
 * шле підтвердження той, хто керує транзакцією.
 */

/**
 * Одна кімната ревізії — майбутня ДОЧІРНЯ бронь групи (К1).
 *
 * `key` приходить із домену (`groupRoomKeys`) і є єдиним, за чим кімната
 * впізнається в наступній редакції. Він же лягає в `external_uid` дочірньої
 * броні — там, де в одиничної броні лежить код броні OTA.
 */
export interface RevisionRoom {
  key: string;
  unitTypeId?: string | null;
  checkIn?: string;
  checkOut?: string;
  adults?: number;
  children?: number;
  amount?: number;
}

/** Ревізія, приведена до нашого вигляду. Переклад із чужого — справа адаптера. */
export interface Revision {
  remoteRevisionId: string;
  /** Стабільний між ревізіями. За ним шукаємо СВОЮ бронь. */
  remoteBookingId: string;
  status: 'new' | 'modified' | 'cancelled';
  otaReservationCode?: string;
  otaName?: string;
  /** Тип номера й тариф не змаплено — бронь усе одно приймається. */
  unmapped?: boolean;
  /** Сира ревізія, як прийшла. Доказ у суперечці. */
  raw: unknown;

  /** Дані самої броні. Відсутні у скасуванні. */
  checkIn?: string;
  checkOut?: string;
  unitTypeId?: string | null;
  adults?: number;
  children?: number;
  totalPrice?: number;
  currency?: string;
  guestFirstName?: string;
  guestLastName?: string;
  guestEmail?: string;

  /**
   * Кімнати бронювання. Більше однієї — ГРУПА: батьківська бронь + дочірні.
   *
   * Порожньо або одна — усе як було: одна бронь, поля вище описують її саму.
   * Групу описують поля вище (бронювання цілком) ПЛЮС цей список (кімнати).
   */
  rooms?: RevisionRoom[];
}

export type ApplyOutcome =
  /** Ревізію бачимо вперше: журнал і бронь оновлені. */
  | { result: 'applied'; reservationId: string | null; created: boolean }
  /** Ця сама ревізія вже застосована. Нічого не робимо — але ack повторюємо. */
  | { result: 'duplicate'; reservationId: string | null }
  /** Ревізія не придатна до застосування; сказано, чому. */
  | { result: 'refused'; reason: string };

/**
 * Застосувати одну ревізію.
 *
 * Викликається ВСЕРЕДИНІ транзакції того, хто читає стрічку. Ack — після
 * коміту і не тут.
 */
export async function applyRevision(
  t: Sql,
  connectionId: string,
  rev: Revision,
): Promise<ApplyOutcome> {
  // Усе — ручкою транзакції викликача: журнал, бронь, гість і координата
  // для каналів лягають або разом, або ніяк (інваріант 11).
  const sql = t;

  // Зʼєднання шукається В МЕЖАХ ОРЕНДАРЯ, а не за самим лише id: id приходить
  // іззовні — з URL вебхука, з рядка черги, з аргументу крона. Запит
  // `WHERE id = ?` на Postgres рятує політика, а на SQLite не рятує НІЩО, і
  // SQLite стоїть у кожного розробника, під `npm run dev` і в CI. Тобто
  // «локально працює» тут доводило б рівно протилежне тому, що здається.
  // Ціна пропуску: бронь чужого готелю — з іменем гостя, сумою і датами —
  // лягає в НАШУ організацію. Клас INC-010.
  const conn = await connectionInTenant(connectionId);
  if (!conn) return { result: 'refused', reason: 'connection_not_found' };

  // ── Крок 1: журнал ПЕРШИМ. Це і є ворота ────────────────────────────────
  //
  // Порядок тут не стильовий. Перша версія цієї функції писала спершу бронь,
  // потім журнал — і на повторній доставці падала на UNIQUE вже ПІСЛЯ того,
  // як створила другу бронь. Тобто захист спрацьовував, а дубль лишався.
  //
  // `ON CONFLICT DO NOTHING`, а не «спершу перевіримо, чи є такий рядок»:
  // між перевіркою і вставкою вміщається другий процес, і саме там дубль і
  // народжується. Обмеження бази цього вікна не має.
  const journalId = crypto.randomUUID();
  const inserted = await sql.run(
    `INSERT INTO cm_inbound_bookings
       (id, organization_id, connection_id, remote_revision_id, remote_booking_id,
        ota_reservation_code, ota_name, status, payload, is_unmapped)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (connection_id, remote_revision_id) DO NOTHING`,
    [journalId, conn.organizationId, connectionId,
      rev.remoteRevisionId, rev.remoteBookingId,
      rev.otaReservationCode ?? null, rev.otaName ?? null, rev.status,
      JSON.stringify(rev.raw), rev.unmapped ? 1 : 0],
  );

  if (inserted.changes === 0) {
    // Цю ревізію вже застосовано. Не помилка й не аварія: ack шлеться після
    // коміту, тож процес, який упав між ними, побачить її ще раз — так само
    // як повтор мережі й кнопка «синхронізувати».
    const seen = await sql.row<any>(
      `SELECT reservation_id FROM cm_inbound_bookings
        WHERE connection_id = ? AND remote_revision_id = ?`,
      [connectionId, rev.remoteRevisionId],
    ) as any;
    return { result: 'duplicate', reservationId: seen?.reservation_id ?? null };
  }

  // ── Крок 2: знайти СВОЮ бронь цього бронювання ──────────────────────────
  //
  // За `remote_booking_id`, який стабільний між ревізіями, — через журнал, а
  // не через `reservations.external_uid`: те поле належить iCal-синку, і
  // ділити його між двома джерелами означало б колізію, якої ніхто не
  // побачить.
  const prior = await sql.row<any>(
    `SELECT reservation_id FROM cm_inbound_bookings
      WHERE connection_id = ? AND remote_booking_id = ? AND reservation_id IS NOT NULL
      ORDER BY received_at DESC`,
    [connectionId, rev.remoteBookingId],
  ) as any;

  let reservationId: string | null = prior?.reservation_id ?? null;
  let created = false;

  // Канали дізнаються про ночі, які ця ревізія звільняє чи займає: стан ДО
  // (скасування, зміна) і ПІСЛЯ (зміна, нова). Тип — із броні: канал адресує
  // тип, а не номер (CP3).
  const stayOf = async (id: string) => sql.row<any>(
    'SELECT property_id, unit_type_id, unit_id, check_in, check_out FROM reservations WHERE id = ?', [id]);
  const noteStay = async (stay: any) => {
    if (!stay?.check_in || !stay?.check_out) return;
    const types = new Set<string>();
    if (stay.unit_type_id) types.add(String(stay.unit_type_id));
    // Кімната, в якій бронь стоїть, може бути ІНШОГО типу, ніж тип броні
    // (канал змінив тип — Д9). Наявність рахує зайнятою кімнату, тож і її
    // тип має дізнатись, що вона звільнилась чи зайнялась.
    if (stay.unit_id) {
      const u = await sql.row<any>('SELECT unit_type_id FROM units WHERE id = ?', [stay.unit_id]);
      if (u?.unit_type_id) types.add(String(u.unit_type_id));
    }
    for (const unitTypeId of types) {
      await noteAvailabilityChanged(sql, {
        propertyId: String(stay.property_id ?? conn.propertyId), unitTypeId,
        from: String(stay.check_in).slice(0, 10), to: lastNight(String(stay.check_out).slice(0, 10)),
      });
    }
  };
  const before = reservationId ? await stayOf(reservationId) : null;
  // Знімок для історії броні — з назвами, як його прочитає картка.
  const snapshotBefore = reservationId ? await bookingSnapshot(sql, reservationId) : null;

  // ── Група: кілька кімнат — батьківська бронь і по дочірній на кімнату ────
  //
  // Один раз група — завжди група: кімнату, яку прибрали, ми СКАСОВУЄМО, а не
  // стираємо, тож бронювання, що колись мало дві кімнати, лишається групою і
  // з однією живою. Розгорнути його назад в одиничну бронь означало б
  // переписати історію: скасована кімната була, і в звіті за минулий місяць
  // має лишитись.
  const children = reservationId ? await childrenOf(sql, reservationId) : [];
  const isGroup = (rev.rooms?.length ?? 0) > 1 || children.length > 0;

  if (isGroup) {
    if (!reservationId) {
      reservationId = crypto.randomUUID();
      created = true;
    }
    await applyGroup(sql, conn, rev, reservationId, created, children, noteStay, stayOf);
  } else if (rev.status === 'cancelled') {
    // Скасування не стирає бронь: вона була, гість про неї знає, і в звітах
    // за минулий місяць вона має лишитись. Міняється лише статус.
    if (reservationId) {
      await sql.run(
        "UPDATE reservations SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [reservationId],
      );
    }
  } else if (reservationId) {
    // Зміна. Оновлюємо лише те, що ревізія справді принесла: порожнє поле в
    // ревізії означає «не міняли», а не «скинути».
    await sql.run(
      `UPDATE reservations
          SET check_in = COALESCE(?, check_in),
              check_out = COALESCE(?, check_out),
              adults = COALESCE(?, adults),
              children = COALESCE(?, children),
              total_price = COALESCE(?, total_price),
              unit_type_id = COALESCE(?, unit_type_id),
              status = 'confirmed',
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [rev.checkIn ?? null, rev.checkOut ?? null, rev.adults ?? null, rev.children ?? null,
        rev.totalPrice ?? null, rev.unitTypeId ?? null, reservationId],
    );
    // Канал змінив ТИП — кімната старого типу новий не вміщає: бронь
    // повертається у смугу «Без номера» нового типу, і рецепція ставить її
    // заново. Живе 03.09.2026 (Д9): бронь із Twin переведена на Double
    // лишилась у кімнаті Twin, наявність рахувала Twin, канал отримав Double.
    if (rev.unitTypeId && before?.unit_id && before.unit_type_id && String(before.unit_type_id) !== rev.unitTypeId) {
      await sql.run('UPDATE reservations SET unit_id = NULL WHERE id = ?', [reservationId]);
    }
    // Ночі — ЗБЕРЕЖЕНА колонка: картка, список і турзбір читають її, а не
    // рахують. Перераховується з того, що тепер у рядку, а не з ревізії:
    // ревізія могла принести лише одну з дат. Живе 03.09.2026 (Д8): зміна з
    // каналу 21→24.12 показувала «2 н.» на трьох ночах.
    const dates = await sql.row<any>('SELECT check_in, check_out FROM reservations WHERE id = ?', [reservationId]);
    if (dates) {
      await sql.run('UPDATE reservations SET nights = ? WHERE id = ?',
        [nightsBetween(isoDay(dates.check_in), isoDay(dates.check_out)), reservationId]);
    }
    // Гість цієї броні — окремий рядок на канальну бронь (див. guestFor), тож
    // перейменування в каналі оновлює САМЕ ЙОГО, а не шукає збігів. Порожнє
    // поле ревізії — «не міняли», як і вище. Те саме живе 03.09.2026: імʼя,
    // змінене в каналі, у картці лишалось старим.
    if (rev.guestFirstName !== undefined || rev.guestLastName !== undefined || rev.guestEmail !== undefined) {
      await sql.run(
        `UPDATE guests
            SET first_name = COALESCE(?, first_name),
                last_name = COALESCE(?, last_name),
                email = COALESCE(?, email),
                updated_at = CURRENT_TIMESTAMP
          WHERE id = (SELECT guest_id FROM reservations WHERE id = ?)`,
        [rev.guestFirstName ?? null, rev.guestLastName ?? null, rev.guestEmail ?? null, reservationId],
      );
    }
  } else {
    // Нова бронь. `unit_id` — NULL: канал про кімнати не знає, він адресує
    // ТИП номера (CP3). Рецепція призначить кімнату зі смуги «Без номера».
    reservationId = crypto.randomUUID();
    created = true;
    await sql.run(
      `INSERT INTO reservations (id, organization_id, property_id, unit_id, unit_type_id, guest_id,
                                 check_in, check_out, nights, adults, children,
                                 status, payment_status, source, total_price, currency, external_uid)
       VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 'confirmed', 'unpaid', ?, ?, ?, ?)`,
      [reservationId, conn.organizationId, conn.propertyId, rev.unitTypeId ?? null,
        await guestFor(sql, conn.organizationId, rev),
        rev.checkIn ?? '', rev.checkOut ?? '', nightsBetween(rev.checkIn, rev.checkOut),
        rev.adults ?? 1, rev.children ?? 0,
        sourceOf(rev.otaName), rev.totalPrice ?? 0, rev.currency ?? '',
        rev.otaReservationCode ?? null],
    );
  }

  await noteStay(before);
  if (reservationId && rev.status !== 'cancelled') await noteStay(await stayOf(reservationId));

  // Історія броні: ревізія з каналу — теж «хто». Автор — назва OTA, текст
  // називає код броні, що змінилось і ревізію, за якою це можна знайти в
  // панелі вендора. Без цього рецепція бачила нові дати і не знала, звідки.
  if (reservationId) {
    const snapshotAfter = await bookingSnapshot(sql, reservationId);
    const code = rev.otaReservationCode ?? rev.remoteBookingId;
    const who = `${rev.otaName ?? 'OTA'} · ${conn.provider}`;
    const revisionTag = `ревізія ${rev.remoteRevisionId.slice(0, 8)}`;
    let action: 'channel_created' | 'channel_modified' | 'channel_cancelled';
    let details: string;
    if (rev.status === 'cancelled') {
      action = 'channel_cancelled';
      details = `Канал скасував бронь ${code} (${revisionTag})`;
    } else if (created) {
      action = 'channel_created';
      const s = snapshotAfter ?? {};
      details = `Нова бронь із каналу ${code}: ${[
        s.unit_type_name, `${day(s.check_in)} → ${day(s.check_out)}`, s.nights != null ? `${s.nights} н.` : '',
        s.total_price != null ? `${s.total_price} ${s.currency ?? ''}`.trim() : '',
      ].filter(Boolean).join(' · ')} (${revisionTag})`;
    } else {
      action = 'channel_modified';
      const diff = changesToText(describeChanges(snapshotBefore ?? {}, snapshotAfter ?? {}));
      details = `Канал змінив бронь ${code}: ${diff || 'без видимих змін'} (${revisionTag})`;
    }
    await recordBookingChange(sql, {
      reservationId, action, details,
      actor: { id: null, name: who },
      before: snapshotBefore ?? undefined, after: snapshotAfter ?? undefined,
    });
  }

  await sql.run(
    `UPDATE cm_inbound_bookings
        SET reservation_id = ?, applied_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [reservationId, journalId],
  );

  return { result: 'applied', reservationId, created };
}

/**
 * Дочірні броні групи — у порядку ключа кімнати.
 *
 * Читається за `parent_id`, а не за `external_uid LIKE`: батьківська бронь уже
 * знайдена в межах орендаря (через журнал і `connectionInTenant`), тож
 * `parent_id` — це вже перевірена межа. `external_uid` дочірньої несе ключ
 * кімнати, і саме за ним вона впізнається в наступній редакції; читати за ним
 * НЕ можна — те поле ділиться з iCal-синком, і збіг там був би тихим.
 */
async function childrenOf(sql: Sql, parentId: string): Promise<any[]> {
  return await sql.rows<any>(
    `SELECT id, external_uid, unit_type_id, unit_id, check_in, check_out, status
       FROM reservations WHERE parent_id = ? ORDER BY external_uid`,
    [parentId],
  ) as any[];
}

/**
 * Група: батьківська бронь бронювання і по дочірній на кожну кімнату (К1).
 *
 * ── Чому батьківська НЕ має типу номера ─────────────────────────────────
 *
 * Бо наявність рахує кожен рядок без номера як зайнятий номер ТИПУ
 * (`unassignedByTypeDay` у `properties/data/availability.ts`), і батьківська з
 * типом відняла б третій номер за групу з двох кімнат. Тобто канал отримав би
 * на одиницю менше, ніж є, — мовчки, без жодної помилки.
 *
 * Батьківська описує БРОНЮВАННЯ: проміжок від найранішого заїзду до
 * найпізнішого виїзду, сума й гості — з ревізії (у бронювання на дві кімнати
 * своя заселеність поруч із заселеністю кожної кімнати, і вони різні).
 * Кімнати описують дочірні, кожна своїм типом і без номера (П9).
 *
 * ── Що робить зникла кімната ────────────────────────────────────────────
 *
 * Скасовується, а не стирається — так само, як скасована одинична бронь: вона
 * була, гість про неї знає, у звіті за минулий місяць має лишитись. Її ночі
 * при цьому звільняються й їдуть у канал: інакше номер стояв би зайнятим і
 * непроданим.
 *
 * Кімната, що повернулась під тим самим ключем, оживає — статус береться від
 * батьківської, як і решта групи.
 */
async function applyGroup(
  sql: Sql,
  conn: { organizationId: string; propertyId: string },
  rev: Revision,
  parentId: string,
  created: boolean,
  children: any[],
  noteStay: (stay: any) => Promise<void>,
  stayOf: (id: string) => Promise<any>,
): Promise<void> {
  const cancelled = rev.status === 'cancelled';
  const rooms = rev.rooms ?? [];

  // Проміжок групи — по кімнатах ЦІЄЇ редакції. Скасування кімнат не несе,
  // тож проміжок лишається таким, яким був: скасована бронь не змінює дат.
  const starts = rooms.map((r) => r.checkIn).filter(Boolean) as string[];
  const ends = rooms.map((r) => r.checkOut).filter(Boolean) as string[];
  const spanFrom = starts.length ? starts.slice().sort()[0] : rev.checkIn;
  const spanTo = ends.length ? ends.slice().sort().at(-1) : rev.checkOut;

  if (created) {
    await sql.run(
      `INSERT INTO reservations (id, organization_id, property_id, unit_id, unit_type_id, guest_id,
                                 check_in, check_out, nights, adults, children,
                                 status, payment_status, source, total_price, currency, external_uid)
       VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, 'unpaid', ?, ?, ?, ?)`,
      [parentId, conn.organizationId, conn.propertyId,
        await guestFor(sql, conn.organizationId, rev),
        spanFrom ?? '', spanTo ?? '', nightsBetween(spanFrom, spanTo),
        rev.adults ?? 1, rev.children ?? 0,
        cancelled ? 'cancelled' : 'confirmed',
        sourceOf(rev.otaName), rev.totalPrice ?? 0, rev.currency ?? '',
        rev.otaReservationCode ?? null],
    );
  } else {
    // Порожнє поле ревізії — «не міняли», а не «скинути»: те саме правило, що
    // й для одиничної броні.
    await sql.run(
      `UPDATE reservations
          SET check_in = COALESCE(?, check_in),
              check_out = COALESCE(?, check_out),
              adults = COALESCE(?, adults),
              children = COALESCE(?, children),
              total_price = COALESCE(?, total_price),
              status = ?,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [spanFrom ?? null, spanTo ?? null, rev.adults ?? null, rev.children ?? null,
        rev.totalPrice ?? null, cancelled ? 'cancelled' : 'confirmed', parentId],
    );
    const dates = await sql.row<any>('SELECT check_in, check_out FROM reservations WHERE id = ?', [parentId]);
    if (dates) {
      await sql.run('UPDATE reservations SET nights = ? WHERE id = ?',
        [nightsBetween(isoDay(dates.check_in), isoDay(dates.check_out)), parentId]);
    }
    if (rev.guestFirstName !== undefined || rev.guestLastName !== undefined || rev.guestEmail !== undefined) {
      await sql.run(
        `UPDATE guests
            SET first_name = COALESCE(?, first_name),
                last_name = COALESCE(?, last_name),
                email = COALESCE(?, email),
                updated_at = CURRENT_TIMESTAMP
          WHERE id = (SELECT guest_id FROM reservations WHERE id = ?)`,
        [rev.guestFirstName ?? null, rev.guestLastName ?? null, rev.guestEmail ?? null, parentId],
      );
    }
  }

  const parent = await sql.row<any>(
    'SELECT guest_id, status, payment_status, source, currency, property_id FROM reservations WHERE id = ?',
    [parentId]) as any;
  const byKey = new Map<string, any>(children.map((c) => [uidKey(c.external_uid), c]));
  const code = rev.otaReservationCode ?? rev.remoteBookingId;

  // Скасування бронювання не перелічує кімнат — воно гасить усю групу.
  const targets = cancelled ? [] : rooms;

  for (const room of targets) {
    const existing = byKey.get(room.key);
    const from = room.checkIn ?? spanFrom;
    const to = room.checkOut ?? spanTo;

    if (!existing) {
      const childId = crypto.randomUUID();
      await sql.run(
        `INSERT INTO reservations (id, organization_id, property_id, parent_id, unit_id, unit_type_id, guest_id,
                                   check_in, check_out, nights, adults, children,
                                   status, payment_status, source, total_price, currency, external_uid)
         VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [childId, conn.organizationId, conn.propertyId, parentId, room.unitTypeId ?? null,
          parent.guest_id, from ?? '', to ?? '', nightsBetween(from, to),
          room.adults ?? 1, room.children ?? 0,
          parent.status, parent.payment_status, parent.source,
          room.amount ?? 0, parent.currency ?? '', `${code}#${room.key}`],
      );
      await noteStay(await stayOf(childId));
      continue;
    }

    const wasStay = await stayOf(existing.id);
    await sql.run(
      `UPDATE reservations
          SET check_in = COALESCE(?, check_in),
              check_out = COALESCE(?, check_out),
              unit_type_id = COALESCE(?, unit_type_id),
              adults = COALESCE(?, adults),
              children = COALESCE(?, children),
              total_price = COALESCE(?, total_price),
              status = ?,
              payment_status = ?,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [from ?? null, to ?? null, room.unitTypeId ?? null, room.adults ?? null, room.children ?? null,
        room.amount ?? null, parent.status, parent.payment_status, existing.id],
    );
    // Канал змінив ТИП кімнати, яку рецепція вже поставила в номер: номер
    // старого типу новий не вміщає (Д9). Те саме правило, що й для одиничної.
    if (room.unitTypeId && wasStay?.unit_id && wasStay.unit_type_id
        && String(wasStay.unit_type_id) !== room.unitTypeId) {
      await sql.run('UPDATE reservations SET unit_id = NULL WHERE id = ?', [existing.id]);
    }
    const nights = await sql.row<any>('SELECT check_in, check_out FROM reservations WHERE id = ?', [existing.id]);
    if (nights) {
      await sql.run('UPDATE reservations SET nights = ? WHERE id = ?',
        [nightsBetween(isoDay(nights.check_in), isoDay(nights.check_out)), existing.id]);
    }
    await noteStay(wasStay);
    await noteStay(await stayOf(existing.id));
  }

  // Кімнати, яких у цій редакції немає, — скасувати. Ночі звільняються, і
  // канал має про це дізнатись: інакше номер лишиться зайнятим і непроданим.
  const alive = new Set(targets.map((r) => r.key));
  for (const child of children) {
    if (alive.has(uidKey(child.external_uid))) continue;
    if (String(child.status) === 'cancelled') continue;
    const wasStay = await stayOf(child.id);
    await sql.run(
      "UPDATE reservations SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [child.id]);
    await noteStay(wasStay);
  }
}

/** Ключ кімнати з `external_uid` дочірньої: усе після першої `#`. */
function uidKey(externalUid: unknown): string {
  const s = String(externalUid ?? '');
  const at = s.indexOf('#');
  return at >= 0 ? s.slice(at + 1) : '';
}

/** Дата для тексту історії — `YYYY-MM-DD`, звідки б не приїхала. */
function day(value: unknown): string {
  return isoDay(value) ?? '';
}

/** Дата з рядка бази як `YYYY-MM-DD`: Postgres може віддати Date, SQLite — рядок. */
function isoDay(value: unknown): string | undefined {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string' && value.length >= 10) return value.slice(0, 10);
  return undefined;
}

/** Ночі між датами. Нуль або менше — одна ніч: бронь на нуль ночей не буває. */
function nightsBetween(from?: string, to?: string): number {
  if (!from || !to) return 1;
  const ms = Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(ms)) return 1;
  return Math.max(1, Math.round(ms / 86_400_000));
}

/**
 * Код джерела броні.
 *
 * `booking_sources` заводить готель сам, і назви там його власні. Поки
 * мапінгу немає, канальна бронь позначається кодом, який уже є в закритому
 * списку `reservations.source`; ім'я OTA як прийшло лишається в журналі й у
 * `ota_reservation_code`.
 */
function sourceOf(otaName?: string): string {
  const n = (otaName ?? '').toLowerCase();
  if (n.includes('airbnb')) return 'airbnb';
  if (n.includes('booking')) return 'booking_com';
  return 'other_ota';
}

/**
 * Гість броні.
 *
 * Окремий рядок на кожну канальну бронь, а не пошук збігів за іменем:
 * «Іван Петренко» з Booking.com і «Іван Петренко» з Airbnb — це, найімовірніше,
 * дві різні людини, і злиття їх в одну картку зробило б із двох історій одну
 * неправдиву. Обʼєднання карток — окрема свідома дія оператора.
 */
async function guestFor(sql: Sql, organizationId: string, rev: Revision): Promise<string> {
  const id = crypto.randomUUID();
  await sql.run(
    `INSERT INTO guests (id, organization_id, first_name, last_name, email)
     VALUES (?, ?, ?, ?, ?)`,
    [id, organizationId,
      rev.guestFirstName ?? 'OTA', rev.guestLastName ?? (rev.otaReservationCode ?? 'guest'),
      rev.guestEmail ?? null],
  );
  return id;
}
