/**
 * Тіло збереження з МАСОВОГО редактора цін — і чому воно живе поруч із денним.
 *
 *   node src/modules/pricing/ui/bulk-edit.check.ts
 *
 * Блок 6 закрив «порожнє поле ціни вихідних мовчки перебиває щойно введену
 * ціну» в денній модалці (`day-edit.ts`) і НЕ закрив у масовій. Рецензія
 * раунду 9 (Р9.1) відтворила це на живій базі: `base_price: 333` на 25–28.11
 * при `weekend_price` 115 давало 25.11 → 333, 26.11 → 333, а 27.11 і 28.11
 * (пʼятниця й субота) → 115. Дослівно те, чого 07.09.2026 не зміг зробити
 * власник, і саме тим шляхом, яким ціну ставлять на місяць.
 *
 * Причина була не в правилі, а в тому, ЩО вважається «не змінювали». У
 * простому режимі поля вихідних на екрані немає, галочки «Прибрати» теж —
 * отже `clearWeekend` завжди `false`, `weekendPrice` завжди порожній, і вираз
 * у JSX давав `undefined`, тобто «не чіпати». Поле, якого на екрані немає, не
 * може бути змінене — це правильно; але воно так само не має права ПЕРЕБИТИ
 * поле, яке там є.
 *
 * Тому обидва екрани відповідають на це однією семантикою:
 *
 *   простий режим + ціну ЗМІНЕНО   → `weekend_price: null` (прибрати)
 *   простий режим + ціну не чіпали → `weekend_price` не називається взагалі
 *   розширений режим               → як оператор сказав полем і галочкою
 *
 * Винесено з JSX з тієї ж причини, що й `buildDayPayload` (рецензія раунду 5,
 * правка 5.2): поки збірка тіла жила в компоненті, гейт міг стверджувати лише
 * ФОРМУ виразу. Тут стверджується поведінка, а про екран лишається один рядок
 * — «модалка кличе `buildBulkPayload`».
 */
import type { DayEditPayload } from './day-edit';

export type BulkApplyTo = 'all' | 'weekdays' | 'weekends';

/** Стан масової форми — рівно те, що бачить оператор у полях. */
export interface BulkEditForm {
  dateFrom: string;
  dateTo: string;
  applyTo: BulkApplyTo;
  /** Порожньо — «не змінювати». */
  basePrice: number | '';
  /** Порожньо — «не змінювати» (розширений режим). */
  weekendPrice: number | '';
  /** «Прибрати ціну вихідних» — явна дія, лише в розширеному режимі. */
  clearWeekend: boolean;
  minStay: number | '';
  maxStay: number | '';
  /** `undefined` — «не змінювати»: у масовій формі це третій стан прапорця. */
  closed?: boolean;
  cta?: boolean;
  ctd?: boolean;
}

export interface BulkEditFlags {
  /** У «Чия ціна» обрано тариф. */
  ratePlanSelected: boolean;
  /** «На всі тарифи типу». */
  allPlans: boolean;
  /** «Розширені ціни» — за замовчуванням вимкнено (Блок 6, п.5). */
  advanced: boolean;
}

export type BulkEditPayload = DayEditPayload & {
  dateFrom: string;
  dateTo: string;
  applyTo: BulkApplyTo;
  restrictionsScope?: 'pair' | 'type';
};

const num = (v: number | ''): number | undefined => (v === '' ? undefined : Number(v));

export function buildBulkPayload(form: BulkEditForm, flags: BulkEditFlags): BulkEditPayload {
  const base = num(form.basePrice);
  const priceChanged = base !== undefined;

  // Та сама розвилка, що в `buildDayPayload`, і навмисно тими ж словами.
  const weekend = flags.advanced
    ? (form.clearWeekend ? null : num(form.weekendPrice))
    // У простому режимі ціна вихідних невидима, тож або прибирається разом зі
    // зміною ціни, або не називається зовсім. Третього стану немає.
    : (priceChanged ? null : undefined);

  const payload: BulkEditPayload = {
    dateFrom: form.dateFrom,
    dateTo: form.dateTo,
    applyTo: form.applyTo,
    base_price: base,
    weekend_price: weekend,
    min_stay: num(form.minStay),
    // Максимум ночей і CTA/CTD — розширені поля: у простому режимі їх на
    // екрані немає, отже оператор їх не міняв і називати їх не можна.
    max_stay: flags.advanced ? num(form.maxStay) : undefined,
    closed: form.closed,
    cta: flags.advanced ? form.cta : undefined,
    ctd: flags.advanced ? form.ctd : undefined,
  };

  // Область має сенс лише коли в тілі є обмеження (Ц32 переглянуто).
  if (flags.ratePlanSelected) payload.restrictionsScope = flags.allPlans ? 'type' : 'pair';
  return payload;
}
