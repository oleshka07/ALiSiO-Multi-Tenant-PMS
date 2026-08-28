/**
 * Правила бланка — ті, що готель налаштовує під себе.
 *
 * ── Що тут стояло ───────────────────────────────────────────────────────
 *
 * Дві константи: `INVOICE_DUE_DAYS = 14` і `BUYER_NAME_THRESHOLD_CZK = 9900`.
 * Перша — чуже рішення, нав'язане всім. Друга гірша: 9900 Kč це межа
 * чеського «zjednodušený daňový doklad», тобто норма ОДНІЄЇ юрисдикції, а
 * поріг ще й у кронах — тож готель, який рахує в євро, порівнював євро з
 * кронами й отримував поріг приблизно вчетверо нижчий, ніж мав би.
 *
 * Тепер обидва — налаштування готелю (`organization_invoicing`). Функції
 * лишились чистими: вони приймають правила аргументом, а не читають базу.
 * Так їх можна перевіряти без бази, а місце, де правила беруться, лишається
 * одне — репозиторій.
 */
import type { InvoiceSettings } from '../data/invoice-settings.repo';

/**
 * Чи мусить імʼя покупця бути на документі.
 *
 * @param amount           сума документа У ВАЛЮТІ ГОТЕЛЮ (не в кронах)
 * @param hasExplicitBuyer компанію/покупця назвали явно — тоді завжди так
 * @param rules            налаштування цього готеля
 *
 * `threshold === null` означає «називати завжди»: для юрисдикції, правил
 * якої ми не знаємо, зайве імʼя на документі це незручність, а відсутнє —
 * порушення.
 */
export function showBuyerName(
  amount: number,
  hasExplicitBuyer: boolean,
  rules: Pick<InvoiceSettings, 'buyerNameThreshold'>,
): boolean {
  if (hasExplicitBuyer) return true;
  if (rules.buyerNameThreshold == null) return true;
  return Math.abs(amount) >= rules.buyerNameThreshold;
}

/** Додати n днів до YYYY-MM-DD; неправильний вхід повертається як є. */
export function addDaysIso(iso: string, n: number): string {
  const base = (iso || '').slice(0, 10);
  const d = new Date(`${base}T00:00:00Z`);
  if (isNaN(d.getTime())) return iso;
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Строк оплати (і DUZP) = дата видачі + стільки днів, скільки задав готель.
 *
 * Одне число на обидві дати — так було в коді до розділення, і так лишається:
 * розвести їх означало б два налаштування, різницю між якими ніхто не
 * пояснить, поки хтось не помилиться.
 */
export function dueDateFor(issueDateIso: string, rules: Pick<InvoiceSettings, 'dueDays'>): string {
  return addDaysIso(issueDateIso, rules.dueDays);
}
