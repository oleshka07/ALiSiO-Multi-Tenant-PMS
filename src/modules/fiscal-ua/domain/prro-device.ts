/**
 * What a Ukrainian till device owes the desk: a registered receipt.
 *
 * The interface is deliberately THIN, for the same reason
 * `invoicing/domain/fiscal/fiscal-device.ts` is thin: the till code must be
 * testable without a live provider, NOT because we anticipate every fiscal
 * regime on earth. Three actions and nothing else — open the shift, register
 * one receipt, close the shift (the Z-report). Which provider signs them is
 * still an open checkpoint (docs/research/prro-providers.md), and the seam
 * gets re-cut when a real one is chosen, not before.
 *
 * Everything here is pure. Drivers live in `../data/`, where IO belongs, and
 * the two that exist today talk to nobody: `none` refuses by name, `test`
 * answers deterministically so a scene can prove the till's behaviour.
 *
 * ── Why the receipt carries `outsideVatBase` as its own number ───────────
 *
 * Т9 (docs/DECISIONS.md): the tourist levy is a line of the receipt that is
 * NOT part of the VAT base. "Rate 0 %" and "outside the base" look the same
 * on a bill and are different facts: the first lands in a VAT bucket whose
 * rate happens to be zero, the second lands in no bucket at all. A receipt
 * that kept only buckets could not tell them apart, so the number the levy
 * adds up to is carried separately and the total is the sum of BOTH.
 */
// Relative path with the extension, not an alias: this file is pure and the
// gates read it under bare node, where `@…` means nothing.
import { money } from '../../../core/money.ts';

/** One VAT bucket of the receipt, gross. */
export interface PrroVatAmount {
  /** Percent as the folio recorded it — 20, 7, 0. */
  rate: number;
  amount: number;
}

/** Методи, які взагалі доходять до каси. Решта — не касовий оборот. */
export const TILL_PAYMENT_METHODS = ['cash', 'card_terminal'] as const;
export type PrroPaymentMethod = (typeof TILL_PAYMENT_METHODS)[number];

export interface PrroPayment {
  method: PrroPaymentMethod;
  amount: number;
}

export interface PrroReceiptLine {
  /** Назва рядка — мовою ЮРИСДИКЦІЇ, не оператора (інваріант 19). */
  name: string;
  quantity: number;
  unitPriceGross: number;
  totalGross: number;
  /**
   * Ставка ПДВ у відсотках, або `null` — рядок ПОЗА базою ПДВ.
   *
   * `null` не означає «нуль відсотків»: нуль — це ставка, і рядок під нею
   * лишається в базі. `null` — це «цей рядок у базу не входить узагалі».
   */
  vatRate: number | null;
}

export interface PrroReceipt {
  lines: PrroReceiptLine[];
  payments: PrroPayment[];
  /** Сума чека — рядки в базі ПДВ ПЛЮС рядки поза нею. */
  total: number;
  /** Розбивка бази ПДВ за ставками. Рядків поза базою тут немає. */
  vatAmounts: PrroVatAmount[];
  /** Сума рядків поза базою ПДВ — Т9. */
  outsideVatBase: number;
  currency: string;
}

/** Зміна, відкрита на касі. */
export interface PrroShift {
  shiftId: string;
  openedAt: string;
}

/** Що провайдер повертає про зареєстрований чек. */
export interface PrroReceiptResult {
  /** Фіскальний номер, присвоєний чеку. */
  fiscalNumber: string;
  registeredAt: string;
  shiftId: string;
  /** Посилання на чек у реєстрі, якщо провайдер його дає. */
  receiptUrl?: string | null;
}

/** Z-звіт: підсумок закритої зміни. */
export interface PrroZReport {
  fiscalNumber: string;
  shiftId: string;
  closedAt: string;
  receiptsCount: number;
  total: number;
}

export interface PrroDevice {
  /** Відкрити зміну; кидає, коли каса недосяжна або відмовляє. */
  openShift(): Promise<PrroShift>;
  /** Зареєструвати один чек; кидає так само. */
  registerReceipt(receipt: PrroReceipt): Promise<PrroReceiptResult>;
  /** Закрити зміну Z-звітом; кидає так само. */
  closeShift(): Promise<PrroZReport>;
}

/** Драйвери, які сьогодні існують. Провайдера ще не обрано. */
export const PRRO_DRIVERS = ['none', 'test'] as const;
export type PrroDriver = (typeof PRRO_DRIVERS)[number];

export function isPrroDriver(value: unknown): value is PrroDriver {
  return typeof value === 'string' && (PRRO_DRIVERS as readonly string[]).includes(value);
}

/** Сума чека у форматі, який читає людина і приймає провайдер. */
export function prroAmount(n: number): string {
  // `money()`, а не `* 100 / 100`: друге йде через множення, де 1.005 стає
  // 100.49999999999999 і округлюється ВНИЗ. Це число їде в реєстр.
  return money(n).toFixed(2);
}
