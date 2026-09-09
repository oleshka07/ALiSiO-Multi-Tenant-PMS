/**
 * Setup progress — чекліст онбордингу з восьми кроків (MASTER-PLAN §1.4, П12).
 *
 * Стан не зберігається — він ВИВОДИТЬСЯ зі зрізу даних (так само, як майстер
 * Channex, Ц18): крок «зроблено», коли в базі є відповідні рядки. Тому
 * прапорців «крок пройдено» немає, і готель не може «пройти» крок, нічого не
 * заповнивши. Показується на дашборді (поки не 8/8) і в платформній таблиці.
 *
 * Зріз збирає `data/setup-progress.repo.ts`; тут — лише правило, чиста
 * функція, і його тримає `setup-progress.check.ts`.
 *
 * ── Тимчасове правило (до Блоку 2) ──────────────────────────────────────
 *
 * Кроки 3 «Сезони» і 5 «Ціни» у цільовій моделі стоять на `seasons` і
 * повноті сезон × тип × тариф (§2.6). Сезонів ще немає, тож обидва
 * рахуються «зроблено», якщо хоч один тип номера має ціну на кожен із
 * найближчих 365 днів без дір (`PRICE_COVERAGE_DAYS`). Правило названо тут і
 * в перевірці навмисно: коли з'являться сезони, міняється одна константа й
 * одна сцена, а не пошук по екранах.
 */

export const PRICE_COVERAGE_DAYS = 365;

export interface SetupSnapshot {
  /**
   * Обʼєкт, чий прогрес рахуємо; `null` — обʼєкта немає взагалі.
   *
   * `lodgingKind` — рід житла (В1). Він у кроці «Обʼєкт» не як ще одна
   * галочка: це вісь, за якою менеджер каналів виставляє РАХУНОК (готельна
   * група — за обʼєкт, оренда — за юніт), і поки він не названий, каталог у
   * канал не їде взагалі. Крок 8 «Канал або сайт» цього не покриває: він
   * питає, чи є зʼєднання, а не чи має воно що відправити.
   */
  property: {
    country: string | null;
    checkInTime: string | null;
    checkOutTime: string | null;
    lodgingKind: string | null;
  } | null;
  /** Типів номерів із дорослою місткістю ≥ 1. */
  unitTypes: number;
  units: number;
  /** Найбільша по типах кількість днів із ціною в межах найближчих `PRICE_COVERAGE_DAYS`. */
  pricedDaysAhead: number;
  /** Тарифів у продажу. */
  ratePlans: number;
  taxRates: number;
  vatPayer: boolean;
  /** Реквізити (юридична назва) заповнені — ознака, що про ПДВ вирішено свідомо. */
  legalNameSet: boolean;
  /** Броней, не скасованих. */
  activeReservations: number;
  channelEnabled: boolean;
  siteActive: boolean;
}

export type SetupStepKey =
  | 'property' | 'rooms' | 'seasons' | 'ratePlans' | 'prices' | 'taxes' | 'firstBooking' | 'channelOrSite';

export interface SetupStep {
  key: SetupStepKey;
  done: boolean;
  /** Куди веде крок (MASTER-PLAN §1.4, колонка «Веде на»). */
  href: string;
}

export interface SetupProgress {
  steps: SetupStep[];
  done: number;
  total: 8;
  /**
   * Рід житла обʼєкта — щоб чекліст МІГ СКАЗАТИ, чим це обертається в
   * рахунку каналу, а не лише «зроблено / не зроблено». Значення, не
   * висновок: підпис малює екран (`LodgingBillingHint`), бо група
   * тарифікації — факт про канал, і в ядро вона не тягнеться.
   */
  lodgingKind: string | null;
}

export function setupProgress(s: SetupSnapshot): SetupProgress {
  const pricesCovered = s.pricedDaysAhead >= PRICE_COVERAGE_DAYS;
  const steps: SetupStep[] = [
    {
      key: 'property',
      done: !!s.property && !!s.property.country && !!s.property.checkInTime && !!s.property.checkOutTime
        && !!s.property.lodgingKind,
      href: '/app/settings/properties',
    },
    { key: 'rooms', done: s.unitTypes >= 1 && s.units >= 1, href: '/app/settings/units' },
    // Тимчасове правило — див. шапку. Сезонів ще немає; веде туди, де ціни ставлять сьогодні.
    { key: 'seasons', done: pricesCovered, href: '/app/pricing' },
    { key: 'ratePlans', done: s.ratePlans >= 1, href: '/app/settings/rate-plans' },
    { key: 'prices', done: pricesCovered, href: '/app/pricing' },
    // Ставка ПДВ є — зроблено. Її немає — зроблено лише коли готель явно
    // неплатник І заповнив реквізити: дефолт «не платник» без реквізитів — це
    // порожня форма, а не рішення (інваріант 13 — відсутність не дозволяє).
    { key: 'taxes', done: s.taxRates >= 1 || (!s.vatPayer && s.legalNameSet), href: '/app/settings/invoicing' },
    { key: 'firstBooking', done: s.activeReservations >= 1, href: '/app/calendar' },
    { key: 'channelOrSite', done: s.channelEnabled || s.siteActive, href: '/app/settings/channel-manager' },
  ];
  return {
    steps,
    done: steps.filter((x) => x.done).length,
    total: 8,
    lodgingKind: s.property?.lodgingKind ?? null,
  };
}
