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
import { withActor, withPermission } from '@core/auth/session';
import { serverError } from '@core/http/errors';
import { normalizeBoundaries } from '@pricing';

async function currentUser() {
  const store = await cookies();
  return await getSessionUser(store.get('session_id')?.value);
}

const unauthorized = () => NextResponse.json({ error: 'Не авторизовано' }, { status: 401 });
const forbidden = () => NextResponse.json({ error: 'Недостатньо прав' }, { status: 403 });
const canManage = (role: string) => role === 'owner' || role === 'director';

// Kept deliberately short: adding a currency here also requires rate handling.
export const SUPPORTED_CURRENCIES = ['CZK', 'EUR', 'USD', 'PLN', 'GBP', 'UAH'] as const;

/**
 * The read itself, unguarded, so the save below can reuse it.
 *
 * The exported handler is the guarded wrapper. Calling the wrapper from inside
 * another handler would re-authenticate a request that is already
 * authenticated, and does not typecheck either: a guard takes
 * (request, context) and this needs neither.
 */
/**
 * Який обʼєкт віддавати. Названий — його, звірений з організацією (чужий —
 * як неіснуючий, `null`). Не названий: єдиний обʼєкт організації — він;
 * кілька — `null`, і екран просить обрати в шапці. Тут стояло
 * `ORDER BY created_at LIMIT 1` — «головний обʼєкт», тобто перший: у
 * готелю з двома цей екран мовчки редагував адресу й часи не того.
 */
async function propertyFor(organizationId: string, propertyId: string | null) {
  const sql = getSql();
  const cols = 'id, name, slug, address, city, country, phone, email, check_in_time, check_out_time';
  if (propertyId) {
    return await sql.row<any>(`SELECT ${cols} FROM properties WHERE organization_id = ? AND id = ?`, [organizationId, propertyId]) ?? null;
  }
  const rows = await sql.rows<any>(`SELECT ${cols} FROM properties WHERE organization_id = ? ORDER BY created_at LIMIT 2`, [organizationId]);
  return rows.length === 1 ? rows[0] : null;
}

async function readGeneralSettings(propertyId: string | null): Promise<NextResponse> {
  const user = await currentUser();
  if (!user) return unauthorized();
  try {
    const sql = getSql();
    const org = await sql.row<any>(`SELECT id, name, slug, timezone, default_currency, language,
                legal_name, registration_no, vat_no, is_vat_payer, legal_address,
                bank_name, bank_account, iban, swift, invoice_email, website, ocr_cloud_fallback, child_age_bands
         FROM organizations WHERE id = ?`, [user.organization_id]);
    const property = await propertyFor(user.organization_id, propertyId);
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

/** GET /api/settings/general?property_id=… — організація і названий обʼєкт. */
export const getGeneralSettings = withActor(async (request: NextRequest) => {
  const propertyId = new URL(request.url).searchParams.get('property_id') || null;
  return readGeneralSettings(propertyId);
});

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const saveGeneralSettings = withPermission('manage_properties', async (request: NextRequest): Promise<NextResponse> => {
  const user = await currentUser();
  if (!user) return unauthorized();
  if (!canManage(user.role)) return forbidden();
  try {
    const body = await request.json();
    const org = body.organization ?? {};
    const prop = body.property ?? {};

    const name = String(org.name ?? '').trim();
    if (!name) return NextResponse.json({ error: 'Назва організації обовʼязкова' }, { status: 400 });

    // Без запасного значення. `?? 'CZK'` тут означало, що екран, який не
    // надіслав валюту, мовчки переводив готель на крони — і німецький готель
    // побачив би це вперше в сумі на фактурі. Валюти, якої не назвали, не
    // існує; правильна відповідь — відмова.
    const currency = String(org.default_currency ?? '').trim().toUpperCase();
    if (!currency) {
      return NextResponse.json({ error: 'Основна валюта обовʼязкова' }, { status: 400 });
    }
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

    // Вікові вилки дітей (Ц30): межі 1…17, JSON-списком; поле, якого екран не
    // надіслав, лишається як було. Погана межа — відмова з назвою.
    let childAgeBands: string | null = null;
    if (org.child_age_bands !== undefined) {
      try {
        childAgeBands = JSON.stringify(normalizeBoundaries(org.child_age_bands));
      } catch {
        return NextResponse.json({ error: 'Вікові межі дітей — цілі числа від 1 до 17, через кому' }, { status: 400 });
      }
    }

    const sql = getSql();
    // What is stored now, so a field the screen did not send keeps its value
    // instead of being reset to a default by omission.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const current: any = await sql.row<any>(
      'SELECT ocr_cloud_fallback, child_age_bands FROM organizations WHERE id = ?', [user.organization_id]) ?? {};
    await sql.run(`UPDATE organizations SET name = ?, timezone = ?, default_currency = ?, language = ?,
         legal_name = ?, registration_no = ?, vat_no = ?, is_vat_payer = ?, legal_address = ?,
         bank_name = ?, bank_account = ?, iban = ?, swift = ?, invoice_email = ?, website = ?, ocr_cloud_fallback = ?,
         child_age_bands = ?,
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
      // The seventeenth placeholder had no value, so every save of this screen
      // answered 500 «Too few parameter values» and nothing on it could be
      // changed — name, timezone, currency, IBAN, all of it. The one that went
      // missing is also the one that matters most: it is the hotel's consent to
      // send a guest's identity document to a cloud OCR, so it is read
      // explicitly rather than defaulted — an absent field keeps what is
      // stored, and only an explicit value turns it on or off.
      org.ocr_cloud_fallback === undefined
        ? (current.ocr_cloud_fallback ? 1 : 0)
        : (org.ocr_cloud_fallback ? 1 : 0),
      childAgeBands ?? current.child_age_bands ?? '[]',
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

    return readGeneralSettings(prop.id ? String(prop.id) : null);
  } catch (e: any) {
    console.error('PUT /api/settings/general error:', e);
    return serverError('modules/properties/api/general-settings saveGeneralSettings', e, 'Не вдалося зберегти');
  }
});
