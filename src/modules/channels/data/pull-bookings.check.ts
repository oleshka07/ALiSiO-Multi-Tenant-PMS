/**
 * Стрічка ревізій: підтвердження — ПІСЛЯ коміту, і ніколи раніше.
 *
 *   node src/modules/channels/data/pull-bookings.check.ts
 *
 * Інваріант И5, і ціна помилки тут несиметрична.
 *
 * Стрічка віддає лише НЕПІДТВЕРДЖЕНІ ревізії — тому вона й самоочищається.
 * З цього ж випливає, що підтвердження незворотне: підтвердили до коміту,
 * процес упав — бронювання втрачено назавжди, бо для менеджера каналів воно
 * вже доставлене. Гість приїде в готель, який про нього не знає.
 *
 * Зворотна помилка дешева: не підтвердили те, що застосували — ревізія
 * приїде ще раз і буде впізнана як дубль (CP4). Тобто в один бік загублена
 * бронь, у другий зайвий прохід. Обирати нема з чого, і саме тому порядок
 * перевіряється, а не мається на увазі.
 *
 * Перевірка написана ДО реалізації і **була червоною**: перша версія
 * підтверджувала всередині транзакції.
 *
 * Записи стрічки тут будуються доменними, а не сирими. Це не спрощення:
 * переклад чужого формату доводить `../channex/revision-map.check.ts`, і
 * якби він жив ще й тут, помилка мапера показувалась би як зламаний
 * порядок підтверджень.
 */
import assert from 'node:assert';
import { pullBookings, type PullDeps } from './pull-bookings.ts';
import type { FeedEntry, FeedRevision, FeedRoom } from '../domain/feed.ts';

const room = (over: Partial<FeedRoom> = {}): FeedRoom => ({
  unitTypeId: 'ut_deluxe',
  checkIn: '2026-10-10',
  checkOut: '2026-10-12',
  adults: 2,
  children: 0,
  amount: 300,
  ...over,
});

const entry = (over: Partial<FeedRevision> = {}): FeedEntry => ({
  ok: true,
  revision: {
    remoteRevisionId: 'sys-1',
    ackToken: 'ack-1',
    remoteBookingId: 'bkg-1',
    status: 'new',
    otaReservationCode: 'BDC-1',
    otaName: 'Booking.com',
    currency: 'EUR',
    totalAmount: 300,
    unmapped: false,
    rooms: [room()],
    guestFirstName: 'A',
    guestLastName: 'B',
    raw: {},
    ...over,
  },
});

/** Журнал того, що і в якому порядку сталося. Він і є доказом. */
function harness(feed: FeedEntry[], over: Partial<PullDeps> = {}) {
  const log: string[] = [];
  const deps: PullDeps = {
    fetchFeed: async () => feed,
    tx: async (fn) => {
      log.push('tx:begin');
      const r = await fn(null as never);
      log.push('tx:commit');
      return r;
    },
    apply: async (_t, _c, r) => {
      log.push(`apply:${r.remoteRevisionId}`);
      return { result: 'applied', reservationId: 'res-1', created: true };
    },
    ack: async (_c, id) => { log.push(`ack:${id}`); },
    ...over,
  };
  return { log, deps };
}

// ─── Порядок: коміт, потім ack ──────────────────────────────────────────────
{
  const { log, deps } = harness([entry()]);
  const report = await pullBookings('conn-1', deps);
  assert.deepStrictEqual(log, ['tx:begin', 'apply:sys-1', 'tx:commit', 'ack:ack-1'],
    'ack стався НЕ після коміту — упавши між ними, ми втратили б бронь назавжди');
  assert.strictEqual(report.applied, 1);
  assert.strictEqual(report.acked, 1);
  console.log('  ok  ack іде після коміту, а не всередині транзакції');
}

// ─── Підтверджуємо ТИМ ключем, яким підтверджують ───────────────────────────
//
// На одну ревізію припадає два ідентифікатори, і вони не взаємозамінні:
// дедуплікація стоїть на одному (`remoteRevisionId`), підтвердження — на
// іншому (`ackToken`), бо в менеджера каналів це різні поля і саме друге
// стоїть у шляху запиту. Тому в приладі вони НАВМИСНО різні: збіг сховав би
// підміну, а ціна підміни — 404 на кожне підтвердження, ревізія назавжди в
// стрічці й лист готелю кожні 30 хвилин.
{
  const { log, deps } = harness([entry({ remoteRevisionId: 'sys-9', ackToken: 'ack-9' })]);
  await pullBookings('conn-1', deps);
  assert.ok(log.includes('ack:ack-9'),
    'підтвердили не тим ключем — запит піде в нікуди, ревізія лишиться в стрічці назавжди');
  assert.ok(!log.includes('ack:sys-9'), 'у підтвердження пішов ключ дедуплікації');
  console.log('  ok  підтвердження йде ключем підтвердження, а не ключем дедуплікації');
}

// ─── Транзакція впала — не підтверджуємо ────────────────────────────────────
{
  const { log, deps } = harness([entry()], {
    tx: async () => { throw new Error('база впала'); },
  });
  const report = await pullBookings('conn-1', deps);
  assert.ok(!log.some(l => l.startsWith('ack:')),
    'підтвердили те, чого не зберегли — ревізію більше ніхто не покаже');
  assert.strictEqual(report.applied, 0);
  assert.strictEqual(report.skipped.length, 1);
  assert.ok(report.skipped[0].reason.startsWith('apply_failed:'),
    'причина відмови не названа');
  console.log('  ok  падіння транзакції не підтверджується');
}

// ─── Відмова застосування — теж не підтверджуємо ────────────────────────────
{
  const { log, deps } = harness([entry()], {
    apply: async () => ({ result: 'refused', reason: 'connection_not_found' }),
  });
  const report = await pullBookings('conn-1', deps);
  assert.ok(!log.some(l => l.startsWith('ack:')), 'підтвердили відмовлену ревізію');
  assert.strictEqual(report.skipped[0].reason, 'connection_not_found');
  console.log('  ok  відмова застосування не підтверджується');
}

// ─── Повтор доставки підтверджується ────────────────────────────────────────
//
// Для менеджера каналів ревізія лишається непідтвердженою, доки ми не скажемо
// інакше. Те, що ми її вже бачили, — наша внутрішня справа: не підтвердити
// означає отримувати її щохвилини вічно.
{
  const { log, deps } = harness([entry()], {
    apply: async () => ({ result: 'duplicate', reservationId: 'res-1' }),
  });
  const report = await pullBookings('conn-1', deps);
  assert.ok(log.includes('ack:ack-1'),
    'дубль не підтверджено — стрічка віддаватиме його вічно');
  assert.strictEqual(report.duplicates, 1);
  assert.strictEqual(report.applied, 0);
  console.log('  ok  повторна доставка підтверджується, а не крутиться вічно');
}

// ─── Порядок стрічки зберігається ───────────────────────────────────────────
//
// Дві ревізії одного бронювання, застосовані навпаки, дадуть скасовану бронь
// як активну. Саме тому стрічку просять із `order[inserted_at]=asc`, і саме
// тому цикл нічого не переставляє.
{
  const feed = [
    entry({ remoteRevisionId: 'sys-1', status: 'new' }),
    entry({ remoteRevisionId: 'sys-2', status: 'modified' }),
    entry({ remoteRevisionId: 'sys-3', status: 'cancelled', rooms: [] }),
  ];
  const { log, deps } = harness(feed);
  await pullBookings('conn-1', deps);
  assert.deepStrictEqual(
    log.filter(l => l.startsWith('apply:')),
    ['apply:sys-1', 'apply:sys-2', 'apply:sys-3'],
    'порядок ревізій переставлено — скасована бронь стала б активною');
  console.log('  ok  порядок стрічки зберігається як є');
}

// ─── Спіткнулись на бронюванні — наступні ЙОГО ревізії пропускаємо ──────────
//
// Але лише його: інші бронювання не мають страждати від однієї поганої.
{
  const feed = [
    entry({ remoteRevisionId: 'a1', remoteBookingId: 'X', status: 'new' }),
    entry({ remoteRevisionId: 'a2', remoteBookingId: 'X', status: 'modified' }),
    entry({ remoteRevisionId: 'b1', remoteBookingId: 'Y', status: 'new' }),
  ];
  const { log, deps } = harness(feed, {
    apply: async (_t, _c, r) => {
      log.push(`apply:${r.remoteRevisionId}`);
      if (r.remoteRevisionId === 'a1') return { result: 'refused', reason: 'bad' };
      return { result: 'applied', reservationId: 'res', created: true };
    },
  });
  const report = await pullBookings('conn-1', deps);
  assert.ok(!log.includes('apply:a2'),
    'зміну застосували після невдалого створення — це зміна того, чого немає');
  assert.ok(log.includes('apply:b1'),
    'одна погана бронь заглушила ІНШУ — так губиться половина стрічки');
  assert.strictEqual(report.applied, 1);
  assert.deepStrictEqual(
    report.skipped.map(s => s.reason).sort(),
    ['bad', 'earlier_revision_failed']);
  console.log('  ok  падіння тримається в межах свого бронювання');
}

// ─── Кілька кімнат: не застосовуємо і НЕ підтверджуємо ──────────────────────
//
// Одне бронювання каналу з двома кімнатами — це дві наші броні, і ми ще не
// вміємо їх заводити. Мовчки взяти першу означало б гостя, який приїде в
// готель, що про нього не знає. Не підтверджуємо навмисно: ревізія лишиться
// в стрічці, і через 30 хвилин про неї нагадають листом — це правильний тиск.
{
  const { log, deps } = harness([entry({
    rooms: [room(), room({ adults: 1, amount: 150 })],
  })]);
  const report = await pullBookings('conn-1', deps);
  assert.ok(!log.some(l => l.startsWith('apply:')), 'бронь на дві кімнати застосовано наполовину');
  assert.ok(!log.some(l => l.startsWith('ack:')),
    'бронь на дві кімнати підтверджено — вона зникла б зі стрічки нерозібраною');
  assert.strictEqual(report.skipped[0].reason, 'multi_room_not_supported');
  console.log('  ok  бронь на кілька кімнат не застосовується й не підтверджується');
}

// ─── Зіпсована ревізія не глушить стрічку ───────────────────────────────────
//
// Адаптер не кидає виняток на кривому повідомленні — він віддає названу
// відмову. Виняток посеред циклу сховав би всі наступні броні.
{
  const feed: FeedEntry[] = [
    { ok: false, reason: 'missing_system_id' },
    entry({ remoteRevisionId: 'good', remoteBookingId: 'Z' }),
  ];
  const { log, deps } = harness(feed);
  const report = await pullBookings('conn-1', deps);
  assert.ok(log.includes('apply:good'),
    'крива ревізія сховала наступні броні');
  assert.strictEqual(report.seen, 2);
  assert.strictEqual(report.applied, 1);
  assert.strictEqual(report.skipped[0].reason, 'missing_system_id');
  console.log('  ok  зіпсована ревізія пропускається, решта стрічки обробляється');
}

// ─── Невдале підтвердження — це повтор, а не втрата ─────────────────────────
{
  const { deps } = harness([entry()], {
    ack: async () => { throw new Error('мережа'); },
  });
  const report = await pullBookings('conn-1', deps);
  assert.strictEqual(report.applied, 1, 'бронь мала лишитись застосованою');
  assert.strictEqual(report.acked, 0);
  assert.ok(report.skipped[0].reason.startsWith('ack_failed:'),
    'невдале підтвердження не назване — його ніхто не побачить у журналі');
  console.log('  ok  невдале підтвердження лишає бронь на місці й називає себе');
}

// ─── Порожня стрічка ────────────────────────────────────────────────────────
{
  const { deps } = harness([]);
  const report = await pullBookings('conn-1', deps);
  assert.deepStrictEqual(report, { seen: 0, applied: 0, duplicates: 0, skipped: [], acked: 0 });
  console.log('  ok  порожня стрічка — порожній звіт, без винятків');
}

console.log('pull: ack після коміту, порядок збережено, погана ревізія не глушить решту');
