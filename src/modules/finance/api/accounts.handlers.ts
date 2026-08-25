/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { todayFor } from '@core/hotel-day';
import { getDb } from '@core/db';
import { requireOrganizationId } from '@core/auth/tenant-context';
import { ownedFinanceRow } from '../data/owned.repo';
import { serverError } from '@core/http/errors';

const ALLOWED_TYPES = ['cash', 'bank', 'card', 'investment', 'clearing', 'other'];

async function selectAccountsWithBalance(orgId: string, opts: { includeArchived?: boolean } = {}): Promise<any[]> {
  const sql = getSql();
  const where = opts.includeArchived ? 'WHERE fa.organization_id = ?' : 'WHERE fa.organization_id = ? AND fa.is_active = TRUE';
  return await sql.rows<any>(`
    SELECT
      fa.*,
      (
        fa.initial_balance
        + COALESCE((SELECT SUM(
            CASE
              WHEN o.op_type = 'transfer' AND o.currency_to IS NOT NULL AND o.currency_to = fa.currency
                THEN COALESCE(o.amount_to, o.amount)
              WHEN o.currency = fa.currency THEN o.amount
              ELSE o.amount_company
            END
          ) FROM fin_operations o
          WHERE o.account_to_id = fa.id AND o.status = 'completed'), 0)
        - COALESCE((SELECT SUM(
            CASE WHEN o.currency = fa.currency THEN o.amount ELSE o.amount_company END
          ) FROM fin_operations o
          WHERE o.account_from_id = fa.id AND o.status = 'completed'), 0)
      ) as balance
    FROM finance_accounts fa
    ${where}
    ORDER BY fa.sort_order, fa.name
  `, [orgId]);
}

async function countLinkedOperations(accountId: string): Promise<number> {
  const sql = getSql();
  const row = await sql.row<any>(`
    SELECT COUNT(*) AS n FROM fin_operations
    WHERE account_from_id = ? OR account_to_id = ?
  `, [accountId, accountId]) as { n: number };
  return row.n;
}

export async function listAccounts(request: NextRequest): Promise<NextResponse> {
  try {
    const sql = getSql();
    const orgId = await requireOrganizationId();
    const includeArchived = request.nextUrl.searchParams.get('archived') === '1';
    const accounts = await selectAccountsWithBalance(orgId, { includeArchived });
    return NextResponse.json(accounts);
  } catch (error: any) {
    return serverError('modules/finance/api/accounts listAccounts', error);
  }
}

export async function createAccount(request: NextRequest): Promise<NextResponse> {
  try {
    const sql = getSql();
    const body = await request.json();
    const {
      name,
      type = 'cash',
      currency = 'CZK',
      initial_balance = 0,
      credit_limit = null,
      iban = null,
      color = '#6366f1',
      sort_order = 0,
    } = body;

    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    if (!ALLOWED_TYPES.includes(type)) {
      return NextResponse.json({ error: `type must be one of ${ALLOWED_TYPES.join(', ')}` }, { status: 400 });
    }
    if (type === 'card' && (credit_limit === null || credit_limit < 0)) {
      return NextResponse.json({ error: 'credit_limit is required and must be >= 0 for card accounts' }, { status: 400 });
    }
    if (type !== 'card' && credit_limit !== null) {
      return NextResponse.json({ error: 'credit_limit is only allowed for card accounts' }, { status: 400 });
    }

    const orgId = await requireOrganizationId();
    const id = `acct_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await sql.run(`
      INSERT INTO finance_accounts
        (id, organization_id, name, type, currency, initial_balance, credit_limit, iban, color, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [id, orgId, name, type, currency, initial_balance, credit_limit, iban, color, sort_order]);

    const account = await ownedFinanceRow('finance_accounts', id, orgId);
    return NextResponse.json(account, { status: 201 });
  } catch (error: any) {
    return serverError('modules/finance/api/accounts createAccount', error);
  }
}

export async function updateAccount(request: NextRequest): Promise<NextResponse> {
  try {
    const sql = getSql();
    const body = await request.json();
    const { id, name, type, currency, initial_balance, credit_limit, iban, color, sort_order, is_active } = body;
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    if (type !== undefined && !ALLOWED_TYPES.includes(type)) {
      return NextResponse.json({ error: `type must be one of ${ALLOWED_TYPES.join(', ')}` }, { status: 400 });
    }

    const fields: string[] = [];
    const params: any[] = [];
    if (name !== undefined) { fields.push('name = ?'); params.push(name); }
    if (type !== undefined) { fields.push('type = ?'); params.push(type); }
    if (currency !== undefined) { fields.push('currency = ?'); params.push(currency); }
    if (initial_balance !== undefined) { fields.push('initial_balance = ?'); params.push(initial_balance); }
    if (credit_limit !== undefined) { fields.push('credit_limit = ?'); params.push(credit_limit); }
    if (iban !== undefined) { fields.push('iban = ?'); params.push(iban || null); }
    if (color !== undefined) { fields.push('color = ?'); params.push(color); }
    if (sort_order !== undefined) { fields.push('sort_order = ?'); params.push(sort_order); }
    if (is_active !== undefined) { fields.push('is_active = ?'); params.push(is_active ? 1 : 0); }
    if (fields.length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

    // The account id arrives in the body. Without the tenant in the WHERE, a
    // finance user of one hotel could rename, re-IBAN or re-balance another
    // hotel's bank account.
    const orgId = await requireOrganizationId();
    if (!await ownedFinanceRow('finance_accounts', id, orgId)) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    params.push(id, orgId);
    await sql.run(`UPDATE finance_accounts SET ${fields.join(', ')} WHERE id = ? AND organization_id = ?`, [...params]);

    const account = await ownedFinanceRow('finance_accounts', id, orgId);
    return NextResponse.json(account);
  } catch (error: any) {
    return serverError('modules/finance/api/accounts updateAccount', error);
  }
}

export async function archiveAccount(request: NextRequest): Promise<NextResponse> {
  try {
    const sql = getSql();
    const body = await request.json();
    const { id, archived = true } = body;
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    const orgId = await requireOrganizationId();
    if (!await ownedFinanceRow('finance_accounts', id, orgId)) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }
    await sql.run("UPDATE finance_accounts SET is_active = ? WHERE id = ? AND organization_id = ?", [archived ? 0 : 1, id, orgId]);
    const account = await ownedFinanceRow('finance_accounts', id, orgId);
    if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    return NextResponse.json(account);
  } catch (error: any) {
    return serverError('modules/finance/api/accounts archiveAccount', error);
  }
}

export async function deleteAccount(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const sql = getSql();
    const { id } = await context.params;
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const orgId = await requireOrganizationId();
    const account = await ownedFinanceRow('finance_accounts', id, orgId);
    if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

    const linked = await countLinkedOperations(id);
    if (linked > 0) {
      return NextResponse.json(
        { error: `Маєте ${linked} операцій, прив'язаних до рахунку. Архівуйте замість видалення.`, linked_operations: linked },
        { status: 409 }
      );
    }

    await sql.run("DELETE FROM finance_accounts WHERE id = ? AND organization_id = ?", [id, orgId]);
    return NextResponse.json({ ok: true, deleted_id: id });
  } catch (error: any) {
    return serverError('modules/finance/api/accounts deleteAccount', error);
  }
}

async function ensureReconcileCategory(orgId: string): Promise<string> {
  const sql = getSql();
  const existing = await sql.row<any>("SELECT id FROM expense_categories WHERE organization_id = ? AND name = 'Звірка залишків' LIMIT 1", [orgId]) as { id: string } | undefined;
  if (existing) return existing.id;
  const id = `ec_reconcile_${Date.now().toString(36)}`;
  await sql.run(`
    INSERT INTO expense_categories
      (id, organization_id, name, std_group, pnl_line, include_in_pnl, include_in_cash, alloc_method, is_capex, icon, color, sort_order, is_active)
    VALUES (?, ?, 'Звірка залишків', 'Other', 'Звірка залишків', 0, 1, 'NONE', FALSE, '⚖️', '#94a3b8', 999, TRUE)
  `, [id, orgId]);
  return id;
}

export async function reconcileAccount(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const sql = getSql();
    const { id } = await context.params;
    const body = await request.json();
    const { actual_balance, note } = body;

    if (typeof actual_balance !== 'number' || !isFinite(actual_balance)) {
      return NextResponse.json({ error: 'actual_balance must be a number' }, { status: 400 });
    }

    const orgId = await requireOrganizationId();
    const accounts = await selectAccountsWithBalance(orgId, { includeArchived: true });
    const account = accounts.find((a: any) => a.id === id);
    if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

    const computed: number = Number(account.balance) || 0;
    const delta = +(actual_balance - computed).toFixed(2);

    if (Math.abs(delta) < 0.005) {
      return NextResponse.json({ computed, actual: actual_balance, delta: 0, adjustment_operation_id: null, message: 'Balances already match' });
    }

    // The hotel's day: this dates an adjustment operation in the ledger.
    const today = await todayFor(orgId);
    const description = note?.trim() || `Звірка залишків (${account.name})`;
    const adjustmentType: 'income' | 'expense' = delta > 0 ? 'income' : 'expense';
    const categoryId = delta > 0 ? null : await ensureReconcileCategory(orgId);

    const { createOperationInTx } = await import('./operations.handlers');
    const adjustmentId = await createOperationInTx(orgId, {
      op_type: adjustmentType,
      account_to_id: delta > 0 ? id : null,
      account_from_id: delta > 0 ? null : id,
      amount: Math.abs(delta),
      currency: account.currency,
      paid_at: today,
      category_id: categoryId,
      comment: description,
      source: 'manual',
      status: 'completed',
    });

    return NextResponse.json({
      computed,
      actual: actual_balance,
      delta,
      adjustment_operation_id: adjustmentId,
      adjustment_type: adjustmentType,
    });
  } catch (error: any) {
    return serverError('modules/finance/api/accounts reconcileAccount', error);
  }
}
