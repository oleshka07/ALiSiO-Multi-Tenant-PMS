/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { getDb } from '@core/db';
import {
  applyRulesToOperation, loadActiveRules, parseRule,
  type AutoRuleRow, type Condition, type Actions, type Operation,
} from '../data/auto-rules-engine';
import { requireOrganizationId } from '@core/auth/tenant-context';
import { serverError, handleError } from '@core/http/errors';
import {
  ownedFinanceRow, requireOwnedReferences, RULE_ACTION_REFERENCES,
} from '../data/owned.repo';
import { requireOwnedTags } from '../data/operation-tags.repo';

const OP_TYPES = ['income', 'expense', 'any'] as const;

async function enrichRule(row: AutoRuleRow) {
  const sql = getSql();
  const parsed = parseRule(row);
  const matchCount = await sql.row<any>("SELECT COUNT(*) AS n FROM fin_auto_rule_matches WHERE rule_id = ?", [row.id]) as { n: number };
  return { ...parsed, match_count: matchCount.n };
}

function validateConditions(conditions: unknown): Condition[] {
  if (!Array.isArray(conditions)) throw new Error('conditions must be an array');
  return conditions.map((c: any) => {
    if (!c || typeof c.field !== 'string' || typeof c.op !== 'string') {
      throw new Error('Each condition must have field, op, value');
    }
    return { field: c.field, op: c.op, value: c.value };
  });
}

/**
 * Дії правила — і належність кожного посилання (Р13.1).
 *
 * Тут стояв самий фільтр типів: `set_category_id`, `set_project_id`,
 * `set_counterparty_id` і `add_tag_ids` їхали з тіла запиту прямо в
 * `actions_json`, а звідти — в `UPDATE fin_operations SET category_id = ? …`
 * (`auto-rules-engine.ts`), тобто ПОВЗ варту `createOperationInTx` і
 * `updateOperation`.
 *
 * RLS тут не сторож, і це треба сказати вголос: політика `fin_operations`
 * дивиться на `organization_id` ОПЕРАЦІЇ, а не на власника статті. Операція
 * своя, стаття чужа — політика пропускає. Тобто вада жива й на Postgres, і
 * вона автоматизована: правило зберігається ОДИН раз, а спрацьовує на кожній
 * наступній операції готелю.
 *
 * Тому варта стоїть саме на ЗБЕРЕЖЕННІ, а не на спрацюванні: одна перевірка
 * замість тисяч, і оператор чує відмову тоді, коли ще розуміє, що робив.
 * Чужий id → 404 (інваріант 5).
 *
 * `add_tag_ids` іде тією самою вартою, що й `tag_ids` операції
 * (`operation-tags.repo`): це ОДНЕ поле і два входи, а не два поля.
 */
async function validateActions(organizationId: string, actions: unknown): Promise<Actions> {
  if (!actions || typeof actions !== 'object') return {};
  const a = actions as any;
  const out: Actions = {};
  if ('set_category_id' in a) out.set_category_id = a.set_category_id || null;
  if ('set_project_id' in a) out.set_project_id = a.set_project_id || null;
  if ('set_counterparty_id' in a) out.set_counterparty_id = a.set_counterparty_id || null;
  if ('auto_match_counterparty' in a) out.auto_match_counterparty = !!a.auto_match_counterparty;
  if ('set_comment' in a && typeof a.set_comment === 'string') out.set_comment = a.set_comment;
  if (Array.isArray(a.add_tag_ids)) out.add_tag_ids = a.add_tag_ids.filter((x: any) => typeof x === 'string');

  await requireOwnedReferences(organizationId, out, RULE_ACTION_REFERENCES);
  if (out.add_tag_ids && out.add_tag_ids.length > 0) {
    out.add_tag_ids = await requireOwnedTags(organizationId, out.add_tag_ids);
  }
  return out;
}

export async function listAutoRules(_request: NextRequest): Promise<NextResponse> {
  try {
    const sql = getSql();
    const orgId = await requireOrganizationId();
    const rows = await sql.rows<any>(`
      SELECT * FROM fin_auto_rules
      WHERE organization_id = ?
      ORDER BY sort_order ASC, created_at ASC
    `, [orgId]) as AutoRuleRow[];
    return NextResponse.json(await Promise.all(rows.map((r) => enrichRule(r))));
  } catch (error: any) {
    return serverError('modules/finance/api/auto-rules listAutoRules', error);
  }
}

export async function createAutoRule(request: NextRequest): Promise<NextResponse> {
  try {
    const sql = getSql();
    const body = await request.json();
    const { name, op_type = 'any', conditions = [], actions = {}, is_active = true, stop_on_match = false, sort_order } = body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    if (!(OP_TYPES as readonly string[]).includes(op_type)) {
      return NextResponse.json({ error: `op_type must be one of ${OP_TYPES.join(', ')}` }, { status: 400 });
    }

    const orgId = await requireOrganizationId();

    let parsedConditions: Condition[];
    try {
      parsedConditions = validateConditions(conditions);
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    // ПОЗА цим `catch` навмисно: `validateActions` кидає НАЗВАНУ відмову 404
    // (чужий id), і глухий рукав перетворив би її на 400 з чужим текстом —
    // рівно те, від чого стереже інваріант 6. `handleError` нижче віддає
    // названій відмові її статус, решті — 500 і рядок у лог.
    const parsedActions: Actions = await validateActions(orgId, actions);
    const id = `ar_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const maxOrder = await sql.row<any>("SELECT COALESCE(MAX(sort_order), 0) AS mx FROM fin_auto_rules WHERE organization_id = ?", [orgId]) as { mx: number };

    await sql.run(`
      INSERT INTO fin_auto_rules
        (id, organization_id, name, op_type, conditions_json, actions_json, is_active, stop_on_match, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [id, orgId, name.trim(), op_type,
      JSON.stringify(parsedConditions), JSON.stringify(parsedActions),
      is_active ? 1 : 0, stop_on_match ? 1 : 0,
      Number(sort_order) || (maxOrder.mx + 1)]);

    const row = await ownedFinanceRow('fin_auto_rules', id, orgId) as AutoRuleRow;
    return NextResponse.json(await enrichRule(row), { status: 201 });
  } catch (error: any) {
    return handleError('modules/finance/api/auto-rules createAutoRule', error);
  }
}

export async function updateAutoRule(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const sql = getSql();
    const { id } = await context.params;
    const body = await request.json();
    const orgId = await requireOrganizationId();
    const existing = await ownedFinanceRow('fin_auto_rules', id, orgId);
    if (!existing) return NextResponse.json({ error: 'Rule not found' }, { status: 404 });

    const fields: string[] = [];
    const params: any[] = [];
    if (typeof body.name === 'string' && body.name.trim()) { fields.push('name = ?'); params.push(body.name.trim()); }
    if (typeof body.op_type === 'string' && (OP_TYPES as readonly string[]).includes(body.op_type)) {
      fields.push('op_type = ?'); params.push(body.op_type);
    }
    if (body.conditions !== undefined) {
      try {
        fields.push('conditions_json = ?');
        params.push(JSON.stringify(validateConditions(body.conditions)));
      } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 400 }); }
    }
    if (body.actions !== undefined) {
      fields.push('actions_json = ?');
      params.push(JSON.stringify(await validateActions(orgId, body.actions)));
    }
    if (body.is_active !== undefined) { fields.push('is_active = ?'); params.push(body.is_active ? 1 : 0); }
    if (body.stop_on_match !== undefined) { fields.push('stop_on_match = ?'); params.push(body.stop_on_match ? 1 : 0); }
    if (body.sort_order !== undefined) { fields.push('sort_order = ?'); params.push(Number(body.sort_order) || 0); }
    fields.push("updated_at = CURRENT_TIMESTAMP");
    if (fields.length === 1) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

    params.push(id);
    await sql.run(`UPDATE fin_auto_rules SET ${fields.join(', ')} WHERE id = ? AND organization_id = ?`, [...params, orgId]);
    const row = await ownedFinanceRow('fin_auto_rules', id, orgId) as AutoRuleRow;
    return NextResponse.json(await enrichRule(row));
  } catch (error: any) {
    return handleError('modules/finance/api/auto-rules updateAutoRule', error);
  }
}

export async function deleteAutoRule(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const sql = getSql();
    const { id } = await context.params;
    const orgId = await requireOrganizationId();
    const existing = await ownedFinanceRow('fin_auto_rules', id, orgId);
    if (!existing) return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    await sql.run('DELETE FROM fin_auto_rules WHERE id = ? AND organization_id = ?', [id, orgId]);
    return NextResponse.json({ ok: true, deleted_id: id });
  } catch (error: any) {
    return serverError('modules/finance/api/auto-rules deleteAutoRule', error);
  }
}

export async function toggleAutoRule(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const sql = getSql();
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const orgId = await requireOrganizationId();
    const row = await ownedFinanceRow('fin_auto_rules', id, orgId) as { is_active: number } | undefined;
    if (!row) return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    const next = typeof body.is_active === 'boolean' ? (body.is_active ? 1 : 0) : (row.is_active ? 0 : 1);
    await sql.run("UPDATE fin_auto_rules SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?", [next, id, orgId]);
    const updated = await ownedFinanceRow('fin_auto_rules', id, orgId) as AutoRuleRow;
    return NextResponse.json(await enrichRule(updated));
  } catch (error: any) {
    return serverError('modules/finance/api/auto-rules toggleAutoRule', error);
  }
}

export async function applyAutoRulesToOperations(request: NextRequest): Promise<NextResponse> {
  try {
    const sql = getSql();
    const orgId = await requireOrganizationId();
    const body = await request.json().catch(() => ({}));
    const { operation_ids, from, to, op_type } = body;

    let ops: Operation[];
    if (Array.isArray(operation_ids) && operation_ids.length > 0) {
      const placeholders = operation_ids.map(() => '?').join(',');
      // The ids come from the request body. Without the organization in the
      // query, rules of one hotel rewrote another hotel's operations.
      ops = await sql.rows<any>(`SELECT * FROM fin_operations WHERE id IN (${placeholders}) AND organization_id = ?`, [...operation_ids, orgId]) as Operation[];
    } else {
      const where: string[] = ['organization_id = ?'];
      const params: any[] = [orgId];
      if (from) { where.push('paid_at >= ?'); params.push(from); }
      if (to) { where.push('paid_at <= ?'); params.push(to); }
      if (op_type) { where.push('op_type = ?'); params.push(op_type); }
      ops = await sql.rows<any>(`SELECT * FROM fin_operations WHERE ${where.join(' AND ')}`, [...params]) as Operation[];
    }

    const rules = await loadActiveRules(orgId);
    if (rules.length === 0) {
      return NextResponse.json({ processed: ops.length, changed: 0, rulesCount: 0, results: [] });
    }

    const results = [];
    let changedCount = 0;
    for (const op of ops) {
      const result = await applyRulesToOperation(op, rules, orgId);
      if (Object.keys(result.changes).length > 0 || result.tagsAdded.length > 0) {
        changedCount++;
        results.push(result);
      }
    }
    return NextResponse.json({ processed: ops.length, changed: changedCount, rulesCount: rules.length, results });
  } catch (error: any) {
    return serverError('modules/finance/api/auto-rules applyAutoRulesToOperations', error);
  }
}

export async function autoMatchCounterpartiesAllOps(request: NextRequest): Promise<NextResponse> {
  try {
    const sql = getSql();
    const orgId = await requireOrganizationId();
    const body = await request.json().catch(() => ({}));
    const onlyUnmatched = body.only_unmatched !== false;

    const where = onlyUnmatched
      ? 'organization_id = ? AND counterparty_id IS NULL AND comment IS NOT NULL'
      : 'organization_id = ? AND comment IS NOT NULL';
    const ops = await sql.rows<any>(`SELECT * FROM fin_operations WHERE ${where}`, [orgId]) as Operation[];

    // Synthetic rule that only auto-matches counterparty
    const syntheticRule = {
      id: 'synthetic_auto_match',
      organization_id: orgId,
      name: 'Auto-match counterparty',
      op_type: 'any' as const,
      conditions: [{ field: 'comment' as const, op: 'contains' as const, value: '' }], // matches anything with a comment
      actions: { auto_match_counterparty: true },
      is_active: 1,
      stop_on_match: 0,
      sort_order: 0,
    };

    let matched = 0;
    for (const op of ops) {
      const result = await applyRulesToOperation(op, [syntheticRule], orgId);
      if (result.changes.counterparty_id) matched++;
    }
    return NextResponse.json({ processed: ops.length, matched });
  } catch (error: any) {
    return serverError('modules/finance/api/auto-rules autoMatchCounterpartiesAllOps', error);
  }
}
