/**
 * Компанія-платник: що вважається валідним рядком і як вона стає знімком
 * платника на документі (Блок 4 §2.3, 0093).
 *
 * Чисті функції, без бази. Сцена — `../data/companies.repo.check.ts`.
 */

export interface CompanyFields {
  name: string;
  business_id: string | null;
  vat_id: string | null;
  registry_no: string | null;
  address_street: string | null;
  address_city: string | null;
  address_zip: string | null;
  address_country: string | null;
  bank_name: string | null;
  iban: string | null;
  bic: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  /**
   * Скільки днів фірмі на оплату. Звідси виводиться `due_date` фактури —
   * саме виводиться, а не вводиться руками (Д58): введений строк розійшовся б
   * з умовами, записаними на самій фірмі, і ніхто б цього не помітив до
   * першого прострочення. `null` — умов не названо, і тоді строку немає.
   */
  payment_terms_days: number | null;
}

export const COMPANY_FIELDS = [
  'name', 'business_id', 'vat_id', 'registry_no',
  'address_street', 'address_city', 'address_zip', 'address_country',
  'bank_name', 'iban', 'bic', 'email', 'phone', 'notes', 'payment_terms_days',
] as const satisfies readonly (keyof CompanyFields)[];

export type InvalidCompanyReason = 'name_required' | 'country_format' | 'payment_terms_days';

// Без параметр-властивості в конструкторі: node у strip-only режимі (сцени
// під голим node) такого синтаксису не приймає.
export class InvalidCompany extends Error {
  readonly reason: InvalidCompanyReason;
  constructor(reason: InvalidCompanyReason) {
    super(reason);
    this.reason = reason;
  }
}

/**
 * Привести тіло запиту до рядка довідника: обрізати, порожнє → NULL,
 * країна — дві великі літери, IBAN/BIC без пробілів у верхньому регістрі,
 * пошта в нижньому. Назва обовʼязкова. Невідомі ключі відкидаються.
 *
 * `partial` — для PATCH: повертає лише названі поля, назву не вимагає, але
 * порожню назву, якщо її назвали, відхиляє так само.
 */
export function normalizeCompany(body: Record<string, unknown>, partial = false): Partial<CompanyFields> {
  const out: Partial<CompanyFields> = {};
  const text = (v: unknown): string | null => {
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    return s === '' ? null : s;
  };
  for (const key of COMPANY_FIELDS) {
    if (partial && !(key in body)) continue;
    let v = text(body[key]);
    if (key === 'address_country' && v !== null) {
      v = v.toUpperCase();
      if (!/^[A-Z]{2}$/.test(v)) throw new InvalidCompany('country_format');
    }
    if ((key === 'iban' || key === 'bic') && v !== null) v = v.replace(/\s+/g, '').toUpperCase();
    if (key === 'email' && v !== null) v = v.toLowerCase();
    if (key === 'name') {
      if (v === null) throw new InvalidCompany('name_required');
      out.name = v;
      continue;
    }
    // Строк оплати — ЧИСЛО, і воно перевіряється тут, а не мовчки лягає
    // рядком: `'тридцять'` у колонці днів дало б фактуру без строку і
    // порожню графу в нагадуванні, а не помилку.
    if (key === 'payment_terms_days') {
      if (v === null) { out.payment_terms_days = null; continue; }
      const days = Number(v);
      if (!Number.isInteger(days) || days < 0 || days > 365) {
        throw new InvalidCompany('payment_terms_days');
      }
      out.payment_terms_days = days;
      continue;
    }
    (out as Record<string, string | null>)[key] = v;
  }
  return out;
}

/** Знімок платника — те, що лягає на бронь і далі на документ. */
export interface PayerSnapshot {
  invoice_company_name: string;
  invoice_company_ico: string | null;
  invoice_company_dic: string | null;
  invoice_company_address: string | null;
  invoice_company_city: string | null;
  invoice_company_country: string | null;
  invoice_company_email: string | null;
}

export function payerSnapshot(c: CompanyFields): PayerSnapshot {
  return {
    invoice_company_name: c.name,
    invoice_company_ico: c.business_id,
    invoice_company_dic: c.vat_id,
    invoice_company_address: c.address_street,
    // Індекс і місто разом — так друкується адреса на бланку; окремого поля
    // для індексу в знімку броні немає, і заводити його заради цього не варто.
    invoice_company_city: [c.address_zip, c.address_city].filter(Boolean).join(' ') || null,
    invoice_company_country: c.address_country,
    invoice_company_email: c.email,
  };
}

/** Порожній знімок — бронь повернулась до платника-фізособи. */
export const EMPTY_PAYER: Record<keyof PayerSnapshot, null> = {
  invoice_company_name: null, invoice_company_ico: null, invoice_company_dic: null,
  invoice_company_address: null, invoice_company_city: null, invoice_company_country: null,
  invoice_company_email: null,
};

/** Адреса платника одним рядком — для `fin_folios.payer_address`. */
export function payerAddressLine(c: CompanyFields): string | null {
  const line = [c.address_street, [c.address_zip, c.address_city].filter(Boolean).join(' '), c.address_country]
    .filter(Boolean).join(', ');
  return line || null;
}
