/**
 * Тіло збереження з редактора дня — лише те, що оператор справді змінив.
 *
 *   node src/modules/pricing/ui/day-edit.check.ts
 *
 * Модалка засівається ЕФЕКТИВНИМИ значеннями дня (`getPriceMonth`): для пари
 * тип × тариф це або власне обмеження пари, або успадковане від типу — на
 * екрані вони виглядають однаково, і це правильно. Тому форма, яка шле всі
 * поля завжди, перетворює «подивився» на «записав»: збереження ціни одного
 * тарифу переносило його власний мінімум (чи «Закрито») у базовий рядок типу,
 * звідки він накривав СУСІДНІ тарифи, і координата лягала на кожну пару —
 * дослівно «Unexpected rate plan in update» з листа Channex, а в проді номер,
 * знятий з продажу на всіх тарифах через правку ціни одного (рецензія 07.09
 * раунд 2, правка 1).
 *
 * Писач уміє «не чіпати»: поля немає в запиті — колонка лишається як лежала
 * (`keepOrSet`). Уся робота тут — не назвати того, чого не міняли.
 *
 * `null` в обмеженні означає «як у типу»: писач кладе в рядок пари NULL, і
 * пара знову успадковує (`pairAfter`). Це операторська дія «Як у типу», без
 * неї пара, що раз дістала власне значення, з екрана до успадкування не
 * повертається (правка 3 тієї ж рецензії).
 */

/** Колонки обмежень у порядку, у якому їх бачить оператор. */
export const DAY_RESTRICTION_KEYS = ['min_stay', 'max_stay', 'closed', 'cta', 'ctd'] as const;

/** Значення дня у формі: `null` в обмеженні — «як у типу». */
export interface DayEditFields {
  /** `null` — ціни немає (день не продається); поле в модалці порожнє. */
  base_price: number | null;
  weekend_price: number | null;
  min_stay: number | null;
  max_stay?: number | null;
  closed: boolean | null;
  cta: boolean | null;
  ctd: boolean | null;
}

/** Те, що йде в `prices[0]` запиту: названі поля і нічого більше. */
export type DayEditPayload = Partial<DayEditFields>;

const KEYS = ['base_price', 'weekend_price', ...DAY_RESTRICTION_KEYS] as const;

/**
 * Поля, які РІЗНЯТЬСЯ між станом при відкритті модалки і станом при
 * збереженні. Однакове не називається взагалі: назване однакове — це запис,
 * і для обмежень пари він осідає в типі.
 *
 * `undefined` і `null` — різні речі: `undefined` тут не буває (форма завжди
 * має стан), `null` означає «прибрати» для ціни вихідних і «як у типу» для
 * обмеження, і його треба надіслати.
 */
export function changedDayFields(opened: DayEditFields, edited: DayEditFields): DayEditPayload {
  const payload: Record<string, unknown> = {};
  for (const key of KEYS) {
    const before = opened[key] ?? null;
    const after = edited[key] ?? null;
    if (before !== after) payload[key] = after;
  }
  return payload as DayEditPayload;
}

/** Чи несе тіло хоч одне обмеження — лише тоді має сенс область («на всі тарифи типу»). */
export function hasRestrictionField(payload: DayEditPayload): boolean {
  return DAY_RESTRICTION_KEYS.some((key) => payload[key] !== undefined);
}

/**
 * «Як у типу»: усі обмеження пари в NULL. Ціни не чіпає — вона належить
 * тарифу і після скидання обмежень лишається його власною.
 */
export function inheritRestrictionsPayload(): DayEditPayload {
  return { min_stay: null, max_stay: null, closed: null, cta: null, ctd: null };
}

/** Стан форми редактора дня — рівно те, що бачить оператор у полях. */
export interface DayEditForm {
  /** Порожньо — «ціну не чіпати» (2.0), а не «прибрати». */
  basePrice: number | '';
  /** Порожньо — прибрати ціну вихідних. */
  weekendPrice: number | '';
  minStay: number;
  closed: boolean;
  cta: boolean;
  ctd: boolean;
}

/** Прапорці модалки, які вирішують область запису. */
export interface DayEditFlags {
  /** У «Чия ціна» обрано тариф. */
  ratePlanSelected: boolean;
  /** «На всі тарифи типу» — за замовчуванням ЗНЯТО (Блок 6, п.3). */
  allPlans: boolean;
  /** «Як у типу» — скинути власні обмеження пари. */
  inherit: boolean;
  /**
   * «Розширені ціни» — за замовчуванням вимкнено (Блок 6, п.5).
   *
   * У простому режимі оператор бачить лише «Ціну» і «Мін. ночей». Тому зміна
   * ціни в ньому мусить ПРИБИРАТИ ціну вихідних: інакше повторюється рівно те,
   * через що заведено весь блок — 07.09.2026 власник поставив на суботу 333,
   * а гість платив 115, бо на дні лежала невидима йому ціна вихідних. Поле,
   * якого на екрані немає, не має права перебивати поле, яке там є.
   */
  advanced: boolean;
}

/**
 * Тіло запиту, яке шле модалка дня — цілком, від стану дня і форми до
 * області обмежень.
 *
 * Винесено з JSX навмисно (рецензія 07.09 раунд 5, правка 5.2). Поки збірка
 * тіла жила в компоненті, гейт міг стверджувати лише ФОРМУ виразу — і
 * пропускав три саботажі, що імітують той самий дефект: домішування сирого
 * стану поверх обчисленого, проміжна змінна, порожня база порівняння. Тепер
 * стверджується ПОВЕДІНКА цієї функції, а про екран лишається один рядок —
 * «модалка кличе `buildDayPayload`».
 */
export function buildDayPayload(opened: DayEditFields, form: DayEditForm, flags: DayEditFlags): DayEditPayload & { restrictionsScope?: 'pair' | 'type' } {
  const basePrice = form.basePrice === '' ? opened.base_price : Number(form.basePrice);
  // У простому режимі полів вихідних, CTA/CTD і максимуму на екрані немає —
  // отже, оператор їх не міняв, і надсилати їхні значення не можна. Виняток
  // один і він же суть режиму: якщо ціну ЗМІНЕНО, ціна вихідних прибирається,
  // бо інакше вона мовчки перебила б щойно введене число.
  const priceChanged = basePrice !== opened.base_price;
  const edited: DayEditFields = flags.advanced
    ? {
      // Порожня ціна — «не чіпати», тому дорівнює тому, що лежало.
      base_price: basePrice,
      weekend_price: form.weekendPrice === '' ? null : Number(form.weekendPrice),
      min_stay: form.minStay, closed: form.closed, cta: form.cta, ctd: form.ctd,
    }
    : {
      base_price: basePrice,
      weekend_price: priceChanged ? null : opened.weekend_price,
      // «Закрито» лишається і в простому режимі: для готелю на 1–15 номерів
      // це головна щоденна дія, і в переліку «розширених» його немає. CTA,
      // CTD і максимум ночей — за перемикачем, тож їхні значення беруться з
      // того, що лежало: поле, якого на екрані немає, не може бути змінене.
      min_stay: form.minStay, closed: form.closed, cta: opened.cta, ctd: opened.ctd,
    };
  const changed = flags.inherit
    // Скидання обмежень пари: ціна — як звичайно, обмеження — всі в NULL.
    ? {
      ...changedDayFields(opened, { ...opened, base_price: edited.base_price, weekend_price: edited.weekend_price }),
      ...inheritRestrictionsPayload(),
    }
    : changedDayFields(opened, edited);
  // Область має сенс лише коли в тілі є обмеження; скидання — завжди на пару.
  if (!flags.ratePlanSelected || !hasRestrictionField(changed)) return changed;
  return { ...changed, restrictionsScope: flags.inherit || !flags.allPlans ? 'pair' : 'type' };
}
