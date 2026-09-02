/**
 * Звірка П6 — чисте порівняння очікуваного з прочитаним.
 *
 *   node src/modules/channels/domain/verify.check.ts
 *
 * Три відповіді, і кожна має бути видима окремо: збіг, розбіжність (назад у
 * чергу з причиною), не звірено (той бік не віддав — ні збіг, ні розбіжність).
 * Фікстура тримає по два значення на кожній осі, про яку стверджує
 * (інваріант 26): ціна рівна і різна, наявність рівна і різна, ніч є і ніч
 * відсутня, поле є і поля немає, одна заселеність і дві на одній парі.
 *
 * Перевірка була ЧЕРВОНОЮ — зламом `coordinatesToRequeue` (без злиття по
 * парі: дві заселеності давали дві координати) і зламом порівняння «закрито»
 * (порівнювалось лише при ціні). Інваріант 24.
 */
import assert from 'node:assert';
import { verifyNights, coordinatesToRequeue, type ExpectedNight, type RemoteNight } from './verify.ts';

const night = (over: Partial<ExpectedNight>): ExpectedNight => ({
  kind: 'rate', unitTypeId: 'DBL', ratePlanId: 'BAR', occupancy: 2, date: '2027-05-10', ...over,
});

// ── 1. Ціна: рівна — збіг, різна — розбіжність з обома числами ────────────
{
  const expected = [
    night({ date: '2027-05-10', rateMinor: 150000, closed: false }),
    night({ date: '2027-05-11', rateMinor: 150000, closed: false }),
  ];
  const remote: Record<string, RemoteNight> = {
    '2027-05-10': { rateMinor: 150000, closed: false },
    '2027-05-11': { rateMinor: 165000, closed: false },
  };
  const r = verifyNights(expected, (e) => remote[e.date] ?? null);
  assert.strictEqual(r.checked, 4, 'дві ночі × (ціна, закрито)');
  assert.strictEqual(r.matched, 3);
  assert.deepStrictEqual(r.mismatches.map((m) => [m.date, m.field, m.ours, m.theirs]), [['2027-05-11', 'rate', '150000', '165000']],
    'розбіжність називає дату, поле і ОБИДВА числа — інакше оператор не знає, кому вірити');
  assert.deepStrictEqual(r.unverified, []);
  console.log('  ok  ціна рівна — збіг, різна — розбіжність з обома числами');
}

// ── 2. «Закрито» стверджується завжди, ціна — лише коли ми її називали ────
{
  const closedNight = night({ rateMinor: null, closed: true });
  const open = verifyNights([closedNight], () => ({ rateMinor: 165000, closed: false }));
  assert.strictEqual(open.checked, 1, 'ціни ми не називали — вона не порівнюється; «закрито» — порівнюється');
  assert.deepStrictEqual(open.mismatches.map((m) => m.field), ['closed'], 'той бік продає ніч, яку ми закрили');
  const shut = verifyNights([closedNight], () => ({ rateMinor: 165000, closed: true }));
  assert.strictEqual(shut.matched, 1);
  assert.deepStrictEqual(shut.mismatches, [], 'закрито там, де ми закрили, — збіг, хоч ціна там і лежить (липкий прапорець, И14)');
  console.log('  ok  «закрито» стверджується завжди, ціна — лише названа');
}

// ── 3. Наявність: рівна і різна ───────────────────────────────────────────
{
  const expected = [
    { kind: 'availability' as const, unitTypeId: 'DBL', date: '2027-05-10', free: 3 },
    { kind: 'availability' as const, unitTypeId: 'DBL', date: '2027-05-11', free: 3 },
  ];
  const remote: Record<string, RemoteNight> = { '2027-05-10': { free: 3 }, '2027-05-11': { free: 2 } };
  const r = verifyNights(expected, (e) => remote[e.date] ?? null);
  assert.strictEqual(r.matched, 1);
  assert.deepStrictEqual(r.mismatches.map((m) => [m.kind, m.date, m.field, m.ours, m.theirs]), [['availability', '2027-05-11', 'free', '3', '2']]);
  console.log('  ok  наявність рівна — збіг, різна — розбіжність');
}

// ── 4. Ночі немає на тому боці — «не звірено», і НЕ назад у чергу ──────────
{
  const r = verifyNights([night({ rateMinor: 150000 }), night({ date: '2027-05-11', rateMinor: 150000 })],
    (e) => (e.date === '2027-05-10' ? { rateMinor: 150000, closed: false } : null));
  assert.strictEqual(r.matched, 2);
  assert.deepStrictEqual(r.unverified, [{ field: 'night', count: 1 }], 'відсутня ніч названа як не звірена');
  assert.deepStrictEqual(r.mismatches.map((m) => m.field), ['night'], 'і видима оператору');
  assert.deepStrictEqual(coordinatesToRequeue(r.mismatches), [], 'пересилання ніч не створить — вічне коло створить');
  console.log('  ok  відсутня ніч — не звірено, видима, не повертається');
}

// ── 5. Поле, якого той бік не віддав, — не звірено; віддав інше — розбіжність ─
{
  const withMin = night({ rateMinor: 150000, closed: false, minStay: 2 });
  const silent = verifyNights([withMin], () => ({ rateMinor: 150000, closed: false }));
  assert.deepStrictEqual(silent.unverified, [{ field: 'minStay', count: 1 }], 'мовчання того боку — не збіг і не розбіжність');
  assert.deepStrictEqual(silent.mismatches, []);
  const other = verifyNights([withMin], () => ({ rateMinor: 150000, closed: false, minStay: 1 }));
  assert.deepStrictEqual(other.mismatches.map((m) => [m.field, m.ours, m.theirs]), [['minStay', '2', '1']]);
  // Поле, якого МИ не називали, не порівнюється — ніч без обмежень нічого про них не каже.
  const unnamed = verifyNights([night({ rateMinor: 150000, closed: false })], () => ({ rateMinor: 150000, closed: false, maxStay: 7 }));
  assert.strictEqual(unnamed.checked, 2, 'лише ціна і «закрито»; чужий maxStay не рахується');
  assert.deepStrictEqual(unnamed.mismatches, []);
  console.log('  ok  поле не віддане — не звірено; віддане інше — розбіжність; неназване — не порівнюється');
}

// ── 6. Назад у чергу — координатами пари × дата, не значеннями ─────────────
{
  const expected = [
    night({ occupancy: 1, rateMinor: 120000, closed: false }),
    night({ occupancy: 2, rateMinor: 150000, closed: false }),
    night({ occupancy: 2, date: '2027-05-11', rateMinor: 150000, closed: false }),
    { kind: 'availability' as const, unitTypeId: 'DBL', date: '2027-05-10', free: 3 },
  ];
  const r = verifyNights(expected, (e) => (e.kind === 'availability' ? { free: 2 } : { rateMinor: 999900, closed: false }));
  assert.strictEqual(r.mismatches.length, 4, 'три ціни і одна наявність розійшлись');
  const back = coordinatesToRequeue(r.mismatches);
  assert.deepStrictEqual(back.map((c) => [c.kind, c.ratePlanId ?? '', c.date]).sort(), [
    ['availability', '', '2027-05-10'],
    ['rate', 'BAR', '2027-05-10'],
    ['rate', 'BAR', '2027-05-11'],
  ], 'дві заселеності однієї пари на одну дату — ОДНА координата (Ц10); інша дата — інша');
  const pair = back.find((c) => c.kind === 'rate' && c.date === '2027-05-10')!;
  assert.match(pair.reason, /^verify: rate@1 120000 ≠ 999900; rate@2 150000 ≠ 999900$/, 'причина називає обидві заселеності з обома числами');
  console.log('  ok  назад у чергу — одна координата на пару × дату, причина з числами');
}

console.log('verify: збіг, розбіжність назад у чергу з причиною, не звірене названо окремо');
