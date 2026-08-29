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
import type { AvailabilityChange, RateChange, DateStr } from '../port';

/** Що адаптер уміє перекласти в чужі ідентифікатори. */
export interface IdMap {
  /** Наш ідентифікатор → ідентифікатор на боці Channex. */
  get(localId: string): string | undefined;
}

/** Один запис у `values[]`. Ключі — вже чужі, це вміст повідомлення. */
export type AriValue = Record<string, string | number | boolean>;

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
): { values: AriValue[]; unmapped: string[] } {
  const unmapped = new Set<string>();
  const mapped = changes.filter((c) => {
    const remote = unitTypes.get(c.unitTypeId);
    if (!remote) unmapped.add(c.unitTypeId);
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

  return { values, unmapped: [...unmapped] };
}

/**
 * Ціни й обмеження: `rate_plan_id` × дата → ціна та умови.
 *
 * Ціна йде цілим у мінорних одиницях — Channex приймає і рядок `"200.00"`,
 * і ціле `20000`, і друге безпечніше: воно не проходить через десятковий
 * роздільник і не залежить від локалі.
 *
 * Ніч без ціни сюди не потрапляє числом: `priceMinor` відсутній, а
 * `closed: true` каже каналу не продавати (інваріанти И2 і 17). Нуль як
 * ціна відхиляється самим Channex — «must be greater than 0», — тож
 * «безкоштовна ніч» неможлива навіть технічно.
 */
export function rateValues(
  remotePropertyId: string,
  changes: RateChange[],
  ratePlans: IdMap,
): { values: AriValue[]; unmapped: string[] } {
  const unmapped = new Set<string>();
  const mapped = changes.filter((c) => {
    const remote = ratePlans.get(c.ratePlanId);
    if (!remote) unmapped.add(c.ratePlanId);
    return Boolean(remote);
  });

  const shapeOf = (c: RateChange) =>
    JSON.stringify([c.priceMinor, c.closed, c.minStay, c.maxStay, c.noArrival, c.noDeparture]);

  const values = compress(
    mapped,
    (c) => c.ratePlanId,
    shapeOf,
    (sample, from, to) => {
      const v: AriValue = {
        property_id: remotePropertyId,
        rate_plan_id: ratePlans.get(sample.ratePlanId)!,
      };
      put(v, 'rate', sample.priceMinor);
      put(v, 'stop_sell', sample.closed);
      put(v, 'min_stay', sample.minStay);
      put(v, 'max_stay', sample.maxStay);
      put(v, 'closed_to_arrival', sample.noArrival);
      put(v, 'closed_to_departure', sample.noDeparture);
      return withDates(v, from, to);
    },
  );

  return { values, unmapped: [...unmapped] };
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
