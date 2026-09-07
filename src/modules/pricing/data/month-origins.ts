/**
 * Скільки коштує кожна ніч місяця гостю — і звідки взялося це число.
 *
 * Сітка місяця (`getPriceMonth`) читає рядки календаря і знає лише їх. Гість
 * же платить за іншим порядком: МАТРИЦЯ заселеності перекриває календар, а
 * власний рядок тарифу перекриває базовий (`nightly-price.ts`). Тому ні
 * підпис «звідки це число», ні саме число не можна вивести з полів рядка —
 * обидва дає `priceNights`, і саме тому цей файл існує окремо від сітки.
 *
 * ── Число і підпис віддаються РАЗОМ (рецензія раунду 9, Р9.2) ────────────
 *
 * Спершу тут повертався лише підпис, а число клітинка брала зі своєї сітки.
 * Два резолвери на одну клітинку дали рівно те, чого й слід було чекати: на
 * живій базі екран показував «100 · матриця заселеності», тоді як матриця
 * каже 120 — стільки й платить гість. Підпис під чужим числом гірший за
 * відсутній підпис, бо він неправдивий. Тому тип тут один обʼєкт: розділити
 * число й підпис у споживача більше нема з чого.
 *
 * ── Чому по одній ночі, а не однією поїздкою на місяць ───────────────────
 *
 * Спершу був один виклик `priceNights` на весь місяць (`nights: lastDay`), і
 * це давало неправильні числа мовчки: знижка за довжину перебування (LOS-тір
 * матриці) і правила з умовою «від N ночей» застосовувались до всієї сітки,
 * бо тридцять ночей — це одна довга поїздка. Сітка цін означає інше: скільки
 * коштує ЦЯ ніч сама по собі. Тому кадрування тут те саме, що в каналі
 * (`channex/ari-adapter.ts:247`): `nights: 1`, `checkIn: date`. Ціна на екрані
 * оператора збігається з ціною, яка поїде в OTA, і це не збіг, а те саме
 * питання, поставлене однаково.
 *
 * Ціна: тридцять викликів замість одного на кожне відкриття екрана. Це екран
 * одного оператора, не гарячий шлях, і правильне число дорожче за швидкість.
 */
import { priceNights } from './nightly-price';
import { priceOrigin, type PriceOrigin } from '../domain/day-price';
import { getSql } from '@core/db/async';

/** Скільки платить гість за цю ніч і звідки число — нерозривно. */
export interface GuestNightPrice {
  price: number;
  origin: PriceOrigin;
}

export async function monthGuestPrices(
  unitTypeId: string,
  month: number,
  year: number,
  ratePlanId?: string,
): Promise<Record<string, GuestNightPrice>> {
  const lastDay = new Date(year, month, 0).getDate();

  // Скільки дорослих цінувати. Базова заселеність типу — та сама кількість,
  // за якою готель називає ціну в переліку; інакше матриця відповідала б про
  // іншу колонку, ніж та, що на екрані.
  const ut = await getSql().row<{ base_occupancy?: unknown }>(
    'SELECT base_occupancy FROM unit_types WHERE id = ?', [unitTypeId]);
  const adults = Math.max(1, Number(ut?.base_occupancy ?? 2) || 2);

  const out: Record<string, GuestNightPrice> = {};
  for (let d = 1; d <= lastDay; d++) {
    const date = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const quote = await priceNights({
      unitTypeId, checkIn: date, nights: 1, adults,
      ratePlanId: ratePlanId ?? null,
      // Екран оператора — не канал і не сайт: правила, які діють на прямому
      // шляху, тут видно так само, як їх побачить адміністратор у квоті.
      channel: 'operator',
    });
    const night = quote.nights[0];
    // Ночі без ціни тут немає взагалі: закрита ніч і ніч без джерела ціни
    // потрапляють у `missing`, і клітинка покаже число рядка календаря БЕЗ
    // підпису — сказати, скільки заплатить гість, ми не можемо (`cellPrice`).
    if (!night) continue;
    out[date] = { price: night.price, origin: priceOrigin(night.source, night.column) };
  }
  return out;
}
