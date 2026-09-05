/**
 * Надбавки за заселеність — чисте правило (Блок 2 крок 3, Ц30).
 *
 *   node src/modules/pricing/domain/extra-occupancy.check.ts
 *
 * Ніч = ціна тарифу (за `base_occupancy` дорослих) + Σ надбавок за кожного
 * дорослого понад базу + Σ надбавок за кожну дитину за її віковою вилкою.
 * Надбавка — проживання (% від ціни ночі або сума) + харчування (% або сума).
 * «За номер» (Ц26) — доплат за дорослих не буває, дитячі лишаються.
 *
 * Що стверджується:
 *   * вилки з меж: `[]` → одна 0–17; `[3, 12]` → 0–2, 3–11, 12–17; вік → індекс;
 *   * правило обирається за точністю: тариф × тип > тариф > тип > усі;
 *   * дорослі понад базу — по надбавці кожному; нижче бази — без знижки;
 *   * дитина без правила — ніч без ціни (інваріант 17), не безкоштовна;
 *   * правило на конкретну вилку без відомого віку — «потрібен вік», не
 *     вгадування; правило «на всі вилки» рятує;
 *   * відсоток — від ціни ночі, сума — як є; харчування додається окремо;
 *   * два правила однакової точності на одного гостя — конфлікт, названий.
 *
 * Осі (інваріант 26): дві різні ціни ночі (100 і 200) під відсотковою
 * надбавкою — «% від ночі» проти «фіксованих 25»; два дорослих понад базу
 * проти одного; дві вилки з різними сумами; обидва режими продажу.
 *
 * Перевірка написана ДО коду і була червоною (інваріант 24).
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';

const { bandsFrom, bandIndexFor, pickRule, nightSurcharges, ruleConflict } = await import('./extra-occupancy.ts');

// ── Вилки ─────────────────────────────────────────────────────────────────
assert.deepStrictEqual(bandsFrom([]), [{ from: 0, to: 17 }], 'без меж — одна вилка 0–17');
assert.deepStrictEqual(bandsFrom([3, 12]), [{ from: 0, to: 2 }, { from: 3, to: 11 }, { from: 12, to: 17 }], 'дві межі — три вилки');
assert.deepStrictEqual(bandsFrom([12, 3]), [{ from: 0, to: 2 }, { from: 3, to: 11 }, { from: 12, to: 17 }], 'межі впорядковуються');
assert.strictEqual(bandIndexFor(2, bandsFrom([3, 12])), 0);
assert.strictEqual(bandIndexFor(3, bandsFrom([3, 12])), 1, 'межа входить у старшу вилку');
assert.strictEqual(bandIndexFor(17, bandsFrom([3, 12])), 2);
assert.strictEqual(bandIndexFor(18, bandsFrom([3, 12])), null, 'від 18 — дорослий, не вилка');
console.log('  ok  вилки з меж, вік → індекс');

// ── Правила ───────────────────────────────────────────────────────────────
const R = (o: Partial<import('./extra-occupancy.ts').OccupancyRule>) => ({
  id: o.id ?? 'r', ratePlanId: null, unitTypeId: null, guestKind: 'adult' as const, ageBandIndex: null,
  lodgingMode: 'fixed' as const, lodgingValue: 0, mealMode: null, mealValue: null, extraBed: false, ...o,
});
const rules = [
  R({ id: 'adult-all', guestKind: 'adult', lodgingMode: 'fixed', lodgingValue: 25 }),
  R({ id: 'adult-bar-dbl', guestKind: 'adult', ratePlanId: 'BAR', unitTypeId: 'DBL', lodgingMode: 'percent', lodgingValue: 10 }),
  R({ id: 'adult-bar', guestKind: 'adult', ratePlanId: 'BAR', lodgingMode: 'fixed', lodgingValue: 30 }),
  R({ id: 'child-all', guestKind: 'child', lodgingMode: 'fixed', lodgingValue: 15, mealMode: 'fixed', mealValue: 5 }),
];
assert.strictEqual(pickRule(rules, { guestKind: 'adult', ratePlanId: 'BAR', unitTypeId: 'DBL' })?.id, 'adult-bar-dbl', 'тариф × тип — найточніше');
assert.strictEqual(pickRule(rules, { guestKind: 'adult', ratePlanId: 'BAR', unitTypeId: 'TRP' })?.id, 'adult-bar', 'тариф без збігу типу');
assert.strictEqual(pickRule(rules, { guestKind: 'adult', ratePlanId: 'NR', unitTypeId: 'DBL' })?.id, 'adult-all', 'усі — коли точнішого немає');
assert.strictEqual(pickRule(rules, { guestKind: 'child', ratePlanId: 'BAR', unitTypeId: 'DBL', bandIndex: 1 })?.id, 'child-all', 'дитяче «на всі вилки» береться для будь-якої вилки');
console.log('  ok  правило обирається за точністю');

// ── Ніч: дорослі понад базу ───────────────────────────────────────────────
const base = { baseOccupancy: 2, bands: bandsFrom([]) };
const two = nightSurcharges({ rules, nightPrice: 100, adults: 2, children: 0, sellMode: 'per_person', ratePlanId: 'BAR', unitTypeId: 'DBL', ...base });
assert.strictEqual(two.total, 0, 'двоє на базі двох — без надбавки');
const three100 = nightSurcharges({ rules, nightPrice: 100, adults: 3, children: 0, sellMode: 'per_person', ratePlanId: 'BAR', unitTypeId: 'DBL', ...base });
const three200 = nightSurcharges({ rules, nightPrice: 200, adults: 3, children: 0, sellMode: 'per_person', ratePlanId: 'BAR', unitTypeId: 'DBL', ...base });
assert.strictEqual(three100.total, 10, '10 % від 100 — третій дорослий 10');
assert.strictEqual(three200.total, 20, '10 % від 200 — 20: відсоток від НОЧІ, не константа');
const four = nightSurcharges({ rules, nightPrice: 100, adults: 4, children: 0, sellMode: 'per_person', ratePlanId: 'BAR', unitTypeId: 'DBL', ...base });
assert.strictEqual(four.total, 20, 'двоє понад базу — двічі по 10');
assert.strictEqual(four.items.length, 2, 'і кожен названий у розкладі');
const nr3 = nightSurcharges({ rules, nightPrice: 100, adults: 3, children: 0, sellMode: 'per_person', ratePlanId: 'NR', unitTypeId: 'DBL', ...base });
assert.strictEqual(nr3.total, 25, 'інший тариф — правило «усі», сума 25 незалежно від ціни ночі');
const one = nightSurcharges({ rules, nightPrice: 100, adults: 1, children: 0, sellMode: 'per_person', ratePlanId: 'BAR', unitTypeId: 'DBL', ...base });
assert.strictEqual(one.total, 0, 'менше бази — без знижки (не заявлено)');
const room3 = nightSurcharges({ rules, nightPrice: 100, adults: 3, children: 0, sellMode: 'per_room', ratePlanId: 'BAR', unitTypeId: 'DBL', ...base });
assert.strictEqual(room3.total, 0, '«за номер»: дорослих понад базу не доплачують');
console.log('  ok  дорослі понад базу: відсоток від ночі, сума як є, «за номер» без доплат');

// ── Ніч: діти ─────────────────────────────────────────────────────────────
const kids = nightSurcharges({ rules, nightPrice: 100, adults: 2, children: 2, sellMode: 'per_person', ratePlanId: 'BAR', unitTypeId: 'DBL', ...base });
assert.strictEqual(kids.total, 2 * (15 + 5), 'дві дитини — проживання 15 і харчування 5 на кожну');
const roomKids = nightSurcharges({ rules, nightPrice: 100, adults: 3, children: 1, sellMode: 'per_room', ratePlanId: 'BAR', unitTypeId: 'DBL', ...base });
assert.strictEqual(roomKids.total, 20, '«за номер»: дитяча надбавка лишається, доросла — ні');
const noChildRule = nightSurcharges({ rules: rules.filter((r) => r.guestKind !== 'child'), nightPrice: 100, adults: 2, children: 1, sellMode: 'per_person', ratePlanId: 'BAR', unitTypeId: 'DBL', ...base });
assert.strictEqual(noChildRule.missing, 'child_rule_missing', 'дитина без правила — ніч без ціни, не безкоштовна дитина');
const noAdultRule = nightSurcharges({ rules: rules.filter((r) => r.guestKind !== 'adult'), nightPrice: 100, adults: 3, children: 0, sellMode: 'per_person', ratePlanId: 'BAR', unitTypeId: 'DBL', ...base });
assert.strictEqual(noAdultRule.missing, 'adult_rule_missing', 'третій дорослий без правила — ніч без ціни');
console.log('  ok  діти: проживання + харчування на кожну; без правила — без ціни');

// ── Вилки й вік ───────────────────────────────────────────────────────────
const banded = [
  R({ id: 'small', guestKind: 'child', ageBandIndex: 0, lodgingMode: 'fixed', lodgingValue: 0 }),
  R({ id: 'big', guestKind: 'child', ageBandIndex: 1, lodgingMode: 'percent', lodgingValue: 50 }),
];
const bands = bandsFrom([6]);
const withAges = nightSurcharges({ rules: banded, nightPrice: 100, adults: 2, children: 2, childrenAges: [3, 10], sellMode: 'per_person', ratePlanId: 'BAR', unitTypeId: 'DBL', baseOccupancy: 2, bands });
assert.strictEqual(withAges.total, 0 + 50, 'малий безкоштовно (названий нуль), великий — 50 % ночі');
const withoutAges = nightSurcharges({ rules: banded, nightPrice: 100, adults: 2, children: 2, sellMode: 'per_person', ratePlanId: 'BAR', unitTypeId: 'DBL', baseOccupancy: 2, bands });
assert.strictEqual(withoutAges.missing, 'child_ages_required', 'правила по вилках без віку дітей — «потрібен вік», не вгадування');
const rescued = nightSurcharges({ rules: [...banded, R({ id: 'any', guestKind: 'child', lodgingMode: 'fixed', lodgingValue: 20 })], nightPrice: 100, adults: 2, children: 2, sellMode: 'per_person', ratePlanId: 'BAR', unitTypeId: 'DBL', baseOccupancy: 2, bands });
assert.strictEqual(rescued.total, 40, 'без віку береться правило «на всі вилки», якщо воно є');
console.log('  ok  вилки: з віком — своя, без віку — лише «на всі вилки», інакше потрібен вік');

// ── Конфлікт ──────────────────────────────────────────────────────────────
assert.strictEqual(ruleConflict(rules, R({ id: 'dup', guestKind: 'adult', ratePlanId: 'BAR', unitTypeId: 'DBL' }))?.id, 'adult-bar-dbl', 'те саме місце — конфлікт, названий існуючим правилом');
assert.strictEqual(ruleConflict(rules, R({ id: 'ok', guestKind: 'adult', ratePlanId: 'NR', unitTypeId: 'DBL' })), null, 'інша клітинка — не конфлікт');
assert.strictEqual(ruleConflict(rules, R({ id: 'self', guestKind: 'adult', ratePlanId: 'BAR', unitTypeId: 'DBL' }), 'adult-bar-dbl'), null, 'своє ж правило при зміні — не конфлікт');
console.log('  ok  два правила на одну клітинку — конфлікт');

console.log('extra-occupancy: ніч = тариф за базу + дорослі понад базу + діти за вилками; без правила — без ціни');
