/* eslint-disable @typescript-eslint/no-explicit-any */
import { getSql } from '@core/db/async';
import { requireOrganizationId } from '@core/auth/tenant-context';
import {
  createOperationInTx,
  type OperationActor,
} from './operations.handlers';
// В3: гроші за бронь лягають У ФОЛІО, а слово рахує один спільний
// перерахунок — не цей модуль. Двері фасадів, не чужий SQL.
import { recordReservationPayment } from '@invoicing/kernel';
import { recalcPaymentStatusFromFolio } from '@bookings/kernel';
// Зняття грошей із книги гостя після видалення рядка — одні двері на всіх
// (Р8.7), інакше кожен видаляч знімає їх по-своєму або не знімає зовсім.
import { reverseOperationInFolio, reverseOperationsInFolio } from './folio-reversal';
import { applyRulesToOperation, loadActiveRules } from '../data/auto-rules-engine';

// Колонка `currency` тут NOT NULL, тож `|| 'CZK'` не спрацьовував ніколи —
// це не захист, а вигляд рішення: читач вірив, що порожня валюта буває.

export type PaymentMethod = 'cash' | 'card' | 'bank_transfer' | 'invoice' | 'online' | 'booking_platform';
export type PaymentSubtype = 'deposit' | 'full' | 'partial' | 'service' | 'refund';
export type PaymentSource = 'teia' | 'hostex' | 'booking_widget' | 'manual';

export interface CreatePaymentOperationInput {
  reservationId: string;
  amount: number;
  currency?: string;
  method: PaymentMethod;
  paymentSubtype: PaymentSubtype;
  source: PaymentSource;
  sourceRef?: string;
  paidAt?: string;
  accountId?: string;
  status?: 'completed' | 'pending';
  comment?: string;
  /**
   * Channel descriptor (Hostex passes 'booking.com' / 'airbnb' / 'vrbo').
   * Used by the resolver to route the operation to the matching clearing
   * account ('Booking.com (CZK)' / 'Airbnb (EUR)' / etc) instead of
   * defaulting to the first cash account.
   */
  channelType?: string;
  /**
   * Who triggered this payment. Forwarded into the fin_operation as
   * `created_by_user_id` + recorded in the audit table. Null for
   * system flows (Hostex sync, Teia webhook, etc.) where there's no
   * HTTP user — those audit rows read «System» in the UI.
   */
  actor?: OperationActor | null;
}

/**
 * Look up the clearing account that matches a channel + currency. Returns
 * null when no clearing account is seeded for this combination — caller
 * should then fall back AND tag the operation as needs_review.
 */
async function findClearingAccount(orgId: string, channelType: string | undefined, currency: string): Promise<string | null> {
  const sql = getSql();
  if (!channelType) return null;
  const ch = channelType.toLowerCase();
  const display = ch === 'booking.com' || ch === 'booking_com' || ch === 'booking'
    ? 'Booking.com'
    : ch === 'airbnb' ? 'Airbnb'
    : ch === 'vrbo' ? 'VRBO'
    : ch === 'expedia' ? 'Expedia'
    : null;
  if (!display) return null;
  const wanted = `${display} (${currency.toUpperCase()})`;
  const row = await sql.row<any>("SELECT id FROM finance_accounts WHERE organization_id = ? AND name = ? AND type = 'clearing' AND is_active = TRUE LIMIT 1", [orgId, wanted]) as { id: string } | undefined;
  return row?.id || null;
}

/**
 * Create a payment-style operation tied to a reservation.
 * Handles op_type mapping (refund → expense, others → income) and recalculates
 * the reservation.payment_status.
 *
 * This replaces direct INSERT INTO payments across hostex-sync, Teya webhook,
 * and widget-payment-return handlers.
 */
/**
 * Результат прийому платежу. `folioRecorded: false` — НЕ помилка запиту, а
 * факт, який мусить дійти до оператора названим: німецький обʼєкт без
 * `fiscal_de` не пускає готівку у фоліо навмисно (вона там досі в старій
 * касі), і для цілого сегмента це постійний стан, а не рідкісний збій.
 * Мовчазне розходження книг неприпустиме (інваріант 13).
 */
export interface PaymentOperationResult {
  operationId: string;
  /** Чи лягли гроші в книгу гостя. */
  folioRecorded: boolean;
  /** Чому не лягли — текст сторожа, для показу оператору. */
  folioRefusal?: string;
}

export async function createPaymentOperation(input: CreatePaymentOperationInput): Promise<PaymentOperationResult> {
  const sql = getSql();
  const {
    reservationId, amount, method, paymentSubtype, source,
    sourceRef,
    paidAt = new Date().toISOString(),
    accountId,
    status = 'completed',
    comment,
  } = input;

  // Get organization_id via reservations -> properties (+ stay dates for
  // accrual attribution below)
  const row = await sql.row<any>(`
    SELECT prop.organization_id AS org_id, r.check_in, r.check_out, r.currency
    FROM reservations r JOIN properties prop ON r.property_id = prop.id
    WHERE r.id = ?
  `, [reservationId]) as
    // `reservations.currency` — NOT NULL, тож тип каже це прямо: інакше кожен,
    // хто його читає, дописує запасне значення, а воно не спрацьовує ніколи.
    { org_id: string; check_in: string | null; check_out: string | null; currency: string } | undefined;
  if (!row) throw new Error(`Reservation ${reservationId} not found`);

  // The money is in whatever currency the reservation is in. The old default
  // ('CZK', the first customer's currency) recorded a German hotel's cash as
  // koruna and then went looking for a koruna till to put it in.
  const currency = input.currency || row.currency;

  const isRefund = paymentSubtype === 'refund';
  const opType = isRefund ? 'expense' : 'income';

  // Auto-comment: when caller didn't supply one, build a short, info-rich
  // string from reservation context so the operator scanning the
  // operations list immediately sees which booking the money is for
  // («Hostex Airbnb · RES-123 · John Doe · 2026-05-20»). Caller's
  // explicit comment always wins.
  const resContext = await (async () => {
    try {
      const ctx = await sql.row<any>(`
        SELECT r.id, r.check_in,
               TRIM(COALESCE(g.first_name, '') || ' ' || COALESCE(g.last_name, '')) AS guest_name
        FROM reservations r
        LEFT JOIN guests g ON g.id = r.guest_id
        WHERE r.id = ?
      `, [reservationId]) as { id: string; check_in: string | null; guest_name: string | null } | undefined;
      if (!ctx) return null;
      const parts = [
        `RES ${ctx.id.slice(0, 8)}`,
        ctx.guest_name && ctx.guest_name.length > 0 ? ctx.guest_name : null,
        ctx.check_in ? `check-in ${ctx.check_in.substring(0, 10)}` : null,
      ].filter(Boolean);
      return parts.join(' · ');
    } catch { return null; }
  })();

  const fullComment = comment
    ? `${comment}${resContext ? ' | ' + resContext : ''}`
    : `${source === 'booking_widget' ? 'Віджет (готівка)' : 'Готівка'} · ${paymentSubtype}${resContext ? ' | ' + resContext : ''}`;

  // Resolve account in 3 stages:
  //   1) Explicit accountId from caller — always honoured.
  //   2) For channel signals (Hostex prepaid via Booking/Airbnb/VRBO),
  //      route to the matching clearing account ("Booking.com (CZK)" etc).
  //   3) Final fallback — first cash account in matching currency, BUT
  //      flag the operation needs_review=1 so the admin can triage.
  let resolvedAccountId = accountId;
  let needsReview = 0;
  if (!resolvedAccountId && source === 'hostex') {
    resolvedAccountId = await findClearingAccount(row.org_id, input.channelType, currency) || undefined;
  }
  if (!resolvedAccountId) {
    const fallback = await sql.row<any>(`
      SELECT id FROM finance_accounts
      WHERE organization_id = ? AND currency = ?
        AND type IN ('cash', 'bank') AND is_active = TRUE
      ORDER BY sort_order ASC, created_at ASC LIMIT 1
    `, [row.org_id, currency]) as { id: string } | undefined;
    resolvedAccountId = fallback?.id || undefined;
    if (source === 'hostex' || source === 'teia' || source === 'booking_widget') {
      needsReview = 1;
    }
  }

  const accruedAt = (!isRefund && row.check_in) ? row.check_in : undefined;

  // ONLY cash payments create an operation in fin_operations (the central ledger).
  // Non-cash methods (card, bank_transfer, online, booking_platform, etc.) arrive
  // via bank statement import and will be recorded when the real bank transaction lands.
  if (method !== 'cash') {
    await recalcPaymentStatusFromFolio(reservationId);
    return { operationId: '', folioRecorded: false, folioRefusal: 'non-cash payment is recorded when the bank transaction lands' };
  }

  const operationId = await createOperationInTx(row.org_id, {
    op_type: opType,
    account_from_id: isRefund ? (resolvedAccountId || null) : null,
    account_to_id: isRefund ? null : (resolvedAccountId || null),
    amount: Math.abs(amount),
    currency,
    paid_at: paidAt,
    ...(accruedAt ? { accrued_at: accruedAt } : {}),
    ...(row.check_in ? { period_from: row.check_in } : {}),
    ...(row.check_out ? { period_to: row.check_out } : {}),
    category_id: isRefund ? 'ec_other_exp' : 'ec_accommodation',
    reservation_id: reservationId,
    status,
    method,
    payment_subtype: paymentSubtype,
    comment: fullComment,
    source,
    source_ref: sourceRef || reservationId,
    needs_review: needsReview,
  }, input.actor || null);

  // В3: гроші за бронь ЛЯГАЮТЬ У ФОЛІО, а не живуть поруч із ним.
  //
  // Доти готівковий внесок був лише рядком `fin_operations`, і виселення
  // показувало ПОВНИЙ борг при сплачених трьох тисячах із пʼяти: книга
  // проживання про ці гроші не знала. Повернення (`refund`) іде тим самим
  // шляхом зі своїм знаком — каса, віддана назад, це рух у книзі, а не
  // видалений рядок.
  //
  // Падіння тут не скасовує вже записану операцію (транзакції над обома
  // писачами немає — `createOperationInTx` попри назву не відкриває BEGIN),
  // тож помилка називається вголос і статус лишається тим, що був: краще
  // старе слово, ніж слово, виведене з половини книги.
  //
  // Відмова тут БУВАЄ ЗАКОННОЮ: німецький обʼєкт без `fiscal_de` не пускає
  // готівку у фоліо навмисно — вона там досі в старій касі, поки не ввімкнено
  // фіскальний модуль. Тому це не помилка запиту, а факт: цю бронь фоліо не
  // обліковує, і борг на виселенні рахується зі слова броні
  // (`checkout.repo` — порожнє фоліо не відповідає). Двері одні
  // (`recordReservationPayment`), і по відмові вони НЕ лишають порожньої
  // книги: доти лишали, і порожня книга відчиняла виселення боржникові.
  let folioRecorded = true;
  let folioRefusal: string | undefined;
  try {
    await recordReservationPayment({
      reservationId,
      amount: isRefund ? -Math.abs(amount) : Math.abs(amount),
      method: 'cash',
      paidAt,
    });
  } catch (e: any) {
    // Спосіб лишається `cash`, а не підміняється на `transfer`: готівка — це
    // готівка, і сторож відмовляє саме їй не помилково. Брехати способом, щоб
    // проскочити повз сторожа, було б гірше за відмову.
    folioRecorded = false;
    folioRefusal = String(e?.message ?? 'folio refused the payment');
    console.warn(`[payment-bridge] фоліо не прийняло платіж за ${reservationId} — гроші лишаються в fin_operations: ${folioRefusal}`);
  }
  await recalcPaymentStatusFromFolio(reservationId);

  // Auto-rules: payment-bridge ops (Hostex / Teia / widget / manual
  // payment) start with no category / counterparty / project. Run the
  // active rules so they get auto-tagged the same way bank-imported ops
  // already do. Failure here must not break the payment write — wrapped
  // in try/catch with console-only logging.
  try {
    const rules = await loadActiveRules(row.org_id);
    if (rules.length > 0) {
      const op = await sql.row<any>('SELECT * FROM fin_operations WHERE id = ?', [operationId]) as any;
      if (op) await applyRulesToOperation(op, rules, row.org_id);
    }
  } catch (e: any) {
    console.error('[payment-bridge] auto-rules apply failed (non-fatal):', e.message);
  }

  return { operationId, folioRecorded, folioRefusal };
}

/**
 * Check if a payment operation already exists for a reservation matching
 * the given source + source_ref. Used by Hostex sync to avoid duplicates.
 */
export async function hasPaymentOperation(reservationId: string, source: PaymentSource, sourceRef?: string): Promise<boolean> {
  const sql = getSql();
  if (sourceRef) {
    const row = await sql.row<any>(`
      SELECT id FROM fin_operations
      WHERE reservation_id = ? AND source = ? AND source_ref = ? LIMIT 1
    `, [reservationId, source, sourceRef]);
    return !!row;
  }
  const row = await sql.row<any>(`
    SELECT id FROM fin_operations
    WHERE reservation_id = ? AND source = ? LIMIT 1
  `, [reservationId, source]);
  return !!row;
}

/**
 * Delete all payment operations associated with a reservation.
 * Used by cleanup-ical handler.
 */
export async function deletePaymentOperationsForReservation(reservationId: string): Promise<number> {
  const sql = getSql();
  // `bank_transactions` НЕМАЄ у схемі — ні в `src/lib/db.ts`, ні в
  // `db/postgres/schema.sql`. Тобто цей рядок валить виклик цілком, і так було
  // ще до цієї правки: `deletePaymentOperationsForReservation` кидав
  // «no such table» на кожному запуску. Огороджено, щоб зняття грошей із книги
  // гостя не залежало від таблиці, якої немає; знахідка передана у звіті —
  // або таблицю треба завести, або цей рядок прибрати, і це рішення не моє.
  await sql.run('UPDATE bank_transactions SET matched_operation_id = NULL WHERE matched_operation_id IN (SELECT id FROM fin_operations WHERE reservation_id = ?)', [reservationId])
    .catch(() => { /* таблиці немає у схемі — див. коментар вище */ });
  const held = await sql.row<{ total: number }>(
    "SELECT COALESCE(SUM(amount), 0) AS total FROM fin_operations WHERE reservation_id = ? AND op_type = 'income'",
    [reservationId]);
  const result = await sql.run('DELETE FROM fin_operations WHERE reservation_id = ?', [reservationId]);
  // Гроші зникли з однієї книги — мусять зникнути і з другої, інакше рахунок
  // гостя показує сплачене, якого вже ніде немає (Р8.7).
  await reverseOperationsInFolio(reservationId, Number(held?.total) || 0);
  return result.changes;
}

/**
 * Видалити ОДНУ операцію по броні — і зняти ті самі гроші з книги гостя.
 *
 * Одні двері для обох викликачів (`api/payments/[id]` і видалення операції у
 * Фінансах): доти кожен чистив лише `fin_operations`, а перерахунок читав
 * фоліо, бачив там гроші й лишав слово `paid`.
 */
export async function deletePaymentOperation(operationId: string): Promise<{ deleted: boolean; reservationId: string | null }> {
  const sql = getSql();
  // Орендар у WHERE обох запитів: `operationId` приходить з URL, і без нього
  // чужий ідентифікатор видаляв би чужий рядок. На Postgres від цього рятує
  // політика, на SQLite (`npm run dev`) — ніщо.
  const organizationId = await requireOrganizationId();
  const op = await sql.row<{ organization_id: string; reservation_id: string | null; amount: number; op_type: string }>(
    'SELECT organization_id, reservation_id, amount, op_type FROM fin_operations WHERE id = ? AND organization_id = ?',
    [operationId, organizationId]);
  if (!op) return { deleted: false, reservationId: null };
  await sql.run('UPDATE bank_transactions SET matched_operation_id = NULL WHERE matched_operation_id = ?', [operationId])
    .catch(() => { /* `bank_transactions` немає у схемі — див. коментар вище */ });
  await sql.run('DELETE FROM fin_operations WHERE id = ? AND organization_id = ?', [operationId, op.organization_id]);
  await reverseOperationInFolio(op);
  return { deleted: true, reservationId: op.reservation_id };
}
