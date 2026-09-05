/**
 * Рахунок броні одним поглядом: усі фоліо, усі рядки, усі оплати, залишок.
 *
 * Блок 4 «День готелю», вкладка «Фінанси» картки броні (джерело форми —
 * Hoteliera, Financials: Totals · Services · Invoices · Payments). Досі
 * картка бачила лише `foliosOverview` — відкриті рядки й документи для
 * поділу рахунку; оплати й уже виставлені рядки їй були невидимі, тож
 * «скільки гість винен» рецепція рахувала в голові.
 *
 * Це ЧИТАННЯ поверх наявних таблиць. Жодного розрахунку ПДВ і жодної
 * нумерації тут немає — лише суми рядків, які вже лежать у базі.
 *
 * Той самий залишок питає варта виселення (`bookings` через
 * `@invoicing/kernel`): бронь із фоліо — з фоліо, без фоліо — зі статусу
 * оплати самої броні (`hasFolio: false` каже викликачу взяти другий шлях).
 */
import { getSql } from '@core/db/async';
import type { Sql } from '@core/db/async';
import { requireOrganizationId } from '@core/auth/tenant-context';
import { money, sumMoney } from '@core/money';
import { resolveCurrency } from './folio.repo';

export interface FolioSummaryItem {
  id: string;
  service_date: string;
  kind: string;
  source: string;
  description: string;
  guest_name: string | null;
  quantity: number;
  unit_price_gross: number;
  total_gross: number;
  vat_rate: number;
  invoice_id: string | null;
  invoice_number: string | null;
}

export interface FolioSummaryPayment {
  id: string;
  amount: number;
  method: string;
  paid_at: string;
  invoice_id: string | null;
  received_by_name: string | null;
}

export interface FolioSummaryInvoice {
  id: string;
  invoice_number: string;
  status: string;
  amount: number;
  issued_at: string;
  corrects_invoice_id: string | null;
}

export interface FolioSummary {
  id: string;
  payer_kind: 'guest' | 'company';
  payer_name: string | null;
  payer_vat_no: string | null;
  label: string | null;
  status: string;
  items: FolioSummaryItem[];
  payments: FolioSummaryPayment[];
  invoices: FolioSummaryInvoice[];
  charged: number;
  paid: number;
  balance: number;
}

export interface ReservationFolioSummary {
  currency: string;
  folios: FolioSummary[];
  totals: { charged: number; paid: number; balance: number };
}

export async function reservationFolioSummary(reservationId: string, t?: Sql): Promise<ReservationFolioSummary> {
  const organizationId = await requireOrganizationId();
  const sql = t ?? getSql();

  const heads = await sql.rows<any>(
    `SELECT id, payer_kind, payer_name, payer_vat_no, label, status, currency
       FROM fin_folios WHERE organization_id = ? AND reservation_id = ? ORDER BY created_at`,
    [organizationId, reservationId]);

  const folios: FolioSummary[] = [];
  for (const f of heads) {
    // Сторновані рядки (`voided_by_item_id`) не рахуються: їх уже замінив
    // зустрічний запис. Виставлені — рахуються: документ не знімає боргу.
    const items = await sql.rows<any>(
      `SELECT i.id, i.service_date, i.kind, i.source, i.description, i.guest_name,
              i.quantity, i.unit_price_gross, i.total_gross, i.vat_rate, i.invoice_id,
              inv.invoice_number
         FROM fin_folio_items i
         LEFT JOIN invoices inv ON inv.id = i.invoice_id
        WHERE i.organization_id = ? AND i.folio_id = ? AND i.voided_by_item_id IS NULL
        ORDER BY i.service_date, i.created_at`,
      [organizationId, f.id]);
    const payments = await sql.rows<any>(
      `SELECT p.id, p.amount, p.method, p.paid_at, p.invoice_id, u.full_name AS received_by_name
         FROM fin_folio_payments p
         LEFT JOIN app_users u ON u.id = p.received_by
        WHERE p.organization_id = ? AND p.folio_id = ?
        ORDER BY p.paid_at, p.created_at`,
      [organizationId, f.id]);
    const invoices = await sql.rows<any>(
      `SELECT id, invoice_number, status, amount, issued_at, corrects_invoice_id
         FROM invoices WHERE organization_id = ? AND folio_id = ?
        ORDER BY issued_at, invoice_number`,
      [organizationId, f.id]);

    const charged = sumMoney(items.map((i) => Number(i.total_gross) || 0));
    const paid = sumMoney(payments.map((p) => Number(p.amount) || 0));
    folios.push({
      id: f.id,
      payer_kind: f.payer_kind === 'company' ? 'company' : 'guest',
      payer_name: f.payer_name ?? null,
      payer_vat_no: f.payer_vat_no ?? null,
      label: f.label ?? null,
      status: String(f.status ?? 'open'),
      items: items.map((i) => ({
        ...i,
        quantity: Number(i.quantity), unit_price_gross: Number(i.unit_price_gross),
        total_gross: Number(i.total_gross), vat_rate: Number(i.vat_rate),
        service_date: day(i.service_date),
      })),
      payments: payments.map((p) => ({ ...p, amount: Number(p.amount), paid_at: String(p.paid_at ?? '') })),
      invoices: invoices.map((i) => ({ ...i, amount: Number(i.amount), issued_at: day(i.issued_at) })),
      charged, paid, balance: money(charged - paid),
    });
  }

  const charged = sumMoney(folios.map((f) => f.charged));
  const paid = sumMoney(folios.map((f) => f.paid));
  // Валюта — з першого фоліо (усі фоліо броні народжуються в її валюті),
  // інакше з броні/організації тим самим резолвером, що й документ.
  const currency = heads.find((h: any) => h.currency)?.currency
    ?? await resolveCurrency(organizationId, reservationId);
  return { currency: String(currency), folios, totals: { charged, paid, balance: money(charged - paid) } };
}

/** Скільки гість винен за цією бронню — і чи є взагалі фоліо, щоб це знати. */
export async function reservationBalance(reservationId: string, t?: Sql): Promise<{
  hasFolio: boolean; charged: number; paid: number; balance: number;
}> {
  const organizationId = await requireOrganizationId();
  const sql = t ?? getSql();
  const folios = await sql.rows<any>(
    'SELECT id FROM fin_folios WHERE organization_id = ? AND reservation_id = ?',
    [organizationId, reservationId]);
  if (folios.length === 0) return { hasFolio: false, charged: 0, paid: 0, balance: 0 };
  const ids = folios.map((f: any) => String(f.id));
  const marks = ids.map(() => '?').join(', ');
  const items = await sql.rows<any>(
    `SELECT total_gross FROM fin_folio_items
      WHERE organization_id = ? AND folio_id IN (${marks}) AND voided_by_item_id IS NULL`,
    [organizationId, ...ids]);
  const payments = await sql.rows<any>(
    `SELECT amount FROM fin_folio_payments WHERE organization_id = ? AND folio_id IN (${marks})`,
    [organizationId, ...ids]);
  const charged = sumMoney(items.map((i: any) => Number(i.total_gross) || 0));
  const paid = sumMoney(payments.map((p: any) => Number(p.amount) || 0));
  return { hasFolio: true, charged, paid, balance: money(charged - paid) };
}

function day(v: unknown): string {
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(v ?? '').slice(0, 10);
}
