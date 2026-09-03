/**
 * Історія змін броні — що саме змінилось, людською мовою.
 *
 * Один опис для двох читачів: рецепції, яка дивиться картку («хто пересунув
 * заїзд?»), і рецензента каналу, якому показують скріншот («зміна дійшла?»).
 * Знімки «до» і «після» — сирі рядки `reservations`; тут із них
 * вибираються лише поля, які людина впізнає, і кожне називається.
 *
 * Чистий модуль: без бази й без React, щоб і писач (текст запису), і
 * картка (рядки різниці) рахували одне й те саме.
 */

export interface ChangeLine {
  /** Ключ поля — для іконки чи стилю на картці. */
  field: 'dates' | 'nights' | 'guests' | 'price' | 'status' | 'payment' | 'unit_type' | 'unit' | 'guest';
  /** Підпис поля, мовою оператора (перекладає картка через t()). */
  label: string;
  from: string;
  to: string;
}

/** Знімок броні, збагачений назвами там, де в рядку лише id. */
export interface BookingSnapshot {
  check_in?: unknown;
  check_out?: unknown;
  nights?: unknown;
  adults?: unknown;
  children?: unknown;
  total_price?: unknown;
  currency?: unknown;
  status?: unknown;
  payment_status?: unknown;
  unit_type_id?: unknown;
  unit_type_name?: unknown;
  unit_id?: unknown;
  unit_code?: unknown;
  guest_name?: unknown;
}

const day = (v: unknown): string => {
  if (!v) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};
const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));
const text = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

/**
 * Рядки різниці між двома знімками. Поле, яке не змінилось, не називається;
 * поле, якого немає в жодному знімку, теж.
 */
export function describeChanges(before: BookingSnapshot | null | undefined, after: BookingSnapshot | null | undefined): ChangeLine[] {
  const b = before ?? {};
  const a = after ?? {};
  const out: ChangeLine[] = [];

  const datesB = `${day(b.check_in)}${b.check_in || b.check_out ? ' → ' : ''}${day(b.check_out)}`;
  const datesA = `${day(a.check_in)}${a.check_in || a.check_out ? ' → ' : ''}${day(a.check_out)}`;
  if ((b.check_in || b.check_out || a.check_in || a.check_out) && datesB !== datesA) {
    out.push({ field: 'dates', label: 'Дати', from: datesB, to: datesA });
  }
  if (num(b.nights) !== num(a.nights) && (num(b.nights) !== null || num(a.nights) !== null)) {
    out.push({ field: 'nights', label: 'Ночей', from: text(b.nights), to: text(a.nights) });
  }
  const guestsB = b.adults === undefined && b.children === undefined ? '' : `${num(b.adults) ?? 0}+${num(b.children) ?? 0}`;
  const guestsA = a.adults === undefined && a.children === undefined ? '' : `${num(a.adults) ?? 0}+${num(a.children) ?? 0}`;
  if ((guestsB || guestsA) && guestsB !== guestsA) {
    out.push({ field: 'guests', label: 'Гостей', from: guestsB, to: guestsA });
  }
  const priceB = num(b.total_price);
  const priceA = num(a.total_price);
  if ((priceB !== null || priceA !== null) && (priceB !== priceA || text(b.currency) !== text(a.currency))) {
    out.push({
      field: 'price', label: 'Сума',
      from: priceB === null ? '' : `${priceB} ${text(b.currency)}`.trim(),
      to: priceA === null ? '' : `${priceA} ${text(a.currency)}`.trim(),
    });
  }
  if (text(b.status) !== text(a.status) && (b.status || a.status)) {
    out.push({ field: 'status', label: 'Статус', from: text(b.status), to: text(a.status) });
  }
  if (text(b.payment_status) !== text(a.payment_status) && (b.payment_status || a.payment_status)) {
    out.push({ field: 'payment', label: 'Оплата', from: text(b.payment_status), to: text(a.payment_status) });
  }
  const typeB = text(b.unit_type_name ?? b.unit_type_id);
  const typeA = text(a.unit_type_name ?? a.unit_type_id);
  if (typeB !== typeA && (typeB || typeA)) {
    out.push({ field: 'unit_type', label: 'Тип номера', from: typeB, to: typeA });
  }
  const unitB = text(b.unit_code ?? b.unit_id);
  const unitA = text(a.unit_code ?? a.unit_id);
  if (unitB !== unitA && (unitB || unitA)) {
    out.push({ field: 'unit', label: 'Номер', from: unitB || '—', to: unitA || '—' });
  }
  if (text(b.guest_name) !== text(a.guest_name) && (b.guest_name || a.guest_name)) {
    out.push({ field: 'guest', label: 'Гість', from: text(b.guest_name), to: text(a.guest_name) });
  }
  return out;
}

/** Рядки різниці одним реченням — для тексту запису в журналі. */
export function changesToText(lines: ChangeLine[]): string {
  return lines.map((l) => `${l.label}: ${l.from || '—'} → ${l.to || '—'}`).join('; ');
}
