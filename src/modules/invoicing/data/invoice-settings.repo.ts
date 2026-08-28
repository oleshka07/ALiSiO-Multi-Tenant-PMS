/* eslint-disable @typescript-eslint/no-explicit-any */
import { getSql } from '@core/db/async';

/**
 * Як виглядає і як поводиться фактура ЦЬОГО готеля.
 *
 * ── Що тут було замість цього ───────────────────────────────────────────
 *
 * Дві константи в `domain/invoice-rules.ts`:
 *
 *   INVOICE_DUE_DAYS = 14
 *   BUYER_NAME_THRESHOLD_CZK = 9900
 *
 * Перша — чуже рішення, нав'язане всім готелям. Друга гірша: 9900 Kč це межа
 * чеського «zjednodušený daňový doklad» — норма ОДНІЄЇ юрисдикції. І оскільки
 * поріг у кронах, а `showBuyerName` порівнював із ним суму документа як є,
 * готель, який рахує в євро, порівнював євро з кронами: поріг спрацьовував
 * приблизно вчетверо раніше, ніж мав би.
 *
 * ── Дефолти ─────────────────────────────────────────────────────────────
 *
 * Рядка може не бути, і це робочий стан: готель, який нічого не налаштовував,
 * працює як раніше. `buyerNameThreshold: null` означає «називати покупця
 * ЗАВЖДИ» — безпечний дефолт для юрисдикції, правил якої ми не знаємо: зайве
 * імʼя на документі це незручність, відсутнє — порушення.
 */
export interface InvoiceSettings {
  /** Скільки днів на оплату. Те саме число йде і в DUZP. */
  dueDays: number;
  /**
   * Нижче цієї суми покупця можна не називати — У ВАЛЮТІ ГОТЕЛЮ.
   * `null` = називати завжди.
   */
  buyerNameThreshold: number | null;
  logoUrl: string | null;
  accentColor: string | null;
  footerNote: string | null;
  showPaymentQr: boolean;
}

export const INVOICE_DEFAULTS: InvoiceSettings = {
  dueDays: 14,
  buyerNameThreshold: null,
  logoUrl: null,
  accentColor: null,
  footerNote: null,
  showPaymentQr: false,
};

export async function invoiceSettings(organizationId: string): Promise<InvoiceSettings> {
  const sql = getSql();
  const row = await sql.row<any>(
    `SELECT due_days, buyer_name_threshold, logo_url, accent_color, footer_note, show_payment_qr
       FROM organization_invoicing WHERE organization_id = ?`,
    [organizationId]);
  if (!row) return { ...INVOICE_DEFAULTS };
  return {
    dueDays: Number(row.due_days ?? INVOICE_DEFAULTS.dueDays),
    buyerNameThreshold: row.buyer_name_threshold == null ? null : Number(row.buyer_name_threshold),
    logoUrl: row.logo_url ?? null,
    accentColor: row.accent_color ?? null,
    footerNote: row.footer_note ?? null,
    // SQLite віддає 0/1, Postgres — boolean. `=== true` пропустив би одиницю.
    showPaymentQr: row.show_payment_qr === true || row.show_payment_qr === 1,
  };
}

export async function saveInvoiceSettings(
  organizationId: string,
  patch: Partial<InvoiceSettings>,
): Promise<InvoiceSettings> {
  const current = await invoiceSettings(organizationId);
  const next: InvoiceSettings = { ...current, ...patch };
  const sql = getSql();
  // `organization_id` названий явно — інваріант 12: DEFAULT від контексту є
  // лише в Postgres, а SQLite стоїть на кожній машині розробника.
  await sql.run(
    `INSERT INTO organization_invoicing
       (organization_id, due_days, buyer_name_threshold, logo_url, accent_color, footer_note, show_payment_qr)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(organization_id) DO UPDATE SET
       due_days = excluded.due_days,
       buyer_name_threshold = excluded.buyer_name_threshold,
       logo_url = excluded.logo_url,
       accent_color = excluded.accent_color,
       footer_note = excluded.footer_note,
       show_payment_qr = excluded.show_payment_qr`,
    [organizationId, next.dueDays, next.buyerNameThreshold, next.logoUrl,
     next.accentColor, next.footerNote,
     // TRUE/FALSE, не 1/0: літеральна одиниця в колонку BOOLEAN відхиляється
     // Postgres (інваріант 12, друга половина).
     next.showPaymentQr],
  );
  return next;
}
