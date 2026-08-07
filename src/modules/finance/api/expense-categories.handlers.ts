/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { getDb } from '@core/db';
import { requireOrganizationId } from '@core/auth/tenant-context';

export async function listExpenseCategories(): Promise<NextResponse> {
  try {
    const sql = getSql();
    const categories = await sql.rows<any>(`SELECT * FROM expense_categories WHERE is_active = TRUE ORDER BY sort_order ASC`);
    return NextResponse.json(categories);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function createExpenseCategory(request: Request): Promise<NextResponse> {
  try {
    const sql = getSql();
    const body = await request.json();
    const { name, std_group, pnl_line, alloc_method, icon, color } = body;

    if (!name || !std_group || !pnl_line) return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });

    const orgRow = { id: await requireOrganizationId() } as any;
    const id = `ec_${Date.now()}`;
    const maxOrder = await sql.row<any>("SELECT MAX(sort_order) as mx FROM expense_categories") as any;

    // Keep both classification axes in sync — a category without
    // op_type/classifier is invisible to the matrix reports.
    const AXIS: Record<string, { op_type: string; classifier: string }> = {
      Revenue:   { op_type: 'income',   classifier: 'revenue' },
      COGS:      { op_type: 'expense',  classifier: 'cogs' },
      OPEX:      { op_type: 'expense',  classifier: 'operational' },
      Taxes:     { op_type: 'expense',  classifier: 'tax' },
      CAPEX:     { op_type: 'expense',  classifier: 'capex' },
      Financing: { op_type: 'expense',  classifier: 'financing' },
      Transfer:  { op_type: 'transfer', classifier: 'other' },
    };
    const axis = AXIS[std_group] || { op_type: 'other', classifier: 'other' };

    await sql.run(`
      INSERT INTO expense_categories (id, organization_id, name, std_group, pnl_line, alloc_method, icon, color, sort_order, op_type, classifier)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [id, orgRow.id, name, std_group, pnl_line, alloc_method || 'DIRECT', icon || '📋', color || '#6b7280', (maxOrder?.mx || 0) + 1, axis.op_type, axis.classifier]);

    return NextResponse.json(await sql.row<any>("SELECT * FROM expense_categories WHERE id = ?", [id]), { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
