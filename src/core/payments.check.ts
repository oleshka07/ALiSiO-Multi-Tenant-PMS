/**
 * Saving an API key is not the same as being able to charge a card.
 *
 *   node src/core/payments.check.ts
 *
 * The product shipped for months telling hotels it took payments. The widget
 * offered «Teya Payment Gateway · Visa · Mastercard · Apple Pay», the sites
 * screen promised «Stripe та PayPal з коробки», and the gateway behind all of
 * it had been deleted. Nobody lied on purpose: the sentences outlived the code
 * they described, which is what sentences do when nothing checks them.
 *
 * So the claim is now a function, and this is what pins it. `live` is the only
 * thing that may turn «оплата» on, and it is false everywhere. The day a real
 * gateway ships, its author flips one flag and these assertions turn into the
 * description of a product that can actually be paid.
 */
import assert from 'node:assert';
import {
  PAYMENT_PROVIDERS,
  PAYMENT_CHANNELS,
  isPaymentChannel,
  paymentProvider,
  anyGatewayImplemented,
} from './payments.ts';
import { INTEGRATION_FIELDS, INTEGRATION_FEATURE } from './integration-credentials.ts';
import { FEATURES } from './features.ts';

// ── Every provider is honest about itself ────────────────────────────
for (const p of PAYMENT_PROVIDERS) {
  assert.ok(p.id && p.label, 'a provider with no id or label cannot be chosen');
  assert.ok(p.note && p.where, `${p.id}: an owner picking a gateway needs to know what it is and where its keys live`);
}
assert.ok(PAYMENT_PROVIDERS.length >= 3, 'the choice is the point — one provider is not a choice');
console.log('  ok  кожен шлюз описаний: що це і де взяти ключі');

// ── The rule that must not bend ──────────────────────────────────────
//
// If this assertion ever fails, read it as the alarm it is: something set
// `live: true` on a gateway. That is allowed ONLY together with the module
// that actually charges the card, and with this file rewritten to say so.
for (const p of PAYMENT_PROVIDERS) {
  assert.strictEqual(p.live, false,
    `${p.id} claims to be live. A widget will start showing «Оплатити» to guests — is there a gateway behind it?`);
}
assert.strictEqual(anyGatewayImplemented(), false,
  'anyGatewayImplemented() disagrees with the providers it reads');
console.log('  ok  жоден шлюз не оголошує себе робочим (сьогодні їх немає)');

// ── The registry and the storage agree ───────────────────────────────
//
// A provider with no fields in INTEGRATION_FIELDS renders an empty card and
// silently saves nothing: saveIntegrationCredentials() filters by that list,
// so an unlisted field is dropped without a word.
for (const p of PAYMENT_PROVIDERS) {
  const fields = INTEGRATION_FIELDS[p.id];
  assert.ok(fields?.length,
    `${p.id} has no fields — its card would offer nothing to fill in, or fill in nothing`);
  for (const f of fields) {
    assert.ok(f.field && f.label, `${p.id}: a field with no label is a box nobody can answer`);
  }
}
console.log('  ok  у кожного шлюзу є поля ключів, які справді зберігаються');

// ── One switch governs them all ──────────────────────────────────────
for (const p of PAYMENT_PROVIDERS) {
  assert.strictEqual(INTEGRATION_FEATURE[p.id], 'online_payments',
    `${p.id} is not behind the online_payments switch — a gateway nobody bought would appear on the screen`);
}
assert.ok('online_payments' in FEATURES,
  'the switch every gateway hangs off is not in the feature catalogue');
console.log('  ok  усі шлюзи за одним вимикачем, і він існує');

// ── Which channels count as payment ──────────────────────────────────
//
// The integrations screen filters payment channels out by this predicate. A
// provider it does not recognise appears on BOTH screens, giving an owner two
// boxes for one key and no way to tell which one the product reads.
for (const p of PAYMENT_PROVIDERS) {
  assert.ok(isPaymentChannel(p.id), `${p.id} is not recognised as a payment channel`);
  assert.strictEqual(paymentProvider(p.id)?.label, p.label);
}
assert.strictEqual(isPaymentChannel('fiskaly'), false, 'the TSE key is not a payment gateway');
assert.strictEqual(paymentProvider('nope'), undefined);
assert.deepStrictEqual([...PAYMENT_CHANNELS], PAYMENT_PROVIDERS.map((p) => p.id));
console.log('  ok  платіжні канали відрізняються від решти інтеграцій');

// ── The union type names every provider ──────────────────────────────
//
// IntegrationChannel is spelled out by hand — payments.ts imports that module,
// so deriving it there would be a cycle. This is the thing that keeps the two
// in step: a provider the union does not name fails to typecheck at every call
// site, which is a confusing way to find out.
const source = (await import('node:fs')).readFileSync(
  new URL('./integration-credentials.ts', import.meta.url), 'utf8');
const union = source.match(/export type IntegrationChannel = ([^;]+);/);
assert.ok(union, 'IntegrationChannel is no longer declared where this check looks');
for (const p of PAYMENT_PROVIDERS) {
  assert.ok(union[1].includes(`'${p.id}'`),
    `IntegrationChannel does not name '${p.id}' — add it there when adding a provider here`);
}
console.log('  ok  тип каналів знає кожен шлюз зі списку');

console.log('платежі: ключі зберігаються, оплата вмикається окремо');
