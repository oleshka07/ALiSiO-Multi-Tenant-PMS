#!/usr/bin/env node
/**
 * Межі слова в списку чутливих імен.
 *
 * Ця перевірка існує тому, що список уже помилявся: `tel` збігався всередині
 * `hotel_name`, `lat` — усередині `template`, `pan` — усередині `panel`.
 * Помилка тиха з обох боків. Занадто широкий список вирізає з дослідження
 * назви й шаблони, тобто рівно те, заради чого воно ведеться; занадто
 * вузький — тягне в репозиторій чужі персональні дані.
 *
 *   node scripts/lib/sensitive-names.check.mjs
 */

import { SENSITIVE } from './sensitive-names.mjs';

const MUST = [
  'email',
  'user_email',
  'billing_address',
  'phone',
  'telephone',
  'tel',
  'tel_number',
  'pan',
  'pan_id',
  'ico',
  'dic',
  'dob',
  'ssn',
  'cvv',
  'iban',
  'bic',
  'zip',
  'zipcode',
  'card_number',
  'cardholder',
  'credit_card',
  'lat',
  'lng',
  'latitude',
  'password',
  'api_key',
  'access_token',
  'guest_name',
  'firstname',
  'note',
  'passport_number',
];

const MUST_NOT = [
  'hotel_name',
  'hotel_id',
  'hotels',
  'template_id',
  'templates',
  'panel_layout',
  'expand',
  'japan',
  'icon_url',
  'unicode',
  'predicate',
  'dictionary',
  'indicator',
  'translate',
  'related_id',
  'calculated_total',
  'public',
  'status',
  'currency',
  'vat_rate',
  'timezone',
  'category',
  'discard_reason',
  'wildcard',
  'unzip',
];

let failed = 0;

console.log('═'.repeat(78));
console.log('МЕЖІ СЛОВА В СПИСКУ ЧУТЛИВИХ ІМЕН — має бути нуль розбіжностей');
console.log('═'.repeat(78));
console.log('');

for (const name of MUST) {
  if (!SENSITIVE.test(name)) {
    console.log(`  ✗ мало бути чутливим, але не збіглося: ${name}`);
    failed += 1;
  }
}

for (const name of MUST_NOT) {
  if (SENSITIVE.test(name)) {
    console.log(`  ✗ НЕ мало бути чутливим, але збіглося: ${name}`);
    failed += 1;
  }
}

if (failed === 0) {
  console.log(`  чисто — ${MUST.length} чутливих і ${MUST_NOT.length} звичайних імен розрізнено правильно`);
  console.log('');
  process.exit(0);
}

console.log('');
console.log(`  розбіжностей: ${failed}`);
console.log('');
process.exit(1);
