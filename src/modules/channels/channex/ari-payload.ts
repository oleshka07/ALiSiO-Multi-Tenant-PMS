/**
 * Доменні зміни → тіло повідомлення Channex, стиснуте в діапазони.
 *
 * ЧОМУ СТИСНЕННЯ — НЕ ОПТИМІЗАЦІЯ, А ВИМОГА. Сертифікаційні тести 3–8
 * формулюють це як умову проходження: тест 8 просить оновити ціну з
 * 1 грудня по 1 травня і додає «This should be **1 API call**», а тест 3 —
 * «Your integration must batch these into 1 API call. If your current code
 * loops per-date, this is a sign you need to refactor before certifying».
 * Цикл по датах названий підставою для відмови прямо в документі.
 *
 * Друга причина — ліміт: 10 повідомлень на хвилину на об'єкт (`limiter.ts`).
 * Пів року окремими датами — це 152 повідомлення, тобто пятнадцять хвилин
 * тільки на одну зміну ціни. Стиснення перетворює їх на одне.
 *
 * ЩО САМЕ СТИСКАЄТЬСЯ. Суміжні дати з ОДНАКОВИМ набором значень для однієї
 * сутності. Порівнюються всі поля, а не лише ціна: діапазон, у якому ціна
 * та сама, а мінімальний строк різний, — це два діапазони, і склеїти їх
 * означало б тихо переписати обмеження.
 *
 * ЧОГО НЕ РОБИМО. `null` у поле не пишеться ніколи. Документація ARI
 * відповідає на нього попередженням «Should be a non null value or not
 * existed field» — тобто поле треба НЕ НАДСИЛАТИ, а не надсилати порожнім.
 * Порожнє поле означало б «скинь», і канал перестав би продавати за
 * умовами, яких ніхто не міняв.
 */
import type { AvailabilityChange, RateChange, DateStr, Unmapped } from '../port';

/** Що адаптер уміє перекласти в чужі ідентифікатори. */
export interface IdMap {
  /** Наш ідентифікатор → ідентифікатор на боці Channex. */
  get(localId: string): string | undefined;
}

/**
 * Дзеркало ПАР «наш тариф × наш тип номера → тариф Channex».
 *
 * Не `IdMap` за тарифом: один наш тариф на чотирьох типах — чотири їхні
 * (Ц10, дзеркало 0056), і сам `ratePlanId` не називає жодного з них.
 */
export interface PairMap {
  get(ratePlanId: string, unitTypeId: string): string | undefined;
}

/** Ціна однієї заселеності в тілі повідомлення. */
export type AriRate = { occupancy: number; rate: number };

/**
 * Один запис у `values[]`. Ключі — вже чужі, це вміст повідомлення.
 *
 * Масив серед типів значення — це `rates[]` (И12), і він там навмисно: ціна
 * не буває одним числом, навіть коли заселеність одна.
 */
export type AriValue = Record<string, string | number | boolean | AriRate[]>;

/** Дата наступного дня. Рядкова арифметика, без Date і без часових поясів. */
function nextDay(date: DateStr): DateStr {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  return t.toISOString().slice(0, 10);
}

/**
 * Згорнути послідовні дати з однаковими значеннями в діапазони.
 *
 * `key` розділяє потоки (сутність), `shape` каже, що вважати «тим самим».
 */
function compress<T extends { date: DateStr }>(
  changes: T[],
  key: (c: T) => string,
  shape: (c: T) => string,
  emit: (sample: T, from: DateStr, to: DateStr) => AriValue,
): AriValue[] {
  const streams = new Map<string, T[]>();
  for (const c of changes) {
    const k = key(c);
    const list = streams.get(k);
    if (list) list.push(c);
    else streams.set(k, [c]);
  }

  const out: AriValue[] = [];
  for (const list of streams.values()) {
    // Впорядковано за датою: без цього «суміжність» нічого не означає.
    list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    let runStart = 0;
    for (let i = 1; i <= list.length; i++) {
      const prev = list[i - 1];
      const cur = list[i];
      const continues =
        cur !== undefined && cur.date === nextDay(prev.date) && shape(cur) === shape(prev);
      if (continues) continue;
      out.push(emit(list[runStart], list[runStart].date, prev.date));
      runStart = i;
    }
  }
  return out;
}

/** Значення, яких не було, у тіло не потрапляють — див. примітку про `null`. */
function put(target: AriValue, field: string, value: number | boolean | undefined): void {
  if (value === undefined) return;
  target[field] = value;
}

/**
 * Наявність: `room_type_id` × дата → ціле.
 *
 * Тип, якого немає в мапінгу, пропускається мовчки тут і голосно вище:
 * відправити чуже або вигадане `room_type_id` гірше, ніж не відправити
 * нічого, бо воно ляже на чужий номер.
 */
export function availabilityValues(
  remotePropertyId: string,
  changes: AvailabilityChange[],
  unitTypes: IdMap,
): { values: AriValue[]; unmapped: Unmapped[] } {
  const unmapped = new Map<string, Unmapped>();
  const mapped = changes.filter((c) => {
    const remote = unitTypes.get(c.unitTypeId);
    if (!remote) unmapped.set(c.unitTypeId, { unitTypeId: c.unitTypeId });
    return Boolean(remote);
  });

  const values = compress(
    mapped,
    (c) => c.unitTypeId,
    (c) => String(c.free),
    (sample, from, to) => {
      const v: AriValue = {
        property_id: remotePropertyId,
        room_type_id: unitTypes.get(sample.unitTypeId)!,
        availability: sample.free,
      };
      return withDates(v, from, to);
    },
  );

  return { values, unmapped: [...unmapped.values()] };
}

/**
 * Ціни й обмеження: `rate_plan_id` × дата → ціна та умови.
 *
 * Ціна йде цілим у мінорних одиницях — Channex приймає і рядок `"200.00"`,
 * і ціле `20000`, і друге безпечніше: воно не проходить через десятковий
 * роздільник і не залежить від локалі.
 *
 * Ніч без ціни сюди не потрапляє числом: `prices` відсутній, а
 * `closed: true` каже каналу не продавати (інваріанти И2 і 17). Нуль як
 * ціна відхиляється самим Channex — «must be greater than 0», — тож
 * «безкоштовна ніч» неможлива навіть технічно.
 *
 * ── Чому `rates[]`, а не одне число (И12) ────────────────────────────────
 *
 * Голий ключ ціни рухає лише ОСНОВНУ опцію заселеності; решта лишаються зі
 * старою ціною, і відповідь чиста. Виміряно на живому API 01.09.2026.
 * Стиснення діапазонів тому порівнює ВЕСЬ набір цін: діапазон, у якому ціна
 * для двох та сама, а для трьох інша, — це два діапазони.
 */
export function rateValues(
  remotePropertyId: string,
  changes: RateChange[],
  ratePlans: PairMap,
): { values: AriValue[]; unmapped: Unmapped[] } {
  // Незмаплена — ПАРА, і названа парою: сам тариф на сусідньому типі може
  // бути змаплений, тож «тариф rp не змаплений» оператору збрехало б.
  const unmapped = new Map<string, Unmapped>();
  const mapped = changes.filter((c) => {
    const remote = ratePlans.get(c.ratePlanId, c.unitTypeId);
    if (!remote) unmapped.set(`${c.ratePlanId}|${c.unitTypeId}`, { ratePlanId: c.ratePlanId, unitTypeId: c.unitTypeId });
    return Boolean(remote);
  });

  // Набір цін входить у порівняння цілком, і в стабільному порядку: два
  // однакові набори, записані по-різному, — це один і той самий діапазон.
  const priceShape = (c: RateChange) => (c.prices ?? [])
    .map((r) => [r.occupancy, r.priceMinor])
    .sort((a, b) => a[0] - b[0]);
  const shapeOf = (c: RateChange) =>
    JSON.stringify([priceShape(c), c.closed, c.minStay, c.maxStay, c.noArrival, c.noDeparture]);

  const values = compress(
    mapped,
    // Потік — пара, не тариф: той самий наш тариф на двох типах це два їхні
    // тарифи з різними цінами, і склеїти їх в один діапазон не можна.
    (c) => `${c.ratePlanId}|${c.unitTypeId}`,
    shapeOf,
    (sample, from, to) => {
      const v: AriValue = {
        property_id: remotePropertyId,
        rate_plan_id: ratePlans.get(sample.ratePlanId, sample.unitTypeId)!,
      };
      // `rates[]`, ніколи голий ключ ціни — И12. Порожній набір означає
      // «ціни не міняли», і тоді поля немає взагалі: порожнє поле Channex
      // читає як «скинь», а скидати ми нічого не просили.
      if (sample.prices && sample.prices.length) {
        v.rates = [...sample.prices]
          .sort((a, b) => a.occupancy - b.occupancy)
          .map((r) => ({ occupancy: r.occupancy, rate: r.priceMinor }));
      }
      put(v, 'stop_sell', sample.closed);
      // Явне поле заїзду, не «віртуальне» `min_stay`: вендор застосовує
      // віртуальне лише при `min_stay_type ≠ both`, а обʼєкт, заведений
      // нашим майстром, має саме `both` — і `min_stay: 2` пройшов повз
      // (живе 02.09.2026, INC-015). Семантика наша — мінімум для стану, що
      // заїжджає в цю дату: так само його читає котирування.
      put(v, 'min_stay_arrival', sample.minStay);
      put(v, 'max_stay', sample.maxStay);
      put(v, 'closed_to_arrival', sample.noArrival);
      put(v, 'closed_to_departure', sample.noDeparture);
      return withDates(v, from, to);
    },
  );

  return { values, unmapped: [...unmapped.values()] };
}

/**
 * Одна дата пишеться як `date`, кілька — як `date_from`/`date_to`.
 *
 * Не «завжди діапазон»: одноденна зміна — найчастіший випадок, і
 * `date_from == date_to` читається в журналі гірше, ніж просто дата.
 */
function withDates(value: AriValue, from: DateStr, to: DateStr): AriValue {
  if (from === to) value.date = from;
  else {
    value.date_from = from;
    value.date_to = to;
  }
  return value;
}
