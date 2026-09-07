/**
 * Звідки взялося число кожного дня місяця — очима того ж резолвера, що й гість.
 *
 * Сітка місяця (`getPriceMonth`) читає рядки календаря і знає лише їх. Гість
 * же платить за іншим порядком: МАТРИЦЯ заселеності перекриває календар, а
 * власний рядок тарифу перекриває базовий (`nightly-price.ts`). Тому підпис
 * «звідки це число» не можна вивести з полів рядка — його дає `priceNights`,
 * і саме тому цей файл існує окремо від сітки.
 *
 * Один виклик на місяць, не тридцять: `priceNights` цінує весь проміжок за
 * раз, і кожна ніч уже несе своє джерело. Другого розрахунку тут немає — є
 * переклад двох фактів (таблиця + колонка) в один ключ для екрана.
 */
import { priceNights } from './nightly-price';
import { priceOrigin, type PriceOrigin } from '../domain/day-price';
import { getSql } from '@core/db/async';

export async function monthOrigins(
  unitTypeId: string,
  month: number,
  year: number,
  ratePlanId?: string,
): Promise<Record<string, PriceOrigin>> {
  const lastDay = new Date(year, month, 0).getDate();
  const first = `${year}-${String(month).padStart(2, '0')}-01`;

  // Скільки дорослих цінувати. Базова заселеність типу — та сама кількість,
  // за якою готель називає ціну в переліку; інакше матриця відповідала б про
  // іншу колонку, ніж та, що на екрані.
  const ut = await getSql().row<{ base_occupancy?: unknown }>(
    'SELECT base_occupancy FROM unit_types WHERE id = ?', [unitTypeId]);
  const adults = Math.max(1, Number(ut?.base_occupancy ?? 2) || 2);

  const quote = await priceNights({
    unitTypeId, checkIn: first, nights: lastDay, adults,
    ratePlanId: ratePlanId ?? null,
    // Екран оператора — не канал і не сайт: правила, які діють на прямому
    // шляху, тут видно так само, як їх побачить адміністратор у квоті.
    channel: 'operator',
  });

  const out: Record<string, PriceOrigin> = {};
  for (const n of quote.nights) out[n.date] = priceOrigin(n.source, n.column);
  return out;
}
