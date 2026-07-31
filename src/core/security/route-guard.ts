/* eslint-disable @typescript-eslint/no-explicit-any */
// ════════════════════════════════════════════════════════════
// Reusable route guards for handlers OUTSIDE the finance module
// (invoices, accounting) that surface or mutate financial data.
//
// The edge middleware only checks cookie presence; these guards validate the
// session against the DB and enforce role/permission. Owner policy mirrors the
// finance module (owner, or an explicit FINANCE_EXTRA_USER_IDS allow-list).
// ════════════════════════════════════════════════════════════
//
// Identity itself comes from core/auth/session — these guards only add the
// finance access policy on top, and hand the same Actor to the handler so a
// finance query has an organization id in hand like every other query.
import { NextResponse } from 'next/server';
import { currentActor, type Actor } from '@core/auth/session';
import { runWithOrganization } from '@core/auth/tenant-context';
import { hasPermission, type Permission } from '@/lib/permissions';

/** What a guarded handler receives. The actor is added by the guard. */
type GuardedHandler<C = any> = (request: any, context: C, actor: Actor) => Promise<Response> | Response;
/** What the guard returns — a plain route export, which Next requires to take
 *  exactly (request, context). */
type RouteHandler<C = any> = (request: any, context: C) => Promise<Response>;

const FINANCE_ALLOWLIST: ReadonlySet<string> = new Set(
  (process.env.FINANCE_EXTRA_USER_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

function unauthenticated(): NextResponse {
  return NextResponse.json({ error: 'Не авторизовано', code: 'UNAUTHENTICATED' }, { status: 401 });
}
function forbidden(message: string): NextResponse {
  return NextResponse.json({ error: message, code: 'FORBIDDEN' }, { status: 403 });
}

/** Owner-only (plus FINANCE_EXTRA_USER_IDS allow-list + finance_user_access table). */
export function requireOwner<C = any>(handler: GuardedHandler<C>): RouteHandler<C> {
  return async (request, context) => {
    const actor = await currentActor();
    if (!actor) return unauthenticated();
    const u = actor.user;
    if (u.role !== 'owner' && !FINANCE_ALLOWLIST.has(u.id)) {
      // Check DB-based access as a fallback
      try {
        const { isFinanceUserEnabled } = await import('@/modules/finance/api/finance-access.handlers');
        if (!isFinanceUserEnabled(u.id)) {
          return forbidden('Доступ лише для власника');
        }
      } catch {
        return forbidden('Доступ лише для власника');
      }
    }
    return runWithOrganization(actor.organizationId, () => handler(request, context, actor));
  };
}

/** Requires a valid session and a specific feature permission. */
export function requirePermission<C = any>(
  permission: Permission,
  handler: GuardedHandler<C>,
): RouteHandler<C> {
  return async (request, context) => {
    const actor = await currentActor();
    if (!actor) return unauthenticated();
    if (!hasPermission(actor.user.permissions, permission)) {
      return forbidden(`Недостатньо прав. Потрібен дозвіл: ${permission}`);
    }
    return runWithOrganization(actor.organizationId, () => handler(request, context, actor));
  };
}
