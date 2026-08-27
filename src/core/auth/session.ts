/**
 * The single place a request's identity is established.
 *
 * The middleware only checks that a session_id cookie is *present*. It does not
 * validate it, and it never derives an organization — so a handler that does
 * not call one of these runs with no identity at all, and any logged-in user of
 * any tenant can reach whatever it touches. That was true of 59 routes.
 *
 * Handlers should not read cookies or call getSessionUser directly: going
 * through here means the organization is always resolved the same way, and the
 * Postgres tenant context (Phase 1.5) has exactly one place to hook into.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSessionUser, type SessionUser } from './auth';
import { hasPermission, type Permission } from './permissions';
import { runWithOrganization } from './tenant-context';
import { PLATFORM_COOKIE, actingUserFor, getPlatformSession } from './platform';
import { hasFeature, featureDisabled, type FeatureKey } from '../features';

export interface Actor {
  user: SessionUser;
  /** Every tenant-scoped query must be constrained by this. */
  organizationId: string;
  /**
   * Set only when this is the supplier working inside a customer's account.
   * Handlers do not need to read it — the acting user already carries a name
   * that says so, which is what lands in audit rows — but a screen can use it
   * to keep saying whose data is on the screen.
   */
  platform?: { userId: string; email: string };
}

export async function currentActor(): Promise<Actor | null> {
  const store = await cookies();

  // An ordinary employee session first: the common path, unchanged, so
  // nothing about a hotel's own logins depends on the platform feature.
  const user = await getSessionUser(store.get('session_id')?.value);
  if (user) {
    if (!user.is_active) return null;
    // A session without an organization cannot be scoped, so it cannot be trusted.
    if (!user.organization_id) return null;
    return { user, organizationId: user.organization_id };
  }

  // Otherwise the supplier, and only while standing inside one hotel. A
  // platform session that has not entered anywhere has no organization, so it
  // resolves to no actor at all — every tenant-scoped route refuses it,
  // exactly as it refuses a stranger.
  const platform = await getPlatformSession(store.get(PLATFORM_COOKIE)?.value);
  if (!platform || !platform.actingOrganizationId) return null;

  const acting = await actingUserFor(platform, platform.actingOrganizationId);
  return {
    user: acting,
    organizationId: platform.actingOrganizationId,
    platform: { userId: platform.userId, email: platform.email },
  };
}

export const unauthorized = () =>
  NextResponse.json({ error: 'Не авторизовано', code: 'UNAUTHENTICATED' }, { status: 401 });

export const forbidden = (message = 'Недостатньо прав') =>
  NextResponse.json({ error: message, code: 'FORBIDDEN' }, { status: 403 });

/** 404, not 403: a wrong-tenant id must not confirm that the row exists. */
export const notFound = () =>
  NextResponse.json({ error: 'Не знайдено', code: 'NOT_FOUND' }, { status: 404 });

type Handler<C> = (request: any, context: C, actor: Actor) => Promise<Response> | Response;

/**
 * Wrap a route handler so it cannot run without an identity. The actor is
 * passed in rather than looked up again, so the handler has no excuse to query
 * without an organization id in hand.
 */
export function withActor<C = any>(handler: Handler<C>) {
  return async (request: any, context: C): Promise<Response> => {
    const actor = await currentActor();
    if (!actor) return unauthorized();
    return runWithOrganization(actor.organizationId, () => handler(request, context, actor));
  };
}

/** As withActor, plus a permission the user's role must carry. */
export function withPermission<C = any>(permission: Permission, handler: Handler<C>) {
  return async (request: any, context: C): Promise<Response> => {
    const actor = await currentActor();
    if (!actor) return unauthorized();
    if (!hasPermission(actor.user.permissions, permission)) return forbidden();
    return runWithOrganization(actor.organizationId, () => handler(request, context, actor));
  };
}

/**
 * Маршрут МОДУЛЯ: особа, право і те, чи цей модуль у готеля взагалі є.
 *
 * ── Навіщо третя перевірка ──────────────────────────────────────────────
 *
 * Модуль, вимкнений у налаштуваннях, зникав лише з бічного меню — а меню це
 * посилання, не двері. `/api/tasks` відповідав так само, як і раніше, тож
 * «вимкнено» означало «сховано від того, хто не знає адреси». Для готелю, який
 * вимкнув «Зали», бо не здає їх, це косметика; для того, хто вимкнув модуль,
 * бо не хоче, щоб персонал туди ходив, — це неправда на екрані налаштувань.
 *
 * Тому меню й маршрут читають ОДИН рядок `organization_features`. Вимкнений
 * модуль не просто невидимий — він недосяжний.
 *
 * ── Чому один загорнутий, а не два ──────────────────────────────────────
 *
 * `withFeature(f, withPermission(p, h))` виглядало б гнучкіше і було б гірше:
 * зовнішній шар мусив би сам піти по особу, щоб дізнатись організацію, тобто
 * розібрати сесію двічі на кожен запит. Тут особа встановлюється один раз, і
 * фіча питається вже з готовим `organizationId`.
 *
 * `hasFeature` викликається ПІСЛЯ `runWithOrganization` навмисно:
 * `organization_features` — таблиця з орендарем, і на Postgres запит без
 * контексту повернув би нуль рядків, тобто дефолт замість справжнього стану.
 * Модуль, який готель вимкнув, знову став би увімкненим — тихо.
 *
 * ── `permission: null` — це не «без варти» ──────────────────────────────
 *
 * Особа встановлюється завжди; null означає лише «окремого права цей модуль
 * не питає». Такий один: аркуші дня. Їх друкує кожен, хто виходить на зміну, а
 * покоївка й технік мають рівно `nav:dashboard` — вимога будь-якого іншого
 * права вигнала б із аркушів саме тих, для кого їх друкують, і готель повернувся
 * б до паперу.
 */
export function withModule<C = any>(feature: FeatureKey, permission: Permission | null, handler: Handler<C>) {
  return async (request: any, context: C): Promise<Response> => {
    const actor = await currentActor();
    if (!actor) return unauthorized();
    if (permission && !hasPermission(actor.user.permissions, permission)) return forbidden();
    return runWithOrganization(actor.organizationId, async () => {
      if (!(await hasFeature(actor.organizationId, feature))) return featureDisabled(feature);
      return handler(request, context, actor);
    });
  };
}

/** Owner-only operations: billing, integrations, anything irreversible. */
export function withOwner<C = any>(handler: Handler<C>) {
  return async (request: any, context: C): Promise<Response> => {
    const actor = await currentActor();
    if (!actor) return unauthorized();
    if (actor.user.role !== 'owner' && actor.user.role !== 'director') return forbidden();
    return runWithOrganization(actor.organizationId, () => handler(request, context, actor));
  };
}
