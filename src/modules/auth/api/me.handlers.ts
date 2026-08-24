import { NextResponse } from 'next/server';
import { currentActor } from '@core/auth/session';
import { getSql } from '@core/db/async';
import { listFeatures } from '@core/features';
import { LANGUAGES, LANGUAGE_CODES } from '@core/i18n/languages';

export async function getMe() {
  try {
    // Through currentActor, not the cookie: this is also how the screen
    // learns it is being shown to the supplier standing inside a customer's
    // account. Reading session_id directly answered 401 for that case, and the
    // dashboard bounced back to the login it had just come from.
    const actor = await currentActor();

    if (!actor) {
      return NextResponse.json({ error: 'Не авторизовано' }, { status: 401 });
    }
    const user = actor.user;

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
      // Present only for the supplier working inside a customer. The screen
      // keeps saying whose data is on it; nothing else changes.
      platform: actor.platform ? { email: actor.platform.email } : null,
    });
  } catch (error) {
    console.error('Auth me error:', error);
    return NextResponse.json({ error: 'Помилка сервера' }, { status: 500 });
  }
}
