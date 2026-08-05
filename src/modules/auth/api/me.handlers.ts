import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSessionUser } from '@core/auth';
import { getDb } from '@core/db';
import { listFeatures } from '@core/features';

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

    return NextResponse.json({ user, features });
  } catch (error) {
    console.error('Auth me error:', error);
    return NextResponse.json({ error: 'Помилка сервера' }, { status: 500 });
  }
}
