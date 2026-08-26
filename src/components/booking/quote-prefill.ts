/**
 * Що робити з відповіддю прайсингу у формі бронювання.
 *
 * Форма створення броні мала поле «Вартість» із підказкою «авто з прайсингу»,
 * але квоту питала ЛИШЕ всередині `handleSubmit` — тобто вже після того, як
 * портьє натиснув «Створити». Обравши тип номера і кількість гостей, він
 * бачив порожнє поле й не мав що назвати гостю по телефону; ціна з'являлась
 * аж у збереженій броні. Прайсинг при цьому відповідав правильно — не було
 * запиту.
 *
 * Логіка рішення живе тут, а не в компоненті, бо її можна запустити:
 * `quote-prefill.check.ts` поруч. У компоненті лишається сам виклик і
 * `setState`.
 *
 * Інваріант 17 («ціни, якої немає, не існує») діє й тут: квота з
 * непокритими ночами НЕ підставляє число в поле. Часткова сума виглядає як
 * повна вартість, і бронь поїхала б за ціною, якої готель не називав.
 */

/** Те, що повертає POST /api/pricing/quote — рівно ті поля, які тут потрібні. */
export interface QuoteResponse {
  total?: number;
  missingDays?: number;
  hasPricing?: boolean;
  currency?: string;
}

export interface QuoteAsk {
  unitTypeId: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
}

/**
 * Чи є сенс питати ціну.
 *
 * Не питаємо, коли:
 *  - форма редагує наявну бронь (там ціна вже узгоджена з гостем),
 *  - оператор сам увів суму — його число не можна затирати,
 *  - ще не обрано тип номера або дати, або виїзд не пізніше заїзду.
 */
export function shouldAskQuote(input: {
  mode: 'create' | 'edit';
  priceTouched: boolean;
  unitTypeId: string;
  checkIn: string;
  checkOut: string;
}): boolean {
  if (input.mode !== 'create') return false;
  if (input.priceTouched) return false;
  if (!input.unitTypeId || !input.checkIn || !input.checkOut) return false;
  return nightsBetween(input.checkIn, input.checkOut) > 0;
}

/** Результат розбору відповіді прайсингу для поля «Вартість». */
export interface QuoteOutcome {
  /** Що покласти в поле. Порожній рядок — поле лишається порожнім. */
  price: string;
  /** Скільки ночей ніхто не оцінив. > 0 означає, що ціни немає. */
  missingDays: number;
  /** Чому поле лишилось порожнім, якщо лишилось. */
  reason: 'priced' | 'missing' | 'failed';
}

/**
 * Розбір відповіді прайсингу.
 *
 * `failed` і `missing` розділені навмисне: перше — «ми не дізнались», друге —
 * «готель не назвав ціну на ці дати». Оператору це різні дії: повторити або
 * ввести суму руками.
 *
 * `expectCurrency` передають, коли бронь уже існує і має свою валюту —
 * переквотування дат у модалці броні. Правило просте: невідома валюта не
 * вважається збігом. Друга реалізація цієї перевірки, яка жила в модалці,
 * казала протилежне —
 *
 *     const currencyOk = !q?.currency || !b.currency || q.currency === b.currency;
 *
 * — тобто квота БЕЗ валюти проходила як «валюта та сама». А відсутня валюта
 * це рівно той випадок, коли вірити числу не можна: німецький готель дістав
 * би в бронь суму, порахувану в кронах, і побачив би це в рахунку.
 */
export function readQuote(
  res: { ok: boolean; body?: QuoteResponse | null },
  expectCurrency?: string | null,
): QuoteOutcome {
  if (!res.ok || !res.body) return { price: '', missingDays: 0, reason: 'failed' };
  if (expectCurrency && res.body.currency !== expectCurrency) {
    return { price: '', missingDays: 0, reason: 'failed' };
  }
  const missingDays = Number(res.body.missingDays) || 0;
  if (missingDays > 0 || res.body.hasPricing === false) {
    return { price: '', missingDays, reason: 'missing' };
  }
  const total = Number(res.body.total);
  if (!Number.isFinite(total) || total <= 0) return { price: '', missingDays: 0, reason: 'failed' };
  return { price: String(total), missingDays: 0, reason: 'priced' };
}

/** Ночі між двома датами. Виїзд не пізніше заїзду — це нуль ночей. */
export function nightsBetween(checkIn: string, checkOut: string): number {
  if (!checkIn || !checkOut) return 0;
  const ms = new Date(`${checkOut.slice(0, 10)}T00:00:00Z`).getTime()
    - new Date(`${checkIn.slice(0, 10)}T00:00:00Z`).getTime();
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, Math.floor(ms / 86400000));
}
