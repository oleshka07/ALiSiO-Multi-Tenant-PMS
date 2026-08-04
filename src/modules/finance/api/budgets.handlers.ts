/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { getDb } from '@core/db';
import { requireOrganizationId } from '@core/auth/tenant-context';

export async function listBudgets(request: NextRequest): Promise<NextResponse> {
  try {
    const sql = getSql();
    const orgId = requireOrganizationId(getDb());
    const sp = request.nextUrl.searchParams;
    const year = sp.get('year');
    const month = sp.get('month');
    const by = sp.get('by');

    const where: string[] = ['organization_id = ?'];
    const params: any[] = [orgId];
    if (year) { where.push('year = ?'); params.push(Number(year)); }
    if (month) { where.push('month = ?'); params.push(Number(month)); }
    if (by === 'category') where.push('category_id IS NOT NULL');
    if (by === 'project') where.push('project_id IS NOT NULL');

    const rows = await sql.rows<any>(`
      SELECT * FROM fin_budgets
      WHERE ${where.join(' AND ')}
      ORDER BY year, month, category_id, project_id
    `, [...params]);
    return NextResponse.json(rows);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function upsertBudget(request: NextRequest): Promise<NextResponse> {
  try {
    const sql = getSql();
    const body = await request.json();
    const { year, month, category_id = null, project_id = null, planned_amount } = body;

    if (!year || !month) return NextResponse.json({ error: 'year and month are required' }, { status: 400 });
    if (typeof planned_amount !== 'number' || !isFinite(planned_amount)) {
      return NextResponse.json({ error: 'planned_amount must be a number' }, { status: 400 });
    }

    const orgId = requireOrganizationId(getDb());
    const existing = await sql.row<any>(`
      SELECT id FROM fin_budgets
      WHERE organization_id = ? AND year = ? AND month = ?
        AND (category_id IS ? OR category_id = ?) AND (project_id IS ? OR project_id = ?)
    `, [orgId, year, month, category_id, category_id, project_id, project_id]) as { id: string } | undefined;

    if (existing) {
      await sql.run("UPDATE fin_budgets SET planned_amount = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [planned_amount, existing.id]);
      const updated = await sql.row<any>("SELECT * FROM fin_budgets WHERE id = ?", [existing.id]);
      return NextResponse.json(updated);
    }

    const id = `bud_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await sql.run(`
      INSERT INTO fin_budgets (id, organization_id, year, month, category_id, project_id, planned_amount)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [id, orgId, year, month, category_id, project_id, planned_amount]);
    const created = await sql.row<any>("SELECT * FROM fin_budgets WHERE id = ?", [id]);
    return NextResponse.json(created, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function deleteBudget(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const sql = getSql();
    const { id } = await context.params;
    await sql.run("DELETE FROM fin_budgets WHERE id = ?", [id]);
    return NextResponse.json({ ok: true, deleted_id: id });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
