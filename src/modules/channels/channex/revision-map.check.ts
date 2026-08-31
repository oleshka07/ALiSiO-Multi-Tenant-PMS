/**
 * Ревізія Channex перекладається без вигадування.
 *
 *   node src/modules/channels/channex/revision-map.check.ts
 *
 * Мапер — єдине місце, де живуть імена вендора, і єдине, де їх легко
 * прочитати не так. Усі факти нижче виміряні на живому API і записані в
 * `docs/vendor/channex/INVENTORY.md` §5; тут вони стають виконуваними.
 *
 * Найдорожчі з них:
 *
 *   `system_id`, а не `id`, дедуплікує ревізію — вендор каже це прямо;
 *   `room_type_id: null` означає «не змаплено», і така бронь усе одно
 *     приймається, бо вона фізично існує;
 *   `days` і `amount` приходять РЯДКАМИ;
 *   кімнат може бути кілька, і друга не має зникати.
 */
import assert from 'node:assert';
import { mapRevision, type ChannexRevision } from './revision-map.ts';

const mapping = new Map([['remote-rt-1', 'ut_deluxe'], ['remote-rt-2', 'ut_standard']]);

const base = (over: Partial<ChannexRevision> = {}): ChannexRevision => ({
  id: 'rev-uuid',
  system_id: 'sys-1',
  booking_id: 'bkg-1',
  property_id: 'prop-remote',
  ota_reservation_code: 'BDC-777',
  ota_name: 'Booking.com',
  status: 'new',
  arrival_date: '2026-10-10',
  departure_date: '2026-10-12',
  amount: '300.00',
  currency: 'EUR',
  occupancy: { adults: 2, children: 0 },
  customer: { name: 'Klaus', surname: 'Weber', mail: 'klaus@example.invalid' },
  rooms: [{
    checkin_date: '2026-10-10',
    checkout_date: '2026-10-12',
    room_type_id: 'remote-rt-1',
    rate_plan_id: 'remote-rp-1',
    occupancy: { adults: 2, children: 0 },
    amount: '300.00',
  }],
  ...over,
});

// ─── Дедуплікує system_id ───────────────────────────────────────────────────
const ok = mapRevision(base(), mapping);
assert.ok(ok.ok, 'нормальна ревізія не змапилась');
assert.strictEqual(ok.revision.remoteRevisionId, 'sys-1',
  'ключем дедуплікації взято НЕ system_id — саме на ньому стоїть CP4');
assert.strictEqual(ok.revision.remoteBookingId, 'bkg-1');

// `id` теж унікальний на ревізію, тож помилку видно лише тут: обидва
// «працюють», але контракт вендора саме на system_id.
const swapped = mapRevision(base({ id: 'ІНШИЙ', system_id: 'sys-1' }), mapping);
assert.ok(swapped.ok && swapped.revision.remoteRevisionId === 'sys-1',
  'мапер узяв id замість system_id');
console.log('  ok  ключ дедуплікації — system_id, як вимагає вендор');

// ─── Гроші рядком ───────────────────────────────────────────────────────────
assert.strictEqual(ok.revision.totalAmount, 300, 'сума «300.00» приїхала рядком і не стала числом');
assert.strictEqual(ok.revision.rooms[0].amount, 300);
const numeric = mapRevision(base({ amount: 250 }), mapping);
assert.ok(numeric.ok && numeric.revision.totalAmount === 250, 'числова сума теж має читатись');
const junk = mapRevision(base({ amount: 'дорого' }), mapping);
assert.ok(junk.ok && junk.revision.totalAmount === 0,
  'нечислова сума мала стати нулем, а не NaN у базі');
console.log('  ok  сума читається і рядком, і числом, а сміття не стає NaN');

// ─── Мапінг типів ───────────────────────────────────────────────────────────
assert.strictEqual(ok.revision.rooms[0].unitTypeId, 'ut_deluxe', 'чужий тип не переклався в наш');
assert.strictEqual(ok.revision.unmapped, false);

// `room_type_id: null` — номер не змаплено. Бронь ПРИЙМАЄТЬСЯ: гість уже
// заплатив, вона фізично існує, і відкинути її означає створити овербукінг
// власноруч.
const unmapped = mapRevision(base({
  rooms: [{ ...base().rooms![0], room_type_id: null }],
}), mapping);
assert.ok(unmapped.ok, 'бронь без змапленого типу відкинуто — це овербукінг власноруч');
assert.strictEqual(unmapped.revision.rooms[0].unitTypeId, null);
assert.strictEqual(unmapped.revision.unmapped, true, 'ознака unmapped не виставлена');

// Тип, якого немає в дзеркалі мапінгу, — те саме: не вигадуємо збіг.
const stranger = mapRevision(base({
  rooms: [{ ...base().rooms![0], room_type_id: 'remote-rt-НЕВІДОМИЙ' }],
}), mapping);
assert.ok(stranger.ok && stranger.revision.rooms[0].unitTypeId === null,
  'незнайомий тип мапера підмінили чимось схожим');
assert.strictEqual(stranger.revision.unmapped, true);
console.log('  ok  незмаплений тип приймається як unmapped, а не вгадується й не відкидається');

// ─── Кімнат може бути кілька ────────────────────────────────────────────────
//
// Одна бронь Channex із двома rooms[] — це дві наші броні. Мовчки загублена
// друга кімната це гість, який приїде в готель, що про нього не знає.
const twoRooms = mapRevision(base({
  rooms: [
    { ...base().rooms![0], room_type_id: 'remote-rt-1', amount: '300.00' },
    { ...base().rooms![0], room_type_id: 'remote-rt-2', amount: '180.00',
      occupancy: { adults: 1, children: 1 } },
  ],
}), mapping);
assert.ok(twoRooms.ok);
assert.strictEqual(twoRooms.revision.rooms.length, 2, 'друга кімната зникла при мапінгу');
assert.deepStrictEqual(
  twoRooms.revision.rooms.map(r => [r.unitTypeId, r.amount, r.adults, r.children]),
  [['ut_deluxe', 300, 2, 0], ['ut_standard', 180, 1, 1]],
  'кімнати змапились не поіменно');
console.log('  ok  дві кімнати лишаються двома, з власними типами й сумами');

// ─── Дати: кімната має свої, і вони головніші ───────────────────────────────
const roomDates = mapRevision(base({
  arrival_date: '2026-10-10', departure_date: '2026-10-12',
  rooms: [{ ...base().rooms![0], checkin_date: '2026-10-11', checkout_date: '2026-10-13' }],
}), mapping);
assert.ok(roomDates.ok);
assert.strictEqual(roomDates.revision.rooms[0].checkIn, '2026-10-11',
  'дати кімнати мали виграти в дат броні');

// Кімната без власних дат бере дати броні — це нормальна форма, не помилка.
const inherited = mapRevision(base({
  rooms: [{ room_type_id: 'remote-rt-1', occupancy: { adults: 2 } }],
}), mapping);
assert.ok(inherited.ok && inherited.revision.rooms[0].checkIn === '2026-10-10',
  'кімната без дат мала успадкувати дати броні');
console.log('  ok  дати кімнати головніші за дати броні, а без них успадковуються');

// ─── Зіпсоване повідомлення відмовляє з назвою, а не падає ──────────────────
//
// Виняток посеред циклу лишив би решту стрічки необробленою — тобто одна
// крива ревізія сховала б усі наступні броні.
for (const [name, rev] of [
  ['без system_id', base({ system_id: undefined })],
  ['без booking_id', base({ booking_id: undefined })],
  ['чужий статус', base({ status: 'refunded' })],
] as const) {
  const r = mapRevision(rev, mapping);
  assert.strictEqual(r.ok, false, `${name}: мапер прийняв зіпсовану ревізію`);
  assert.ok(!r.ok && r.reason.length > 0, `${name}: відмова без причини`);
}
assert.strictEqual(
  (mapRevision(base({ status: 'refunded' }), mapping) as { reason: string }).reason,
  'unknown_status:refunded', 'причина відмови має називати, що саме не так');
console.log('  ok  зіпсована ревізія відмовляє з причиною, а не валить обробку стрічки');

// ─── Скасування приходить без кімнат — це нормально ─────────────────────────
const cancelled = mapRevision(base({ status: 'cancelled', rooms: [] }), mapping);
assert.ok(cancelled.ok, 'скасування без кімнат відкинуто');
assert.strictEqual(cancelled.revision.rooms.length, 0);
assert.strictEqual(cancelled.revision.unmapped, false,
  'порожній список кімнат не робить бронь незмапленою');
console.log('  ok  скасування без кімнат приймається');

// ─── Гість ──────────────────────────────────────────────────────────────────
assert.strictEqual(ok.revision.guestFirstName, 'Klaus');
assert.strictEqual(ok.revision.guestEmail, 'klaus@example.invalid');
// Поле пошти бачене під двома іменами.
const altMail = mapRevision(base({ customer: { name: 'A', surname: 'B', email: 'b@example.invalid' } }), mapping);
assert.ok(altMail.ok && altMail.revision.guestEmail === 'b@example.invalid',
  'пошта під іншим іменем поля загубилась');
console.log('  ok  гість читається, пошта під обома баченими іменами');

// Сира ревізія лишається цілою — вона доказ у суперечці.
assert.deepStrictEqual(ok.revision.raw, base(), 'сирий payload змінено дорогою');

console.log('revision-map: ревізія перекладається без вигадування');
