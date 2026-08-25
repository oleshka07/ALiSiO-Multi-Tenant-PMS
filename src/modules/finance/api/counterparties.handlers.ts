/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { requireOrganizationId } from '@core/auth/tenant-context';
import { serverError } from '@core/http/errors';

const KINDS = ['client', 'supplier', 'employee', 'other'] as const;
type Kind = typeof KINDS[number];
const MAX_ALIAS_LEN = 100;

interface CounterpartyRow {
  id: string;
  organization_id: string;
  name: string;
  parent_id: string | null;
  kind: Kind | null;
  note: string | null;
  aliases_json: string;
  icon: string | null;
  color: string | null;
  sort_order: number;
  is_active: number;
  created_at: string;
}

const getOrgId = requireOrganizationId;

function parseAliases(json: string | null): string[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr.filter((x): x is string => typeof x === 'string');
  } catch { return []; }
}

function normalizeAliases(input: unknown): string[] {
  if (!Array.isArray(input)) {
    throw new Error('aliases must be an array of strings');
  }
  if (input.length > 50) {
    throw new Error(`Максимум ${50} синонімів`);
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (trimmed.length > MAX_ALIAS_LEN) {
      throw new Error(`Синонім «${trimmed.slice(0, 30)}…» довший за ${MAX_ALIAS_LEN} символів`);
    }
    const upper = trimmed.toUpperCase();
    if (!seen.has(upper)) {
      seen.add(upper);
      result.push(upper);
    }
  }
  return result;
}

function enrich(row: CounterpartyRow) {
  return { ...row, aliases: parseAliases(row.aliases_json) };
}

async function countChildren(id: string): Promise<number> {
  const sql = getSql();
  const r = await sql.row<any>("SELECT COUNT(*) AS n FROM finance_counterparties WHERE parent_id = ?", [id]) as { n: number };
  return r.n;
}

export async function listCounterparties(request: NextRequest): Promise<NextResponse> {
  try {
    const sql = getSql();
    const orgId = await getOrgId();
    const kind = request.nextUrl.searchParams.get('kind');
    const includeArchived = request.nextUrl.searchParams.get('archived') === '1';
    const search = request.nextUrl.searchParams.get('search');

    const where: string[] = ['organization_id = ?'];
    const params: any[] = [orgId];
    if (!includeArchived) where.push('is_active = TRUE');
    if (kind && KINDS.includes(kind as Kind)) { where.push('kind = ?'); params.push(kind); }
    if (search) { where.push('name LIKE ?'); params.push(`%${search}%`); }

    const rows = await sql.rows<any>(`
      SELECT * FROM finance_counterparties
      WHERE ${where.join(' AND ')}
      ORDER BY sort_order ASC, name ASC
    `, [...params]) as CounterpartyRow[];
    return NextResponse.json(rows.map(enrich));
  } catch (error: any) {
    return serverError('modules/finance/api/counterparties listCounterparties', error);
  }
}

export async function getCounterpartyTree(request: NextRequest): Promise<NextResponse> {
  try {
    const sql = getSql();
    const orgId = await getOrgId();
    const includeArchived = request.nextUrl.searchParams.get('archived') === '1';
    const where = includeArchived ? 'organization_id = ?' : 'organization_id = ? AND is_active = TRUE';

    const rows = await sql.rows<any>(`
      SELECT * FROM finance_counterparties
      WHERE ${where}
      ORDER BY sort_order ASC, name ASC
    `, [orgId]) as CounterpartyRow[];

    const enriched = rows.map(enrich);
    const roots = enriched.filter((r) => r.parent_id === null);
    const childrenByParent = new Map<string, typeof enriched>();
    for (const r of enriched) {
      if (r.parent_id) {
        if (!childrenByParent.has(r.parent_id)) childrenByParent.set(r.parent_id, []);
        childrenByParent.get(r.parent_id)!.push(r);
      }
    }
    const tree = roots.map((root) => ({ ...root, children: childrenByParent.get(root.id) || [] }));

    const byKind: Record<string, typeof tree> = { client: [], supplier: [], employee: [], other: [], unspecified: [] };
    for (const node of tree) {
      const key = (node.kind || 'unspecified') as string;
      if (!byKind[key]) byKind[key] = [];
      byKind[key].push(node);
    }

    return NextResponse.json({ tree, byKind });
  } catch (error: any) {
    return serverError('modules/finance/api/counterparties getCounterpartyTree', error);
  }
}

export async function createCounterparty(request: NextRequest): Promise<NextResponse> {
  try {
    const sql = getSql();
    const body = await request.json();
    const { name, parent_id = null, kind, aliases, icon, color, note, sort_order } = body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    let finalKind: Kind | null = null;
    if (parent_id) {
      const parent = await sql.row<any>("SELECT * FROM finance_counterparties WHERE id = ?", [parent_id]) as CounterpartyRow | undefined;
      if (!parent) return NextResponse.json({ error: 'Parent counterparty not found' }, { status: 404 });
      if (parent.parent_id !== null) {
        return NextResponse.json({ error: 'Підконтрагента не можна створити всередині іншого підконтрагента. Дозволено максимум 2 рівні.' }, { status: 400 });
      }
      finalKind = parent.kind;
    } else if (kind !== undefined && kind !== null && kind !== '') {
      if (!KINDS.includes(kind)) {
        return NextResponse.json({ error: `kind must be one of ${KINDS.join(', ')}` }, { status: 400 });
      }
      finalKind = kind;
    }

    let aliasArr: string[] = [];
    if (aliases !== undefined) {
      try { aliasArr = normalizeAliases(aliases); }
      catch (e: any) { return NextResponse.json({ error: e.message }, { status: 400 }); }
    }

    const orgId = await getOrgId();
    const id = `cp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    // `IS NOT DISTINCT FROM`: a root-level row has parent_id NULL, and `= ?`
    // never matches NULL. SQLite spells the null-safe form `IS ?`; Postgres
    // rejects a parameter after IS outright — "syntax error at or near $2".
    const maxOrder = await sql.row<any>(
      "SELECT COALESCE(MAX(sort_order), 0) AS mx FROM finance_counterparties WHERE organization_id = ? AND parent_id IS NOT DISTINCT FROM ?",
      [orgId, parent_id],
    ) as { mx: number };

    await sql.run(`
      INSERT INTO finance_counterparties
        (id, organization_id, name, parent_id, kind, note, aliases_json, icon, color, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [id, orgId, name.trim(), parent_id, finalKind,
      note || null,
      JSON.stringify(aliasArr),
      icon || null,
      color || '#6b7280',
      Number(sort_order) || (maxOrder.mx + 1)]);

    const created = await sql.row<any>("SELECT * FROM finance_counterparties WHERE id = ?", [id]) as CounterpartyRow;
    return NextResponse.json(enrich(created), { status: 201 });
  } catch (error: any) {
    return serverError('modules/finance/api/counterparties createCounterparty', error);
  }
}

export async function updateCounterparty(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const sql = getSql();
    const { id } = await context.params;
    const body = await request.json();
    const { name, kind, aliases, icon, color, note, sort_order } = body;

    const existing = await sql.row<any>("SELECT * FROM finance_counterparties WHERE id = ?", [id]) as CounterpartyRow | undefined;
    if (!existing) return NextResponse.json({ error: 'Counterparty not found' }, { status: 404 });

    const isRoot = existing.parent_id === null;
    const fields: string[] = [];
    const params: any[] = [];

    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) {
        return NextResponse.json({ error: 'name must be a non-empty string' }, { status: 400 });
      }
      fields.push('name = ?'); params.push(name.trim());
    }
    if (kind !== undefined) {
      if (!isRoot) {
        return NextResponse.json({ error: 'kind неможна змінити у підконтрагента (успадковується від батька)' }, { status: 400 });
      }
      if (kind !== null && kind !== '' && !KINDS.includes(kind)) {
        return NextResponse.json({ error: `kind must be one of ${KINDS.join(', ')}` }, { status: 400 });
      }
      fields.push('kind = ?'); params.push(kind || null);
      await sql.run("UPDATE finance_counterparties SET kind = ? WHERE parent_id = ?", [kind || null, id]);
    }
    if (aliases !== undefined) {
      try {
        const arr = normalizeAliases(aliases);
        fields.push('aliases_json = ?'); params.push(JSON.stringify(arr));
      } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 400 });
      }
    }
    if (icon !== undefined) { fields.push('icon = ?'); params.push(icon); }
    if (color !== undefined) { fields.push('color = ?'); params.push(color); }
    if (note !== undefined) { fields.push('note = ?'); params.push(note || null); }
    if (sort_order !== undefined) { fields.push('sort_order = ?'); params.push(Number(sort_order) || 0); }

    if (fields.length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

    params.push(id);
    await sql.run(`UPDATE finance_counterparties SET ${fields.join(', ')} WHERE id = ?`, [...params]);

    const updated = await sql.row<any>("SELECT * FROM finance_counterparties WHERE id = ?", [id]) as CounterpartyRow;
    return NextResponse.json(enrich(updated));
  } catch (error: any) {
    return serverError('modules/finance/api/counterparties updateCounterparty', error);
  }
}

export async function archiveCounterparty(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const sql = getSql();
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const archived = body.archived !== false;

    const existing = await sql.row<any>("SELECT id FROM finance_counterparties WHERE id = ?", [id]);
    if (!existing) return NextResponse.json({ error: 'Counterparty not found' }, { status: 404 });

    await sql.run("UPDATE finance_counterparties SET is_active = ? WHERE id = ?", [archived ? 0 : 1, id]);
    if (archived) {
      await sql.run("UPDATE finance_counterparties SET is_active = FALSE WHERE parent_id = ?", [id]);
    }

    const updated = await sql.row<any>("SELECT * FROM finance_counterparties WHERE id = ?", [id]) as CounterpartyRow;
    return NextResponse.json(enrich(updated));
  } catch (error: any) {
    return serverError('modules/finance/api/counterparties archiveCounterparty', error);
  }
}

export async function deleteCounterparty(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const sql = getSql();
    const { id } = await context.params;

    const existing = await sql.row<any>("SELECT * FROM finance_counterparties WHERE id = ?", [id]) as CounterpartyRow | undefined;
    if (!existing) return NextResponse.json({ error: 'Counterparty not found' }, { status: 404 });

    const childCount = await countChildren(id);
    if (childCount > 0) {
      return NextResponse.json(
        { error: `Маєте ${childCount} підконтрагент${childCount === 1 ? 'а' : 'и'}. Спершу видаліть або архівуйте їх.`, children: childCount },
        { status: 409 }
      );
    }

    await sql.run("DELETE FROM finance_counterparties WHERE id = ?", [id]);
    return NextResponse.json({ ok: true, deleted_id: id });
  } catch (error: any) {
    return serverError('modules/finance/api/counterparties deleteCounterparty', error);
  }
}

export async function moveCounterparty(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const sql = getSql();
    const { id } = await context.params;
    const body = await request.json();
    const { parent_id, sort_order } = body;

    const existing = await sql.row<any>("SELECT * FROM finance_counterparties WHERE id = ?", [id]) as CounterpartyRow | undefined;
    if (!existing) return NextResponse.json({ error: 'Counterparty not found' }, { status: 404 });

    if (parent_id !== undefined && parent_id !== null) {
      if (parent_id === id) {
        return NextResponse.json({ error: 'Контрагент не може бути батьком сам собі' }, { status: 400 });
      }
      const newParent = await sql.row<any>("SELECT * FROM finance_counterparties WHERE id = ?", [parent_id]) as CounterpartyRow | undefined;
      if (!newParent) return NextResponse.json({ error: 'Parent counterparty not found' }, { status: 404 });
      if (newParent.parent_id !== null) {
        return NextResponse.json({ error: 'Обраний батько сам є підконтрагентом. Дозволено максимум 2 рівні.' }, { status: 400 });
      }
      if (newParent.kind !== existing.kind) {
        return NextResponse.json({ error: `Батько має тип «${newParent.kind || 'не вказано'}», а контрагент — «${existing.kind || 'не вказано'}». Переміщення заборонено.` }, { status: 400 });
      }
      const childCount = await countChildren(id);
      if (childCount > 0) {
        return NextResponse.json({ error: 'Контрагент має підконтрагентів — спершу переоформіть або видаліть їх, щоб уникнути 3-го рівня.' }, { status: 400 });
      }
    }

    const fields: string[] = [];
    const params: any[] = [];
    if (parent_id !== undefined) { fields.push('parent_id = ?'); params.push(parent_id); }
    if (sort_order !== undefined) { fields.push('sort_order = ?'); params.push(Number(sort_order) || 0); }
    if (fields.length === 0) return NextResponse.json({ error: 'Nothing to move' }, { status: 400 });
    params.push(id);

    await sql.run(`UPDATE finance_counterparties SET ${fields.join(', ')} WHERE id = ?`, [...params]);
    const updated = await sql.row<any>("SELECT * FROM finance_counterparties WHERE id = ?", [id]) as CounterpartyRow;
    return NextResponse.json(enrich(updated));
  } catch (error: any) {
    return serverError('modules/finance/api/counterparties moveCounterparty', error);
  }
}

export async function getAliasSuggestions(_request: NextRequest): Promise<NextResponse> {
  try {
    const sql = getSql();
    const orgId = await getOrgId();
    const rows = await sql.rows<any>(`
      SELECT comment AS txt, COUNT(*) AS n FROM fin_operations
        WHERE organization_id = ? AND counterparty_id IS NULL
          AND comment IS NOT NULL AND TRIM(comment) != ''
        GROUP BY comment
    `, [orgId]) as { txt: string; n: number }[];

    const agg = new Map<string, number>();
    for (const r of rows) {
      const key = r.txt.trim().toUpperCase();
      if (!key) continue;
      agg.set(key, (agg.get(key) || 0) + r.n);
    }

    const usedAliases = new Set<string>();
    const cpRows = await sql.rows<any>("SELECT aliases_json FROM finance_counterparties WHERE organization_id = ? AND is_active = TRUE", [orgId]) as { aliases_json: string }[];
    for (const cp of cpRows) {
      for (const a of parseAliases(cp.aliases_json)) usedAliases.add(a);
    }

    const suggestions = [...agg.entries()]
      .filter(([k]) => !usedAliases.has(k))
      .map(([text, count]) => ({ text, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return NextResponse.json({ suggestions });
  } catch (error: any) {
    return serverError('modules/finance/api/counterparties getAliasSuggestions', error);
  }
}
