/**
 * @companies/kernel — двері довідника для сусідніх модулів, без HTTP.
 *
 * `@bookings` при виборі платника на броні бере звідси знімок реквізитів;
 * `api/index.ts` тягне обробники з `next/server`, і сцена під голим node
 * його не імпортує.
 */
import { getCompany, createCompany, listCompanies } from '../data/companies.repo';
export { adoptDebtorNo, type AdoptDebtorNoResult } from '../data/companies.repo';
import { normalizeCompany, payerSnapshot, payerAddressLine, EMPTY_PAYER, type PayerSnapshot } from '../domain/company';

export type { PayerSnapshot } from '../domain/company';

/**
 * Завести компанію з коду — для сцен сусідів (`company-stays.repo.check.ts`)
 * і, згодом, для синку каналу, якому OTA віддає юрособу. Та сама
 * нормалізація, що й у HTTP-обробнику.
 */
export async function createCompanyForTests(organizationId: string, body: Record<string, unknown>): Promise<string> {
  return await createCompany(organizationId, normalizeCompany(body) as any);
}

export interface CompanyPayer extends PayerSnapshot {
  id: string;
  name: string;
  archived: boolean;
  /** Для `fin_folios.payer_*`: адреса одним рядком, ДІЧ, ІД. */
  payer_address: string | null;
  payer_vat_no: string | null;
  payer_debtor_no: string | null;
}

/**
 * Назви компаній організації за їхніми id — для екранів і експортів, які
 * показують «чиї це гроші», не заводячи власного SQL до довідника.
 * Невідомий або чужий id у мапу не потрапляє.
 */
export async function companyNames(organizationId: string, ids: readonly string[]): Promise<Map<string, string>> {
  const wanted = new Set(ids.filter(Boolean));
  if (wanted.size === 0) return new Map();
  const rows = await listCompanies(organizationId, { includeArchived: true });
  return new Map(rows.filter((c) => wanted.has(c.id)).map((c) => [c.id, c.name]));
}

/**
 * Скільки днів фірмі на оплату — двері для `@invoicing`, який виводить із
 * цього `due_date` фактури (Д58).
 *
 * Вужче за `companyPayer` навмисно: строк потрібен ПИСАЧЕВІ документа, а не
 * екрану реквізитів, і тягнути заради однієї колонки повний знімок платника
 * означало б, що писач залежить від форми знімка.
 *
 * Чужа, неіснуюча і фірма без названих умов — однаково `null`: строку немає
 * в усіх трьох випадках, і розрізняти їх викликачеві нема для чого.
 */
export async function companyPaymentTerms(organizationId: string, id: string): Promise<number | null> {
  const c = await getCompany(organizationId, id);
  return c?.payment_terms_days ?? null;
}

/**
 * Реквізити компанії як платника. Чужа або неіснуюча — `null` (інваріант 5).
 * Архівна повертається з прапорцем: бронь, на якій вона вже стоїть, має
 * читатись; нову на неї викликач не ставить.
 */
export async function companyPayer(organizationId: string, id: string): Promise<CompanyPayer | null> {
  const c = await getCompany(organizationId, id);
  if (!c) return null;
  return {
    id: c.id, name: c.name, archived: c.archived_at !== null,
    ...payerSnapshot(c),
    payer_address: payerAddressLine(c), payer_vat_no: c.vat_id,
    // Номер дебітора — той, що видав ГОТЕЛЬ (Д56, 0140), а не реєстраційний
    // номер держави. Досі тут стояв `business_id`, бо свого номера не було;
    // це були різні числа під одним іменем, і фірма без реєстрації —
    // приватна особа, закордонний партнер — лишалась у картці дебітора
    // порожньою. Реєстраційний номер нікуди не подівся: він їде в
    // `invoice_company_ico` знімка, своїм іменем.
    payer_debtor_no: c.debtor_no === null || c.debtor_no === undefined ? null : String(c.debtor_no),
  };
}

/**
 * Що саме лягає в бронь, коли платником названо фірму — і коли не названо.
 *
 * ── Навіщо одні двері на два шляхи ──────────────────────────────────────
 *
 * Платника ставили лише ПІСЛЯ створення броні, з картки (`PATCH company_id`),
 * і всі 25 рядків знімка жили просто в тому обробнику. Щойно фірму стало
 * видно й у формі створення, у коді з'явилося б ДВА місця, які пишуть ті
 * самі сім колонок, — і розійтися вони можуть мовчки: бронь, заведена з
 * фірмою, отримала б інший набір реквізитів, ніж та сама бронь, якій фірму
 * поставили наступним кліком. Помітили б це на фактурі, тобто пізно.
 *
 * ── Чому результат, а не `refuse()` ─────────────────────────────────────
 *
 * `refuse()` розбирає лише `handleError`; `catch` обох цих обробників —
 * `serverError`, тож кинута відмова доїхала б 500-ю замість 404/409, які
 * читає екран. Роди відмови тут названі значенням, і кожен обробник віддає
 * свій статус сам — рівно той, що й досі.
 */
export type BookingPayerFields =
  | { ok: true; fields: { company_id: string | null } & Record<keyof PayerSnapshot, string | null> }
  | { ok: false; reason: 'not_found' | 'archived' };

export async function bookingPayerFields(
  organizationId: string,
  companyId: string | null | undefined,
): Promise<BookingPayerFields> {
  const wanted = typeof companyId === 'string' ? companyId.trim() : '';
  // Порожньо — платник-фізособа: знімок ЧИСТИТЬСЯ, а не лишається від
  // попередньої фірми. Інакше документ друкував би реквізити, які бронь уже
  // не має.
  if (!wanted) return { ok: true, fields: { company_id: null, ...EMPTY_PAYER } };

  // Чужа або неіснуюча — однаково «немає» (інваріант 5): бронь готелю А не
  // виставляється на фірму готелю Б, і відповідь не каже, чи така фірма є.
  const payer = await companyPayer(organizationId, wanted);
  if (!payer) return { ok: false, reason: 'not_found' };
  // Архівна читається там, де вона вже стоїть, але новою не ставиться.
  if (payer.archived) return { ok: false, reason: 'archived' };

  // Ключі беруться зі ЗНІМКА, не рештою від `payer`: `CompanyPayer` несе й те,
  // чого в броні немає (`payer_debtor_no` додали пізніше заради фоліо), і
  // rest-деструктуризація пропустила б наступне таке поле в список колонок
  // броні мовчки.
  const fields = { company_id: payer.id } as { company_id: string | null } & Record<keyof PayerSnapshot, string | null>;
  for (const key of Object.keys(EMPTY_PAYER) as (keyof PayerSnapshot)[]) fields[key] = payer[key];
  return { ok: true, fields };
}
