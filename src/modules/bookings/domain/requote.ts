/**
 * «Перерахувати ціну за новою заселеністю» — різниця до/після з квоти.
 *
 * Hoteliera має перемикач «Recalculate price based on the new occupancy»,
 * який спрацьовує сам при збереженні. У нас це ЯВНА кнопка: картка питає
 * котирування (`POST /api/pricing/quote`, той самий шлях, що й форма
 * бронювання — інваріант 16), показує стару й нову суму, і лише
 * підтвердження пише число. Ціни в коді картки немає: усе, що тут є, — це
 * порівняння двох чисел і відмова, коли квоті не можна вірити.
 *
 * Три відмови, і всі — не число:
 *   - непокрита ніч (`missingDays > 0`) — ціни немає (інваріант 17);
 *   - валюта квоти не збігається з валютою броні (або її нема) — чужі гроші;
 *   - total квоти не дорівнює сумі її ж ночей — квота суперечить собі.
 *
 * Чиста функція: `requote.check.ts` поруч, три ночі різних цін.
 */
import { money, sumMoney } from '@core/money';

export interface RequoteQuote {
  total?: number;
  currency?: string;
  missingDays?: number;
  hasPricing?: boolean;
  breakdown?: { date: string; price: number }[];
  /** Збори поверх ночей — входять у total, тож звірка суми їх враховує. */
  feesTotal?: number;
}

export interface RequoteDelta {
  reason: 'priced' | 'missing' | 'failed';
  before: number;
  /** Нова сума, або null, коли числа немає. */
  after: number | null;
  /** after − before; нуль, коли числа немає. */
  delta: number;
  missingDays: number;
}

export function requoteDelta(
  current: { currentTotal: number; currency?: string | null },
  quote: RequoteQuote | null | undefined,
): RequoteDelta {
  const before = money(Number(current.currentTotal) || 0);
  const failed: RequoteDelta = { reason: 'failed', before, after: null, delta: 0, missingDays: 0 };
  if (!quote) return failed;
  if (current.currency && quote.currency !== current.currency) return failed;

  const missingDays = Number(quote.missingDays) || 0;
  if (missingDays > 0 || quote.hasPricing === false) {
    return { reason: 'missing', before, after: null, delta: 0, missingDays };
  }

  const total = Number(quote.total);
  if (!Number.isFinite(total) || total <= 0) return failed;

  // Квота, чий підсумок не складається з її ж ночей і зборів, — не ціна.
  if (Array.isArray(quote.breakdown) && quote.breakdown.length > 0) {
    const nights = sumMoney(quote.breakdown.map((n) => Number(n.price) || 0));
    const fees = money(Number(quote.feesTotal) || 0);
    if (money(nights + fees) !== money(total)) return failed;
  }

  const after = money(total);
  return { reason: 'priced', before, after, delta: money(after - before), missingDays: 0 };
}
