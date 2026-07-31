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
import { getSessionUser, type SessionUser } from '@/lib/auth';
import { hasPermission, type Permission } from '@/lib/permissions';
import { runWithOrganization } from './tenant-context';

export interface Actor {
  user: SessionUser;
  /** Every tenant-scoped query must be constrained by this. */
  organizationId: string;
}

export async function currentActor(): Promise<Actor | null> {
  const store = await cookies();
  const user = await getSessionUser(store.get('session_id')?.value);
  if (!user || !user.is_active) return null;
  // A session without an organization cannot be scoped, so it cannot be trusted.
  if (!user.organization_id) return null;
  return { user, organizationId: user.organization_id };
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

/** Owner-only operations: billing, integrations, anything irreversible. */
export function withOwner<C = any>(handler: Handler<C>) {
  return async (request: any, context: C): Promise<Response> => {
    const actor = await currentActor();
    if (!actor) return unauthorized();
    if (actor.user.role !== 'owner' && actor.user.role !== 'director') return forbidden();
    return runWithOrganization(actor.organizationId, () => handler(request, context, actor));
  };
}
