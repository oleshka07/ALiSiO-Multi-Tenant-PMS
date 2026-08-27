/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { getDb } from '@core/db';
import { requireOrganizationId } from '@core/auth/tenant-context';
import { serverError } from '@core/http/errors';

interface ProjectRow {
  id: string;
  organization_id: string;
  name: string;
  unit_type: string | null;
  is_shared: number;
  is_active: number;
  sort_order: number;
  parent_id: string | null;
  created_at: string;
}

async function countChildren(projectId: string): Promise<number> {
  const sql = getSql();
  const row = await sql.row<any>("SELECT COUNT(*) AS n FROM business_units WHERE parent_id = ?", [projectId]) as { n: number };
  return row.n;
}

interface LinkedCount { table: string; count: number }
async function countLinkedRows(projectId: string): Promise<{ total: number; breakdown: LinkedCount[] }> {
  const sql = getSql();
  const tables: { table: string; column: string }[] = [
    { table: 'expenses',           column: 'business_unit_id' },
    { table: 'income',             column: 'business_unit_id' },
    { table: 'capex_items',        column: 'business_unit_id' },
    { table: 'accruals',           column: 'business_unit_id' },
    { table: 'bank_transactions',  column: 'matched_business_unit_id' },
    // `cost_allocations` стояла тут шостою. Таблиця не мала жодного писача,
    // тож рядок означав «порахуй нуль» — і зник разом із нею (міграція 0038).
  ];
  const breakdown: LinkedCount[] = [];
  let total = 0;
  for (const t of tables) {
    try {
      const row = await sql.row<any>(`SELECT COUNT(*) AS n FROM ${t.table} WHERE ${t.column} = ?`, [projectId]) as { n: number };
      if (row.n > 0) breakdown.push({ table: t.table, count: row.n });
      total += row.n;
    } catch {
      // Table may not exist yet in a partially-migrated DB — skip silently.
    }
  }
  return { total, breakdown };
}

export async function listProjects(request: NextRequest): Promise<NextResponse> {
  try {
    const sql = getSql();
    const orgId = await requireOrganizationId();
    const includeArchived = request.nextUrl.searchParams.get('archived') === '1';
    const where = includeArchived ? 'organization_id = ?' : 'organization_id = ? AND is_active = TRUE';
    const rows = await sql.rows<any>(`
      SELECT * FROM business_units
      WHERE ${where}
      ORDER BY sort_order ASC, name ASC
    `, [orgId]);
    return NextResponse.json(rows);
  } catch (error: any) {
    return serverError('modules/finance/api/projects listProjects', error);
  }
}

export async function getProjectTree(request: NextRequest): Promise<NextResponse> {
  try {
    const sql = getSql();
    const orgId = await requireOrganizationId();
    const includeArchived = request.nextUrl.searchParams.get('archived') === '1';
    const where = includeArchived ? 'organization_id = ?' : 'organization_id = ? AND is_active = TRUE';
    const rows = await sql.rows<any>(`
      SELECT * FROM business_units
      WHERE ${where}
      ORDER BY sort_order ASC, name ASC
    `, [orgId]) as ProjectRow[];

    const roots = rows.filter((r) => r.parent_id === null);
    const childrenByParent = new Map<string, ProjectRow[]>();
    for (const r of rows) {
      if (r.parent_id) {
        if (!childrenByParent.has(r.parent_id)) childrenByParent.set(r.parent_id, []);
        childrenByParent.get(r.parent_id)!.push(r);
      }
    }
    const tree = roots.map((root) => ({ ...root, children: childrenByParent.get(root.id) || [] }));
    return NextResponse.json({ tree });
  } catch (error: any) {
    return serverError('modules/finance/api/projects getProjectTree', error);
  }
}

export async function createProject(request: NextRequest): Promise<NextResponse> {
  try {
    const sql = getSql();
    const orgId = await requireOrganizationId();
    const body = await request.json();
    const { name, parent_id = null, is_shared = 0, unit_type, sort_order } = body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    if (parent_id) {
      const parent = await sql.row<any>("SELECT * FROM business_units WHERE id = ? AND organization_id = ?", [parent_id, orgId]) as ProjectRow | undefined;
      if (!parent) return NextResponse.json({ error: 'Parent project not found' }, { status: 404 });
      if (parent.parent_id !== null) {
        return NextResponse.json({ error: 'Підпроєкт не можна створити всередині іншого підпроєкта. Дозволено максимум 2 рівні.' }, { status: 400 });
      }
    }

    const id = `bu_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    // `IS NOT DISTINCT FROM`: a root-level row has parent_id NULL, and `= ?`
    // never matches NULL. SQLite spells the null-safe form `IS ?`; Postgres
    // rejects a parameter after IS outright — "syntax error at or near $2".
    const maxOrder = await sql.row<any>(
      "SELECT COALESCE(MAX(sort_order), 0) AS mx FROM business_units WHERE organization_id = ? AND parent_id IS NOT DISTINCT FROM ?",
      [orgId, parent_id],
    ) as { mx: number };

    // A subproject cannot be "is_shared" on its own — inherit from parent.
    let finalIsShared = is_shared ? 1 : 0;
    if (parent_id) {
      const parent = await sql.row<any>("SELECT is_shared FROM business_units WHERE id = ? AND organization_id = ?", [parent_id, orgId]) as { is_shared: number };
      finalIsShared = parent.is_shared;
    }

    await sql.run(`
      INSERT INTO business_units
        (id, organization_id, name, unit_type, is_shared, is_active, sort_order, parent_id)
      VALUES (?, ?, ?, ?, ?, TRUE, ?, ?)
    `, [id, orgId, name.trim(),
      unit_type || name.trim(),
      finalIsShared,
      Number(sort_order) || (maxOrder.mx + 1),
      parent_id]);

    const created = await sql.row<any>("SELECT * FROM business_units WHERE id = ? AND organization_id = ?", [id, orgId]);
    return NextResponse.json(created, { status: 201 });
  } catch (error: any) {
    return serverError('modules/finance/api/projects createProject', error);
  }
}

export async function updateProject(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const sql = getSql();
    const orgId = await requireOrganizationId();
    const { id } = await context.params;
    const body = await request.json();
    const { name, unit_type, is_shared, sort_order } = body;

    const existing = await sql.row<any>("SELECT * FROM business_units WHERE id = ? AND organization_id = ?", [id, orgId]) as ProjectRow | undefined;
    if (!existing) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

    const isRoot = existing.parent_id === null;

    const fields: string[] = [];
    const params: any[] = [];
    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) {
        return NextResponse.json({ error: 'name must be a non-empty string' }, { status: 400 });
      }
      fields.push('name = ?'); params.push(name.trim());
    }
    if (unit_type !== undefined) { fields.push('unit_type = ?'); params.push(unit_type); }
    if (is_shared !== undefined) {
      if (!isRoot) {
        return NextResponse.json({ error: '«Спільний» неможна змінити у підпроєкті (успадковується від батька)' }, { status: 400 });
      }
      fields.push('is_shared = ?'); params.push(is_shared ? 1 : 0);
      // Propagate to children
      await sql.run("UPDATE business_units SET is_shared = ? WHERE parent_id = ?", [is_shared ? 1 : 0, id]);
    }
    if (sort_order !== undefined) { fields.push('sort_order = ?'); params.push(Number(sort_order) || 0); }

    if (fields.length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

    params.push(id);
    await sql.run(`UPDATE business_units SET ${fields.join(', ')} WHERE id = ? AND organization_id = ?`, [...params, orgId]);

    const updated = await sql.row<any>("SELECT * FROM business_units WHERE id = ? AND organization_id = ?", [id, orgId]);
    return NextResponse.json(updated);
  } catch (error: any) {
    return serverError('modules/finance/api/projects updateProject', error);
  }
}

export async function archiveProject(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const sql = getSql();
    const orgId = await requireOrganizationId();
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const archived = body.archived !== false;

    const existing = await sql.row<any>("SELECT id FROM business_units WHERE id = ? AND organization_id = ?", [id, orgId]);
    if (!existing) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

    await sql.run("UPDATE business_units SET is_active = ? WHERE id = ? AND organization_id = ?", [archived ? 0 : 1, id, orgId]);
    if (archived) {
      await sql.run("UPDATE business_units SET is_active = FALSE WHERE parent_id = ?", [id]);
    }

    const updated = await sql.row<any>("SELECT * FROM business_units WHERE id = ? AND organization_id = ?", [id, orgId]);
    return NextResponse.json(updated);
  } catch (error: any) {
    return serverError('modules/finance/api/projects archiveProject', error);
  }
}

export async function deleteProject(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const sql = getSql();
    const orgId = await requireOrganizationId();
    const { id } = await context.params;

    const existing = await sql.row<any>("SELECT * FROM business_units WHERE id = ? AND organization_id = ?", [id, orgId]) as ProjectRow | undefined;
    if (!existing) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

    const childCount = await countChildren(id);
    if (childCount > 0) {
      return NextResponse.json(
        { error: `Маєте ${childCount} підпроєкт${childCount === 1 ? '' : 'и'}. Спершу видаліть або архівуйте їх.`, children: childCount },
        { status: 409 }
      );
    }

    const { total, breakdown } = await countLinkedRows(id);
    if (total > 0) {
      const parts = breakdown.map((b) => `${b.table}: ${b.count}`).join(', ');
      return NextResponse.json(
        { error: `Проєкт використовується у ${total} запис${total === 1 ? 'і' : 'ах'} (${parts}). Архівуйте замість видалення.`, linked: breakdown, linked_total: total },
        { status: 409 }
      );
    }

    await sql.run("DELETE FROM business_units WHERE id = ? AND organization_id = ?", [id, orgId]);
    return NextResponse.json({ ok: true, deleted_id: id });
  } catch (error: any) {
    return serverError('modules/finance/api/projects deleteProject', error);
  }
}

export async function moveProject(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const sql = getSql();
    const orgId = await requireOrganizationId();
    const { id } = await context.params;
    const body = await request.json();
    const { parent_id, sort_order } = body;

    const existing = await sql.row<any>("SELECT * FROM business_units WHERE id = ? AND organization_id = ?", [id, orgId]) as ProjectRow | undefined;
    if (!existing) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

    if (parent_id !== undefined && parent_id !== null) {
      if (parent_id === id) {
        return NextResponse.json({ error: 'Проєкт не може бути батьком сам собі' }, { status: 400 });
      }
      const newParent = await sql.row<any>("SELECT * FROM business_units WHERE id = ? AND organization_id = ?", [parent_id, orgId]) as ProjectRow | undefined;
      if (!newParent) return NextResponse.json({ error: 'Parent project not found' }, { status: 404 });
      if (newParent.parent_id !== null) {
        return NextResponse.json({ error: 'Обраний батько сам є підпроєктом. Дозволено максимум 2 рівні.' }, { status: 400 });
      }
      const childCount = await countChildren(id);
      if (childCount > 0) {
        return NextResponse.json({ error: 'Проєкт має підпроєкти — спершу переоформіть або видаліть їх, щоб уникнути 3-го рівня.' }, { status: 400 });
      }
    }

    const fields: string[] = [];
    const params: any[] = [];
    if (parent_id !== undefined) { fields.push('parent_id = ?'); params.push(parent_id); }
    if (sort_order !== undefined) { fields.push('sort_order = ?'); params.push(Number(sort_order) || 0); }
    if (fields.length === 0) return NextResponse.json({ error: 'Nothing to move' }, { status: 400 });
    params.push(id);

    await sql.run(`UPDATE business_units SET ${fields.join(', ')} WHERE id = ? AND organization_id = ?`, [...params, orgId]);
    const updated = await sql.row<any>("SELECT * FROM business_units WHERE id = ? AND organization_id = ?", [id, orgId]);
    return NextResponse.json(updated);
  } catch (error: any) {
    return serverError('modules/finance/api/projects moveProject', error);
  }
}
