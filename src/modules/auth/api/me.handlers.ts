import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSessionUser } from '@core/auth';
import { getDb } from '@core/db';
import { getSql } from '@core/db/async';
import { listFeatures } from '@core/features';
import { LANGUAGES, LANGUAGE_CODES } from '@core/i18n/languages';

export async function getMe() {
  try {
    const cookieStore = await cookies();
    const sessionId = cookieStore.get('session_id')?.value;
    const user = await getSessionUser(sessionId);

    if (!user) {
      return NextResponse.json({ error: 'Не авторизовано' }, { status: 401 });
    }

    // The same registry the routes enforce — the sidebar only mirrors it.
    const features = user.organization_id ? await listFeatures(user.organization_id) : {};

    // What the organization IS: its currency, and which countries its
    // properties stand in. Jurisdiction-bound UI (the Czech Evidenční kniha,
    // currency labels on reports) reads this instead of assuming the first
    // customer's answers.
    let organization: { currency: string; countries: string[] } | null = null;
    if (user.organization_id) {
      const sql = getSql();
      const org = await sql.row<any>(
        'SELECT default_currency FROM organizations WHERE id = ?', [user.organization_id]);
      const props = await sql.rows<any>(
        'SELECT DISTINCT country FROM properties WHERE organization_id = ? AND country IS NOT NULL',
        [user.organization_id]);
      organization = {
        currency: org?.default_currency || 'EUR',
        countries: props.map((p) => String(p.country).toUpperCase()).filter(Boolean),
      };
    }

    // The effective language is already resolved on the session (person, else
    // hotel); it is repeated at the top level so the client does not have to
    // know the precedence rule to render a language switch.
    return NextResponse.json({
      user,
      features,
      organization,
      language: user.language,
      languages: LANGUAGE_CODES.map((code) => ({ code, native: LANGUAGES[code].native })),
    });
  } catch (error) {
    console.error('Auth me error:', error);
    return NextResponse.json({ error: 'Помилка сервера' }, { status: 500 });
  }
}
