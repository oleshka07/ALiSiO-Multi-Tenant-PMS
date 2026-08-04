/**
 * The language one person works in.
 *
 * Separate from the staff-management routes on purpose. Changing your own
 * interface language is not an administrative act — a receptionist should not
 * need `manage_users` to stop reading Ukrainian, and letting them near the
 * staff endpoints to achieve it would be a much larger grant than the task
 * deserves. This touches the caller's own row and nothing else, so the id is
 * never taken from the request.
 */
import { type Actor, withActor } from '@core/auth/session';
import { getSql } from '@core/db/async';
import { LANGUAGES, LANGUAGE_CODES, isLanguage } from '@core/i18n/languages';
import { NextResponse } from 'next/server';

export const getMyLanguage = withActor(async (_request, _context, actor: Actor) => {
  return NextResponse.json({
    language: actor.user.language,
    own: actor.user.own_language,
    organization: actor.user.organization_language,
    languages: LANGUAGE_CODES.map((code) => ({ code, native: LANGUAGES[code].native })),
  });
});

export const setMyLanguage = withActor(async (request, _context, actor: Actor) => {
  const body = await request.json().catch(() => ({}));
  const wanted = body?.language;

  // Null means "follow the hotel". Storing the hotel's current code instead
  // would pin the person to it and quietly detach them the day the hotel
  // switches — the two are not the same choice.
  if (wanted === null || wanted === '') {
    await getSql().run(
      'UPDATE app_users SET language = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [actor.user.id],
    );
    return NextResponse.json({ language: actor.user.organization_language, own: null });
  }

  if (!isLanguage(wanted)) {
    return NextResponse.json(
      { error: `Мова не підтримується. Доступні: ${LANGUAGE_CODES.join(', ')}` },
      { status: 400 },
    );
  }

  await getSql().run(
    'UPDATE app_users SET language = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [wanted, actor.user.id],
  );
  return NextResponse.json({ language: wanted, own: wanted });
});
