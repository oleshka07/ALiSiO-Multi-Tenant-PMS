/**
 * Що тарифний план робить із ціною ночі.
 *
 * ── Навіщо окремий файл ──────────────────────────────────────────────────
 *
 * Тарифні плани сайту («−20 % за раннє бронювання», «VIP за фіксованою
 * ціною») міняли ціну ЛИШЕ в пошуку. `widget-availability` мав цю арифметику
 * всередині циклу по ночах, а `widget-reserve` про `site_rate_plans` не знав
 * узагалі — він навіть не читав `ratePlanId`, бо віджет його не надсилав.
 *
 * Тобто гість заходив за посиланням `?ratePlanId=…`, бачив ціну зі знижкою,
 * натискав «Забронювати» — і діставав підтвердження за базовою ціною. Різницю
 * помічали або гість у листі, або рецепція на заїзді. Обидва варіанти
 * закінчуються розмовою, у якій готель неправий.
 *
 * Правило живе тут, а не в жодному з хендлерів, з тієї самої причини, що й
 * `coupon-eligibility.ts`: ціна, яку показують, і ціна, яку списують, мусять
 * рахуватись одним кодом, інакше вони розійдуться.
 *
 * ── Це не другий постачальник цін ────────────────────────────────────────
 *
 * AGENTS.md §3, інваріант 16: ніч оцінює лише `priceNights()`. Тариф — це не
 * ціна ночі, а надбавка сайту поверх неї, і застосовується до того, що
 * `priceNights()` уже повернув. Виняток один — `fixed_price`: там готель
 * назвав ціну сам, і це теж «хтось назвав» у сенсі інваріанта 17.
 */
// Відносний шлях із розширенням, а не '@core/money': цей файл читає і node у
// rate-plan.check.ts, який запускають без збірки, тож аліаси tsconfig йому
// невідомі. Так само робить modules/pricing/domain/fees.ts.
import { money } from '../../../core/money.ts';

export interface RatePlan {
  /** Ціна за ніч, названа тарифом. Перекриває все інше. */
  fixed_price?: number | string | null;
  /** 'dependent' — рахувати від базової ціни; будь-що інше — не чіпати. */
  pricing_mode?: string | null;
  pricing_modifier_percent?: number | string | null;
  /** 'more' — надбавка, будь-що інше — знижка. */
  pricing_modifier_type?: string | null;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Ціна однієї ночі під цим тарифом.
 *
 * Порядок навмисний: `fixed_price` виграє в модифікатора, бо це два різні
 * способи описати тариф, і план, у якому заповнені обидва, — помилка
 * оператора, а не команда «застосуй обидва».
 *
 * `money()` на кожну ніч окремо, а не на суму: саме так рахує пошук, і саме
 * так гроші округлюються всюди в цьому проєкті (інваріант 9). Знижка 20 % від
 * 119 € — це 95,20 € за ніч, а не 95 і не 95,2 після трьох ночей.
 */
export function ratePlanNightPrice(basePrice: number, plan?: RatePlan | null): number {
  const base = num(basePrice) ?? 0;
  if (!plan) return base;

  const fixed = num(plan.fixed_price);
  if (fixed !== null) return money(fixed);

  const pct = num(plan.pricing_modifier_percent);
  if (plan.pricing_mode === 'dependent' && pct !== null) {
    return plan.pricing_modifier_type === 'more'
      ? money(base * (1 + pct / 100))
      : money(base * (1 - pct / 100));
  }

  return base;
}

/**
 * Чи тариф сам називає ціну — тобто чи потрібен йому взагалі календар цін.
 *
 * `widget-reserve` відмовляє в бронюванні, коли ніч не має ціни, і це
 * правильно: підтвердити бронь за вигаданим числом гірше, ніж відмовити. Але
 * тариф із `fixed_price` — це і є ціна, названа готелем, тож відмовляти в ній
 * означало б відмовити гостю, якому щойно показали суму.
 */
export function ratePlanNamesItsOwnPrice(plan?: RatePlan | null): boolean {
  return !!plan && num(plan.fixed_price) !== null;
}
