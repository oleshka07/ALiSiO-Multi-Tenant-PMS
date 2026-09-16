/* eslint-disable @typescript-eslint/no-explicit-any */
import { getSql } from '@core/db/async';
import { requireOrganizationId } from '@core/auth/tenant-context';
import { refuse } from '@core/http/errors';
import { categoryIdByCode } from '@core/chart-of-accounts';
import {
  createOperationInTx,
  getOptionalActor,
  writeOperationAudit,
  type OperationActor,
} from './operations.handlers';
// В3: гроші за бронь лягають У ФОЛІО, а слово рахує один спільний
// перерахунок — не цей модуль. Двері фасадів, не чужий SQL.
import { recordReservationPayment, recordPaymentDetailed } from '@invoicing/kernel';
import { recalcPaymentStatusFromFolio, recordBookingChange } from '@bookings/kernel';
// Зняття грошей із книги гостя після видалення рядка — одні двері на всіх
// (Р8.7), інакше кожен видаляч знімає їх по-своєму або не знімає зовсім.
import { reverseOperationInFolio } from './folio-reversal';
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
  /**
   * Куди покласти гроші — ПЕРЕВАГА, не наказ.
   *
   * Рахунок береться, лише якщо він ще чинний (`is_active`) і в тій самій
   * валюті, що операція; інакше добір іде звичайним шляхом, а не знайшовши
   * нічого — відмовляє названою відмовою. Доти поле шанувалось беззастережно,
   * і готівка лягала на ВИМКНЕНУ касу (виміряно 11.09.2026).
   *
   * Кліринговий рахунок каналу сюди не передають — його добирає
   * `findClearingAccount` за каналом і валютою.
   */
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

/**
 * Стаття довідника ЦЬОГО готелю за сталим кодом — або НАЗВАНА ВІДМОВА.
 *
 * `categoryIdByCode` віддає `null`, коли статті немає, і мовчазний `null`
 * поїхав би далі в `fin_operations.category_id`: на Postgres це відмова
 * зовнішнього ключа з текстом драйвера, на SQLite — рядок, що вказує в
 * нікуди. Обидва варіанти кажуть оператору неправду про причину.
 *
 * Порожній довідник — стан, який справді буває: організація, заведена до
 * того, як засів переїхав у `provisionOrganization` (INC-025/INC-028). Тому
 * відмова називає не поле запиту, а дію: чим саме порожньо і хто це лагодить.
 */
async function requireCategory(code: string): Promise<string> {
  const id = await categoryIdByCode(code);
  if (!id) {
    refuse(
      `У готелю не заведено плану рахунків (немає статті «${code}»), тож операції нема на що віднести. `
      + 'Це разова дія адміністратора: `node scripts/seed-chart-of-accounts.mjs --slug <готель>`.', 409);
  }
  return id;
}

/**
 * Куди покласти готівку — або НАЗВАНА ВІДМОВА.
 *
 * Витягнуто з `createPaymentOperation`, бо дверей у каси стало двоє: рецепція
 * (`/api/payments`) і екран фоліо (`settleFolioPayment`). Дві копії цього
 * добору розійшлися б у перший же тиждень — а розходяться вони тим, що одна
 * кладе гроші на вимкнений рахунок або в чужу валюту.
 */
async function resolveTillAccount(args: {
  organizationId: string;
  currency: string;
  /** Памʼять екрана (`app_users.default_cash_account_id`) — ПЕРЕВАГА, не наказ. */
  accountId?: string;
  source: PaymentSource;
  channelType?: string;
}): Promise<{ accountId: string; needsReview: 0 | 1 }> {
  const sql = getSql();
  const { organizationId, currency, accountId, source } = args;
  let resolved: string | undefined;
  let needsReview: 0 | 1 = 0;
  if (!accountId && source === 'hostex') {
    resolved = await findClearingAccount(organizationId, args.channelType, currency) || undefined;
  }
  if (!resolved) {
    // ── Названий рахунок — ПЕРЕВАГА, а не наказ ─────────────────────────
    //
    // Тут стояло `let resolvedAccountId = accountId`, тобто явно названий
    // рахунок шанувався беззастережно і повз усі три умови нижче. Для синку
    // каналу це правильно (кліринговий рахунок називають свідомо, і його
    // добір вище вже звіряє і валюту, і чинність), але `accountId` сюди
    // передає рівно ОДИН викликач — `app/api/payments`, — і він рахунок не
    // називає, а ПАМʼЯТАЄ: `app_users.default_cash_account_id`. Памʼять
    // застаріває.
    //
    // Виміряно живим прогоном 11.09.2026: після `is_active = FALSE` на
    // єдиній касі готівка все одно лягла В НЕЇ — 999 CZK на вимкнений
    // рахунок, 201 і жодного слова. «Закрити касу» не закривало касу. Друге
    // те саме, тихіше: валюта не звірялась, тож каса в кронах була місцем
    // для євро.
    //
    // `(id = ?) DESC` у порядку, а не окремим запитом: умови придатності вже
    // написані ТУТ, одним рядком на всіх, і другий запит означав би другу їх
    // копію — яка розійдеться.
    const fallback = await sql.row<any>(`
      SELECT id FROM finance_accounts
      WHERE organization_id = ? AND currency = ?
        AND type IN ('cash', 'bank') AND is_active = TRUE
      ORDER BY (id = ?) DESC, sort_order ASC, created_at ASC LIMIT 1
    `, [organizationId, currency, accountId ?? '']) as { id: string } | undefined;
    resolved = fallback?.id || undefined;
    if (source === 'hostex' || source === 'teia' || source === 'booking_widget') needsReview = 1;
  }

  // Немає КУДИ покласти гроші — відмова, названа тут і словами оператора
  // (INC-028, ланка 3). Доти цей випадок доходив до `createOperationInTx`, той
  // кидав `income requires account_to_id` — англійський рядок про поле запиту,
  // — а маршрут згортав його в 500 «Внутрішня помилка сервера».
  //
  // Відмова називає ВАЛЮТУ: рахунок може бути, але в іншій — саме так виглядає
  // готель на євро, якому колись завели касу в кронах.
  if (!resolved) {
    refuse(
      `У готелю немає активного рахунку в ${currency}, тож готівку нема куди записати. `
      + 'Додайте касу: Фінанси → Рахунки → Додати рахунок (тип «Каса», валюта '
      + `${currency}).`, 409);
  }
  return { accountId: resolved as string, needsReview };
}

/**
 * СЛІД НА КАРТЦІ БРОНІ — одна форма запису на обидві двері.
 *
 * ── Чому це переїхало сюди з маршруту (16.09.2026, доповнення Д83) ──────
 *
 * Д81 постановив: правка, якою рухають гроші, лишає рядок у «Історії змін».
 * Рецепційні двері його лишали — але робив це САМ МАРШРУТ, після повернення
 * з містка. Тобто «одні двері — однакові книги» було неправдою рівно на одну
 * книгу: оплата з екрана фоліо не лишала на картці жодного сліду, і питання
 * «звідки на броні ці гроші» знову не мало відповіді там, де його ставлять.
 *
 * Тепер слід лишає той, хто рухає гроші, а не той, хто про це попросив. Це
 * безпечно: у `createPaymentOperation` рівно ОДИН бойовий викликач
 * (`app/api/payments`), і він ходить сюди тільки з `cash` — канальний синк і
 * віджет мають свої шляхи.
 *
 * `caveat` — це те, чого з грошима НЕ сталося, і воно не косметика: рядок
 * «гроші в касі, у рахунку гостя їх немає» — постійний стан німецького
 * обʼєкта без `fiscal_de`, і видимим він мусить лишатись і через місяць, а не
 * лише в тості.
 */
async function noteMoneyOnBooking(args: {
  reservationId: string;
  amount: number;
  method: string;
  isRefund: boolean;
  caveat?: string | null;
  actor?: OperationActor | null;
}): Promise<void> {
  // Знак — із РОДУ платежу, не літералом: повернення 500 готівкою лягало в
  // журнал як «+500 · cash» (П11) — рядок, який каже протилежне тому, що
  // сталося з грошима. Власного `try` тут немає навмисно: писач журналу вже
  // не ковтає своїх помилок мовчки (Д81), і друга обгортка це б повернула.
  await recordBookingChange(getSql(), {
    reservationId: args.reservationId,
    action: 'payment',
    details: `${args.isRefund ? '−' : '+'}${Math.abs(Number(args.amount))} · ${args.method}`
      + (args.isRefund ? ' · повернення' : '')
      + (args.caveat ? ` · ${args.caveat}` : ''),
    actor: args.actor?.id ? { id: args.actor.id, name: args.actor.name || args.actor.id } : null,
  });
}

/** Рядок каси за платежем броні — одна форма запису на обидві двері. */
async function writeTillOperation(args: {
  organizationId: string;
  reservationId: string;
  stay: { check_in: string | null; check_out: string | null };
  amount: number;
  isRefund: boolean;
  currency: string;
  accountId: string;
  needsReview: 0 | 1;
  paymentSubtype: PaymentSubtype;
  source: PaymentSource;
  sourceRef?: string;
  paidAt: string;
  comment: string;
  status: 'completed' | 'pending';
  actor?: OperationActor | null;
}): Promise<string> {
  const { isRefund } = args;
  const accruedAt = (!isRefund && args.stay.check_in) ? args.stay.check_in : undefined;
  return await createOperationInTx(args.organizationId, {
    op_type: isRefund ? 'expense' : 'income',
    account_from_id: isRefund ? args.accountId : null,
    account_to_id: isRefund ? null : args.accountId,
    amount: Math.abs(args.amount),
    currency: args.currency,
    paid_at: args.paidAt,
    ...(accruedAt ? { accrued_at: accruedAt } : {}),
    ...(args.stay.check_in ? { period_from: args.stay.check_in } : {}),
    ...(args.stay.check_out ? { period_to: args.stay.check_out } : {}),
    // Стаття довідника ЦЬОГО готелю, за сталим кодом (INC-025). Тут стояв
    // літеральний ідентифікатор — рядок, який належить готелю, що завівся
    // першим: на чистій інсталяції зовнішній ключ відмовляв готівковій оплаті
    // ПЕРШОГО ж готелю, а на базі з демо операції ДРУГОГО тихо чіплялись на
    // чужий рядок, який його ж політика при читанні ховає.
    category_id: isRefund ? await requireCategory('other_exp') : await requireCategory('accommodation'),
    reservation_id: args.reservationId,
    status: args.status,
    method: 'cash',
    payment_subtype: args.paymentSubtype,
    comment: args.comment,
    source: args.source,
    source_ref: args.sourceRef || args.reservationId,
    needs_review: args.needsReview,
  }, args.actor || null);
}

/**
 * Стоя очима каси: чий це готель, яка валюта і які дати нарахування.
 *
 * Один запит на ОБИДВІ двері. Друга копія того самого питання — це не лише
 * зайве читання: `check-property-scope` рахує пари «запит × таблиця», і
 * другий такий `SELECT` підіймав би стелю файла за роботу, якої не було.
 */
async function stayForTill(reservationId: string) {
  return await getSql().row<{
    org_id: string; check_in: string | null; check_out: string | null; currency: string;
  }>(`
    SELECT prop.organization_id AS org_id, r.check_in, r.check_out, r.currency
    FROM reservations r JOIN properties prop ON r.property_id = prop.id
    WHERE r.id = ?
  `, [reservationId]);
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

  const row = await stayForTill(reservationId) as
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

  // Куди лягають гроші — спільним добором (одна копія на обидві двері).
  // Порядок збережено: відмова «немає рахунку» лунає ДО розгалуження за
  // способом, як і раніше.
  const { accountId: tillAccountId, needsReview } = await resolveTillAccount({
    organizationId: row.org_id, currency, accountId, source, channelType: input.channelType,
  });

  // ONLY cash payments create an operation in fin_operations (the central ledger).
  // Non-cash methods (card, bank_transfer, online, booking_platform, etc.) arrive
  // via bank statement import and will be recorded when the real bank transaction lands.
  if (method !== 'cash') {
    await recalcPaymentStatusFromFolio(reservationId);
    // Слід лишається і тут, з чесною приміткою: грошей ще немає ні в касі, ні
    // в рахунку гостя — вони приїдуть випискою.
    await noteMoneyOnBooking({
      reservationId, amount, method, isRefund,
      caveat: 'ще не в касі — приїде випискою', actor: input.actor ?? null,
    });
    return { operationId: '', folioRecorded: false, folioRefusal: 'non-cash payment is recorded when the bank transaction lands' };
  }

  const operationId = await writeTillOperation({
    organizationId: row.org_id, reservationId,
    stay: { check_in: row.check_in, check_out: row.check_out },
    amount, isRefund, currency,
    accountId: tillAccountId, needsReview,
    paymentSubtype, source, sourceRef,
    paidAt, comment: fullComment, status,
    actor: input.actor || null,
  });

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
    const { paymentId } = await recordReservationPayment({
      reservationId,
      amount: isRefund ? -Math.abs(amount) : Math.abs(amount),
      method: 'cash',
      paidAt,
    });
    // Операція НЕСЕ рядок, який поклала (0096, Р10.6). Без цього посилання
    // видалення не має чим відрізнити свій платіж від ручної проводки
    // бухгалтера — і забирає з рахунку гостя чужі гроші.
    await sql.run(
      'UPDATE fin_operations SET folio_payment_id = ? WHERE id = ? AND organization_id = ?',
      [paymentId, operationId, row.org_id]);
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

  // Слід на картці — ТУТ, а не в маршруті: див. `noteMoneyOnBooking`.
  await noteMoneyOnBooking({
    reservationId, amount, method, isRefund,
    caveat: folioRecorded ? null : 'лише в касі, не в рахунку гостя',
    actor: input.actor ?? null,
  });
  return { operationId, folioRecorded, folioRefusal };
}

/**
 * ОПЛАТА З ЕКРАНА ФОЛІО — і вона закриває ті самі книги, що й рецепційна.
 *
 * ── Що було ─────────────────────────────────────────────────────────────
 *
 * Дверей у гроші двоє, і вони давали різне. Виміряно запуском 16.09.2026 на
 * тій самій фікстурі, тими самими 1000 готівкою:
 *
 *                      книга гостя   слово броні   каса
 *   екран фоліо        борг 0        unpaid        0 рядків
 *   рецепція           борг 0        paid          1 рядок, 1000
 *
 * Обробник фоліо писав рядок у `fin_folio_payments` і повертав 201. Слово
 * броні ставив БРАУЗЕР — окремим `PATCH`, який вимагає `manage_bookings`; у
 * бухгалтера цього права немає, тож у нього оплата мовчки лишала бронь
 * «не оплаченою». А каса не бачила рецепційної готівки взагалі: у ролі
 * `receptionist` немає `manage_payments`, тобто ЄДИНІ доступні рецепції
 * двері були ті, що в касу не пишуть.
 *
 * ── Що тут ──────────────────────────────────────────────────────────────
 *
 * Один порядок на обидві двері, і він саме такий:
 *
 *   1. книга гостя — ПЕРША. Фіскальна варта (німецький обʼєкт без TSE)
 *      відмовляє тут, і тоді в касу не лягає нічого: гроші в касі за платіж,
 *      якого рахунок гостя не прийняв, — це та сама розбіжність книг, тільки
 *      з іншого боку;
 *   2. каса — ЛИШЕ готівка. `transfer` і `card_terminal` приходять випискою
 *      банку чи еквайра, і рядок тут дав би подвійний рахунок тих самих
 *      грошей (те саме правило, що `CASH_METHODS` у `/api/payments`);
 *   3. звʼязок `folio_payment_id` — щоб видалення знімало СВОЇ гроші (Р10.6);
 *   4. слово броні — спільним перерахунком, а не вигаданим статусом.
 *
 * Фоліо без броні (зала, подія) проходить кроки 1 і 3: слова немає, бо немає
 * броні, і в касу гроші кладе той, хто вміє назвати обʼєкт.
 */
export interface SettleFolioInput {
  folioId: string;
  amount: number;
  /** Клас оплати або порожньо, якщо названо `methodId` (Д61). */
  method?: string;
  methodId?: string | null;
  invoiceId?: string | null;
  paidAt?: string | null;
  receivedBy?: string | null;
  actor?: OperationActor | null;
}

export interface SettleFolioResult {
  paymentId: string;
  /** Рядок каси, коли гроші справді лягли в касу; інакше `null`. */
  operationId: string | null;
  reservationId: string | null;
  /** Слово броні після перерахунку — те, що показувати оператору. */
  paymentStatus: string | null;
  /**
   * Чому готівка не дійшла до каси, хоч мала.
   *
   * Найчастіший випадок — у готелю немає активного рахунку в валюті броні.
   * Втрачати через це ПЛАТІЖ ГОСТЯ не можна: гроші вже в руках, і рахунок
   * гостя мусить їх бачити. Але й мовчати не можна — саме мовчання цих двох
   * книг і було вадою, яку лікує Д83. Тому: платіж записано, каса порожня,
   * причина названа й доїжджає до оператора (той самий взірець, що
   * `folioRefusal` у рецепційних дверях).
   */
  tillRefusal?: string;
}

export async function settleFolioPayment(input: SettleFolioInput): Promise<SettleFolioResult> {
  const organizationId = await requireOrganizationId();
  const sql = getSql();

  // 1. Книга гостя — ПЕРША, і вона ж каже, що саме записала: клас із
  //    довідника, суму і бронь, якій належить рахунок. Усі відмови писача
  //    (чужий рахунок → 404, клас, фіскальна варта) лунають тут і своїм
  //    статусом — далі нічого не виконується.
  const written = await recordPaymentDetailed({
    folioId: input.folioId,
    amount: input.amount,
    method: input.method,
    methodId: input.methodId ?? null,
    invoiceId: input.invoiceId ?? null,
    paidAt: input.paidAt ?? null,
    receivedBy: input.receivedBy ?? null,
  });
  const paymentId = written.id;
  const reservationId = written.reservationId;
  const method = String(written.method);
  const amount = Number(written.amount);

  // 2. Каса — лише готівка і лише там, де є бронь, від якої відомі валюта,
  //    обʼєкт і дати нарахування.
  let operationId: string | null = null;
  let tillRefusal: string | undefined;
  if (method === 'cash' && reservationId) {
    const stay = await stayForTill(reservationId);
    if (stay) try {
      const currency = String(stay.currency);
      const { accountId, needsReview } = await resolveTillAccount({
        organizationId, currency, source: 'manual',
      });
      // Відʼємний рядок — це повернена з каси готівка, тобто ВИТРАТА з тим
      // самим знаком в обох книгах. Зустрічний рядок не «видаляє платіж».
      const isRefund = amount < 0;
      operationId = await writeTillOperation({
        organizationId, reservationId,
        stay: { check_in: stay.check_in, check_out: stay.check_out },
        amount, isRefund, currency,
        accountId, needsReview,
        paymentSubtype: isRefund ? 'refund' : 'partial',
        source: 'manual',
        sourceRef: reservationId,
        paidAt: input.paidAt ?? new Date().toISOString(),
        comment: `Готівка з рахунку гостя${isRefund ? ' (повернення)' : ''}`,
        status: 'completed',
        actor: input.actor ?? null,
      });
      // 3. Операція НЕСЕ рядок, який поклала (0096, Р10.6): без цього
      //    видалення не відрізнить свій платіж від ручної проводки бухгалтера.
      await sql.run(
        'UPDATE fin_operations SET folio_payment_id = ? WHERE id = ? AND organization_id = ?',
        [paymentId, operationId, organizationId]);
    } catch (e: unknown) {
      // Каса відмовила — найчастіше «немає активного рахунку в цій валюті».
      // Платіж гостя вже записаний і лишається: гроші в руках, і книга гостя
      // мусить їх бачити. Відмова їде оператору названою, а не в лог.
      operationId = null;
      tillRefusal = (e as Error)?.message ?? 'till refused the operation';
      console.warn(`[payment-bridge] каса не прийняла готівку за ${reservationId}: ${tillRefusal}`);
    }
  }

  // 4. Слово броні — тим самим перерахунком, що й усюди (В3).
  let paymentStatus: string | null = null;
  if (reservationId) {
    const change = await recalcPaymentStatusFromFolio(reservationId);
    paymentStatus = change?.now ?? null;
    // 5. І слід на картці — тією самою формою, що з рецепції. Фоліо без броні
    //    сліду не має, бо немає картки, на якій його шукати.
    await noteMoneyOnBooking({
      reservationId, amount, method, isRefund: amount < 0,
      caveat: tillRefusal ? 'у рахунку гостя, але не в касі' : null,
      actor: input.actor ?? null,
    });
  }

  return { paymentId, operationId, reservationId, paymentStatus, ...(tillRefusal ? { tillRefusal } : {}) };
}

/**
 * Check if a payment operation already exists for a reservation matching
 * the given source + source_ref. Used by Hostex sync to avoid duplicates.
 */
export async function hasPaymentOperation(reservationId: string, source: PaymentSource, sourceRef?: string): Promise<boolean> {
  const sql = getSql();
  // Орендар названий явно, хоч `reservationId` і приходить із синку каналу:
  // «чи вже є така операція» без орендаря відповідає ПО ВСІЙ базі, і сусідній
  // готель, чия бронь має той самий ідентифікатор джерела, змусив би нас
  // пропустити свій платіж. На Postgres рятує політика, на SQLite — ніщо.
  const organizationId = await requireOrganizationId();
  if (sourceRef) {
    const row = await sql.row<any>(`
      SELECT id FROM fin_operations
      WHERE organization_id = ? AND reservation_id = ? AND source = ? AND source_ref = ? LIMIT 1
    `, [organizationId, reservationId, source, sourceRef]);
    return !!row;
  }
  const row = await sql.row<any>(`
    SELECT id FROM fin_operations
    WHERE organization_id = ? AND reservation_id = ? AND source = ? LIMIT 1
  `, [organizationId, reservationId, source]);
  return !!row;
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
  const op = await sql.row<any>(
    'SELECT * FROM fin_operations WHERE id = ? AND organization_id = ?',
    [operationId, organizationId]);
  if (!op) return { deleted: false, reservationId: null };
  // Слід у журналі — так само, як у видаленні операції з екрана Фінансів:
  // двері одні, тож і запис про видалення мусить бути один, інакше рядок,
  // знесений старим маршрутом платежів, зникав без автора (Р10.10).
  const actor = await getOptionalActor();
  await writeOperationAudit(operationId, 'delete', actor, op, null);
  await sql.run('DELETE FROM fin_operations WHERE id = ? AND organization_id = ?', [operationId, organizationId]);
  await reverseOperationInFolio(op);

  // Слід на КАРТЦІ БРОНІ, а не лише в аудиті операцій (П10): прийом грошей
  // рядок лишав, зняття — ні, і «хто прибрав цей платіж» не мало відповіді
  // там, де його питають.
  if (op.reservation_id) {
    try {
      await recordBookingChange(sql, {
        reservationId: String(op.reservation_id),
        action: 'payment_deleted',
        details: `−${Math.abs(Number(op.amount) || 0)} ${String(op.currency ?? '')}`.trim()
          + (op.method ? ` · ${String(op.method)}` : ''),
        actor: actor?.id ? { id: actor.id, name: actor.name || actor.id } : null,
      });
    } catch (e: unknown) {
      // Журнал не причина зірвати видалення, але й мовчати він не має.
      console.error('[payments] слід видалення платежу не записався:', (e as Error)?.message ?? e);
    }
  }
  return { deleted: true, reservationId: op.reservation_id ?? null };
}
