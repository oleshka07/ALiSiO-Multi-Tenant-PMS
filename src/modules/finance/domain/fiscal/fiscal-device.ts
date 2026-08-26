
/**
 * What a fiscal device owes the till: a signature over what was paid.
 *
 * The interface is deliberately THIN — start, finish, and the fields §6
 * KassenSichV wants back on the beleg. It exists because the till code must
 * be testable without a live TSE (the check injects a stub), NOT because we
 * anticipate every fiscal regime on earth: Austria and Czechia will come
 * with their own rules, and the seam gets re-cut when the second real
 * provider arrives, not before (docs/TSE-KASSENSICHV.md §7).
 *
 * Everything in this file is pure — the fiskaly HTTP implementation lives in
 * data/, where IO belongs.
 */
// Відносний шлях із розширенням, а не аліас: цей файл чистий, і його читають
// гейти, які запускають голим node — `@core/…` знає лише бандлер.
import { money } from '../../../../core/money.ts';

/** One VAT bucket of the receipt, gross. */
export interface VatAmount {
  /** Percent as the invoice recorded it — 19, 7, 0. */
  rate: number;
  amount: number;
}

export interface FiscalReceipt {
  /** Gross total of the payment being signed. */
  amount: number;
  /** 'cash' or 'card_terminal' — the only methods that reach a TSE. */
  method: 'cash' | 'card_terminal';
  /** The invoice's own split; empty means the split is not known. */
  vatAmounts: VatAmount[];
}

/** What §6 wants back on the beleg — one signed transaction. */
export interface FiscalSignature {
  tseSerial: string;
  txNumber: string;
  signatureCounter: string;
  signature: string;
  startTime: string;
  endTime: string;
  qrPayload: string;
  clientId: string;
  processType: string;
  processData: string;
}

export interface FiscalDevice {
  /** Sign one payment; throws when the TSE cannot be reached or refuses. */
  signReceipt(receipt: FiscalReceipt): Promise<FiscalSignature>;
}

/**
 * DSFinV-K names five VAT buckets by POSITION, not by percent. Which German
 * rate sits in which bucket is fixed by the standard: 1 = Regelsatz (19),
 * 2 = ermäßigt (7), 5 = 0 %. Buckets 3 and 4 are agriculture's special
 * rates, which a hotel bill never carries — a rate this map does not know is
 * an error, not a guess.
 */
export function dsfinvkVatField(rate: number): 'NORMAL' | 'REDUCED_1' | 'NULL' {
  if (rate === 19) return 'NORMAL';
  if (rate === 7) return 'REDUCED_1';
  if (rate === 0) return 'NULL';
  throw new Error(`No DSFinV-K VAT bucket for rate ${rate}%`);
}

/** DSFinV-K Zahlungsart for the two till methods. */
export function dsfinvkPaymentType(method: 'cash' | 'card_terminal'): 'CASH' | 'NON_CASH' {
  return method === 'cash' ? 'CASH' : 'NON_CASH';
}

/** Money formatted the way process_data wants it: dot decimal, two places. */
export function fiscalAmount(n: number): string {
  // `money()`, а не `* 100 / 100`: друге йде через множення, де 1.005
  // стає 100.49999999999999 і округлюється ВНИЗ. Це число підписує TSE.
  return money(n).toFixed(2);
}
