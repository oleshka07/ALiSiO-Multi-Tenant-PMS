/**
 * Setup progress: вісім кроків, і кожен «зроблено» лише з даних (MASTER-PLAN §1.4).
 *
 *   node src/modules/properties/domain/setup-progress.check.ts
 *
 * Стан не зберігається — виводиться зі зрізу бази (як майстер Channex, Ц18).
 * Тут перевіряється чиста функція: два зрізи на кожній осі (інваріант 26) —
 * порожній готель дає 0/8, повністю заведений 8/8, і кожен крок окремо
 * розрізняє «є» від «немає» так, що сусідні кроки не тягнуть один одного.
 *
 * Тимчасове правило для кроків 3 і 5 (до Блоку 2: сезонів ще немає) названо в
 * коді і перевіряється тут як таке: 365 днів цін без дір — «зроблено», 364 —
 * ні. Коли з'являться `seasons`, ця сцена міняється разом із правилом.
 *
 * Перевірка написана ДО коду і була червоною (модуля не існувало).
 */
import assert from 'node:assert';
import { setupProgress, type SetupSnapshot } from './setup-progress.ts';

const EMPTY: SetupSnapshot = {
  property: null,
  unitTypes: 0, units: 0,
  pricedDaysAhead: 0,
  ratePlans: 0,
  taxRates: 0, vatPayer: false, legalNameSet: false,
  activeReservations: 0,
  channelEnabled: false, siteActive: false,
};

const FULL: SetupSnapshot = {
  property: { country: 'CZ', checkInTime: '15:00', checkOutTime: '10:00', lodgingKind: 'hotel' },
  unitTypes: 3, units: 8,
  pricedDaysAhead: 365,
  ratePlans: 2,
  taxRates: 2, vatPayer: true, legalNameSet: true,
  activeReservations: 1,
  channelEnabled: true, siteActive: false,
};

// ── Дві крайності ───────────────────────────────────────────────────────
const none = setupProgress(EMPTY);
assert.strictEqual(none.total, 8);
assert.strictEqual(none.done, 0, `порожній готель мав дати 0/8, а не ${none.done}`);
assert.deepStrictEqual(none.steps.map((s) => s.key), ['property', 'rooms', 'seasons', 'ratePlans', 'prices', 'taxes', 'firstBooking', 'channelOrSite']);
const full = setupProgress(FULL);
assert.strictEqual(full.done, 8, `заведений готель мав дати 8/8, а не ${full.done}: ${full.steps.filter((s) => !s.done).map((s) => s.key)}`);
console.log('  ok  0/8 і 8/8 на двох крайніх зрізах');

// ── Крок за кроком: кожен розрізняє свою вісь і не тягне сусідів ────────
const only = (patch: Partial<SetupSnapshot>) => setupProgress({ ...EMPTY, ...patch });
const doneKeys = (s: ReturnType<typeof setupProgress>) => s.steps.filter((x) => x.done).map((x) => x.key);

// 1. Обʼєкт: країна, часи заїзду/виїзду і РІД ЖИТЛА — саме те, що дає
//    provision-org. Рід тут не четверта галочка: поки він не названий,
//    каталог у канал не їде взагалі, а рахунок вендора рахується не за тим.
assert.deepStrictEqual(doneKeys(only({ property: { country: 'UA', checkInTime: '14:00', checkOutTime: '12:00', lodgingKind: 'camping' } })), ['property']);
assert.deepStrictEqual(doneKeys(only({ property: { country: null, checkInTime: '14:00', checkOutTime: '12:00', lodgingKind: 'camping' } })), [], 'обʼєкт без країни — не зроблено');
assert.deepStrictEqual(doneKeys(only({ property: { country: 'UA', checkInTime: '14:00', checkOutTime: '12:00', lodgingKind: null } })), [], 'обʼєкт без роду житла — не зроблено (В1)');
// Вісь роду житла існує окремо від решти трьох полів: сцена вище і сцена
// нижче різняться РІВНО одним полем, і різними значеннями (§26). Порожній
// рядок — не рід: колонка його приймає, а `!!''` дало б «зроблено».
assert.deepStrictEqual(doneKeys(only({ property: { country: 'UA', checkInTime: '14:00', checkOutTime: '12:00', lodgingKind: '' } })), [], 'порожній рядок — не рід житла');
// І значення доїжджає до екрана, а не лише до галочки: підпис про рахунок
// каналу малює `LodgingBillingHint`, і малювати йому нічого без цього поля.
assert.strictEqual(setupProgress({ ...EMPTY, property: { country: 'UA', checkInTime: '14:00', checkOutTime: '12:00', lodgingKind: 'camping' } }).lodgingKind, 'camping');
assert.strictEqual(setupProgress(EMPTY).lodgingKind, null, 'обʼєкта немає — і роду немає');
// 2. Типи й номери — обидва.
assert.deepStrictEqual(doneKeys(only({ unitTypes: 1, units: 0 })), [], 'тип без номера — не зроблено');
assert.deepStrictEqual(doneKeys(only({ unitTypes: 0, units: 3 })), [], 'номери без типу — не зроблено');
assert.deepStrictEqual(doneKeys(only({ unitTypes: 1, units: 1 })), ['rooms']);
// 3 і 5. Тимчасове правило: 365 днів цін без дір закривають і сезони, і ціни.
assert.deepStrictEqual(doneKeys(only({ pricedDaysAhead: 364 })), [], '364 дні — дірка, не зроблено');
assert.deepStrictEqual(doneKeys(only({ pricedDaysAhead: 365 })), ['seasons', 'prices']);
// 4. Тарифи.
assert.deepStrictEqual(doneKeys(only({ ratePlans: 1 })), ['ratePlans']);
// 6. Податки: ставка ПДВ, або явний неплатник із заповненими реквізитами.
assert.deepStrictEqual(doneKeys(only({ taxRates: 1 })), ['taxes']);
assert.deepStrictEqual(doneKeys(only({ vatPayer: false, legalNameSet: true })), ['taxes'], 'неплатник із реквізитами — зроблено');
assert.deepStrictEqual(doneKeys(only({ vatPayer: false, legalNameSet: false })), [], 'дефолт «не платник» без реквізитів — не рішення, не зроблено');
assert.deepStrictEqual(doneKeys(only({ vatPayer: true, legalNameSet: true, taxRates: 0 })), [], 'платник без ставки — не зроблено');
// 7. Перша бронь — не скасована.
assert.deepStrictEqual(doneKeys(only({ activeReservations: 1 })), ['firstBooking']);
// 8. Канал або сайт — будь-який з двох.
assert.deepStrictEqual(doneKeys(only({ channelEnabled: true })), ['channelOrSite']);
assert.deepStrictEqual(doneKeys(only({ siteActive: true })), ['channelOrSite']);
console.log('  ok  кожен із 8 кроків розрізняє свою вісь і не тягне сусідів');

// ── Кожен крок веде кудись ──────────────────────────────────────────────
for (const s of full.steps) assert.ok(s.href.startsWith('/app/'), `крок ${s.key} без адреси екрана`);
console.log('  ok  кожен крок веде на екран');

console.log('setup-progress: 8 кроків з даних, тимчасове правило цін названо');
