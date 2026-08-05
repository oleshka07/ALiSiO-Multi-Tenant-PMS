/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { requireOrganizationId } from '@core/auth/tenant-context';

const getOrgId = requireOrganizationId;

export async function listTags(request: NextRequest): Promise<NextResponse> {
  try {
    const sql = getSql();
    const orgId = await getOrgId();
    const includeArchived = request.nextUrl.searchParams.get('archived') === '1';
    const where = includeArchived ? 'organization_id = ?' : 'organization_id = ? AND is_active = 1';
    const rows = await sql.rows<any>(`
      SELECT * FROM finance_tags
      WHERE ${where}
      ORDER BY sort_order ASC, name ASC
    `, [orgId]);
    return NextResponse.json(rows);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function createTag(request: NextRequest): Promise<NextResponse> {
  try {
    const sql = getSql();
    const body = await request.json();
    const { name, color, sort_order } = body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    if (name.trim().length > 50) {
      return NextResponse.json({ error: `Назва тега не може бути довшою за ${50} символів` }, { status: 400 });
    }

    const orgId = await getOrgId();
    const id = `tag_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const maxOrder = await sql.row<any>("SELECT COALESCE(MAX(sort_order), 0) AS mx FROM finance_tags WHERE organization_id = ?", [orgId]) as { mx: number };

    try {
      await sql.run(`
        INSERT INTO finance_tags (id, organization_id, name, color, sort_order)
        VALUES (?, ?, ?, ?, ?)
      `, [id, orgId, name.trim(), color || '#6b7280', Number(sort_order) || (maxOrder.mx + 1)]);
    } catch (e: any) {
      if (String(e.message).includes('UNIQUE')) {
        return NextResponse.json({ error: `Тег «${name.trim()}» уже існує` }, { status: 409 });
      }
      throw e;
    }

    const created = await sql.row<any>("SELECT * FROM finance_tags WHERE id = ?", [id]);
    return NextResponse.json(created, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function updateTag(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const sql = getSql();
    const { id } = await context.params;
    const body = await request.json();
    const { name, color, sort_order } = body;

    const existing = await sql.row<any>("SELECT * FROM finance_tags WHERE id = ?", [id]);
    if (!existing) return NextResponse.json({ error: 'Tag not found' }, { status: 404 });

    const fields: string[] = [];
    const params: any[] = [];
    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) {
        return NextResponse.json({ error: 'name must be a non-empty string' }, { status: 400 });
      }
      if (name.trim().length > 50) {
        return NextResponse.json({ error: `Назва тега не може бути довшою за ${50} символів` }, { status: 400 });
      }
      fields.push('name = ?'); params.push(name.trim());
    }
    if (color !== undefined) { fields.push('color = ?'); params.push(color || '#6b7280'); }
    if (sort_order !== undefined) { fields.push('sort_order = ?'); params.push(Number(sort_order) || 0); }

    if (fields.length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

    params.push(id);
    try {
      await sql.run(`UPDATE finance_tags SET ${fields.join(', ')} WHERE id = ?`, [...params]);
    } catch (e: any) {
      if (String(e.message).includes('UNIQUE')) {
        return NextResponse.json({ error: 'Тег з такою назвою уже існує' }, { status: 409 });
      }
      throw e;
    }

    const updated = await sql.row<any>("SELECT * FROM finance_tags WHERE id = ?", [id]);
    return NextResponse.json(updated);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function archiveTag(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const sql = getSql();
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const archived = body.archived !== false;

    const existing = await sql.row<any>("SELECT id FROM finance_tags WHERE id = ?", [id]);
    if (!existing) return NextResponse.json({ error: 'Tag not found' }, { status: 404 });

    await sql.run("UPDATE finance_tags SET is_active = ? WHERE id = ?", [archived ? 0 : 1, id]);
    const updated = await sql.row<any>("SELECT * FROM finance_tags WHERE id = ?", [id]);
    return NextResponse.json(updated);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function deleteTag(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const sql = getSql();
    const { id } = await context.params;

    const existing = await sql.row<any>("SELECT id FROM finance_tags WHERE id = ?", [id]);
    if (!existing) return NextResponse.json({ error: 'Tag not found' }, { status: 404 });

    await sql.run("DELETE FROM finance_tags WHERE id = ?", [id]);
    return NextResponse.json({ ok: true, deleted_id: id });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
