import { NextRequest, NextResponse } from 'next/server';
import { withActor, notFound, type Actor } from '@core/auth/session';
import { getSql } from '@core/db/async';
import { PROPERTY_SCOPE_COOKIE, PROPERTY_SCOPE_MAX_AGE } from '@core/auth/property-scope';

/**
 * POST /api/auth/property — запамʼятати обраний обʼєкт.
 *
 * Тіло: `{ property_id: string | null }`. Порожньо — «Усі обʼєкти», кука
 * стирається. Обʼєкт звіряється з організацією сесії: чужий або неіснуючий
 * — 404, не 403 (інваріант 5), і кука не змінюється.
 *
 * Це не змінює жодних даних готелю — лише те, що відкриється в новій
 * вкладці. Тому право — будь-яка особа організації (`withActor`), без
 * окремого дозволу. Див. `core/auth/property-scope.ts`.
 */
export const setPropertyScope = withActor(async (request: NextRequest, _ctx: unknown, actor: Actor) => {
  let body: { property_id?: unknown } = {};
  try { body = await request.json(); } catch { body = {}; }
  const raw = body?.property_id;
  const id = raw === null || raw === undefined || raw === '' ? null : String(raw).trim();

  if (id) {
    const owned = await getSql().row<{ id: string }>(
      'SELECT id FROM properties WHERE id = ? AND organization_id = ?', [id, actor.organizationId],
    );
    if (!owned) return notFound();
  }

  const response = NextResponse.json({ property: id });
  if (id) {
    response.cookies.set(PROPERTY_SCOPE_COOKIE, id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: PROPERTY_SCOPE_MAX_AGE,
    });
  } else {
    response.cookies.set(PROPERTY_SCOPE_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
  }
  return response;
});
