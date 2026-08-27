/**
 * Умови купона щось означають.
 *
 *   node src/modules/widget/domain/coupon-eligibility.check.ts
 *
 * Кожне твердження нижче — це поле, яке оператор заповнює у «Промокодах» або
 * «Пакетах» і яке до цієї зміни не читав ніхто. Найдорожче з них — останнє:
 * пакет «дві ночі за 8500» коштував 8500 і за двадцять ночей.
 */
import assert from 'node:assert';
import { couponApplies, packageApplies, isoWeekday, COUPON_REJECTIONS } from './coupon-eligibility.ts';

const stay = (o: Record<string, unknown> = {}) => ({ unitId: 'u1', nights: 3, checkIn: '2026-09-04', ...o });

// ── День тижня рахується в UTC ───────────────────────────────────────
assert.strictEqual(isoWeekday('2026-09-04'), 5, '4 вересня 2026 — пʼятниця');
assert.strictEqual(isoWeekday('2026-09-06'), 7, 'неділя — 7, а не 0: форма нумерує Пн…Нд');
assert.strictEqual(isoWeekday('2026-09-07'), 1, 'понеділок — 1');
assert.strictEqual(isoWeekday(null), null);
assert.strictEqual(isoWeekday('не дата'), null);
console.log('  ok  день заїзду береться з дати, а не з поясу сервера');

// ── min_nights / max_nights ──────────────────────────────────────────
assert.deepStrictEqual(
  couponApplies({ applies_to: 'listings', min_nights: 5 }, stay({ nights: 3 })),
  { ok: false, reason: 'min_nights', detail: 5 },
  'три ночі не дотягують до пʼяти',
);
assert.deepStrictEqual(couponApplies({ applies_to: 'listings', min_nights: 3 }, stay({ nights: 3 })), { ok: true },
  'рівно мінімум — це вже досить');
assert.deepStrictEqual(
  couponApplies({ applies_to: 'listings', max_nights: 2 }, stay({ nights: 20 })),
  { ok: false, reason: 'max_nights', detail: 2 },
  'саме той випадок, який ловили: купон на дві ночі проти двадцятиденного заїзду',
);
assert.deepStrictEqual(couponApplies({ applies_to: 'listings', max_nights: 2 }, stay({ nights: 2 })), { ok: true });

// Порожнє поле форми приходить як '' і як null — і не має ставати нулем.
for (const empty of ['', null, undefined]) {
  assert.deepStrictEqual(
    couponApplies({ applies_to: 'listings', min_nights: empty as never, max_nights: empty as never }, stay()),
    { ok: true },
    `порожній ліміт (${JSON.stringify(empty)}) не обмежує нічого`,
  );
}
console.log('  ok  межі за ночами діють, а порожнє поле не стає нулем');

// ── allowed_days ─────────────────────────────────────────────────────
// 2026-09-04 — пʼятниця (5).
assert.deepStrictEqual(couponApplies({ applies_to: 'listings', allowed_days: '[5,6]' }, stay()), { ok: true },
  'пʼятниця в списку — купон діє');
assert.deepStrictEqual(
  couponApplies({ applies_to: 'listings', allowed_days: [1, 2, 3] }, stay()),
  { ok: false, reason: 'allowed_days', detail: [1, 2, 3] },
  'заїзд у пʼятницю проти «лише Пн–Ср»',
);
assert.deepStrictEqual(
  couponApplies({ applies_to: 'listings', allowed_days: '[1,2,3]' }, stay({ checkIn: null })),
  { ok: true },
  'без дати правило про день заїзду ні до чого прикласти — validatePromo кличуть і до вибору дат',
);
assert.deepStrictEqual(couponApplies({ applies_to: 'listings', allowed_days: '{битий' }, stay()), { ok: true },
  'побите поле — це «обмеження немає», а не «код недійсний»: гість не має бачити відмову на код, який готель йому щойно надіслав');
assert.deepStrictEqual(couponApplies({ applies_to: 'listings', allowed_days: '[]' }, stay()), { ok: true },
  'порожній список — оператор не обрав жодного дня, тобто не обмежував');
console.log('  ok  дні заїзду діють, а зіпсоване поле не робить купон недійсним');

// ── Послуги проти проживання ─────────────────────────────────────────
assert.deepStrictEqual(
  couponApplies({}, stay()),
  { ok: false, reason: 'not_for_stay' },
  'без applies_to купон читається як «на послуги» — так само, як у validatePromo',
);
assert.deepStrictEqual(
  couponApplies({ applies_to: 'listings' }, { serviceId: 'svc1', nights: null }),
  { ok: false, reason: 'not_for_service' },
);
assert.deepStrictEqual(couponApplies({ applies_to: 'both' }, stay()), { ok: true });

assert.deepStrictEqual(
  couponApplies({ applies_to: 'listings', applied_listings: '["u2"]' }, stay()),
  { ok: false, reason: 'unit_not_included' },
);
assert.deepStrictEqual(
  couponApplies({ applies_to: 'listings', applied_listings: '["u1","u2"]' }, stay()), { ok: true });
assert.deepStrictEqual(
  couponApplies({ applies_to: 'services', applicable_services: '["svc2"]' }, { serviceId: 'svc1' }),
  { ok: false, reason: 'service_not_included' },
);
console.log('  ok  «на що діє» і списки будиночків та послуг перевіряються');

// ── Пакети ───────────────────────────────────────────────────────────
assert.deepStrictEqual(
  packageApplies({ nights_included: 2 }, stay({ nights: 20 })),
  { ok: false, reason: 'package_nights', detail: 2 },
  'пакет «дві ночі за 8500» не є ціною двадцятиденного заїзду',
);
assert.deepStrictEqual(packageApplies({ nights_included: 2 }, stay({ nights: 2 })), { ok: true });
assert.deepStrictEqual(
  packageApplies({ nights_included: 2 }, stay({ nights: 1 })),
  { ok: false, reason: 'package_nights', detail: 2 },
  'менше — теж не пакет: це рівність, а не мінімум',
);
assert.deepStrictEqual(packageApplies({}, stay({ nights: 7 })), { ok: true },
  'пакет без nights_included не обмежує довжину');
console.log('  ok  пакет діє рівно на стільки ночей, на скільки його продано');

// ── Список кодів не розходиться сам із собою ─────────────────────────
assert.strictEqual(new Set(COUPON_REJECTIONS).size, COUPON_REJECTIONS.length, 'коди не повторюються');
const produced = new Set<string>();
for (const r of [
  couponApplies({ applies_to: 'listings', min_nights: 5 }, stay({ nights: 1 })),
  couponApplies({ applies_to: 'listings', max_nights: 1 }, stay({ nights: 9 })),
  couponApplies({ applies_to: 'listings', allowed_days: [1] }, stay()),
  couponApplies({}, stay()),
  couponApplies({ applies_to: 'listings' }, { serviceId: 's' }),
  couponApplies({ applies_to: 'listings', applied_listings: '["x"]' }, stay()),
  couponApplies({ applies_to: 'services', applicable_services: '["x"]' }, { serviceId: 's' }),
  packageApplies({ nights_included: 2 }, stay({ nights: 3 })),
]) {
  if (!r.ok) produced.add(r.reason);
}
assert.deepStrictEqual(
  [...produced].sort(), [...COUPON_REJECTIONS].sort(),
  'кожен оголошений код має бути досяжним, інакше екран малює те, чого не буває, або навпаки',
);
console.log('  ok  усі оголошені причини відмови справді трапляються');
