/**
 * A folio becomes a receipt.
 *
 * The rows come from `fin_folio_items` and `fin_folio_payments` — tables the
 * invoicing module owns — and they arrive here as plain data, passed in by
 * their owner. This module never queries them: a jurisdiction module that
 * reached into the core's tables would be the boundary breach the whole
 * arrangement exists to avoid.
 *
 * ── Рядок 11, і чому він окремим числом (Т9) ────────────────────────────
 *
 * Турзбір іде в чек рядком ПОЗА базою ПДВ. У фоліо він уже названий —
 * `kind = 'city_tax'` (Т5), і ставка на ньому нуль. Саме тому рішення
 * ухвалюється за `kind`, а НЕ за `vat_rate === 0`: нульова ставка — це теж
 * ставка, і рядок під нею лишається в базі. Читати нуль як «поза базою»
 * означало б викинути з бази ПДВ будь-яку послугу, звільнену від податку,
 * і сума податку зійшлася б з меншою базою — тихо й неправильно.
 *
 * ── Чого ця збірка свідомо НЕ вміє ──────────────────────────────────────
 *
 * Часткової оплати. Сума платежів мусить дорівнювати сумі рядків, інакше —
 * названа відмова. Чек на завдаток — це окреме питання юрисдикції (що саме
 * друкується, коли гість платить половину), і вигадувати відповідь тут
 * означало б віддати в реєстр число, якого ніхто не називав (інваріант 17).
 * Питання стоїть у чекпоінті власника — docs/research/prro-providers.md §2.
 */
import { money, sumMoney } from '../../../core/money.ts';
import type { PrroPayment, PrroReceipt, PrroReceiptLine, PrroVatAmount } from './prro-device.ts';
import { TILL_PAYMENT_METHODS } from './prro-device.ts';

/** Рядок фоліо в тій формі, у якій його віддає власник таблиці. */
export interface FolioItemRow {
  kind: string;
  description: string;
  quantity: number;
  unit_price_gross: number;
  total_gross: number;
  vat_rate: number;
}

/** Оплата фоліо в тій самій формі. */
export interface FolioPaymentRow {
  method: string;
  amount: number;
}

/**
 * Рід рядка, який у чек іде ПОЗА базою ПДВ.
 *
 * Один рід, не список: сьогодні це лише збір, який готель збирає для
 * громади і передає далі (`collected_for = 'authority'` в ядрі). Новий рід
 * додається сюди разом із рішенням, чому він поза базою, — а не тому, що в
 * нього нульова ставка.
 */
const OUTSIDE_VAT_BASE: ReadonlySet<string> = new Set(['city_tax']);

export class PrroReceiptRefusal extends Error {}

function refuseReceipt(message: string): never {
  throw new PrroReceiptRefusal(message);
}

export function buildPrroReceipt(input: {
  items: readonly FolioItemRow[];
  payments: readonly FolioPaymentRow[];
  currency: string;
}): PrroReceipt {
  if (input.items.length === 0) {
    refuseReceipt('A receipt needs at least one charge — an empty folio has nothing to register');
  }

  const lines: PrroReceiptLine[] = [];
  const buckets = new Map<number, number>();
  let outside = 0;

  for (const item of input.items) {
    const total = Number(item.total_gross);
    const outsideBase = OUTSIDE_VAT_BASE.has(String(item.kind));
    lines.push({
      name: String(item.description),
      quantity: Number(item.quantity),
      unitPriceGross: money(Number(item.unit_price_gross)),
      totalGross: money(total),
      vatRate: outsideBase ? null : Number(item.vat_rate),
    });
    if (outsideBase) {
      outside += total;
    } else {
      const rate = Number(item.vat_rate);
      buckets.set(rate, (buckets.get(rate) ?? 0) + total);
    }
  }

  const vatAmounts: PrroVatAmount[] = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([rate, amount]) => ({ rate, amount: money(amount) }));

  const outsideVatBase = money(outside);
  const total = money(vatAmounts.reduce((s, v) => s + v.amount, 0) + outsideVatBase);

  const payments: PrroPayment[] = [];
  for (const p of input.payments) {
    const method = String(p.method);
    if (!(TILL_PAYMENT_METHODS as readonly string[]).includes(method)) {
      // Переказ і ваучер до каси не доходять — це не касовий оборот, і
      // мовчки пропустити такий рядок означало б чек на суму, менш ніж
      // сплачено (інваріант 13: не знаємо — відмовляємо).
      refuseReceipt(
        `A till receipt carries only ${TILL_PAYMENT_METHODS.join(' and ')} — «${method}» is not a till movement`);
    }
    payments.push({ method: method as PrroPayment['method'], amount: money(Number(p.amount)) });
  }
  if (payments.length === 0) {
    refuseReceipt('A receipt needs at least one till payment — nothing was paid at the desk');
  }

  const paid = sumMoney(payments.map((p) => p.amount));
  if (paid !== total) {
    refuseReceipt(
      `The receipt total (${total}) and the till payments (${paid}) do not agree — a partial payment is not a receipt this product knows how to print`);
  }

  return { lines, payments, total, vatAmounts, outsideVatBase, currency: String(input.currency) };
}
