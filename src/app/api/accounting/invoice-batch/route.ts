/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * POST /api/accounting/invoice-batch
 *
 * Parses an Airbnb, Booking.com, or Teya CSV and creates invoices for each
 * valid row — WITHOUT creating any fin_operations entries.
 *
 * Returns the list of created/found invoices so the UI can offer PDF + ISDOC
 * download buttons per row. For Teya rows with amount >= 10 000 CZK the flag
 * `needs_guest_name: true` is returned — the invoice is created with a
 * placeholder buyer name ("DOPLNIT JMÉNO") that the user can update later.
 *
 * Deduplication: uses notes field as "source:source_ref" key.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireFinanceAccess } from '@core/security/route-guard';
import { allocateInvoiceNumber, seriesForChannel, isPeriodLocked } from '@/modules/finance/domain/invoice-numbering';
import type { Actor } from '@core/auth/session';
import { getSql } from '@core/db/async';
import { serverError } from '@core/http/errors';

// ─── CSV utilities ──────────────────────────────────────────────────────────

function parseLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { current += '"'; i++; }
      else inQ = !inQ;
    } else if (c === ',' && !inQ) {
      result.push(current.trim());
      current = '';
    } else {
      current += c;
    }
  }
  result.push(current.trim());
  return result;
}

function parseNum(s: string): number {
  if (!s) return 0;
  return parseFloat(s.replace(/\s/g, '').replace(',', '.')) || 0;
}

/**
 * Repair double-encoded UTF-8 (mojibake) that some Booking/Excel CSV exports
 * produce, e.g. "ÐÐ½Ð°ÑÑ..." instead of "Анаст...". Only applied when the string
 * looks mis-encoded AND re-decoding yields valid UTF-8 (no replacement char),
 * so correctly-encoded Latin accents (José, Müller) are left untouched.
 */
function fixMojibake(s: string | null | undefined): string {
  if (!s) return s || '';
  if (!/[Â-ß][-¿]|[ÐÑÃ]/.test(s)) return s;
  try {
    const fixed = Buffer.from(s, 'latin1').toString('utf8');
    if (fixed && !fixed.includes('�') && fixed !== s) return fixed;
  } catch { /* keep original */ }
  return s;
}

function airbnbDate(s: string): string {
  if (!s) return '';
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0,10);
  return s;
}

const MONTH_MAP: Record<string,string> = {
  Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',
  Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12',
};
function bookingDate(s: string): string {
  if (!s) return '';
  const m = s.trim().match(/^(\d{1,2})\s+(\w{3})\s+(\d{4})$/);
  if (m) return `${m[3]}-${MONTH_MAP[m[2]]??'01'}-${m[1].padStart(2,'0')}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0,10);
  return s;
}



// ─── Parsed row types ────────────────────────────────────────────────────────

export interface BatchRow {
  source: 'airbnb' | 'booking';
  source_ref: string;
  guest_name: string;
  needs_guest_name?: boolean; // true → amount ≥ 10 000 CZK, buyer name unknown
  is_credit_note?: boolean;   // true → REFUND/storno transaction
  listing: string;
  check_in: string;
  check_out: string;
  description: string;
  amount: number;             // negative for credit notes
  currency: string;
  date: string;
  op_type: 'income' | 'expense';
}

// ─── Airbnb parser ───────────────────────────────────────────────────────────

function parseAirbnb(csv: string): BatchRow[] {
  const lines = csv.split('\n').map(l => l.replace(/\r$/, ''));
  if (lines.length < 2) return [];
  const hdrs = parseLine(lines[0]);
  const idx = (n: string) => hdrs.findIndex(h => h.replace(/^"|"$/g,'').trim() === n);

  const iDate      = idx('Дата');
  const iType      = idx('Тип');
  const iCode      = idx('Код підтвердження');
  const iDateStart = idx('Дата початку');
  const iDateEnd   = idx('Дата завершення');
  const iGuest     = idx('Гість');
  const iListing   = idx('Оголошення');
  const iCurrency  = idx('Валюта');
  const iAmount    = idx('Сума');
  const iGross     = idx('Валовий дохід');

  if (iDate === -1 || iType === -1 || iCode === -1) {
    throw new Error('Не розпізнано як Airbnb-виписку. Переконайтесь що файл завантажено з Airbnb (CSV → Виписка виплат).');
  }

  const rows: BatchRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseLine(line);
    const type = (cols[iType] ?? '').trim();
    if (type !== 'Бронювання' && type !== 'Компенсація') continue;

    const ref = (cols[iCode] ?? '').trim();
    if (!ref) continue;

    const amountRaw = parseNum(cols[iAmount] ?? '0');
    const grossRaw  = parseNum(cols[iGross]  ?? '0');
    const isExpense = type === 'Компенсація' && amountRaw < 0;
    const amount    = Math.abs(amountRaw);
    if (amount === 0) continue;

    const guestName = (cols[iGuest] ?? '').trim();
    const listing   = (cols[iListing] ?? '').trim();
    const checkIn   = airbnbDate(cols[iDateStart] ?? '');
    const checkOut  = airbnbDate(cols[iDateEnd]   ?? '');
    const gross     = Math.abs(grossRaw);

    const desc = `Airbnb: ${guestName}${checkIn ? ` — ${checkIn}` : ''}${checkOut ? ` – ${checkOut}` : ''}${listing ? ` — ${listing}` : ''}`;

    rows.push({
      source: 'airbnb',
      source_ref: ref,
      guest_name: guestName,
      listing,
      check_in: checkIn,
      check_out: checkOut,
      description: desc,
      amount: gross > 0 ? gross : amount,  // prefer gross for the invoice
      currency: (cols[iCurrency] ?? 'EUR').trim() || 'EUR',
      date: airbnbDate(cols[iDate] ?? ''),
      op_type: isExpense ? 'expense' : 'income',
    });
  }
  return rows;
}

// ─── Booking.com parser ──────────────────────────────────────────────────────

function parseBooking(csv: string): BatchRow[] {
  const lines = csv.split('\n').map(l => l.replace(/\r$/, ''));
  if (lines.length < 2) return [];
  const hdrs = parseLine(lines[0]);
  const idx = (n: string) => hdrs.findIndex(h => h.replace(/^"|"$/g,'').trim() === n);

  const iType       = idx('Type');
  const iBookingNum = idx('Booking number');
  const iCheckIn    = idx('Check-in');
  const iCheckout   = idx('Checkout');
  const iGuest      = idx('Guest name');
  const iStatus     = idx('Reservation status');
  const iCurrency   = idx('Currency');
  const iAmount     = idx('Amount');
  const iPayoutDate = idx('Payout date');

  if (iType === -1 || iBookingNum === -1 || iAmount === -1) {
    throw new Error('Не розпізнано як Booking.com виписку. Перевірте формат CSV.');
  }

  const rows: BatchRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseLine(line);
    const type = (cols[iType] ?? '').trim();
    if (type !== 'Reservation') continue;

    const ref = String(cols[iBookingNum] ?? '').trim();
    if (!ref) continue;

    const status = (cols[iStatus] ?? '').toLowerCase();
    if (status === 'cancelled' || status === 'no-show') continue;

    const amount = parseNum(cols[iAmount] ?? '0');
    if (amount <= 0) continue;

    const guestName = (cols[iGuest] ?? '').trim();
    const checkIn   = bookingDate(cols[iCheckIn]  ?? '');
    const checkOut  = bookingDate(cols[iCheckout] ?? '');
    const paidAt    = bookingDate(cols[iPayoutDate] ?? '');

    const desc = `Booking.com: ${guestName}${checkIn ? ` — ${checkIn}` : ''}${checkOut ? ` – ${checkOut}` : ''}`;

    rows.push({
      source: 'booking',
      source_ref: ref,
      guest_name: guestName,
      listing: '',
      check_in: checkIn,
      check_out: checkOut,
      description: desc,
      amount,
      currency: (cols[iCurrency] ?? 'EUR').trim() || 'EUR',
      date: paidAt,
      op_type: 'income',
    });
  }
  return rows;
}

// ─── Teya parser ─────────────────────────────────────────────────────────────
//
// Expected CSV columns (18):
//   Date, Store name, Payment context, Device ID, Status, Payment type,
//   Sales, Teya fee, Teya fee classifier, Interchange fee, Scheme fee,
//   MOTO fee, Fixed fee, Chargeback fee, Total fees,
//   Pay by Link Email, Pay by Link Phone, Settlement status
//
// Rules:
//   • Keep only Status = SUCCEEDED (skip FAILED, PENDING, REVERSED)
//   • Skip Payment type = REFUND
//   • Guest name:
//       amount < 10 000 CZK  → "Konečný zákazník"
//       amount ≥ 10 000 CZK  → empty (needs_guest_name=true, UI will ask)


// ─── Invoice number generator ─────────────────────────────────────────────────

// ─── Route handler ────────────────────────────────────────────────────────────

export interface BatchInvoiceResult {
  source_ref: string;
  invoice_id: string;
  invoice_number: string;
  guest_name: string;
  needs_guest_name: boolean;  // true = amount ≥ 10 000, buyer name must be filled in
  is_credit_note: boolean;    // true = REFUND / storno faktura
  description: string;
  amount: number;
  currency: string;
  date: string;
  created: boolean;
}

export const DELETE = requireFinanceAccess(_DELETE);
async function _DELETE(request: NextRequest, _ctx: unknown, actor: Actor): Promise<NextResponse> {
  try {
    const sql = getSql();
    const url = new URL(request.url);
    const channel = url.searchParams.get('channel')?.toLowerCase(); // 'airbnb', 'booking', or 'all'
    const month = url.searchParams.get('month'); // optional 'YYYY-MM'

    if (!channel || !['airbnb', 'booking', 'all'].includes(channel)) {
      return NextResponse.json({ error: 'channel must be airbnb|booking|all' }, { status: 400 });
    }

    // Build conditions
    let notesPattern = '';
    let seriesVal = '';
    if (channel === 'airbnb') {
      notesPattern = 'airbnb:%';
      seriesVal = 'AIR';
    } else if (channel === 'booking') {
      notesPattern = 'booking:%';
      seriesVal = 'BKG';
    }

    // Unscoped this wiped every hotel's imported invoices, not just this one's.
    let query = `DELETE FROM invoices WHERE organization_id = ?`;
    const params: any[] = [actor.organizationId];

    if (channel !== 'all') {
      query += ` AND (notes LIKE ? OR series = ?)`;
      params.push(notesPattern, seriesVal);
    } else {
      query += ` AND (notes LIKE 'airbnb:%' OR notes LIKE 'booking:%' OR notes LIKE 'teya:%' OR series IN ('AIR', 'BKG', 'TEYA'))`;
    }

    if (month) {
      if (!/^\d{4}-\d{2}$/.test(month)) {
        return NextResponse.json({ error: 'month must be in YYYY-MM format' }, { status: 400 });
      }
      query += ` AND (period = ? OR ${sql.dialect.month('issued_at')} = ?)`;
      params.push(month, month);
    }

    // Check if we are deleting any locked invoices, unless override is provided
    const force = url.searchParams.get('force') === 'true';
    if (!force) {
      // Find if any matched invoices are locked
      let checkQuery = `SELECT COUNT(*) as count FROM invoices WHERE organization_id = ? AND locked = TRUE`;
      const checkParams: any[] = [actor.organizationId];
      if (channel !== 'all') {
        checkQuery += ` AND (notes LIKE ? OR series = ?)`;
        checkParams.push(notesPattern, seriesVal);
      } else {
        checkQuery += ` AND (notes LIKE 'airbnb:%' OR notes LIKE 'booking:%' OR notes LIKE 'teya:%' OR series IN ('AIR', 'BKG', 'TEYA'))`;
      }
      if (month) {
        checkQuery += ` AND (period = ? OR ${sql.dialect.month('issued_at')} = ?)`;
        checkParams.push(month, month);
      }
      const lockedCount = await sql.row(checkQuery, checkParams) as { count: number };
      if (lockedCount.count > 0) {
        return NextResponse.json({
          error: `Знайдено ${lockedCount.count} заблокованих фактур. Ви не можете видалити їх без примусового прапорця (force=true).`,
          lockedCount: lockedCount.count,
          requiresForce: true
        }, { status: 409 });
      }
    }

    // Run delete inside a transaction to keep it atomic
    const deletedCount = await sql.tx(async (t) => {
      const result = await t.run(query, params);
      return result.changes;
    });

    const channelLabelMap: Record<string, string> = {
      airbnb: 'Airbnb',
      booking: 'Booking.com',
      all: 'всіх імпортованих каналів',
    };

    return NextResponse.json({
      ok: true,
      message: `Успішно видалено ${deletedCount} фактур для ${channelLabelMap[channel] || channel}${month ? ` за період ${month}` : ''}.`,
      deletedCount,
    });
  } catch (e: any) {
    console.error('[BatchInvoices] delete error:', e.message);
    return serverError('app/api/accounting/invoice-batch _DELETE', e);
  }
}

export const POST = requireFinanceAccess(_POST);
async function _POST(request: NextRequest, _ctx: unknown, actor: Actor): Promise<NextResponse> {
  try {
    const sql = getSql();
    const form = await request.formData();
    const file    = form.get('file');
    const channel = (form.get('channel') as string ?? '').toLowerCase();

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'file required' }, { status: 400 });
    }
    if (!['airbnb', 'booking'].includes(channel)) {
      return NextResponse.json({ error: 'channel must be airbnb|booking' }, { status: 400 });
    }

    const text = await file.text();

    let rows: BatchRow[];
    if (channel === 'airbnb')       rows = parseAirbnb(text);
    else                            rows = parseBooking(text);

    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'Жодного рядка не знайдено. Перевірте файл.' },
        { status: 400 }
      );
    }

    const today = new Date().toISOString().slice(0, 10);
    const results: BatchInvoiceResult[] = [];

    const createInvoice = (row: BatchRow) => sql.tx(async (t) => {
      // Dedup: check if already exists via notes field
      const noteKey = `${row.source}:${row.source_ref}`;
      const existing = await t.row<{ id: string; invoice_number: string }>(
        "SELECT id, invoice_number FROM invoices WHERE organization_id = ? AND notes = ? AND status = 'issued' LIMIT 1",
        [actor.organizationId, noteKey],
      );

      if (existing) {
        return { id: existing.id, number: existing.invoice_number, created: false };
      }

      // Per-channel series (BKG-/AIR-/TEYA-), allocated atomically.
      const issued = (row.date || today);
      const period = issued.slice(0, 7);
      const { series } = seriesForChannel(row.source);
      if (await isPeriodLocked(t, actor.organizationId, series, period)) {
        throw new Error(`Období ${series} ${period} je uzamčeno — nové faktury nelze přidat.`);
      }
      const invId  = `inv_batch_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
      const { invoiceNumber: invNum } = await allocateInvoiceNumber(t, actor.organizationId, row.source, new Date().getFullYear());
      const due    = row.date > today ? row.date : today;

      // For rows that need a guest name, store a placeholder
      const buyerName = row.needs_guest_name ? 'DOPLNIT JMÉNO' : (fixMojibake(row.guest_name) || null);

      await t.run(`
        INSERT INTO invoices
          (id, organization_id, invoice_number, issued_at, due_date, amount, currency, status, notes, is_custom,
           custom_buyer_name, custom_description, is_credit_note, series, period, confirmed, confirmation_source)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'issued', ?, TRUE, ?, ?, ?, ?, ?, TRUE, ?)
      `, [
        invId, actor.organizationId, invNum, issued, due,
        row.amount, row.currency,
        noteKey,
        buyerName,
        fixMojibake(row.description),
        row.is_credit_note ? 1 : 0,
        series, period,
        `statement:${row.source}`,
      ]);

      return { id: invId, number: invNum, created: true };
    });

    for (const row of rows) {
      // Process both income rows AND credit notes (refunds)
      if (row.op_type !== 'income' && !row.is_credit_note) continue;
      try {
        const { id, number, created } = await createInvoice(row);
        results.push({
          source_ref:       row.source_ref,
          invoice_id:       id,
          invoice_number:   number,
          guest_name:       row.guest_name,
          needs_guest_name: row.needs_guest_name ?? false,
          is_credit_note:   row.is_credit_note ?? false,
          description:      row.description,
          amount:           row.amount,
          currency:         row.currency,
          date:             row.date,
          created,
        });
      } catch (e: any) {
        console.error('[BatchInvoices] row error:', e.message, row.source_ref);
      }
    }

    return NextResponse.json({
      ok: true,
      channel,
      total:   results.length,
      created: results.filter(r => r.created).length,
      needs_names: results.filter(r => r.needs_guest_name).length,
      invoices: results,
    });
  } catch (e: any) {
    console.error('[BatchInvoices] error:', e.message);
    return serverError('app/api/accounting/invoice-batch _POST', e);
  }
}
