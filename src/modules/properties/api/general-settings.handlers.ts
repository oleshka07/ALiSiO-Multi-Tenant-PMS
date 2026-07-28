/**
 * General settings — the organization record and its primary property.
 *
 * Scoped to the caller's organization from the session. These are the fields
 * the rest of the system reads for currency, timezone and guest-facing contact
 * details, so they belong in one place rather than scattered across env vars.
 */
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getDb } from '@core/db';
import { getSessionUser } from '@/lib/auth';

async function currentUser() {
  const store = await cookies();
  return getSessionUser(store.get('session_id')?.value);
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
    const db = getDb();
    const org = db
      .prepare('SELECT id, name, slug, timezone, default_currency FROM organizations WHERE id = ?')
      .get(user.organization_id);
    const property = db
      .prepare(
        'SELECT id, name, slug, address, city, country, phone, email, check_in_time, check_out_time FROM properties WHERE organization_id = ? ORDER BY created_at LIMIT 1',
      )
      .get(user.organization_id);
    return NextResponse.json({ organization: org ?? null, property: property ?? null, currencies: SUPPORTED_CURRENCIES });
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

    const db = getDb();
    db.prepare(
      "UPDATE organizations SET name = ?, timezone = ?, default_currency = ?, updated_at = datetime('now') WHERE id = ?",
    ).run(name, timezone, currency, user.organization_id);

    if (prop.id) {
      // The WHERE clause carries organization_id so a forged property id from
      // another tenant updates nothing instead of their record.
      db.prepare(
        `UPDATE properties SET name = ?, address = ?, city = ?, country = ?, phone = ?, email = ?,
           check_in_time = ?, check_out_time = ?, updated_at = datetime('now')
         WHERE id = ? AND organization_id = ?`,
      ).run(
        String(prop.name ?? '').trim() || name,
        prop.address ?? null,
        prop.city ?? null,
        String(prop.country ?? 'CZ').toUpperCase().slice(0, 2),
        prop.phone ?? null,
        prop.email ?? null,
        prop.check_in_time || '15:00',
        prop.check_out_time || '11:00',
        prop.id,
        user.organization_id,
      );
    }

    return getGeneralSettings();
  } catch (e: any) {
    console.error('PUT /api/settings/general error:', e);
    return NextResponse.json({ error: e?.message || 'Не вдалося зберегти' }, { status: 500 });
  }
}
