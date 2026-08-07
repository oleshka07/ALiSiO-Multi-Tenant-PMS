/**
 * General settings — the organization record and its primary property.
 *
 * Scoped to the caller's organization from the session. These are the fields
 * the rest of the system reads for currency, timezone and guest-facing contact
 * details, so they belong in one place rather than scattered across env vars.
 */
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSql } from '@core/db/async';
import { getSessionUser } from '@core/auth';
import { LANGUAGES, LANGUAGE_CODES, isLanguage } from '@core/i18n/languages';

async function currentUser() {
  const store = await cookies();
  return await getSessionUser(store.get('session_id')?.value);
}

const unauthorized = () => NextResponse.json({ error: 'Не авторизовано' }, { status: 401 });
const forbidden = () => NextResponse.json({ error: 'Недостатньо прав' }, { status: 403 });
const canManage = (role: string) => role === 'owner' || role === 'director';

// Kept deliberately short: adding a currency here also requires rate handling.
export const SUPPORTED_CURRENCIES = ['CZK', 'EUR', 'USD', 'PLN', 'GBP', 'UAH'] as const;

export async function getGeneralSettings(): Promise<NextResponse> {
  const user = await currentUser();
  if (!user) return unauthorized();
  try {
    const sql = getSql();
    const org = await sql.row<any>(`SELECT id, name, slug, timezone, default_currency, language,
                legal_name, registration_no, vat_no, is_vat_payer, legal_address,
                bank_name, bank_account, iban, swift, invoice_email, website, ocr_cloud_fallback
         FROM organizations WHERE id = ?`, [user.organization_id]);
    const property = await sql.row<any>('SELECT id, name, slug, address, city, country, phone, email, check_in_time, check_out_time FROM properties WHERE organization_id = ? ORDER BY created_at LIMIT 1', [user.organization_id]);
    return NextResponse.json({
      organization: org ?? null,
      property: property ?? null,
      currencies: SUPPORTED_CURRENCIES,
      languages: LANGUAGE_CODES.map((code) => ({ code, native: LANGUAGES[code].native })),
    });
  } catch (e: any) {
    console.error('GET /api/settings/general error:', e);
    return NextResponse.json({ error: 'Не вдалося прочитати налаштування' }, { status: 500 });
  }
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function saveGeneralSettings(request: NextRequest): Promise<NextResponse> {
  const user = await currentUser();
  if (!user) return unauthorized();
  if (!canManage(user.role)) return forbidden();
  try {
    const body = await request.json();
    const org = body.organization ?? {};
    const prop = body.property ?? {};

    const name = String(org.name ?? '').trim();
    if (!name) return NextResponse.json({ error: 'Назва організації обовʼязкова' }, { status: 400 });

    const currency = String(org.default_currency ?? 'CZK').toUpperCase();
    if (!SUPPORTED_CURRENCIES.includes(currency as (typeof SUPPORTED_CURRENCIES)[number])) {
      return NextResponse.json({ error: `Валюта не підтримується: ${currency}` }, { status: 400 });
    }

    // The base language is not merely a display preference: it decides which
    // language the hotel's content is treated as being written in, and so what
    // gets translated for guests. A silent fallback would mistranslate quietly.
    const language = String(org.language ?? '').trim().toLowerCase();
    if (!isLanguage(language)) {
      return NextResponse.json(
        { error: `Мова не підтримується: ${language || '—'}. Доступні: ${LANGUAGE_CODES.join(', ')}` },
        { status: 400 },
      );
    }

    const timezone = String(org.timezone ?? 'Europe/Prague').trim();
    try {
      new Intl.DateTimeFormat('en', { timeZone: timezone });
    } catch {
      return NextResponse.json({ error: `Невідома часова зона: ${timezone}` }, { status: 400 });
    }

    for (const [label, value] of [
      ['Час заїзду', prop.check_in_time],
      ['Час виїзду', prop.check_out_time],
    ] as const) {
      if (value && !TIME_RE.test(String(value))) {
        return NextResponse.json({ error: `${label} має бути у форматі ГГ:ХХ` }, { status: 400 });
      }
    }

    const str = (v: unknown) => {
      const s = String(v ?? '').trim();
      return s === '' ? null : s;
    };
    // IBAN is checked because it ends up on invoices: a typo means guests pay
    // into an account that does not exist.
    const iban = str(org.iban)?.replace(/\s+/g, '').toUpperCase() ?? null;
    if (iban && !/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) {
      return NextResponse.json({ error: 'IBAN виглядає некоректно' }, { status: 400 });
    }

    const sql = getSql();
    await sql.run(`UPDATE organizations SET name = ?, timezone = ?, default_currency = ?, language = ?,
         legal_name = ?, registration_no = ?, vat_no = ?, is_vat_payer = ?, legal_address = ?,
         bank_name = ?, bank_account = ?, iban = ?, swift = ?, invoice_email = ?, website = ?, ocr_cloud_fallback = ?,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`, [name,
      timezone,
      currency,
      language,
      str(org.legal_name),
      str(org.registration_no),
      str(org.vat_no),
      org.is_vat_payer ? 1 : 0,
      str(org.legal_address),
      str(org.bank_name),
      str(org.bank_account),
      iban,
      str(org.swift),
      str(org.invoice_email),
      str(org.website),
      user.organization_id]);

    if (prop.id) {
      // The WHERE clause carries organization_id so a forged property id from
      // another tenant updates nothing instead of their record.
      await sql.run(`UPDATE properties SET name = ?, address = ?, city = ?, country = ?, phone = ?, email = ?,
           check_in_time = ?, check_out_time = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND organization_id = ?`, [String(prop.name ?? '').trim() || name,
        prop.address ?? null,
        prop.city ?? null,
        String(prop.country ?? 'CZ').toUpperCase().slice(0, 2),
        prop.phone ?? null,
        prop.email ?? null,
        prop.check_in_time || '15:00',
        prop.check_out_time || '11:00',
        prop.id,
        user.organization_id]);
    }

    return getGeneralSettings();
  } catch (e: any) {
    console.error('PUT /api/settings/general error:', e);
    return NextResponse.json({ error: e?.message || 'Не вдалося зберегти' }, { status: 500 });
  }
}
