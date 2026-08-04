/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { getSql } from '@core/db/async';

const CAPEX_JOIN = `SELECT c.*, bu.name as bu_name FROM capex_items c LEFT JOIN business_units bu ON c.business_unit_id = bu.id WHERE c.id = ?`;

export async function getCapexItem(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const sql = getSql();
    const { id } = await params;
    const item = await sql.row<any>(CAPEX_JOIN, [id]);
    if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(item);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function updateCapexItem(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const sql = getSql();
    const { id } = await params;
    const body = await request.json();
    const { name, asset_type, business_unit_id, amount, counterparty, purchase_date, useful_life_months, status, notes } = body;

    if (!await sql.row<any>("SELECT id FROM capex_items WHERE id = ?", [id])) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const depMonthly = useful_life_months && useful_life_months > 0 && amount ? Math.round((amount / useful_life_months) * 100) / 100 : undefined;
    const month = purchase_date ? purchase_date.substring(0, 7) : undefined;

    await sql.run(`
      UPDATE capex_items SET
        name = COALESCE(?, name), asset_type = COALESCE(?, asset_type), business_unit_id = ?,
        amount = COALESCE(?, amount), counterparty = ?, purchase_date = COALESCE(?, purchase_date),
        month = COALESCE(?, month), useful_life_months = COALESCE(?, useful_life_months),
        depreciation_monthly = COALESCE(?, depreciation_monthly), status = COALESCE(?, status),
        notes = ?, updated_at = datetime('now')
      WHERE id = ?
    `, [name, asset_type, business_unit_id ?? null, amount, counterparty ?? null, purchase_date, month, useful_life_months, depMonthly, status, notes ?? null, id]);

    return NextResponse.json(await sql.row<any>(CAPEX_JOIN, [id]));
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function deleteCapexItem(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const sql = getSql();
    const { id } = await params;
    const result = await sql.run("DELETE FROM capex_items WHERE id = ?", [id]);
    if (result.changes === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
