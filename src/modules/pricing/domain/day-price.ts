/**
 * Яке число рядка календаря діє на цю дату — і З ЯКОЇ колонки воно взялося.
 *
 * ── Навіщо окремий модуль ───────────────────────────────────────────────
 *
 * Правило «пʼятниця, субота й неділя беруть `weekend_price`, якщо він є»
 * було написане ТРИЧІ: у `nightly-price.ts` (ціна для гостя), у
 * `price-calendar.repo.ts` (`effective_price` для сітки місяця) і в
 * `widget-calendar-public.handlers.ts` (мінімум по днях у віджеті). Три
 * копії одного правила — це три відповіді на питання «скільки коштує ця
 * ніч», і вони вже розходились: у сітці не було варти на нуль і відʼємне,
 * яку `nightly-price` має з 0062.
 *
 * Гірше за розбіжність — мовчазність. 07.09.2026 власник поставив на 22
 * листопада ціну 333 і не зміг її отримати: на суботу діяв `weekend_price`
 * 115, екран показував 115, і ніде не було сказано, ЧОМУ. Код відпрацював
 * як написано; непрохідним був інтерфейс, бо число на екрані не називало
 * свого джерела.
 *
 * Тому тут одна функція, і вона повертає ДВА факти: число і колонку, з якої
 * воно взяте. Колонка — це те, що екран показує підписом; рахувати її
 * заново на екрані означало б завести четверту копію правила (інваріант 16).
 */

/** Пʼятниця, субота, неділя — за UTC, як усюди в календарі. */
export function isWeekendDate(date: string): boolean {
  const dow = new Date(`${date.slice(0, 10)}T00:00:00Z`).getUTCDay();
  return dow === 0 || dow === 5 || dow === 6;
}

export type PriceColumn = 'base' | 'weekend';

export interface DayRowPrice {
  /** `null` — рядок ціни не має (лише обмеження): ніч не продається. */
  price: number | null;
  /** Колонка, з якої взяте число. При `price === null` — `'base'`. */
  column: PriceColumn;
}

/**
 * Ціна рядка на дату.
 *
 * Нуль і відʼємне читаються як «ціни немає» (Ц24): писачі їх більше не
 * приймають, але рядок міг лягти повз писача або до відмови — і
 * `weekend_price = 0` продавав пʼятницю за нуль тим самим шляхом, який 0062
 * закрила для буднів.
 */
export function dayRowPrice(
  row: { base_price?: unknown; weekend_price?: unknown } | null | undefined,
  date: string,
): DayRowPrice {
  if (!row) return { price: null, column: 'base' };
  const named = (v: unknown): number | null => {
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const weekend = named(row.weekend_price);
  if (isWeekendDate(date) && weekend != null) return { price: weekend, column: 'weekend' };
  return { price: named(row.base_price), column: 'base' };
}

/**
 * Звідки взялося число, яке бачить оператор — одним ключем.
 *
 * `priceNights()` називає ТАБЛИЦЮ (`rate_plan` | `matrix` | `calendar`), а
 * оператор питає інше: «чому тут 115, коли я ставив 333». Відповідь на це —
 * таблиця ПЛЮС колонка, і ці чотири ключі покривають усі випадки, які
 * бачить екран цін.
 */
export type PriceOrigin = 'rate_plan' | 'rate_plan_weekend' | 'matrix' | 'unit_type' | 'unit_type_weekend';

export function priceOrigin(source: 'rate_plan' | 'matrix' | 'calendar', column: PriceColumn = 'base'): PriceOrigin {
  if (source === 'matrix') return 'matrix';
  const weekend = column === 'weekend';
  if (source === 'rate_plan') return weekend ? 'rate_plan_weekend' : 'rate_plan';
  return weekend ? 'unit_type_weekend' : 'unit_type';
}
