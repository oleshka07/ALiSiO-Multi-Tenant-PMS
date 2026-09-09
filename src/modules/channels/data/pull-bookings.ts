import type { Sql } from '@core/db/async';
import type { ApplyOutcome, Revision } from './inbound-bookings.repo';
// Розширення в шляху, а не аліас: цей файл читає ще й перевірка, яку
// запускають голим node, а бандлер із розширенням теж згоден.
import { groupRoomKeys, type FeedEntry } from '../domain/feed.ts';

/**
 * Прочитати стрічку ревізій і завести з неї броні.
 *
 * Уся небезпека тут в одному місці — у порядку двох дій.
 *
 * ── Інваріант И5: ack ПІСЛЯ коміту ──────────────────────────────────────
 *
 * Стрічка віддає **лише непідтверджені** ревізії. Це її головна властивість:
 * вона самоочищається, і пропущений вебхук не означає пропущену броню.
 *
 * Але з неї ж випливає, що підтвердження — незворотне. Підтвердили до
 * коміту, процес упав — бронювання втрачено НАЗАВЖДИ: більше його ніхто не
 * покаже, бо для менеджера каналів воно вже доставлене. Гість приїде в
 * готель, який про нього не знає.
 *
 * Тому: транзакція → коміт → і лише тоді ack. Ніколи не в один крок і
 * ніколи не «заразом, щоб не робити двічі».
 *
 * Зворотний бік теж названий: не підтвердили те, що застосували, — ревізія
 * приїде ще раз. Це не втрата, а повтор, і від нього захищає
 * `UNIQUE(connection_id, remote_revision_id)` у журналі (CP4). Тобто ціна
 * помилки в один бік — загублена бронь, у другий — зайвий прохід. Обирати
 * тут нема з чого.
 *
 * ── Порядок ревізій ─────────────────────────────────────────────────────
 *
 * Стрічка просить `order[inserted_at]=asc` — без цього параметра порядок не
 * гарантований, а дві ревізії одного бронювання, застосовані навпаки,
 * дадуть скасовану бронь як активну. Цикл нижче зберігає порядок, у якому
 * прийшли дані, і НЕ переставляє їх.
 *
 * ── Група кімнат — одне застосування ────────────────────────────────────
 *
 * Ревізія з кількома кімнатами це батьківська бронь і по дочірній на кімнату
 * (К1). Цикл не розбиває її на частини: `apply` отримує ревізію цілком і
 * кладе всю групу в одну транзакцію. Інакше `ack` після першої кімнати
 * означав би половину групи в базі й ревізію, якої вже ніхто не покаже.
 *
 * ── Помилка на одній ревізії не глушить решту ───────────────────────────
 *
 * Але лише між РІЗНИМИ бронюваннями. Якщо впала ревізія бронювання X,
 * наступні ревізії того самого X пропускаються: застосувати «змінено» після
 * невдалого «створено» означає зміну того, чого немає.
 *
 * ── Чого тут НЕМАЄ ──────────────────────────────────────────────────────
 *
 * Імені вендора. Цикл — це порядок дій, і він однаковий для будь-якого
 * менеджера каналів; переклад чужого формату однаковим не буває ніколи.
 * Тому `fetchFeed` віддає вже доменні записи (`../domain/feed.ts`), а хто і
 * як їх переклав — справа адаптера (інваріант И1).
 */

/** Що зробити з однією ревізією. Усе, що торкається світу, приходить ззовні. */
export interface PullDeps {
  /**
   * Записи стрічки, вже перекладені й уже в порядку надходження.
   *
   * Порядок задає адаптер запитом до менеджера каналів; цикл його зберігає
   * і не сортує. Запис може бути відмовою з причиною — крива ревізія не
   * має валити решту стрічки.
   */
  fetchFeed(connectionId: string): Promise<FeedEntry[]>;
  /**
   * Одна транзакція на одну ревізію.
   *
   * `fn` отримує ручку `t` і мусить писати ЛИШЕ нею: зовнішній `getSql()`
   * усередині `sql.tx` на Postgres — це інше зʼєднання з пулу, тобто запис
   * повз транзакцію (інваріант 11). Саме так `applyRevision` і був написаний
   * до 01.09.2026 — журнал і бронь на різних зʼєднаннях, «атомарно» лише на
   * SQLite, де зʼєднання одне й вісь невидима (інваріант 26).
   */
  tx<T>(fn: (t: Sql) => Promise<T>): Promise<T>;
  /** Записати ревізію й звести з бронню. Викликається ВСЕРЕДИНІ `tx`, тією ж ручкою. */
  apply(t: Sql, connectionId: string, rev: Revision): Promise<ApplyOutcome>;
  /**
   * Підтвердити менеджеру каналів. Викликається ПІСЛЯ коміту.
   *
   * `ackToken` — це НЕ ключ дедуплікації. На одну ревізію припадає два
   * ідентифікатори, і в шляху підтвердження стоїть саме цей; підмінити його
   * ключем дедуплікації означає 404 і ревізію, яка не зникне зі стрічки
   * ніколи. Домен його не читає — лише повертає тому, хто видав.
   */
  ack(connectionId: string, ackToken: string): Promise<void>;
}

export interface PullReport {
  /** Скільки ревізій прочитано зі стрічки. */
  seen: number;
  /** Застосовано вперше. */
  applied: number;
  /** Уже були — повтор доставки, не помилка. */
  duplicates: number;
  /** Не застосовано; кожна причина названа. */
  skipped: { remoteRevisionId?: string; remoteBookingId?: string; reason: string }[];
  /** Підтверджено менеджеру каналів. */
  acked: number;
}

export async function pullBookings(connectionId: string, deps: PullDeps): Promise<PullReport> {
  const report: PullReport = { seen: 0, applied: 0, duplicates: 0, skipped: [], acked: 0 };

  const feed = await deps.fetchFeed(connectionId);

  /** Бронювання, на якому вже спіткнулись: його наступні ревізії пропускаємо. */
  const broken = new Set<string>();

  for (const entry of feed) {
    report.seen++;

    if (!entry.ok) {
      report.skipped.push({ reason: entry.reason });
      continue;
    }
    const rev = entry.revision;

    if (broken.has(rev.remoteBookingId)) {
      report.skipped.push({
        remoteRevisionId: rev.remoteRevisionId,
        remoteBookingId: rev.remoteBookingId,
        reason: 'earlier_revision_failed',
      });
      continue;
    }

    // Кілька кімнат — це кілька наших броней (`reservations` це рядок на
    // кімнату), і вони їдуть ОДНИМ застосуванням: група лягає в одну
    // транзакцію, і `ack` іде після її коміту (К1, И5). Підтвердити після
    // першої кімнати означало б, що падіння на другій лишає половину групи, а
    // ревізія вже зникла зі стрічки назавжди.
    //
    // Ключі кімнат рахуються тут, бо правило стосується редакції ЦІЛКОМ:
    // або в усіх кімнат є свій ідентифікатор на боці OTA, або жодна не має і
    // всі впізнаються позицією (`groupRoomKeys`).
    const room = rev.rooms[0];
    const keys = groupRoomKeys(rev.rooms);
    const domain: Revision = {
      remoteRevisionId: rev.remoteRevisionId,
      remoteBookingId: rev.remoteBookingId,
      status: rev.status,
      otaReservationCode: rev.otaReservationCode,
      otaName: rev.otaName,
      unmapped: rev.unmapped,
      raw: rev.raw,
      checkIn: room?.checkIn,
      checkOut: room?.checkOut,
      unitTypeId: room?.unitTypeId ?? null,
      // Заселеність бронювання, якщо менеджер каналів її назвав; інакше — з
      // єдиної кімнати. Для групи різницю бачить `applyRevision`.
      adults: rev.adults ?? room?.adults,
      children: rev.children ?? room?.children,
      totalPrice: rev.totalAmount,
      currency: rev.currency,
      guestFirstName: rev.guestFirstName,
      guestLastName: rev.guestLastName,
      guestEmail: rev.guestEmail,
      rooms: rev.rooms.map((r, i) => ({
        key: keys[i],
        unitTypeId: r.unitTypeId ?? null,
        checkIn: r.checkIn,
        checkOut: r.checkOut,
        adults: r.adults,
        children: r.children,
        amount: r.amount,
      })),
    };

    let outcome: ApplyOutcome;
    try {
      outcome = await deps.tx((t) => deps.apply(t, connectionId, domain));
    } catch (e) {
      report.skipped.push({
        remoteRevisionId: rev.remoteRevisionId,
        remoteBookingId: rev.remoteBookingId,
        reason: `apply_failed:${e instanceof Error ? e.message : 'unknown'}`,
      });
      broken.add(rev.remoteBookingId);
      continue;
    }

    if (outcome.result === 'refused') {
      report.skipped.push({
        remoteRevisionId: rev.remoteRevisionId,
        remoteBookingId: rev.remoteBookingId,
        reason: outcome.reason,
      });
      broken.add(rev.remoteBookingId);
      continue;
    }

    if (outcome.result === 'duplicate') report.duplicates++;
    else report.applied++;

    // Коміт уже стався — `deps.tx` повернувся. Аж ТЕПЕР можна підтверджувати.
    //
    // Повтор доставки підтверджується так само: для менеджера каналів ревізія
    // лишається непідтвердженою, доки ми не скажемо інакше, а те, що бачили,
    // — наша внутрішня справа.
    try {
      await deps.ack(connectionId, rev.ackToken);
      report.acked++;
    } catch (e) {
      // Не підтвердили те, що застосували: ревізія приїде ще раз і буде
      // впізнана як дубль. Це повтор, а не втрата — див. шапку файла.
      report.skipped.push({
        remoteRevisionId: rev.remoteRevisionId,
        remoteBookingId: rev.remoteBookingId,
        reason: `ack_failed:${e instanceof Error ? e.message : 'unknown'}`,
      });
    }
  }

  return report;
}
