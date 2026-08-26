/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { serverError } from '@core/http/errors';
import { requireOrganizationId } from '@core/auth/tenant-context';
import { ownedFinanceRow } from '../data/owned.repo';
import { money } from '@core/money';

/**
 * A capital asset, addressed by id. All three handlers wrote `WHERE id = ?`
 * over a table that carries organization_id — so on SQLite a finance user of
 * one hotel could read, re-value and delete another hotel's assets, and the
 * ids are sequential-ish enough to walk.
 */
const CAPEX_JOIN = `SELECT c.*, bu.name as bu_name FROM capex_items c LEFT JOIN business_units bu ON c.business_unit_id = bu.id WHERE c.id = ? AND c.organization_id = ?`;

export async function getCapexItem(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const sql = getSql();
    const { id } = await params;
    const orgId = await requireOrganizationId();
    const item = await sql.row<any>(CAPEX_JOIN, [id, orgId]);
    if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(item);
  } catch (error: any) {
    return serverError('modules/finance/api/capex-item getCapexItem', error);
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

    const orgId = await requireOrganizationId();
    if (!await ownedFinanceRow('capex_items', id, orgId)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    // business_unit_id comes from the body, so it is checked too: a capex line
    // must not be filed against another hotel's business unit.
    if (business_unit_id && !await ownedFinanceRow('business_units', String(business_unit_id), orgId)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const depMonthly = useful_life_months && useful_life_months > 0 && amount ? money(amount / useful_life_months) : undefined;
    const month = purchase_date ? purchase_date.substring(0, 7) : undefined;

    await sql.run(`
      UPDATE capex_items SET
        name = COALESCE(?, name), asset_type = COALESCE(?, asset_type), business_unit_id = ?,
        amount = COALESCE(?, amount), counterparty = ?, purchase_date = COALESCE(?, purchase_date),
        month = COALESCE(?, month), useful_life_months = COALESCE(?, useful_life_months),
        depreciation_monthly = COALESCE(?, depreciation_monthly), status = COALESCE(?, status),
        notes = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND organization_id = ?
    `, [name, asset_type, business_unit_id ?? null, amount, counterparty ?? null, purchase_date, month, useful_life_months, depMonthly, status, notes ?? null, id, orgId]);

    return NextResponse.json(await sql.row<any>(CAPEX_JOIN, [id, orgId]));
  } catch (error: any) {
    return serverError('modules/finance/api/capex-item updateCapexItem', error);
  }
}

export async function deleteCapexItem(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const sql = getSql();
    const { id } = await params;
    const orgId = await requireOrganizationId();
    const result = await sql.run("DELETE FROM capex_items WHERE id = ? AND organization_id = ?", [id, orgId]);
    if (result.changes === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return serverError('modules/finance/api/capex-item deleteCapexItem', error);
  }
}
