import { LODGING_KINDS, type LodgingKind } from '@core/lodging-kinds';

/**
 * За що менеджер каналів бере гроші: за ОБʼЄКТ чи за ЮНІТ.
 *
 * ── Чому це в модулі каналів, а не в ядрі ───────────────────────────────
 *
 * Рід житла — факт про сам обʼєкт, і він у ядрі (`@core/lodging-kinds`):
 * форма обʼєкта питає його в готелю, який каналів не купував. А от те, ЯК
 * за цей рід виставлять рахунок, — знання менеджера каналів, і в ядрі йому
 * робити нічого. Готель без модуля каналів не має бачити нічого про чужі
 * тарифи. Тримає `check-boundaries --strict`, друга вісь.
 *
 * ── Чому в `ui/`, а не в `channex/` ─────────────────────────────────────
 *
 * Бо це читає ЕКРАН, на якому оператор обирає рід житла, і читає в браузері:
 * `'use client'` не може імпортувати `@channels` — фасад тягне серверний код
 * (та сама «друга парадна», що описана в `check-boundaries`). Тека адаптера
 * теж не підходить: файл, який тягне в клієнтський бандл `client.ts` разом
 * із ключами й транспортом, — це не те, що має поїхати в браузер.
 *
 * Назви тут ДОМЕННІ (`per_property`, `per_unit`), не вендорські, і це не
 * косметика: `check-vendor-isolation --strict` тримає імʼя вендора всередині
 * `channex/`, а екран стоїть далеко за його межами. Переклад у вендорські
 * слова робить адаптер у себе (`channex/property-type.ts`).
 *
 * ── Звідки взято розбиття ───────────────────────────────────────────────
 *
 * Лист вендора 09.09.2026, збережений дослівно —
 * `docs/vendor/channex/billing-2026-09-09.md`: «Hotel-group types bill at
 * $7/property; vacation-rental types at $0.50/unit», далі поіменний перелік
 * 14 + 8. Сьогодні це розбиття Channex; коли зʼявиться другий менеджер
 * каналів зі своїм, таблиця переїде за реєстр провайдерів
 * (`providers.ts`) — і саме тоді порт окупиться. До того другої таблиці не
 * заводимо: два списки одного факту розходяться мовчки.
 *
 * ── Сум тут немає, і не буде ────────────────────────────────────────────
 *
 * $7 і $0.50 — числа вендора, вони змінюються без нас. Код називає ОСНОВУ
 * рахунку; джерело правди для сум — лист вище і сторінка цін вендора.
 * Зашита сума застаріла б мовчки і в найгіршому місці: там, де оператор
 * ухвалює рішення про гроші.
 */
export type LodgingBillingBasis = 'per_property' | 'per_unit';

/**
 * Рід житла → основа рахунку.
 *
 * `Record<LodgingKind, …>`, а не два масиви: два масиви дозволяють додати
 * рід у жоден із них або в обидва. Тут новий рід житла в ядрі не
 * компілюється, поки йому не назвали основу — і це та сама причина, з якої
 * вендорська мапа перелічена поіменно.
 */
const BILLING_BASIS: Record<LodgingKind, LodgingBillingBasis> = {
  // Готельна група — рахунок за ОБʼЄКТ. 14 значень.
  camping: 'per_property',
  holiday_park: 'per_property',
  tent: 'per_property',
  guest_house: 'per_property',
  resort: 'per_property',
  hostel: 'per_property',
  hotel: 'per_property',
  inn: 'per_property',
  lodge: 'per_property',
  motel: 'per_property',
  apart_hotel: 'per_property',
  riad: 'per_property',
  ryokan: 'per_property',
  capsule_hotel: 'per_property',
  // Оренда — рахунок за ЮНІТ. 8 значень.
  apartment: 'per_unit',
  holiday_home: 'per_unit',
  chalet: 'per_unit',
  boat: 'per_unit',
  farm_stay: 'per_unit',
  homestay: 'per_unit',
  villa: 'per_unit',
  country_house: 'per_unit',
};

/**
 * Основа рахунку для цього роду житла, або `null` — рід невідомий.
 *
 * `null` тут не «байдуже»: рід поза переліком до менеджера каналів не
 * поїде взагалі, тож питання рахунку не стоїть.
 */
export function billingBasisOf(kind: string | null | undefined): LodgingBillingBasis | null {
  if (!kind || !(kind in BILLING_BASIS)) return null;
  return BILLING_BASIS[kind as LodgingKind];
}

/** Роди житла з однією основою рахунку. Для гейта і для екрана. */
export function lodgingKindsBilledBy(basis: LodgingBillingBasis): LodgingKind[] {
  return LODGING_KINDS.filter((k) => BILLING_BASIS[k] === basis);
}
