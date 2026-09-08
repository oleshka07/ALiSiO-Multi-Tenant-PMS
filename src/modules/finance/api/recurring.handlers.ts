/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { todayFor } from '@core/hotel-day';
import { getDb } from '@core/db';
import { materializeTemplate, runRecurringTick, type Template } from '../data/recurring-engine';
import { requireOrganizationId } from '@core/auth/tenant-context';
import { ownedFinanceRow, requireOwnedReferences } from '../data/owned.repo';
import { serverError, handleError } from '@core/http/errors';

const SCHEDULES = ['daily', 'weekly', 'monthly', 'yearly'] as const;
const OP_TYPES = ['income', 'expense', 'transfer'] as const;

export async function listRecurringTemplates(request: NextRequest): Promise<NextResponse> {
  try {
    const sql = getSql();
    const orgId = await requireOrganizationId();
    const includeInactive = request.nextUrl.searchParams.get('archived') === '1';
    const where = includeInactive ? 't.organization_id = ?' : 't.organization_id = ? AND t.is_active = TRUE';
    const rows = await sql.rows<any>(`
      SELECT t.*,
             afr.name AS account_from_name,
             ato.name AS account_to_name,
             ec.name  AS category_name,
             bu.name  AS project_name,
             cp.name  AS counterparty_name
      FROM fin_recurring_templates t
      LEFT JOIN finance_accounts afr ON afr.id = t.account_from_id
      LEFT JOIN finance_accounts ato ON ato.id = t.account_to_id
      LEFT JOIN expense_categories ec ON ec.id = t.category_id
      LEFT JOIN business_units bu ON bu.id = t.project_id
      LEFT JOIN finance_counterparties cp ON cp.id = t.counterparty_id
      WHERE ${where}
      ORDER BY t.next_run_at ASC, t.name ASC
    `, [orgId]);
    return NextResponse.json(rows);
  } catch (error: any) {
    return serverError('modules/finance/api/recurring listRecurringTemplates', error);
  }
}

export async function createRecurringTemplate(request: NextRequest): Promise<NextResponse> {
  try {
    const sql = getSql();
    const body = await request.json();
    const {
      name, op_type, amount, currency = 'CZK',
      account_from_id, account_to_id,
      category_id, project_id, counterparty_id, comment,
      schedule, schedule_day, next_run_at, end_at, is_active = true,
    } = body;

    if (!name?.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 });
    if (!(OP_TYPES as readonly string[]).includes(op_type)) {
      return NextResponse.json({ error: `op_type must be one of ${OP_TYPES.join(', ')}` }, { status: 400 });
    }
    if (!(SCHEDULES as readonly string[]).includes(schedule)) {
      return NextResponse.json({ error: `schedule must be one of ${SCHEDULES.join(', ')}` }, { status: 400 });
    }
    if (typeof amount !== 'number' || !isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: 'amount must be > 0' }, { status: 400 });
    }
    if (!next_run_at || !/^\d{4}-\d{2}-\d{2}$/.test(next_run_at)) {
      return NextResponse.json({ error: 'next_run_at must be YYYY-MM-DD' }, { status: 400 });
    }
    if (op_type === 'income' && !account_to_id) return NextResponse.json({ error: 'income requires account_to_id' }, { status: 400 });
    if (op_type === 'expense' && !account_from_id) return NextResponse.json({ error: 'expense requires account_from_id' }, { status: 400 });
    if (op_type === 'transfer' && (!account_from_id || !account_to_id)) {
      return NextResponse.json({ error: 'transfer requires both accounts' }, { status: 400 });
    }

    const orgId = await requireOrganizationId();
    // Та сама варта, що на операції (Д34). Тут вона важить БІЛЬШЕ, ніж там:
    // шаблон із чужою статтею лягав у базу тихо, а відмовляв аж уночі, коли
    // рушій до нього дійде, — і оператора, який міг би це пояснити, поруч уже
    // не було. Помилка конфігурації мусить називатись у момент конфігурації.
    await requireOwnedReferences(orgId, body);
    const id = `rt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await sql.run(`
      INSERT INTO fin_recurring_templates
        (id, organization_id, name, op_type, amount, currency,
         account_from_id, account_to_id, category_id, project_id, counterparty_id, comment,
         schedule, schedule_day, next_run_at, end_at, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [id, orgId, name.trim(), op_type, amount, currency,
      account_from_id || null, account_to_id || null,
      category_id || null, project_id || null, counterparty_id || null, comment || null,
      schedule, schedule_day ?? null, next_run_at, end_at || null,
      is_active ? 1 : 0]);
    const row = await sql.row<any>("SELECT * FROM fin_recurring_templates WHERE id = ?", [id]);
    return NextResponse.json(row, { status: 201 });
  } catch (error: any) {
    return handleError('modules/finance/api/recurring createRecurringTemplate', error);
  }
}

export async function updateRecurringTemplate(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const sql = getSql();
    const { id } = await context.params;
    const body = await request.json();
    const orgId = await requireOrganizationId();
    const existing = await ownedFinanceRow('fin_recurring_templates', id, orgId);
    if (!existing) return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    // Білий список `allowed` нижче бере ті самі імена з тіла запиту — закрити
    // лише створення означало б лишити двері поруч.
    await requireOwnedReferences(orgId, body);

    const fields: string[] = [];
    const params: any[] = [];
    const allowed = ['name', 'op_type', 'amount', 'currency', 'account_from_id', 'account_to_id',
      'category_id', 'project_id', 'counterparty_id', 'comment', 'schedule', 'schedule_day',
      'next_run_at', 'end_at', 'is_active'];
    for (const k of allowed) {
      if (body[k] !== undefined) {
        fields.push(`${k} = ?`);
        const v = body[k];
        params.push(typeof v === 'boolean' ? (v ? 1 : 0) : (v === '' ? null : v));
      }
    }
    fields.push("updated_at = CURRENT_TIMESTAMP");
    if (fields.length === 1) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    params.push(id, orgId);
    await sql.run(`UPDATE fin_recurring_templates SET ${fields.join(', ')} WHERE id = ? AND organization_id = ?`, [...params]);
    return NextResponse.json(await ownedFinanceRow('fin_recurring_templates', id, orgId));
  } catch (error: any) {
    return handleError('modules/finance/api/recurring updateRecurringTemplate', error);
  }
}

export async function deleteRecurringTemplate(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const sql = getSql();
    const { id } = await context.params;
    const orgId = await requireOrganizationId();
    const row = await ownedFinanceRow('fin_recurring_templates', id, orgId);
    if (!row) return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    await sql.run("DELETE FROM fin_recurring_templates WHERE id = ? AND organization_id = ?", [id, orgId]);
    return NextResponse.json({ ok: true, deleted_id: id });
  } catch (error: any) {
    return serverError('modules/finance/api/recurring deleteRecurringTemplate', error);
  }
}

export async function toggleRecurringTemplate(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const sql = getSql();
    const { id } = await context.params;
    const orgId = await requireOrganizationId();
    const row = await ownedFinanceRow('fin_recurring_templates', id, orgId);
    if (!row) return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    await sql.run("UPDATE fin_recurring_templates SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?", [row.is_active ? 0 : 1, id, orgId]);
    return NextResponse.json(await ownedFinanceRow('fin_recurring_templates', id, orgId));
  } catch (error: any) {
    return serverError('modules/finance/api/recurring toggleRecurringTemplate', error);
  }
}

export async function runRecurringNow(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const orgId = await requireOrganizationId();
    const t = await ownedFinanceRow('fin_recurring_templates', id, orgId) as Template | undefined;
    if (!t) return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    if (!t.is_active) return NextResponse.json({ error: 'Template is inactive' }, { status: 400 });

    const operationId = await materializeTemplate(t, await todayFor(orgId));
    return NextResponse.json({ ok: true, operation_id: operationId });
  } catch (error: any) {
    return serverError('modules/finance/api/recurring runRecurringNow', error);
  }
}

