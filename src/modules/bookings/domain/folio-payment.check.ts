/**
 * Оплата з фоліо: один документ, і бронь закривається лише разом із проживанням.
 *
 *   node src/modules/bookings/domain/folio-payment.check.ts
 *
 * Рецензія 07.09 п.1 (червоним до коду): PATCH `paid` з фоліо виписував
 * другий документ; оплата за воду до нарахування закривала бронь як `paid`.
 * Осі: спосіб оплати (готівка через фоліо / фоліо / ручний cash / без
 * способу), склад фоліо (з проживанням / без), залишок (0 / борг).
 */
import assert from 'node:assert';
import { legacyInvoiceWanted, folioSettlesStay } from './folio-payment.ts';

// ── legacy-документ ────────────────────────────────────────────────────────
assert.strictEqual(legacyInvoiceWanted({ payment_status: 'paid', payment_method: 'folio' }), false, 'оплата з фоліо — документ виставляє фоліо');
assert.strictEqual(legacyInvoiceWanted({ payment_status: 'paid', payment_method: 'folio_cash' }), false, 'готівка через фоліо — те саме');
assert.strictEqual(legacyInvoiceWanted({ payment_status: 'paid', payment_method: 'cash' }), true, 'ручна готівка без фоліо — старий шлях лишається');
assert.strictEqual(legacyInvoiceWanted({ payment_status: 'paid' }), true, 'ручне «оплачено» без способу — старий шлях');
assert.strictEqual(legacyInvoiceWanted({ payment_status: 'prepaid', payment_method: 'cash' }), false, 'не paid — нічого не виписується');
assert.strictEqual(legacyInvoiceWanted({ payment_method: 'folio' }), false);
console.log('  ok  legacy-документ не виписується на оплату з фоліо; ручне «оплачено» — як було');

// ── закриття броні з фоліо ─────────────────────────────────────────────────
const lodging = { kind: 'lodging' };
const water = { kind: 'service' };
assert.strictEqual(folioSettlesStay({ totals: { charged: 3600, balance: 0 }, folios: [{ items: [lodging, water] }] }), true, 'проживання нараховано, борг нуль — закриває');
assert.strictEqual(folioSettlesStay({ totals: { charged: 3600, balance: -100 }, folios: [{ items: [lodging] }] }), true, 'переплата — теж закриває');
assert.strictEqual(folioSettlesStay({ totals: { charged: 45, balance: 0 }, folios: [{ items: [water] }] }), false, 'лише вода, без проживання — НЕ закриває');
assert.strictEqual(folioSettlesStay({ totals: { charged: 3600, balance: 1200 }, folios: [{ items: [lodging] }] }), false, 'борг — не закриває');
assert.strictEqual(folioSettlesStay({ totals: { charged: 0, balance: 0 }, folios: [] }), false, 'порожнє фоліо — не закриває');
assert.strictEqual(folioSettlesStay({ totals: { charged: 3600, balance: 0 }, folios: [{ items: [water] }, { items: [lodging] }] }), true, 'проживання на другому платнику — рахується');
assert.strictEqual(folioSettlesStay(null), false);
console.log('  ok  бронь закривається лише з нарахованим проживанням і нульовим боргом');

console.log('folio-payment: оплата з фоліо — один документ; бронь закриває лише проживання без боргу');
