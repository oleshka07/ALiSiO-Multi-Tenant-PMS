import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSessionUser } from '@core/auth';
import { getDb } from '@core/db';
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

    // The effective language is already resolved on the session (person, else
    // hotel); it is repeated at the top level so the client does not have to
    // know the precedence rule to render a language switch.
    return NextResponse.json({
      user,
      features,
      language: user.language,
      languages: LANGUAGE_CODES.map((code) => ({ code, native: LANGUAGES[code].native })),
    });
  } catch (error) {
    console.error('Auth me error:', error);
    return NextResponse.json({ error: 'Помилка сервера' }, { status: 500 });
  }
}
