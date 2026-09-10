/**
 * Довідник способів оплати готелю (0141, Д61).
 *
 * ── Довідник НАД класом ─────────────────────────────────────────────────
 *
 * `PAYMENT_METHODS` — чотири КЛАСИ: як із цими грішми поводитись (готівка
 * йде в касову книгу і під §146a AO, переказ ні). Вони лишаються, і CHECK у
 * базі лишається. Довідник відповідає на інше питання — ЧИМ САМЕ заплатили,
 * — і несе те, чого клас не несе: рахунок обліку, ознаку «на дебітора»,
 * доступність. У живому готелі таких рядків 24, і три з них — «картка» з
 * різними рахунками обліку.
 *
 * Два джерела одного факту тут неможливі за побудовою: `recordPayment` бере
 * клас ІЗ РЯДКА, а не приймає його окремо поруч із рядком.
 *
 * ── Видалити використаний спосіб не можна, і це не те саме, що вимкнути ──
 *
 * Рішення (Д61): **названа відмова, якщо ним уже платили; вільне видалення,
 * якщо ні; `is_active` — щоб перестати пропонувати.**
 *
 * Чому не «завжди лише вимикати»: рядок, заведений із помилкою в назві
 * хвилину тому, має зникати, інакше довідник обростає сміттям, яке ніхто не
 * наважується чіпати. Чому не «видаляти завжди»: платіжка вказує на рядок, і
 * зникнення рядка або порве посилання, або лишить платіж без рахунку обліку —
 * тобто зіпсує саме те, заради чого довідник заводили. `ON DELETE RESTRICT`
 * тримає це і в базі, але відмова тут НАЗВАНА: база сказала б «порушення
 * зовнішнього ключа», а портьє має прочитати, що робити (`is_active`).
 */
import { getSql } from '@core/db/async';
import { requireOrganizationId } from '@core/auth/tenant-context';
import { PAYMENT_METHODS, type PaymentMethod } from './folio-payments.repo';

export interface PaymentMethodRow {
  id: string;
  organization_id: string;
  code: string;
  /** `null` — «стандартна назва класу»: мову вибирає екран, не міграція. */
  name: string | null;
  kind: PaymentMethod;
  ledger_account: string | null;
  settles_to_debtor: boolean;
  is_active: boolean;
  position: number;
}

const toRow = (r: any): PaymentMethodRow => ({
  id: r.id,
  organization_id: r.organization_id,
  code: r.code,
  name: r.name ?? null,
  kind: r.kind,
  ledger_account: r.ledger_account ?? null,
  // SQLite віддає 0/1, Postgres — boolean: читач нормалізує обидва, щоб
  // «не платіж, а перенесення боргу» не залежало від рушія.
  settles_to_debtor: r.settles_to_debtor === true || r.settles_to_debtor === 1,
  is_active: r.is_active === true || r.is_active === 1,
  position: Number(r.position ?? 0),
});

/**
 * Усі способи готелю; `activeOnly` — те, що пропонувати НОВОМУ платежу.
 *
 * `is_active = TRUE`, а не `IN (TRUE, 1)`: спроба бути «нейтральною до
 * рушія» тут коштувала червоного на справжньому Postgres —
 * `operator does not exist: boolean = integer`. SQLite розуміє літерал
 * `TRUE` (це 1) з 3.23, Postgres розуміє лише його; спільна форма ОДНА, і
 * вона ж та, якою проєкт пише прапорці (інваріант 12).
 */
export async function listPaymentMethods(activeOnly = false): Promise<PaymentMethodRow[]> {
  const organizationId = await requireOrganizationId();
  const rows = await getSql().rows<any>(
    `SELECT * FROM fin_payment_methods
      WHERE organization_id = ?${activeOnly ? ' AND is_active = TRUE' : ''}
      ORDER BY position, code`,
    [organizationId]);
  return rows.map(toRow);
}

/** Один рядок; чужий або неіснуючий — `null` (інваріант 5). */
export async function getPaymentMethod(id: string): Promise<PaymentMethodRow | null> {
  const organizationId = await requireOrganizationId();
  const r = await getSql().row<any>(
    'SELECT * FROM fin_payment_methods WHERE id = ? AND organization_id = ?',
    [id, organizationId]);
  return r ? toRow(r) : null;
}

export class InvalidPaymentMethod extends Error {
  readonly reason: string;
  constructor(reason: string) { super(reason); this.reason = reason; }
}

function requireKind(kind: string): PaymentMethod {
  if (!PAYMENT_METHODS.includes(kind as PaymentMethod)) {
    throw new InvalidPaymentMethod(`kind must be one of ${PAYMENT_METHODS.join(', ')}`);
  }
  return kind as PaymentMethod;
}

export async function createPaymentMethod(input: {
  code: string;
  kind: string;
  name?: string | null;
  ledgerAccount?: string | null;
  settlesToDebtor?: boolean;
  position?: number;
}): Promise<string> {
  const organizationId = await requireOrganizationId();
  const code = String(input.code ?? '').trim();
  if (!code) throw new InvalidPaymentMethod('code required');
  const kind = requireKind(input.kind);
  const id = crypto.randomUUID();
  // `organization_id` названий явно (інваріант 12); прапорці TRUE/FALSE, не 1/0.
  await getSql().run(
    `INSERT INTO fin_payment_methods
       (id, organization_id, code, name, kind, ledger_account, settles_to_debtor, is_active, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, TRUE, ?)`,
    [id, organizationId, code, input.name?.trim() || null, kind,
     input.ledgerAccount?.trim() || null,
     input.settlesToDebtor ? true : false,
     Number(input.position ?? 0)]);
  return id;
}

export async function updatePaymentMethod(id: string, patch: {
  name?: string | null;
  ledgerAccount?: string | null;
  settlesToDebtor?: boolean;
  isActive?: boolean;
  position?: number;
}): Promise<boolean> {
  const organizationId = await requireOrganizationId();
  const sets: string[] = [];
  const values: unknown[] = [];
  if ('name' in patch) { sets.push('name = ?'); values.push(patch.name?.trim() || null); }
  if ('ledgerAccount' in patch) { sets.push('ledger_account = ?'); values.push(patch.ledgerAccount?.trim() || null); }
  if ('settlesToDebtor' in patch) { sets.push('settles_to_debtor = ?'); values.push(patch.settlesToDebtor ? true : false); }
  if ('isActive' in patch) { sets.push('is_active = ?'); values.push(patch.isActive ? true : false); }
  if ('position' in patch) { sets.push('position = ?'); values.push(Number(patch.position)); }
  // Клас НЕ міняється: він уже записаний у платіжках цим способом, і зміна
  // зробила б їх заднім числом іншим родом грошей — готівку переказом.
  if (sets.length === 0) return (await getPaymentMethod(id)) !== null;
  const r = await getSql().run(
    `UPDATE fin_payment_methods SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND organization_id = ?`,
    [...values, id, organizationId]);
  return (r?.changes ?? 0) > 0;
}

/**
 * Скільки платежів уже пішло цим способом. Питається до видалення — і саме
 * ЦЕ число, а не «чи є хоч один»: відмова має сказати людині, скільки саме,
 * інакше вона не знає, чи це помилка хвилинної давнини, чи рік роботи.
 */
export async function paymentsWithMethod(id: string): Promise<number> {
  const organizationId = await requireOrganizationId();
  // Осі ОБʼЄКТА тут немає навмисно, і це рішення. Спосіб оплати належить
  // РАХУНКУ, не будинку: звузивши це питання по обʼєкту, ми дозволили б
  // одному будинку видалити спосіб, яким досі платять у сусідньому — і
  // видалення пройшло б, бо «в моєму будинку ним не платили». Питання
  // навмисно ширше за екран, з якого воно приходить.
  const r = await getSql().row<{ n: number }>(
    'SELECT COUNT(*) AS n FROM fin_folio_payments WHERE organization_id = ? AND method_id = ?',
    [organizationId, id]);
  return Number(r?.n ?? 0);
}

/**
 * Видалити спосіб. Використаний — НАЗВАНА відмова з числом (Д61).
 * `false` — чужий або неіснуючий (інваріант 5: 404, не 403).
 */
export async function deletePaymentMethod(id: string): Promise<boolean> {
  const organizationId = await requireOrganizationId();
  const used = await paymentsWithMethod(id);
  if (used > 0) {
    throw new InvalidPaymentMethod(
      `This payment method is already used by ${used} payment(s) — switch it off instead of deleting it`);
  }
  const r = await getSql().run(
    'DELETE FROM fin_payment_methods WHERE id = ? AND organization_id = ?',
    [id, organizationId]);
  return (r?.changes ?? 0) > 0;
}
