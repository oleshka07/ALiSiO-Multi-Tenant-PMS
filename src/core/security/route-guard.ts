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
import { currentActor, type Actor } from '../auth/session.ts';
import { runWithOrganization } from '../auth/tenant-context.ts';
import { hasPermission, type Permission } from '../auth/index.ts';

/** What a guarded handler receives. The actor is added by the guard. */
type GuardedHandler<C = any> = (request: any, context: C, actor: Actor) => Promise<Response> | Response;
/** What the guard returns — a plain route export, which Next requires to take
 *  exactly (request, context). */
type RouteHandler<C = any> = (request: any, context: C) => Promise<Response>;

function unauthenticated(): NextResponse {
  return NextResponse.json({ error: 'Не авторизовано', code: 'UNAUTHENTICATED' }, { status: 401 });
}
function forbidden(message: string): NextResponse {
  return NextResponse.json({ error: message, code: 'FORBIDDEN' }, { status: 403 });
}

/**
 * The finance access policy, applied to invoices and accounting.
 *
 * This used to be a second copy of that policy, written out by hand here: its
 * own FINANCE_EXTRA_USER_IDS set, its own owner check, its own call to
 * `isFinanceUserEnabled`. It answered the question «may this person reach
 * money?» the same way the finance module does — and then stopped, while the
 * module's own guard goes on to ask two more:
 *
 *   the step-up lock   once a finance passphrase is set, a session must unlock
 *                      before finance opens. These routes never asked, so the
 *                      passphrase protected /app/finance and left invoice
 *                      delete, the invoice batches and the period lock open;
 *   the per-user ACL   a non-owner enabled in `finance_user_access` carries
 *                      read_only, an allowed-tabs list and can_export. Those
 *                      were ignored here, so a finance user marked READ-ONLY
 *                      could delete an invoice, run a batch and lock a period.
 *
 * Two controls the codebase deliberately built, bypassed by using a different
 * door into the same data. `_guard.ts` says of itself «to change WHO can reach
 * finance, edit ONLY this function» — so now this asks it instead of guessing
 * the same answer separately.
 *
 * Write-ness comes from the HTTP method: read_only has to distinguish a GET
 * from a DELETE, and every call site here is a plain route export whose method
 * is the truth about which it is.
 *
 * Imported dynamically, like the call it replaces: this is core, and reaching
 * into a module from here is the exception, not a habit.
 */
export function requireFinanceAccess<C = any>(handler: GuardedHandler<C>): RouteHandler<C> {
  return async (request, context) => {
    let requireFinanceUser;
    try {
      ({ requireFinanceUser } = await import('@/modules/finance/api/_guard'));
    } catch {
      // Fail closed. The old code did the same for the same reason: a guard
      // that cannot load its policy must not fall back to letting people in.
      return forbidden('Доступ лише для власника');
    }
    const isWrite = !['GET', 'HEAD'].includes(String(request?.method || 'GET').toUpperCase());
    const a = await requireFinanceUser(request, isWrite);
    if (a instanceof NextResponse) return a;
    return runWithOrganization(a.organizationId, () => handler(request, context, a));
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
