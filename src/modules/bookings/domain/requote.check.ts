/**
 * «Перерахувати ціну за новою заселеністю»: різниця до/після — з КВОТИ.
 *
 *   node src/modules/bookings/domain/requote.check.ts
 *
 * Вісь — ночі (інваріант 26): три ночі з РІЗНИМИ цінами, щоб «сума ночей»,
 * «перша ніч × ночей» і «стара сума + надбавка за ніч» давали три різні
 * числа. Інваріант 17: квота з непокритою ніччю не дає числа взагалі.
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';

const { requoteDelta } = await import('./requote.ts');

// Бронь на 2 дорослих коштувала 3000 за три ночі. Квота на 3 дорослих —
// три ночі по 1200, 1300, 1400 (сезон зростає до вихідних).
const quote = {
  total: 3900,
  currency: 'CZK',
  missingDays: 0,
  breakdown: [
    { date: '2026-10-09', price: 1200 },
    { date: '2026-10-10', price: 1300 },
    { date: '2026-10-11', price: 1400 },
  ],
};

const d = requoteDelta({ currentTotal: 3000, currency: 'CZK' }, quote);
assert.strictEqual(d.reason, 'priced');
assert.strictEqual(d.before, 3000);
assert.strictEqual(d.after, 3900, 'нова сума — total квоти, тобто сума трьох різних ночей');
assert.strictEqual(d.delta, 900);
// Альтернативні прочитання, які мусять НЕ збігатись із 3900:
assert.notStrictEqual(1200 * 3, d.after, 'не «перша ніч × ночей»');
assert.notStrictEqual(3000 + 300, d.after, 'не «стара сума + одна надбавка»');
console.log('  ok  різниця рахується від total квоти, три ночі різних цін');

// Квота, чий total не дорівнює сумі ночей, — зламана квота, а не ціна.
const broken = { ...quote, total: 3600 };
assert.strictEqual(requoteDelta({ currentTotal: 3000, currency: 'CZK' }, broken).reason, 'failed',
  'total ≠ сума ночей — відмова, а не число навмання');
console.log('  ok  квота, що суперечить власним ночам, відкидається');

// Непокрита ніч — ціни немає (інваріант 17).
const missing = { ...quote, missingDays: 1, breakdown: quote.breakdown.slice(0, 2), total: 2500 };
const m = requoteDelta({ currentTotal: 3000, currency: 'CZK' }, missing);
assert.strictEqual(m.reason, 'missing');
assert.strictEqual(m.after, null);
console.log('  ok  ніч без ціни — числа немає');

// Чужа валюта — не збіг (те саме правило, що в readQuote).
assert.strictEqual(requoteDelta({ currentTotal: 3000, currency: 'EUR' }, quote).reason, 'failed');
// Квота БЕЗ валюти для броні З валютою — теж не збіг.
assert.strictEqual(requoteDelta({ currentTotal: 3000, currency: 'CZK' }, { ...quote, currency: undefined }).reason, 'failed');
console.log('  ok  валюта квоти мусить збігтись із валютою броні');

// Та сама сума — різниці немає, але число є: кнопка каже «без змін», не «помилка».
const same = requoteDelta({ currentTotal: 3900, currency: 'CZK' }, quote);
assert.strictEqual(same.reason, 'priced');
assert.strictEqual(same.delta, 0);
console.log('  ok  однакова сума — нуль різниці, не відмова');

// Копійки: 1000.1 + 1000.2 + 1000.3 у double не 3000.6 — а тут мусить.
const cents = {
  total: 3000.6, currency: 'CZK', missingDays: 0,
  breakdown: [{ date: 'a', price: 1000.1 }, { date: 'b', price: 1000.2 }, { date: 'c', price: 1000.3 }],
};
assert.strictEqual(requoteDelta({ currentTotal: 3000, currency: 'CZK' }, cents).after, 3000.6);
console.log('  ok  копійки звіряються після округлення');

// ── перерахунок лише для своїх броней (рецензія 07.09 п.2) ────────────────
const { isChannelBooking } = await import('./requote.ts');
assert.strictEqual(isChannelBooking({ source: 'direct' }), false, 'пряма — своя ціна');
assert.strictEqual(isChannelBooking({ source: 'phone' }), false, 'телефон — своя ціна');
assert.strictEqual(isChannelBooking({ source: 'booking_com' }), true, 'OTA за кодом джерела');
assert.strictEqual(isChannelBooking({ source: 'direct', hostex_channel_type: 'airbnb' }), true, 'канал за кодом ревізії, попри джерело');
assert.strictEqual(isChannelBooking({ source: 'direct', external_uid: 'BDC-1' }), true, 'зовнішній ідентифікатор — канал');
assert.strictEqual(isChannelBooking({}), false, 'без ознак — своя');
console.log('  ok  бронь із каналу впізнається за ревізією, зовнішнім id або джерелом-OTA');

console.log('requote: різниця до/після — з квоти, три ночі різних цін, непокрита ніч не має ціни; канал не переквотується');
