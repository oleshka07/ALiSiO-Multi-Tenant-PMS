/**
 * Чи діє цей промокод на цю поїздку.
 *
 * ── Навіщо окремий файл ──────────────────────────────────────────────────
 *
 * Умови купона оператор задає у «Промокоди»: `min_nights`, `max_nights`,
 * `allowed_days`, «на послуги чи на проживання», список будиночків. Форма їх
 * зберігає, API їх пише, картка їх показує — і жоден із двох шляхів, якими
 * купон доходить до ціни, їх не читав. `validatePromo` перевіряв дати, ліміт
 * використань і сайт; `createWidgetReservation`, тобто місце, де знижка
 * справді віднімається від суми, — навіть цього не робив: він брав рядок
 * купона й одразу рахував знижку. Тож «промокод на 2 ночі, лише на вихідні»
 * діяв на двадцять ночей серед тижня.
 *
 * Те саме з пакетами: `nights_included` перевіряв ЛИШЕ віджет
 * (`useBookingWidget.ts:536`) і лише щоб не дати натиснути кнопку. Запит в
 * обхід віджета — а публічний маршрут відкритий усім — робив «пакет на дві
 * ночі за 8500» ціною двадцятиденного заїзду.
 *
 * Правила живуть тут, окремо від обох хендлерів, з однієї причини: інакше
 * «перевірити при застосуванні» і «перевірити при бронюванні» напишуть двічі,
 * і два рази вони розійдуться. Порада гостю і рішення про гроші мають
 * відповідати однаково.
 *
 * ── Чому код, а не речення ───────────────────────────────────────────────
 *
 * Віджет бачить гість, і мову обирає він, а не готель. Тому звідси виходить
 * КОД причини, а рядок складає екран — так само, як `domain/alerts.ts` робить
 * для попереджень оператора. `check-i18n-leak` забороняє `t()` під
 * `src/app/api` саме тому.
 */

/** Чому купон не діє. Рядки складає `ui/translations.ts`. */
export const COUPON_REJECTIONS = [
  /** Ночей менше, ніж `min_nights`. */
  'min_nights',
  /** Ночей більше, ніж `max_nights`. */
  'max_nights',
  /** День заїзду не входить у `allowed_days`. */
  'allowed_days',
  /** Пакет діє на рівно `nights_included` ночей, а обрано інше число. */
  'package_nights',
  /** Купон лише на послуги, а його прикладають до проживання. */
  'not_for_stay',
  /** Купон лише на проживання, а його прикладають до послуги. */
  'not_for_service',
  /** Цей будиночок не в списку `applied_listings`. */
  'unit_not_included',
  /** Ця послуга не в списку `applicable_services`. */
  'service_not_included',
] as const;

export type CouponRejection = (typeof COUPON_REJECTIONS)[number];

export type Eligibility =
  | { ok: true }
  /** `detail` — число або список, яких бракує гостю: скільки ночей, які дні. */
  | { ok: false; reason: CouponRejection; detail?: number | number[] };

export interface CouponRules {
  /** 'services' | 'listings' | 'both'. Порожнє читається як 'services' — так само, як у validatePromo. */
  applies_to?: string | null;
  min_nights?: number | string | null;
  max_nights?: number | string | null;
  /** JSON-масив днів тижня 1–7, де 1 — понеділок (як у формі «Промокоди»). */
  allowed_days?: string | number[] | null;
  applied_listings?: string | string[] | null;
  applicable_services?: string | string[] | null;
  /** Лише для пакетів (`gift_card_bundles`). */
  nights_included?: number | string | null;
}

export interface Stay {
  /** YYYY-MM-DD. Потрібен лише для `allowed_days`. */
  checkIn?: string | null;
  nights?: number | null;
  /** Купон прикладають до проживання. */
  unitId?: string | null;
  /** Купон прикладають до послуги. */
  serviceId?: string | null;
}

const OK: Eligibility = { ok: true };

/**
 * Число, яким його задав оператор, або null.
 *
 * Порожнє поле форми приходить як '' і як null, а Number('') — це 0. Нуль
 * ночей як мінімум означав би «купон не діє ніколи», тому порожнє мусить
 * лишитись порожнім, а не стати нулем.
 */
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Список із JSON-рядка або вже готового масиву.
 *
 * Побитий JSON читається як «обмеження немає» — рівно так поводились обидва
 * `catch { treat as applicable to all }` у validatePromo. Купон, чиє поле
 * зіпсоване, не має ставати недійсним: оператор про це не дізнається, а гість
 * побачить «Invalid code» на код, який готель йому щойно надіслав.
 */
function list<T>(v: unknown): T[] | null {
  if (v === null || v === undefined || v === '') return null;
  if (Array.isArray(v)) return v as T[];
  if (typeof v !== 'string') return null;
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? (parsed as T[]) : null;
  } catch {
    return null;
  }
}

/**
 * День тижня дати заїзду, 1 = понеділок … 7 = неділя.
 *
 * Розібрано як UTC-північ, а не через `new Date('YYYY-MM-DD')` у локальному
 * поясі: у поясі на захід від Гринвіча рядок «2026-08-29» став би 28 серпня, і
 * купон «лише на суботу» відмовив би саме в суботу. `core/hotel-day.ts`
 * тримається того самого правила.
 */
export function isoWeekday(date: string | null | undefined): number | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}/.test(date)) return null;
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const dow = d.getUTCDay(); // 0 = неділя
  return dow === 0 ? 7 : dow;
}

/**
 * Чи діє купон на цю поїздку. Перше порушення і виграє — гостю показують одну
 * причину, а не список.
 */
export function couponApplies(rules: CouponRules, stay: Stay): Eligibility {
  const nights = num(stay.nights);

  // «На послуги чи на проживання» — та сама відповідь, що й у validatePromo,
  // але тепер і на шляху бронювання, де її не було зовсім.
  const appliesTo = rules.applies_to || 'services';
  if (stay.unitId && appliesTo === 'services') return { ok: false, reason: 'not_for_stay' };
  if (!stay.unitId && stay.serviceId && appliesTo === 'listings') {
    return { ok: false, reason: 'not_for_service' };
  }

  if (stay.unitId) {
    const listings = list<string>(rules.applied_listings);
    if (listings && listings.length > 0 && !listings.includes(stay.unitId)) {
      return { ok: false, reason: 'unit_not_included' };
    }
  } else if (stay.serviceId) {
    const services = list<string>(rules.applicable_services);
    if (services && services.length > 0 && !services.includes(stay.serviceId)) {
      return { ok: false, reason: 'service_not_included' };
    }
  }

  // Довжина поїздки має сенс лише для проживання: купон на послугу не має
  // ночей, і `nights` для нього не приходить.
  if (nights !== null && nights > 0) {
    const min = num(rules.min_nights);
    if (min !== null && min > 0 && nights < min) {
      return { ok: false, reason: 'min_nights', detail: min };
    }
    const max = num(rules.max_nights);
    if (max !== null && max > 0 && nights > max) {
      return { ok: false, reason: 'max_nights', detail: max };
    }
  }

  const days = list<number>(rules.allowed_days);
  if (days && days.length > 0) {
    const wd = isoWeekday(stay.checkIn);
    // Дати немає — правило про день заїзду ні до чого прикласти. Мовчазна
    // згода тут навмисна: `validatePromo` кличуть і без дат, коли гість
    // застосовує код до вибору дат. Місце, де це важить, — бронювання, і туди
    // дата приходить завжди.
    if (wd !== null && !days.includes(wd)) {
      return { ok: false, reason: 'allowed_days', detail: days };
    }
  }

  return OK;
}

/**
 * Чи діє пакет на цю поїздку.
 *
 * `nights_included` — не мінімум і не знижка за ніч: пакет продано як «дві ночі
 * за 8500», і на трьох ночах він не означає нічого. Тому саме рівність.
 */
export function packageApplies(rules: CouponRules, stay: Stay): Eligibility {
  const included = num(rules.nights_included);
  const nights = num(stay.nights);
  if (included !== null && included > 0 && nights !== null && nights > 0 && nights !== included) {
    return { ok: false, reason: 'package_nights', detail: included };
  }

  if (stay.unitId) {
    const listings = list<string>(rules.applied_listings);
    if (listings && listings.length > 0 && !listings.includes(stay.unitId)) {
      return { ok: false, reason: 'unit_not_included' };
    }
  }

  const days = list<number>(rules.allowed_days);
  if (days && days.length > 0) {
    const wd = isoWeekday(stay.checkIn);
    if (wd !== null && !days.includes(wd)) {
      return { ok: false, reason: 'allowed_days', detail: days };
    }
  }

  return OK;
}
