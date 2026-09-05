/**
 * Правила цін і промо — чисте правило (Блок 2 крок 4, Ц31; Hoteliera
 * «Price rules» / «Promos»).
 *
 *   node src/modules/pricing/domain/price-rules.check.ts
 *
 * Правило — знижка або надбавка до ціни ночі ПІСЛЯ надбавок за заселеність і
 * ДО зборів: умови (період проживання / заїзду / виїзду, дні тижня, тарифи,
 * типи, тривалість, за скільки днів заброньовано, заселеність), дія (мінус
 * або плюс, відсоток або сума), пріоритет. Промо — те саме правило з кодом:
 * діє лише коли код названо, лічить використання, може бути «лише онлайн».
 *
 * Що стверджується:
 *   * відсоток — від поточної ціни ночі (100 → 90, 200 → 180), сума — як є;
 *     мінус і плюс — обидва; ціна не йде нижче нуля;
 *   * кілька правил — за пріоритетом (менше число — раніше), кожне на
 *     результат попереднього: −10 % потім +20 = 110, а не 108 і не 120;
 *   * період проживання дивиться на НІЧ, період заїзду — на дату заїзду (усі
 *     ночі поїздки), період виїзду — на дату виїзду;
 *   * дні тижня: для періоду проживання — день ночі; для заїзду — день заїзду;
 *   * тривалість: min/max ночей; «за скільки днів» (EB/LM) — лише коли відома
 *     дата бронювання, без неї (канал) правило не діє;
 *   * заселеність — дорослі + діти; тарифи й типи — списками, порожньо = усі;
 *   * промо діє лише зі своїм кодом (регістр байдужий), вичерпане — ні,
 *     «лише онлайн» — лише з прямого каналу; звичайне правило коду не потребує;
 *   * вимкнене правило не діє.
 *
 * Осі (інваріант 26): дві ціни ночі (100 і 200) під відсотком; обидві дії;
 * обидва види значення; дві тривалості (2 і 3 ночі) проти min_los 3; дві
 * дати бронювання (за 40 і за 5 днів) проти вікна EB; два коди.
 *
 * Перевірка написана ДО коду і була червоною (інваріант 24).
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';

const { applyRules, ruleAppliesToStay, ruleAppliesToNight, isoWeekday } = await import('./price-rules.ts');
type PriceRule = import('./price-rules.ts').PriceRule;

const R = (o: Partial<PriceRule> & { id: string }): PriceRule => ({
  name: o.id, titleForGuest: null, kind: 'rule', code: null,
  conditionKind: null, dateFrom: null, dateTo: null, weekDays: null,
  ratePlanIds: null, unitTypeIds: null, minLos: null, maxLos: null,
  bookedDaysBeforeFrom: null, bookedDaysBeforeTo: null, occupancyFrom: null, occupancyTo: null,
  action: 'decrease', value: 10, valueKind: 'percent', priority: 100, isActive: true,
  onlineOnly: false, maxUses: null, currentUses: 0,
  ...o,
});

const stay = (o: Partial<import('./price-rules.ts').StayContext> = {}) => ({
  checkIn: '2027-07-05', nights: 3, ratePlanId: 'BAR', unitTypeId: 'DBL', occupancy: 2,
  bookedAt: '2027-05-26', channel: 'direct' as const, promoCode: null, ...o,
});

// ── Арифметика ────────────────────────────────────────────────────────────
const minus10 = R({ id: 'minus10' });
assert.strictEqual(applyRules([minus10], stay(), '2027-07-05', 100).price, 90, '−10 % від 100');
assert.strictEqual(applyRules([minus10], stay(), '2027-07-05', 200).price, 180, '−10 % від 200 — відсоток від НОЧІ, не константа');
const plus20 = R({ id: 'plus20', action: 'increase', value: 20, valueKind: 'fixed', priority: 200 });
assert.strictEqual(applyRules([plus20], stay(), '2027-07-05', 100).price, 120, '+20 сумою');
const both = applyRules([plus20, minus10], stay(), '2027-07-05', 100);
assert.strictEqual(both.price, 110, 'за пріоритетом: −10 % (100) → 90, потім +20 → 110; не 108, не 120');
assert.deepStrictEqual(both.applied.map((a) => [a.ruleId, a.delta]), [['minus10', -10], ['plus20', 20]], 'розклад називає кожне правило і його дельту');
const eatAll = R({ id: 'eat', action: 'decrease', value: 500, valueKind: 'fixed' });
assert.strictEqual(applyRules([eatAll], stay(), '2027-07-05', 100).price, 0, 'ціна не йде нижче нуля');
console.log('  ok  відсоток від ночі, сума як є, обидві дії, пріоритет компонує, не нижче нуля');

// ── Періоди й дні тижня ───────────────────────────────────────────────────
assert.strictEqual(isoWeekday('2027-07-05'), 1, '5 липня 2027 — понеділок');
const julyStay = R({ id: 'july', conditionKind: 'period_of_stay', dateFrom: '2027-07-01', dateTo: '2027-07-06' });
assert.strictEqual(ruleAppliesToNight(julyStay, stay(), '2027-07-06'), true, 'ніч у періоді проживання');
assert.strictEqual(ruleAppliesToNight(julyStay, stay(), '2027-07-07'), false, 'ніч поза періодом — правило на неї не діє, хоч поїздка почалась у періоді');
const julyCheckin = R({ id: 'julyin', conditionKind: 'period_of_checkin', dateFrom: '2027-07-01', dateTo: '2027-07-06' });
assert.strictEqual(ruleAppliesToStay(julyCheckin, stay()), true, 'заїзд у періоді');
assert.strictEqual(ruleAppliesToNight(julyCheckin, stay(), '2027-07-07'), true, '…і тоді правило діє на КОЖНУ ніч поїздки, навіть поза періодом');
assert.strictEqual(ruleAppliesToStay(julyCheckin, stay({ checkIn: '2027-07-07' })), false, 'заїзд поза періодом');
const julyCheckout = R({ id: 'julyout', conditionKind: 'period_of_checkout', dateFrom: '2027-07-08', dateTo: '2027-07-08' });
assert.strictEqual(ruleAppliesToStay(julyCheckout, stay()), true, 'виїзд 8 липня (3 ночі з 5-го) — у періоді');
assert.strictEqual(ruleAppliesToStay(julyCheckout, stay({ nights: 2 })), false, 'виїзд 7 липня — поза');
const weekend = R({ id: 'wknd', weekDays: [5, 6] });
assert.strictEqual(ruleAppliesToNight(weekend, stay(), '2027-07-09'), true, 'пʼятниця — день ночі підходить');
assert.strictEqual(ruleAppliesToNight(weekend, stay(), '2027-07-05'), false, 'понеділок — ні');
const mondayCheckin = R({ id: 'monin', conditionKind: 'period_of_checkin', weekDays: [1] });
assert.strictEqual(ruleAppliesToNight(mondayCheckin, stay(), '2027-07-06'), true, 'день заїзду понеділок — діє й на вівторкову ніч');
assert.strictEqual(ruleAppliesToStay(mondayCheckin, stay({ checkIn: '2027-07-06' })), false, 'заїзд у вівторок — не діє');
console.log('  ok  період проживання — по ночах; заїзду/виїзду — на всю поїздку; дні тижня за тим самим правилом');

// ── Тривалість, EB/LM, заселеність, тарифи, типи ─────────────────────────
const los3 = R({ id: 'los3', minLos: 3 });
assert.strictEqual(ruleAppliesToStay(los3, stay({ nights: 3 })), true, 'три ночі — досягнуто');
assert.strictEqual(ruleAppliesToStay(los3, stay({ nights: 2 })), false, 'дві — ні');
assert.strictEqual(ruleAppliesToStay(R({ id: 'max2', maxLos: 2 }), stay({ nights: 3 })), false, 'понад максимум — ні');
const early = R({ id: 'eb', bookedDaysBeforeFrom: 30, bookedDaysBeforeTo: null });
assert.strictEqual(ruleAppliesToStay(early, stay({ bookedAt: '2027-05-26' })), true, 'за 40 днів — раннє бронювання');
assert.strictEqual(ruleAppliesToStay(early, stay({ bookedAt: '2027-06-30' })), false, 'за 5 днів — ні');
assert.strictEqual(ruleAppliesToStay(early, stay({ bookedAt: null })), false, 'дата бронювання невідома (канал) — EB/LM не діє, а не «діє завжди»');
const lastMinute = R({ id: 'lm', bookedDaysBeforeFrom: null, bookedDaysBeforeTo: 7 });
assert.strictEqual(ruleAppliesToStay(lastMinute, stay({ bookedAt: '2027-06-30' })), true, 'за 5 днів — останній момент');
assert.strictEqual(ruleAppliesToStay(lastMinute, stay({ bookedAt: '2027-05-26' })), false);
assert.strictEqual(ruleAppliesToStay(R({ id: 'occ3', occupancyFrom: 3 }), stay({ occupancy: 2 })), false, 'заселеність нижче — ні');
assert.strictEqual(ruleAppliesToStay(R({ id: 'occ3', occupancyFrom: 3 }), stay({ occupancy: 3 })), true);
assert.strictEqual(ruleAppliesToStay(R({ id: 'bar', ratePlanIds: ['BAR'] }), stay({ ratePlanId: 'NR' })), false, 'інший тариф — ні');
assert.strictEqual(ruleAppliesToStay(R({ id: 'bar', ratePlanIds: ['BAR'] }), stay({ ratePlanId: null })), false, 'без тарифу правило «на BAR» не діє');
assert.strictEqual(ruleAppliesToStay(R({ id: 'dbl', unitTypeIds: ['DBL', 'TRP'] }), stay({ unitTypeId: 'TRP' })), true);
assert.strictEqual(ruleAppliesToStay(R({ id: 'dbl', unitTypeIds: ['DBL'] }), stay({ unitTypeId: 'TRP' })), false);
assert.strictEqual(ruleAppliesToStay(R({ id: 'off', isActive: false }), stay()), false, 'вимкнене не діє');
console.log('  ok  тривалість, EB/LM лише з датою бронювання, заселеність, тарифи, типи, вимкнене');

// ── Промо ─────────────────────────────────────────────────────────────────
const promo = R({ id: 'promo', kind: 'promo', code: 'SUMMER10' });
assert.strictEqual(ruleAppliesToStay(promo, stay()), false, 'промо без коду не діє');
assert.strictEqual(ruleAppliesToStay(promo, stay({ promoCode: 'summer10' })), true, 'зі своїм кодом — діє, регістр байдужий');
assert.strictEqual(ruleAppliesToStay(promo, stay({ promoCode: 'WINTER' })), false, 'з чужим кодом — ні');
assert.strictEqual(ruleAppliesToStay(R({ id: 'used', kind: 'promo', code: 'X', maxUses: 5, currentUses: 5 }), stay({ promoCode: 'X' })), false, 'вичерпане — ні');
assert.strictEqual(ruleAppliesToStay(R({ id: 'left', kind: 'promo', code: 'X', maxUses: 5, currentUses: 4 }), stay({ promoCode: 'X' })), true);
const online = R({ id: 'online', kind: 'promo', code: 'WEB', onlineOnly: true });
assert.strictEqual(ruleAppliesToStay(online, stay({ promoCode: 'WEB', channel: 'direct' })), true, '«лише онлайн» — з форми бронювання діє');
assert.strictEqual(ruleAppliesToStay(online, stay({ promoCode: 'WEB', channel: 'operator' })), false, '…з рецепції — ні');
assert.strictEqual(ruleAppliesToStay(minus10, stay({ promoCode: 'WEB' })), true, 'звичайне правило діє незалежно від коду');
const mixed = applyRules([minus10, promo], stay({ promoCode: 'SUMMER10' }), '2027-07-05', 100);
assert.strictEqual(mixed.price, 81, 'правило й промо разом: 100 → 90 → 81');
console.log('  ok  промо лише зі своїм кодом, лічить використання, «лише онлайн» — лише з прямого каналу');

console.log('price-rules: правило — знижка чи надбавка після надбавок і до зборів, за пріоритетом, з умовами; промо — правило з кодом');
