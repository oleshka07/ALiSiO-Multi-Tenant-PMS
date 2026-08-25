/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { getDb } from '@core/db';
import { requireOrganizationId } from '@core/auth/tenant-context';
import { serverError } from '@core/http/errors';

export async function listCapex(request: NextRequest): Promise<NextResponse> {
  try {
    const sql = getSql();
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month');
    const business_unit_id = searchParams.get('business_unit_id');
    const status = searchParams.get('status');

    let where = 'WHERE 1=1';
    const params: any[] = [];
    if (month) { where += ' AND c.month = ?'; params.push(month); }
    if (business_unit_id) { where += ' AND c.business_unit_id = ?'; params.push(business_unit_id); }
    if (status) { where += ' AND c.status = ?'; params.push(status); }

    const items = await sql.rows<any>(`
      SELECT c.*, bu.name as bu_name FROM capex_items c LEFT JOIN business_units bu ON c.business_unit_id = bu.id
      ${where} ORDER BY c.purchase_date DESC
    `, [...params]);

    const summary = await sql.row<any>(`
      SELECT COUNT(*) as total_items, COALESCE(SUM(c.amount), 0) as total_amount,
             COALESCE(SUM(CASE WHEN c.status = 'active' THEN 1 ELSE 0 END), 0) as active_items,
             COALESCE(SUM(CASE WHEN c.status = 'active' THEN c.depreciation_monthly ELSE 0 END), 0) as monthly_depreciation
      FROM capex_items c ${where}
    `, [...params]) as any;

    return NextResponse.json({ items, summary });
  } catch (error: any) {
    return serverError('modules/finance/api/capex listCapex', error);
  }
}

export async function createCapex(request: Request): Promise<NextResponse> {
  try {
    const sql = getSql();
    const body = await request.json();
    const { name, asset_type, business_unit_id, amount, counterparty, purchase_date, useful_life_months, notes } = body;

    if (!name || !amount || !purchase_date) return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });

    const orgRow = { id: await requireOrganizationId() } as any;
    const id = `capex_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const month = purchase_date.substring(0, 7);
    const depMonthly = useful_life_months && useful_life_months > 0 ? Math.round((amount / useful_life_months) * 100) / 100 : 0;

    await sql.run(`
      INSERT INTO capex_items (id, organization_id, business_unit_id, name, asset_type, amount, counterparty, purchase_date, month, useful_life_months, depreciation_monthly, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [id, orgRow.id, business_unit_id || null, name, asset_type || 'construction', amount, counterparty || null, purchase_date, month, useful_life_months || null, depMonthly, notes || null]);

    const item = await sql.row<any>(`SELECT c.*, bu.name as bu_name FROM capex_items c LEFT JOIN business_units bu ON c.business_unit_id = bu.id WHERE c.id = ?`, [id]);
    return NextResponse.json(item, { status: 201 });
  } catch (error: any) {
    return serverError('modules/finance/api/capex createCapex', error);
  }
}
