import type { Sql } from '@core/db/async';
import { ALL_PROPERTIES, oneProperty, propertyScopeFilter, type PropertyScopeFilter } from '@core/property-scope';
import { connectionInTenant } from './connections.repo';
import { noteAvailabilityChanged, lastNight } from './outbox-notes';
import { recordBookingChange, bookingSnapshot, describeChanges, changesToText } from '@bookings/history';
import { releaseGroupRoom } from '@bookings/group-rooms';

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
 * Вісь обʼєкта цього проходу — і чому вона `oneProperty`, а не `ALL_PROPERTIES`.
 *
 * ── Вісь тут ВИЗНАЧЕНА, і визначає її зʼєднання ─────────────────────────
 *
 * `cm_connections.property_id` називає РІВНО ОДИН будинок, ставиться при
 * заведенні зʼєднання і жоден писач `connections.repo.ts` його не міняє —
 * колонка не зустрічається в жодному `UPDATE cm_connections`. Отже кожен
 * рядок, до якого доходить ця ревізія, створений тут із
 * `property_id = conn.propertyId`: три `INSERT INTO reservations` у цьому
 * файлі беруть його звідти, а знайти чужу бронь нема звідки — журнал шукається
 * за `connection_id`, і `cm_inbound_bookings.reservation_id` пише лише ця
 * функція.
 *
 * Тому `ALL_PROPERTIES` тут був би **неправдою, набраною літерами**: він
 * означає «цей читач НАВМИСНО дивиться на всі будинки рахунку» — так пишеться
 * зведений звіт або крон, що обходить зʼєднання. Ревізія ж адресована одному
 * будинку, і сказати про неї «усі» означало б лишити наступному читачеві
 * рішення, якого ніхто не ухвалював (INC-029 починався саме з такого
 * мовчазного «усі»).
 *
 * ── Навіщо писати те, що й так істинне ──────────────────────────────────
 *
 * Бо «істинне за побудовою» і «перевірене» — різні речі, і різницю видно рівно
 * тоді, коли побудова зламалась: мапінг, заведений повз каталожний синк
 * (`putMapping` питає лише про орендаря), бронь із відновленого дампа, ручна
 * правка журналу. Без осі в запиті такий рядок не відмовляє — він мовчки
 * править сусідній будинок, і побачить це рецепція сусіда через день, у
 * шахматці.
 *
 * ── І чому двері кличуться щоразу, а не через свою обгортку ─────────────
 *
 * Перша редакція цієї правки мала тут `inHouse(propertyId, alias)` — на два
 * рядки коротше і на один здогад дорожче. Гейт осі
 * (`scripts/lib/property-scope-scan.mjs`) впізнає фрагмент за ДВЕРИМА зі
 * списку `SCOPE_DOORS`, а не за підрядком у назві, і зробив це навмисно:
 * «щоб треті двері не зʼявились непоміченими через збіг імені». Обгортка і є
 * треті двері. Вимір показав це числом: одинадцять пар не опустились, а
 * переїхали з «мовчить» у «невизначено», і стеля виросла 11 → 13. Гейт мав
 * рацію — полагоджено код, а не гейт.
 */

/**
 * Перший тип номера ревізії, що НЕ належить будинку цього зʼєднання, або
 * `null`, якщо всі свої.
 *
 * Два поля, а не одне: одиничну бронь тип описує зверху (`rev.unitTypeId`),
 * групу — кожна кімната своїм (`rev.rooms[].unitTypeId`). Перевірка лише
 * верхнього лишила б групу відчиненою, а саме група — звичайний спосіб, яким
 * канал приносить кілька типів однією ревізією.
 *
 * Тип у ревізії — це вже НАШ ідентифікатор: його поклав мапінг каналу
 * (`mappingMirror`). Тобто чужий тут означає не «невідомий», а «мапінг
 * зʼєднання показує на інший будинок» — і це поломка налаштування, яку треба
 * назвати, а не бронь, яку треба створити.
 */
async function firstTypeOutsideHouse(
  sql: Sql,
  conn: { organizationId: string; propertyId: string },
  rev: Revision,
): Promise<string | null> {
  const named = new Set<string>();
  if (rev.unitTypeId) named.add(String(rev.unitTypeId));
  for (const room of rev.rooms ?? []) if (room.unitTypeId) named.add(String(room.unitTypeId));
  if (named.size === 0) return null;

  const ofType = propertyScopeFilter(oneProperty(conn.propertyId), 'ut');
  for (const unitTypeId of named) {
    const own = await sql.row<any>(
      `SELECT ut.id FROM unit_types ut
         JOIN properties p ON p.id = ut.property_id
        WHERE ut.id = ? AND p.organization_id = ? AND ${ofType.sql}`,
      [unitTypeId, conn.organizationId, ...ofType.params]);
    if (!own) return unitTypeId;
  }
  return null;
}

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

  // Вісь ОБʼЄКТА цього проходу. Далі вона стоїть у кожному запиті, і саме
  // тому — не в коментарі: див. `house()` нижче.
  const house = propertyScopeFilter(oneProperty(conn.propertyId), '');

  // ── Крок 0: типи номерів ревізії належать будинку ЦЬОГО зʼєднання ───────
  //
  // Перед журналом, і це не стиль. Відмова ПІСЛЯ журналу лишає рядок, і на
  // наступному проході стрічки та сама ревізія впізнається як `duplicate` —
  // тобто буде ПІДТВЕРДЖЕНА, хоч не застосована ніколи (`pull-bookings.ts`
  // ack-ає дублі навмисно). Тут відмова має бути такою, після якої ревізія
  // приїде ще раз: до воріт або винятком, який відкотить транзакцію.
  const alienType = await firstTypeOutsideHouse(sql, conn, rev);
  if (alienType) {
    return { result: 'refused', reason: `unit_type_not_in_property:${alienType}` };
  }

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

  // Журнал показує на бронь — але чи вона цього будинку?
  //
  // У здоровій базі інакше не буває: рядок пише лише ця функція, і пише те,
  // що сама ж і створила з `conn.propertyId`. Розійтись це може лише ззовні —
  // відновлення з дампа, ручна правка, перенесення. І саме тоді читач, який
  // вірить журналу на слово, переписує дати й статус броні СУСІДНЬОГО
  // будинку: рахунок той самий, політика пропускає, у лозі нічого.
  //
  // Тут — виняток, а не `refused`, і причина в порядку кроків: ворота журналу
  // вже пройдено. `refused` повернувся б із транзакції нормально, тобто рядок
  // журналу лишився б — і наступна доставка тієї самої ревізії впізналась би
  // як `duplicate` та отримала ack (`pull-bookings.ts` ack-ає дублі
  // навмисно). Виняток відкочує транзакцію разом із рядком, тож ревізія
  // лишається непідтвердженою і приїде ще раз — як і має бути з тим, чого ми
  // не застосували.
  if (reservationId) {
    const mine = await sql.row<any>(
      `SELECT id FROM reservations WHERE id = ? AND organization_id = ? AND ${house.sql}`,
      [reservationId, conn.organizationId, ...house.params]);
    if (!mine) {
      throw new Error(
        `channels: журнал зʼєднання показує на бронь ${reservationId}, якої немає в обʼєкті ${conn.propertyId}`);
    }
  }

  // Канали дізнаються про ночі, які ця ревізія звільняє чи займає: стан ДО
  // (скасування, зміна) і ПІСЛЯ (зміна, нова). Тип — із броні: канал адресує
  // тип, а не номер (CP3).
  const stayOf = async (id: string) => sql.row<any>(
    `SELECT property_id, unit_type_id, unit_id, check_in, check_out
       FROM reservations WHERE id = ? AND ${house.sql}`, [id, ...house.params]);
  const noteStay = async (stay: any) => {
    if (!stay?.check_in || !stay?.check_out) return;
    const types = new Set<string>();
    if (stay.unit_type_id) types.add(String(stay.unit_type_id));
    // Кімната, в якій бронь стоїть, може бути ІНШОГО типу, ніж тип броні
    // (канал змінив тип — Д9). Наявність рахує зайнятою кімнату, тож і її
    // тип має дізнатись, що вона звільнилась чи зайнялась.
    if (stay.unit_id) {
      const u = await sql.row<any>(
        `SELECT unit_type_id FROM units WHERE id = ? AND ${house.sql}`, [stay.unit_id, ...house.params]);
      if (u?.unit_type_id) types.add(String(u.unit_type_id));
    }
    for (const unitTypeId of types) {
      // Будинок — зʼєднання, а не рядок. Раніше тут стояло
      // `stay.property_id ?? conn.propertyId`, і запасне значення ховало б
      // саме той випадок, задля якого воно писалось: рядок ІНШОГО будинку
      // склав би пару «будинок Б × тип Б» у черзі каналу, підключеного до А.
      // Тепер рядка іншого будинку сюди не доходить (`stayOf` звужений), тож
      // запасне значення — єдине.
      await noteAvailabilityChanged(sql, {
        propertyId: conn.propertyId, unitTypeId,
        from: String(stay.check_in).slice(0, 10), to: lastNight(String(stay.check_out).slice(0, 10)),
      });
    }
  };
  const before = reservationId ? await stayOf(reservationId) : null;
  // Знімок для історії броні — з назвами, як його прочитає картка.
  const snapshotBefore = reservationId ? await bookingSnapshot(sql, reservationId) : null;

  // ── Група: майстер — кімната №1, кімнати 2..n — дочірні (К4) ────────────
  //
  // Один раз група — завжди група: кімнату, яку прибрали, ми СКАСОВУЄМО, а не
  // стираємо, тож бронювання, що колись мало дві кімнати, лишається групою і
  // з однією живою. Розгорнути його назад в одиничну бронь означало б
  // переписати історію: скасована кімната була, і в звіті за минулий місяць
  // має лишитись.
  const children = reservationId ? await childrenOf(sql, reservationId, house) : [];
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
        "UPDATE reservations SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?",
        [reservationId, conn.organizationId],
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
        WHERE id = ? AND organization_id = ?`,
      [rev.checkIn ?? null, rev.checkOut ?? null, rev.adults ?? null, rev.children ?? null,
        rev.totalPrice ?? null, rev.unitTypeId ?? null, reservationId, conn.organizationId],
    );
    // Канал змінив ТИП — кімната старого типу новий не вміщає: бронь
    // повертається у смугу «Без номера» нового типу, і рецепція ставить її
    // заново. Живе 03.09.2026 (Д9): бронь із Twin переведена на Double
    // лишилась у кімнаті Twin, наявність рахувала Twin, канал отримав Double.
    if (rev.unitTypeId && before?.unit_id && before.unit_type_id && String(before.unit_type_id) !== rev.unitTypeId) {
      await sql.run('UPDATE reservations SET unit_id = NULL WHERE id = ? AND organization_id = ?',
        [reservationId, conn.organizationId]);
    }
    // Ночі — ЗБЕРЕЖЕНА колонка: картка, список і турзбір читають її, а не
    // рахують. Перераховується з того, що тепер у рядку, а не з ревізії:
    // ревізія могла принести лише одну з дат. Живе 03.09.2026 (Д8): зміна з
    // каналу 21→24.12 показувала «2 н.» на трьох ночах.
    const dates = await sql.row<any>(
      `SELECT check_in, check_out FROM reservations WHERE id = ? AND ${house.sql}`,
      [reservationId, ...house.params]);
    if (dates) {
      await sql.run('UPDATE reservations SET nights = ? WHERE id = ? AND organization_id = ?',
        [nightsBetween(isoDay(dates.check_in), isoDay(dates.check_out)),
          reservationId, conn.organizationId]);
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
          WHERE id = (SELECT guest_id FROM reservations
                       WHERE id = ? AND organization_id = ? AND ${house.sql})`,
        [rev.guestFirstName ?? null, rev.guestLastName ?? null, rev.guestEmail ?? null,
         reservationId, conn.organizationId, ...house.params],
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
    // Бронювання цілком — САМЕ ТУТ, і більше ніде: у рядку броні лежить
    // кімната (К4), тож сума бронювання (555 при кімнатах 300 + 210) і його
    // заселеність не мають куди лягти. Без цього рецепція бачить бронь на 300
    // і лист із OTA на 555 — і не має чим пояснити різницю.
    const roomCount = rev.rooms?.length ?? 0;
    if (roomCount > 1) {
      const whole = [
        `${roomCount} кімнати`,
        rev.totalPrice != null ? `${rev.totalPrice} ${rev.currency ?? ''}`.trim() : '',
        rev.adults != null ? `гостей ${rev.adults}${rev.children ? ` + ${rev.children} діт.` : ''}` : '',
      ].filter(Boolean).join(' · ');
      details = `${details} · бронювання цілком: ${whole}`;
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
      WHERE id = ? AND organization_id = ?`,
    [reservationId, journalId, conn.organizationId],
  );

  return { result: 'applied', reservationId, created };
}

/**
 * Дочірні броні групи — у порядку ключа кімнати.
 *
 * Читається за `parent_id`, а не за `external_uid LIKE`: батьківська бронь уже
 * знайдена в межах орендаря (через журнал і `connectionInTenant`), тож
 * `parent_id` — це вже перевірена межа. Вісь ОБʼЄКТА при цьому називається
 * окремо: `parent_id` доводить спорідненість, а не будинок, і дочірня бронь,
 * що з якоїсь причини лежить в іншому обʼєкті, тут не потрібна ні для чого —
 * канал адресує один будинок. `external_uid` дочірньої несе ключ
 * кімнати, і саме за ним вона впізнається в наступній редакції; читати за ним
 * НЕ можна — те поле ділиться з iCal-синком, і збіг там був би тихим.
 */
async function childrenOf(sql: Sql, parentId: string, house: PropertyScopeFilter): Promise<any[]> {
  return await sql.rows<any>(
    `SELECT id, external_uid, unit_type_id, unit_id, check_in, check_out, status
       FROM reservations WHERE parent_id = ? AND ${house.sql} ORDER BY external_uid`,
    [parentId, ...house.params],
  ) as any[];
}

/**
 * Група в РІДНІЙ формі продукту: майстер сам є кімнатою №1 (К4).
 *
 * ── Чому не конверт ─────────────────────────────────────────────────────
 *
 * Перша редакція клала бронювання в батьківський рядок без типу і без номера,
 * з сумарними гостями й сумою всього бронювання, а кожну кімнату — в дочірню.
 * Виглядало охайно і ламало кожного читача мовчки:
 *
 *   • `day-sheets` рахував гостей конверта ПЛЮС гостей кімнат — Zimmerliste і
 *     сніданок на подвійну кількість людей;
 *   • турзбір — так само двічі;
 *   • календар малював три плашки на дві кімнати (`lanes.ts` бере кожен рядок);
 *   • список показував бронь без типу, картка пропонувала «створити групу»,
 *     а PATCH дозволяв поставити конверт у номер — третій зайнятий номер за
 *     дві кімнати.
 *
 * Рідна група тут одна, і вона старша за канали: майстер — це бронь із власним
 * типом, датами і сумою СВОЄЇ кімнати; кімнати 2..n — дочірні броні з
 * `parent_id`; а те, з чого група складається, читається з
 * `reservation_sub_bookings` — по рядку на кімнату (у кімнати майстра
 * `child_reservation_id IS NULL`, як його заводить рецепція).
 *
 * ── Ключ кімнати несе КОЖЕН рядок, майстер теж ──────────────────────────
 *
 * `external_uid` = `${код броні}#${ключ кімнати}`. Інакше при зникненні
 * кімнати №1 нема за чим упізнати, яку саме кімнату майстер тримав, і
 * «перейняти кімнату №2» перетворюється на здогад по порядку рядків.
 *
 * ── Що з сумою бронювання ───────────────────────────────────────────────
 *
 * Бронювання цілком (555 при кімнатах 300 + 210) у рядок НЕ пишеться: рядок
 * описує кімнату, і фоліо кімнати рахує її гроші. Сума бронювання лишається
 * там, де їй місце, — у журналі ревізій (сира ревізія) і в історії броні.
 *
 * ── Що робить зникла кімната ────────────────────────────────────────────
 *
 * Скасовується, а не стирається: вона була, гість про неї знає, у звіті за
 * минулий місяць має лишитись. Її ночі при цьому звільняються й їдуть у канал.
 *
 * Якщо зникла кімната МАЙСТРА — майстер переймає першу живу (rekey), а рядок,
 * що її тримав, забирає стару кімнату майстра і скасовується: рядки міняються
 * місцями. Скасувати майстра означало б скасувати саму бронь — картка, аркуші
 * дня і рахунок показували б «скасовано», поки гість заселяється в живу
 * кімнату під ним.
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
  // Та сама вісь, що у виклику, і виведена з того самого — зʼєднання. Не
  // передається аргументом навмисно: фільтр, зібраний із `conn`, не може
  // розійтися з будинком, від якого походить (той самий довід, що в
  // інваріанті 12 про підзапит проти змінної).
  const house = propertyScopeFilter(oneProperty(conn.propertyId), '');
  // Скасування кімнат не перелічує — воно гасить усю групу.
  const rooms = cancelled ? [] : (rev.rooms ?? []);
  const code = rev.otaReservationCode ?? rev.remoteBookingId;

  if (created) {
    // Нова група: майстер — перша кімната. Ревізія без кімнат (скасування
    // бронювання, якого ми не бачили) описує сама себе.
    const first = rooms[0];
    const from = first?.checkIn ?? rev.checkIn;
    const to = first?.checkOut ?? rev.checkOut;
    await sql.run(
      `INSERT INTO reservations (id, organization_id, property_id, unit_id, unit_type_id, guest_id,
                                 check_in, check_out, nights, adults, children,
                                 status, payment_status, source, total_price, currency, external_uid)
       VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 'unpaid', ?, ?, ?, ?)`,
      [parentId, conn.organizationId, conn.propertyId,
        first?.unitTypeId ?? rev.unitTypeId ?? null,
        await guestFor(sql, conn.organizationId, rev),
        from ?? '', to ?? '', nightsBetween(from, to),
        first?.adults ?? rev.adults ?? 1, first?.children ?? rev.children ?? 0,
        cancelled ? 'cancelled' : 'confirmed',
        sourceOf(rev.otaName), first?.amount ?? rev.totalPrice ?? 0, rev.currency ?? '',
        first ? `${code}#${first.key}` : (rev.otaReservationCode ?? null)],
    );
  }

  const master = await sql.row<any>(
    `SELECT id, guest_id, status, payment_status, source, currency, property_id, external_uid,
            unit_type_id, unit_id, check_in, check_out, nights, adults, children, total_price
       FROM reservations WHERE id = ? AND ${house.sql}`, [parentId, ...house.params]) as any;
  const byKey = new Map<string, any>(children.map((c) => [uidKey(c.external_uid), c]));
  const masterKey = uidKey(master.external_uid);

  // Майстер тримає ту саму кімнату, доки вона є в редакції; зникла — переймає
  // першу живу. Порожній ключ — бронь, яка приїхала однією кімнатою і лише
  // тепер стала групою: вона і є кімнатою №1, нічого переймати не треба.
  const masterRoom = rooms.find((r) => r.key === masterKey) ?? rooms[0];
  const rekey = !created && !!masterRoom && !!masterKey && masterRoom.key !== masterKey;
  const handled = new Set<string>();

  if (rekey && masterRoom) {
    // Стара кімната майстра лишається в базі — скасованою, зі своїм ключем і
    // своїм типом: її ночі мають звільнитись саме з нього.
    const displaced = byKey.get(masterRoom.key) ?? null;
    const old = {
      unitTypeId: master.unit_type_id ?? null,
      from: isoDay(master.check_in) ?? '', to: isoDay(master.check_out) ?? '',
      adults: Number(master.adults ?? 1), children: Number(master.children ?? 0),
      amount: Number(master.total_price ?? 0),
    };
    if (displaced) {
      const wasStay = await stayOf(displaced.id);
      await sql.run(
        `UPDATE reservations
            SET external_uid = ?, unit_type_id = ?, unit_id = NULL,
                check_in = ?, check_out = ?, nights = ?, adults = ?, children = ?,
                total_price = ?, status = 'cancelled', updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND organization_id = ?`,
        [`${code}#${masterKey}`, old.unitTypeId, old.from, old.to,
          nightsBetween(old.from, old.to), old.adults, old.children, old.amount,
          displaced.id, conn.organizationId],
      );
      handled.add(String(displaced.id));
      byKey.delete(masterRoom.key);
      await noteStay(wasStay);
      await noteStay(await stayOf(displaced.id));
    } else {
      // Кімнату майстра прибрали, а та, що він переймає, рядка ще не має:
      // скасованій кімнаті потрібен свій, інакше вона зникне беззвучно.
      const ghostId = crypto.randomUUID();
      await sql.run(
        `INSERT INTO reservations (id, organization_id, property_id, parent_id, unit_id, unit_type_id, guest_id,
                                   check_in, check_out, nights, adults, children,
                                   status, payment_status, source, total_price, currency, external_uid)
         VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 'cancelled', ?, ?, ?, ?, ?)`,
        [ghostId, conn.organizationId, conn.propertyId, parentId, old.unitTypeId,
          master.guest_id, old.from, old.to, nightsBetween(old.from, old.to),
          old.adults, old.children, master.payment_status, master.source,
          old.amount, master.currency ?? '', `${code}#${masterKey}`],
      );
      handled.add(ghostId);
    }
  }

  if (!created) {
    if (masterRoom) {
      // Порожнє поле кімнати — «не міняли», а не «скинути»: те саме правило,
      // що й для одиничної броні. Ключ і статус — безумовно.
      const typeChanged = !!masterRoom.unitTypeId && !!master.unit_type_id
        && String(master.unit_type_id) !== masterRoom.unitTypeId;
      await sql.run(
        `UPDATE reservations
            SET external_uid = ?,
                check_in = COALESCE(?, check_in),
                check_out = COALESCE(?, check_out),
                unit_type_id = COALESCE(?, unit_type_id),
                adults = COALESCE(?, adults),
                children = COALESCE(?, children),
                total_price = COALESCE(?, total_price),
                status = ?,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND organization_id = ?`,
        [`${code}#${masterRoom.key}`, masterRoom.checkIn ?? null, masterRoom.checkOut ?? null,
          masterRoom.unitTypeId ?? null, masterRoom.adults ?? null, masterRoom.children ?? null,
          masterRoom.amount ?? null, cancelled ? 'cancelled' : 'confirmed',
          parentId, conn.organizationId],
      );
      // Номер знімається у двох випадках, і обидва про одне: кімната під
      // майстром більше не та. Канал змінив ТИП (Д9) — номер старого типу
      // новий не вміщає; майстер перейняв ІНШУ кімнату — номер належав тій,
      // якої вже немає. Бронь повертається у смугу «Без номера».
      if ((typeChanged || rekey) && master.unit_id) {
        await sql.run('UPDATE reservations SET unit_id = NULL WHERE id = ? AND organization_id = ?',
          [parentId, conn.organizationId]);
      }
    } else {
      await sql.run(
        `UPDATE reservations SET status = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND organization_id = ?`,
        [cancelled ? 'cancelled' : 'confirmed', parentId, conn.organizationId]);
    }
    // Ночі — ЗБЕРЕЖЕНА колонка: перераховуються з того, що ТЕПЕР у рядку.
    const dates = await sql.row<any>(
      `SELECT check_in, check_out FROM reservations WHERE id = ? AND ${house.sql}`,
      [parentId, ...house.params]);
    if (dates) {
      await sql.run('UPDATE reservations SET nights = ? WHERE id = ? AND organization_id = ?',
        [nightsBetween(isoDay(dates.check_in), isoDay(dates.check_out)),
          parentId, conn.organizationId]);
    }
    if (rev.guestFirstName !== undefined || rev.guestLastName !== undefined || rev.guestEmail !== undefined) {
      await sql.run(
        `UPDATE guests
            SET first_name = COALESCE(?, first_name),
                last_name = COALESCE(?, last_name),
                email = COALESCE(?, email),
                updated_at = CURRENT_TIMESTAMP
          WHERE id = (SELECT guest_id FROM reservations
                       WHERE id = ? AND organization_id = ? AND ${house.sql})`,
        [rev.guestFirstName ?? null, rev.guestLastName ?? null, rev.guestEmail ?? null,
         parentId, conn.organizationId, ...house.params],
      );
    }
  }

  const now = await sql.row<any>(
    `SELECT guest_id, status, payment_status, source, currency
       FROM reservations WHERE id = ? AND ${house.sql}`,
    [parentId, ...house.params]) as any;

  // ── Кімнати 2..n ─────────────────────────────────────────────────────────
  const childRooms = rooms.filter((r) => r !== masterRoom);
  const live: Array<{ id: string | null; room: RevisionRoom }> = [];
  if (masterRoom) live.push({ id: null, room: masterRoom });

  for (const room of childRooms) {
    const existing = byKey.get(room.key);
    const from = room.checkIn ?? isoDay(master.check_in);
    const to = room.checkOut ?? isoDay(master.check_out);

    if (!existing) {
      const childId = crypto.randomUUID();
      await sql.run(
        `INSERT INTO reservations (id, organization_id, property_id, parent_id, unit_id, unit_type_id, guest_id,
                                   check_in, check_out, nights, adults, children,
                                   status, payment_status, source, total_price, currency, external_uid)
         VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [childId, conn.organizationId, conn.propertyId, parentId, room.unitTypeId ?? null,
          now.guest_id, from ?? '', to ?? '', nightsBetween(from, to),
          room.adults ?? 1, room.children ?? 0,
          now.status, now.payment_status, now.source,
          room.amount ?? 0, now.currency ?? '', `${code}#${room.key}`],
      );
      handled.add(childId);
      live.push({ id: childId, room });
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
        WHERE id = ? AND organization_id = ?`,
      [from ?? null, to ?? null, room.unitTypeId ?? null, room.adults ?? null, room.children ?? null,
        room.amount ?? null, now.status, now.payment_status,
        existing.id, conn.organizationId],
    );
    // Канал змінив ТИП кімнати, яку рецепція вже поставила в номер (Д9).
    if (room.unitTypeId && wasStay?.unit_id && wasStay.unit_type_id
        && String(wasStay.unit_type_id) !== room.unitTypeId) {
      await sql.run('UPDATE reservations SET unit_id = NULL WHERE id = ? AND organization_id = ?',
        [existing.id, conn.organizationId]);
    }
    const nights = await sql.row<any>(
      `SELECT check_in, check_out FROM reservations WHERE id = ? AND ${house.sql}`,
      [existing.id, ...house.params]);
    if (nights) {
      await sql.run('UPDATE reservations SET nights = ? WHERE id = ? AND organization_id = ?',
        [nightsBetween(isoDay(nights.check_in), isoDay(nights.check_out)),
          existing.id, conn.organizationId]);
    }
    handled.add(String(existing.id));
    live.push({ id: String(existing.id), room });
    await noteStay(wasStay);
    await noteStay(await stayOf(existing.id));
  }

  // Кімнати, яких у цій редакції немає, — скасувати. Ночі звільняються, і
  // канал має про це дізнатись: інакше номер лишиться зайнятим і непроданим.
  for (const child of children) {
    if (handled.has(String(child.id))) continue;
    if (String(child.status) === 'cancelled') continue;
    const wasStay = await stayOf(child.id);
    await sql.run(
      "UPDATE reservations SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?",
      [child.id, conn.organizationId]);
    await noteStay(wasStay);
  }

  // ── З чого складається бронювання ───────────────────────────────────────
  //
  // Скасування кімнат не несе, тож і склад групи воно не переписує: бронь
  // скасована статусом, а з чого вона складалась — лишається видно.
  if (!cancelled) await syncGroupRooms(sql, conn, parentId, live);
}

/**
 * Рядки `reservation_sub_bookings` = кімнати цієї редакції, і нічого крім.
 *
 * Це не дубль дочірніх броней: дочірня — це НОМЕР на календарі, а рядок групи —
 * те, з чого бронювання складається для картки, фоліо і рахунку. Кімната
 * майстра теж має рядок, і саме без дочірньої броні (`child_reservation_id`
 * порожній) — так само, як його заводить рецепція, коли ділить одну кімнату
 * між платниками.
 *
 * Прибрана кімната свій рядок втрачає — але ЛИШЕ якщо на ньому нічого не
 * висить. Сама бронь при цьому лишається скасованою дочірньою: історію тримає
 * вона, а не рядок.
 *
 * Дві речі на рядку поводяться по-різному, і різниця в оборотності:
 *
 *   гість (`reservation_guests.sub_booking_id`) — ВІДʼЄДНУЄТЬСЯ. Ключ туди
 *   не має `ON DELETE`, тож без цього `DELETE` нижче падав, і через нього
 *   ревізія не підтверджувалась ніколи (Б2);
 *
 *   вписані позиції (`reservation_line_items.sub_booking_id`) — рядок
 *   ЛИШАЄТЬСЯ. Канал володіє тим, що забронювали; готель — тим, що нарахували
 *   і що вписала людина (рішення власника 09.09.2026, К18). Каскад на цьому
 *   ключі знято міграцією 0131, тож правило тримає база: наступний `DELETE`
 *   по рядку з позиціями відмовляє, а не нищить. Випадок іде рецепції
 *   рішенням, а не тихим станом, — див. нижче по коду.
 */
async function syncGroupRooms(
  sql: Sql,
  conn: { organizationId: string; propertyId: string },
  parentId: string,
  live: Array<{ id: string | null; room: RevisionRoom }>,
): Promise<void> {
  const organizationId = conn.organizationId;
  if (live.length === 0) return;

  const existing = await sql.rows<any>(
    'SELECT id, child_reservation_id FROM reservation_sub_bookings WHERE reservation_id = ?',
    [parentId]) as any[];
  const byChild = new Map<string, any>(existing.map((r) => [String(r.child_reservation_id ?? ''), r]));
  const keep = new Set<string>();

  // Назва рядка — тип номера кімнати: у картці інакше два рядки без імен.
  //
  // Тип читається В МЕЖАХ ОРЕНДАРЯ, і рядок, якого немає, — це ВІДМОВА, а не
  // порожня назва (інваріант 13). До правки було два тихі шляхи в один і той
  // самий стан: `WHERE id = ?` без орендаря взяв би назву чужого типу на
  // SQLite (на Postgres політика віддала б порожньо), а `?? ''` перетворював
  // «типу не знайшли» на «тип без назви» — і в картці групи стояв би рядок,
  // якого рецепція не може ні впізнати, ні пояснити гостю.
  //
  // Тип у ревізії — НАШ ідентифікатор: його поклав мапінг каналу. Якщо його
  // немає в цього орендаря, зламаний мапінг, а не назва.
  //
  // І вісь ОБʼЄКТА тут та сама, що у воротах ревізії: тип сусіднього будинку
  // того самого рахунку дав би рядку групи назву кімнати, якої в цьому
  // будинку немає, — рецепція прочитала б її як свою. Ворота вже відмовили б
  // такій ревізії; тут це повторено, бо `syncGroupRooms` — окремі двері, і
  // наступний виклик може прийти не звідти.
  const ofType = propertyScopeFilter(oneProperty(conn.propertyId), 'ut');
  const names = new Map<string, string>();
  const nameOf = async (unitTypeId?: string | null): Promise<string> => {
    if (!unitTypeId) return '';
    const known = names.get(unitTypeId);
    if (known !== undefined) return known;
    const row = await sql.row<any>(
      `SELECT ut.name FROM unit_types ut
         JOIN properties p ON p.id = ut.property_id
        WHERE ut.id = ? AND p.organization_id = ? AND ${ofType.sql}`,
      [unitTypeId, organizationId, ...ofType.params]) as any;
    if (!row) {
      throw new Error(
        `channels: тип номера ${unitTypeId} не належить обʼєкту ${conn.propertyId} цього зʼєднання`);
    }
    const name = String(row.name ?? '');
    names.set(unitTypeId, name);
    return name;
  };

  for (let i = 0; i < live.length; i++) {
    const { id, room } = live[i];
    const label = await nameOf(room.unitTypeId);
    const row = byChild.get(id ?? '');
    if (row) {
      await sql.run(
        `UPDATE reservation_sub_bookings
            SET label = ?, adults = ?, children = ?, subtotal = ?, sort_order = ?
          WHERE id = ?`,
        [label, room.adults ?? 1, room.children ?? 0, room.amount ?? 0, i, row.id]);
      keep.add(String(row.id));
      continue;
    }
    const subId = crypto.randomUUID();
    await sql.run(
      `INSERT INTO reservation_sub_bookings
         (id, reservation_id, child_reservation_id, label, adults, children, subtotal, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [subId, parentId, id, label, room.adults ?? 1, room.children ?? 0, room.amount ?? 0, i]);
    keep.add(subId);
  }

  for (const row of existing) {
    if (keep.has(String(row.id))) continue;
    // Двері модуля броней: `reservation_sub_bookings` тягне за собою ще дві
    // таблиці броней, і знання «як саме знімається рядок» живе там, а не тут
    // (`check-boundaries`). Що робиться і чому — у шапці `@bookings/group-rooms`.
    const released = await releaseGroupRoom(sql, String(row.id));
    if (released.outcome !== 'kept_has_charges') continue;

    // Рецепція мусить побачити це як РІШЕННЯ, а не як тихий стан (К18).
    //
    // Тут стояв `console.warn` — рядок у лозі контейнера, якого не бачить
    // ніхто, крім того, хто його шукає. А стан невизначений і належить
    // ЛЮДИНІ: кімнати в бронюванні більше немає, а вписані на неї позиції
    // лишились — їх треба перенести на іншу кімнату, виставити окремо або
    // списати. Ми не вирішуємо за неї й не стираємо: канал володіє тим, що
    // ЗАБРОНЮВАЛИ, готель — тим, що НАРАХУВАЛИ (В10).
    //
    // Пишеться в історію броні — туди, куди рецепція й так дивиться, і що
    // переживає перезапуск. Це ті самі двері, якими ця функція вже пише
    // решту змін з каналу.
    const room = released.label || 'без назви';
    const money = released.charges.total ? ` на суму ${released.charges.total}` : '';
    await recordBookingChange(sql, {
      reservationId: parentId,
      action: 'channel_room_removed_with_charges',
      details: `Канал прибрав кімнату «${room}» із бронювання. На ній лишилось `
        + `${released.charges.count} вписаних позицій${money} — перенесіть на іншу кімнату, `
        + 'виставте окремо або спишіть. Ми їх не стерли: канал володіє тим, що забронювали, '
        + 'готель — тим, що нарахували.',
      // Дію зробив КАНАЛ, не людина — так її і підписуємо: рецепція має
      // бачити, що рядок не її рук справа, і не шукати, хто це натиснув.
      actor: { id: null, name: 'Канал' },
    });
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
