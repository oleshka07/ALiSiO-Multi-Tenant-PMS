/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { withFinanceRead } from '@finance/_guard';

/**
 * GET /api/finance/history
 *
 * Every audit entry of THIS hotel's operations, from `fin_operation_audit`.
 * Enriches each row with live operation data (LEFT JOIN) or, when the
 * operation has been deleted, extracts amount/currency/comment from the
 * stored before_json / after_json snapshot.
 *
 * The docstring above used to say «ALL audit entries across all operations»,
 * and it was accurate: `where[]` started empty and never mentioned the tenant.
 * Every entry carries before_json/after_json — whole snapshots of financial
 * operations, amounts, comments, counterparties — so a finance user of one
 * hotel could read the other hotels' ledgers, including rows deleted from
 * them. `?search=` made it queryable.
 *
 * Query params:
 *   page   – pagination page (default 1)
 *   limit  – rows per page (default 50, max 500)
 *   from   – performed_at >= date  (e.g. 2026-05-01)
 *   to     – performed_at <= date  (e.g. 2026-05-31)
 *   action – create | update | delete | convert
 *   user   – partial match on user_name
 *   search – searches in before_json, after_json, user_name
 */
export const GET = await withFinanceRead(async (request: NextRequest, _ctx, actor) => {
  try {
    const sql = getSql();
    const sp = request.nextUrl.searchParams;

    const page  = Math.max(1, parseInt(sp.get('page')  || '1',  10));
    const limit = Math.min(500, Math.max(1, parseInt(sp.get('limit') || '50', 10)));
    const from   = sp.get('from');
    const to     = sp.get('to');
    const action = sp.get('action');
    const user   = sp.get('user');
    const search = sp.get('search');

    const VALID_ACTIONS = ['create', 'update', 'delete', 'convert'];

    const where: string[] = ['a.organization_id = ?'];
    const params: any[] = [actor.organizationId];

    if (from) {
      where.push('a.performed_at >= ?');
      params.push(from);
    }
    if (to) {
      // Include the entire "to" day — compare with next-day boundary
      where.push('a.performed_at < datetime(?, \'+1 day\')');
      params.push(to);
    }
    if (action && VALID_ACTIONS.includes(action)) {
      where.push('a.action = ?');
      params.push(action);
    }
    if (user) {
      where.push('a.user_name LIKE ?');
      params.push(`%${user}%`);
    }
    if (search) {
      where.push('(a.before_json LIKE ? OR a.after_json LIKE ? OR a.user_name LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const whereSql = `WHERE ${where.join(' AND ')}`;

    // Count
    const totalRow = await sql.row<any>(
      `SELECT COUNT(*) AS n FROM fin_operation_audit a ${whereSql}`,
      params,
    ) as { n: number };

    // Fetch audit rows with LEFT JOIN to live operation + account
    const rows = await sql.rows<any>(`
      SELECT
        a.id,
        a.operation_id,
        a.action,
        a.user_id,
        a.user_name,
        a.before_json,
        a.after_json,
        a.performed_at,
        o.amount       AS live_amount,
        o.currency     AS live_currency,
        o.op_type      AS live_op_type,
        o.comment      AS live_comment,
        o.account_to_id   AS live_account_to_id,
        o.account_from_id AS live_account_from_id,
        acc_to.name    AS live_account_to_name,
        acc_from.name  AS live_account_from_name
      FROM fin_operation_audit a
      LEFT JOIN fin_operations    o        ON o.id      = a.operation_id AND o.organization_id = a.organization_id
      LEFT JOIN finance_accounts  acc_to   ON acc_to.id = o.account_to_id AND acc_to.organization_id = a.organization_id
      LEFT JOIN finance_accounts  acc_from ON acc_from.id = o.account_from_id AND acc_from.organization_id = a.organization_id
      ${whereSql}
      ORDER BY a.performed_at DESC, a.id DESC
      LIMIT ? OFFSET ?
    `, [...params, limit, (page - 1) * limit]);

    // Enrich: prefer live data, fall back to JSON snapshots for deleted ops.
    // A loop rather than .map(): the account fallback below is a query, and an
    // async callback would hand back an array of promises.
    const items: any[] = [];
    for (const r of rows) {
      let opAmount:  number | null = r.live_amount  ?? null;
      let opCurrency: string | null = r.live_currency ?? null;
      let opType:    string | null = r.live_op_type  ?? null;
      let opComment: string | null = r.live_comment  ?? null;
      let accountName: string | null = null;

      // Determine account name from live data
      if (r.live_account_to_name || r.live_account_from_name) {
        accountName = r.live_account_to_name || r.live_account_from_name;
      }

      // Fall back to JSON snapshots when the live operation is gone
      if (opAmount === null) {
        const snapshot = tryParseJson(r.after_json) || tryParseJson(r.before_json);
        if (snapshot) {
          opAmount   = snapshot.amount   ?? null;
          opCurrency = snapshot.currency ?? null;
          opType     = snapshot.op_type  ?? null;
          opComment  = snapshot.comment  ?? null;

          // Try to resolve account name from snapshot's account IDs
          if (!accountName) {
            const accId = snapshot.account_to_id || snapshot.account_from_id;
            if (accId) {
              const accRow = await sql.row<{ name: string }>(
                'SELECT name FROM finance_accounts WHERE id = ? AND organization_id = ?',
                [accId, actor.organizationId]);
              if (accRow) accountName = accRow.name;
            }
          }
        }
      }

      items.push({
        id:           r.id,
        operation_id: r.operation_id,
        action:       r.action,
        user_id:      r.user_id,
        user_name:    r.user_name,
        before_json:  r.before_json,
        after_json:   r.after_json,
        performed_at: r.performed_at,
        op_amount:    opAmount,
        op_currency:  opCurrency,
        op_type:      opType,
        op_comment:   opComment,
        account_name: accountName,
      });
    }

    return NextResponse.json({ items, total: totalRow.n, page, limit });
  } catch (error: any) {
    console.error('GET /api/finance/history error:', error?.message || error);
    return NextResponse.json({ error: 'Не вдалося зібрати історію' }, { status: 500 });
  }
});

function tryParseJson(str: string | null): any | null {
  if (!str) return null;
  try { return JSON.parse(str); } catch { return null; }
}
