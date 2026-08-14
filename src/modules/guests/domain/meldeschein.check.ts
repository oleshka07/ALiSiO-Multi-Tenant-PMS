/**
 * Коли Meldeschein потрібен, а коли його не має бути.
 *
 *   node src/modules/guests/domain/meldeschein.check.ts
 *
 * Найважливіше твердження тут — те, що бланк НЕ друкується. З 01.01.2025
 * німецький гість у німецькому готелі не реєструється взагалі, і бланк,
 * надрукований йому, це папір, який закон скасував.
 */
import assert from 'node:assert';
import {
  meldescheinNeeded, missingFields, retentionWindow, MELDESCHEIN_FIELDS,
  type MeldescheinData,
} from './meldeschein.ts';

// ─── Німецький готель ───────────────────────────────────────────────────────
assert.deepStrictEqual(
  meldescheinNeeded({ propertyCountry: 'DE', guestNationality: 'DE' }),
  { required: false, reason: 'german_national' },
  'a German guest in a German hotel no longer registers',
);
assert.deepStrictEqual(
  meldescheinNeeded({ propertyCountry: 'DE', guestNationality: 'UA' }),
  { required: true, reason: 'foreign_national' },
  'a foreign guest still does',
);
console.log('  ok  німець у німецькому готелі бланк НЕ заповнює, іноземець — заповнює');

// Написання країни — не бізнес-рішення.
for (const spelling of ['de', ' De ', 'DE']) {
  assert.strictEqual(
    meldescheinNeeded({ propertyCountry: 'DE', guestNationality: spelling }).required,
    false, `"${spelling}" is the same nationality`,
  );
}
console.log('  ok  de / De / " DE " — одне громадянство, а не три');

// ─── Невідоме громадянство — це прогалина, а не «німець» ───────────────────
//
// Мовчазне припущення «якщо не сказано, то німець» прибрало б з обліку саме
// того гостя, заради якого правило й існує.
for (const unknown of [null, undefined, '']) {
  assert.deepStrictEqual(
    meldescheinNeeded({ propertyCountry: 'DE', guestNationality: unknown }),
    { required: true, reason: 'nationality_unknown' },
    'unknown nationality is a gap, not an exemption',
  );
}
console.log('  ok  громадянство не вказане — бланк потрібен, а не пропущений');

// ─── Інша країна — інші правила, і вони не наші ─────────────────────────────
assert.deepStrictEqual(
  meldescheinNeeded({ propertyCountry: 'CZ', guestNationality: 'UA' }),
  { required: false, reason: 'not_germany' },
  'a Czech property keeps its own Evidenční kniha',
);
assert.strictEqual(
  meldescheinNeeded({ propertyCountry: null, guestNationality: 'UA' }).required,
  false, 'a property with no country is not silently German',
);
console.log('  ok  чеський обʼєкт німецького бланка не друкує');

// ─── Обовʼязкові поля § 30 ──────────────────────────────────────────────────
const FULL: MeldescheinData = {
  arrival: '2026-08-04', departure: '2026-08-06',
  last_name: 'Schneider', first_name: 'Maria',
  date_of_birth: '1985-03-11', nationality: 'UA',
  address: 'Musterweg 7, 10115 Berlin',
  companions: 1, document_number: 'FA1234567',
};
assert.deepStrictEqual(missingFields(FULL), [], 'a complete form');

assert.deepStrictEqual(
  missingFields({ ...FULL, document_number: null }),
  ['document_number'],
  'the passport number is mandatory for the people who still register',
);
assert.deepStrictEqual(
  missingFields({ ...FULL, date_of_birth: null, address: '' }),
  ['date_of_birth', 'address'],
  'each gap is named, not counted',
);
console.log('  ok  кожне пропущене поле § 30 називається поіменно');

// Нуль супутників — це відповідь, а не порожнеча.
assert.deepStrictEqual(missingFields({ ...FULL, companions: 0 }), [], 'zero companions is an answer');
console.log('  ok  нуль супутників — відповідь, а не прогалина');

// Бланк несе рівно перелік закону і нічого більше.
assert.strictEqual(MELDESCHEIN_FIELDS.length, 9, 'the list is the law\'s, not ours');
assert.ok(!MELDESCHEIN_FIELDS.includes('email' as never), 'a Meldeschein is not a mailing list');
console.log('  ok  на бланку лише обовʼязкові поля — ні email, ні номера авто');

// ─── Строк зберігання ───────────────────────────────────────────────────────
//
// Рік від дня ВИЇЗДУ, знищити протягом трьох місяців після цього.
const w = retentionWindow('2026-08-06');
assert.strictEqual(w.keepUntil, '2027-08-06', 'kept a year from departure');
assert.strictEqual(w.destroyBy, '2027-11-06', 'and destroyed within three months after');

// Кінець місяця не має перестрибувати на наступний.
assert.strictEqual(retentionWindow('2026-08-31').keepUntil, '2027-08-31', 'a 31-day month to itself');
assert.strictEqual(retentionWindow('2027-11-30').destroyBy, '2029-02-28', '30 Nov + 15 міс = 28 лютого, не 2 березня');
assert.strictEqual(retentionWindow('2028-02-29').keepUntil, '2029-02-28', 'a leap day keeps to February');
console.log('  ok  рік від виїзду і три місяці на знищення, без перестрибування місяця');

console.log('meldeschein: з 2025 німець бланка не заповнює — і це головне твердження');
