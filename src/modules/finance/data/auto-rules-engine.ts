/* eslint-disable @typescript-eslint/no-explicit-any */
import { getSql } from '@core/db/async';
import { ownedFinanceRow, RULE_ACTION_REFERENCES } from './owned.repo';

export type ConditionField =
  | 'comment' | 'amount' | 'amount_company'
  | 'account_from_id' | 'account_to_id'
  | 'currency' | 'counterparty_id';

export type ConditionOp =
  | 'contains' | 'not_contains' | 'starts_with' | 'ends_with' | 'equals' | 'not_equals'
  | '=' | '!=' | '>' | '>=' | '<' | '<='
  | 'between' | 'in';

export interface Condition {
  field: ConditionField;
  op: ConditionOp;
  value: any;
}

export interface Actions {
  set_category_id?: string | null;
  set_project_id?: string | null;
  set_counterparty_id?: string | null;
  add_tag_ids?: string[];
  auto_match_counterparty?: boolean;
  set_comment?: string;
}

export interface AutoRuleRow {
  id: string;
  organization_id: string;
  name: string;
  op_type: 'income' | 'expense' | 'any';
  conditions_json: string;
  actions_json: string;
  is_active: number;
  stop_on_match: number;
  sort_order: number;
}

export interface ParsedRule extends Omit<AutoRuleRow, 'conditions_json' | 'actions_json'> {
  conditions: Condition[];
  actions: Actions;
  /** JSON правила не розбирається — правило зламане, а не порожнє. */
  unreadable?: boolean;
}

export interface Operation {
  id: string;
  op_type: string;
  comment: string | null;
  amount: number;
  amount_company: number;
  account_from_id: string | null;
  account_to_id: string | null;
  currency: string;
  counterparty_id: string | null;
  category_id: string | null;
  project_id: string | null;
}

/**
 * Колонка з JSON — і на SQLite, і на Postgres.
 *
 * Тут стояло `JSON.parse(actions_json)` під глухим `catch`, який мовчки
 * ковтав виняток, і
 * це вбивало ВСІ авто-правила на Postgres мовчки. `conditions_json` і
 * `actions_json` — `JSONB` (`schema.sql`), а драйвер віддає JSONB уже
 * РОЗІБРАНИМ обʼєктом. `JSON.parse(обʼєкт)` розбирає рядок `[object Object]`,
 * кидає — і глухий рукав повертав `{}` та `[]`. Далі `matchesAllConditions`
 * на порожньому списку умов повертає `false`, тобто жодне правило не
 * застосовувалось НІКОЛИ: ані категоризація, ані автопідбір контрагента.
 * Помилки не було ніде — була тиша.
 *
 * На SQLite та сама колонка це TEXT, і там усе працювало. Класичний
 * INC-014-подібний розрив: зелено там, де розробка, мертво там, де клієнт.
 *
 * Знайдено 09.09.2026 прогоном `check:pg` роллю `alisio_app` — саме тим, що
 * AGENTS §7 і вимагає: «SQL — це рядок, політика — це поведінка бази; обидва
 * мовчать».
 *
 * `null` у розборі означає «зіпсовано»: рядок не вгадується мовчки, а
 * позначається зламаним нарівні з чужим посиланням (Д40).
 */
function parseJsonColumn<T>(value: unknown, empty: T): T | null {
  if (value === null || value === undefined || value === '') return empty;
  if (typeof value === 'object') return value as T;          // Postgres JSONB
  try { return JSON.parse(String(value)) as T; } catch { return null; }  // SQLite TEXT
}

export function parseRule(row: AutoRuleRow): ParsedRule {
  const { conditions_json, actions_json, ...rest } = row;
  const conditions = parseJsonColumn<Condition[]>(conditions_json, []);
  const actions = parseJsonColumn<Actions>(actions_json, {});
  return {
    ...rest,
    conditions: conditions ?? [],
    actions: actions ?? {},
    unreadable: conditions === null || actions === null,
  };
}

export function evaluateCondition(op: Operation, cond: Condition): boolean {
  const raw = (op as any)[cond.field];
  const actual = raw === null || raw === undefined ? '' : raw;

  switch (cond.op) {
    case 'contains':
      return String(actual).toLowerCase().includes(String(cond.value || '').toLowerCase());
    case 'not_contains':
      return !String(actual).toLowerCase().includes(String(cond.value || '').toLowerCase());
    case 'starts_with':
      return String(actual).toLowerCase().startsWith(String(cond.value || '').toLowerCase());
    case 'ends_with':
      return String(actual).toLowerCase().endsWith(String(cond.value || '').toLowerCase());
    case 'equals':
      return String(actual) === String(cond.value);
    case 'not_equals':
      return String(actual) !== String(cond.value);
    case '=':  return Number(actual) === Number(cond.value);
    case '!=': return Number(actual) !== Number(cond.value);
    case '>':  return Number(actual) >  Number(cond.value);
    case '>=': return Number(actual) >= Number(cond.value);
    case '<':  return Number(actual) <  Number(cond.value);
    case '<=': return Number(actual) <= Number(cond.value);
    case 'between': {
      if (!Array.isArray(cond.value) || cond.value.length !== 2) return false;
      const n = Number(actual);
      return n >= Number(cond.value[0]) && n <= Number(cond.value[1]);
    }
    case 'in':
      if (!Array.isArray(cond.value)) return false;
      return cond.value.some((v: any) => String(v) === String(actual));
    default: return false;
  }
}

export function matchesAllConditions(op: Operation, conditions: Condition[]): boolean {
  if (conditions.length === 0) return false;
  return conditions.every((c) => evaluateCondition(op, c));
}

export function isRuleApplicable(rule: ParsedRule, op: Operation): boolean {
  if (!rule.is_active) return false;
  if (rule.op_type !== 'any' && rule.op_type !== op.op_type) return false;
  return matchesAllConditions(op, rule.conditions);
}

export interface ApplyResult {
  operationId: string;
  changes: Record<string, any>;
  rulesFired: string[];
  tagsAdded: string[];
  /** Правила, які не спрацювали, бо посилаються в чужий довідник (Р13.1). */
  skipped?: { ruleId: string; fields: string[] }[];
}

function parseAliases(json: string | null): string[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}

async function findCounterpartyByText(orgId: string, text: string): Promise<string | null> {
  const sql = getSql();
  if (!text) return null;
  const haystack = text.toUpperCase();
  const rows = await sql.rows<any>(`
    SELECT id, aliases_json, sort_order FROM finance_counterparties
    WHERE organization_id = ? AND is_active = TRUE
  `, [orgId]) as { id: string; aliases_json: string; sort_order: number }[];
  let best: { id: string; len: number; sort: number } | null = null;
  for (const r of rows) {
    for (const a of parseAliases(r.aliases_json)) {
      if (!a) continue;
      if (haystack.includes(a)) {
        if (!best || a.length > best.len || (a.length === best.len && r.sort_order < best.sort)) {
          best = { id: r.id, len: a.length, sort: r.sort_order };
        }
      }
    }
  }
  return best?.id || null;
}

/**
 * Apply active rules (sorted by sort_order ASC) to a single operation.
 * Writes changes to fin_operations and logs matches.
 * Returns the delta (what changed).
 */
/**
 * Поля правила, чиє посилання веде в довідник ЧУЖОГО готелю.
 *
 * Варта стоїть на збереженні (`validateActions`, Д35), і для всього, що
 * зберігається після неї, цей список завжди порожній. Він потрібен для
 * правил, які лягли в базу РАНІШЕ за варту — і для них питання не «як
 * заборонити», а «що робить спрацювання». Відповідь: нічого не змінює і
 * каже про це видимо.
 *
 * `add_tag_ids` тут же: мітка — те саме поле, просто в іншому тілі (Д36).
 */
async function brokenRuleFields(rule: ParsedRule, orgId: string): Promise<string[]> {
  const broken: string[] = [];
  for (const [field, table] of RULE_ACTION_REFERENCES) {
    const value = (rule.actions as Record<string, unknown>)[field];
    if (value === undefined || value === null || value === '') continue;
    if (!await ownedFinanceRow(table, String(value), orgId)) broken.push(field);
  }
  for (const tagId of rule.actions.add_tag_ids || []) {
    if (!await ownedFinanceRow('finance_tags', String(tagId), orgId)) {
      if (!broken.includes('add_tag_ids')) broken.push('add_tag_ids');
    }
  }
  return broken;
}

/**
 * Позначити правило зламаним — У САМІЙ ТАБЛИЦІ, щоб побачив готель.
 *
 * Не `console.error`: лог контейнера не читає ніхто, і саме цей клас тиші
 * коштував проєкту найдорожче. Ознака їде в список правил
 * (`listAutoRules` → `enrichRule`), де оператор її і побачить поруч із
 * назвою правила.
 */
async function markRuleBroken(rule: ParsedRule, fields: string[], orgId: string): Promise<void> {
  const sql = getSql();
  if (rule.id.startsWith('synthetic_')) return;
  await sql.run(
    'UPDATE fin_auto_rules SET broken_fields = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?',
    [JSON.stringify(fields), rule.id, orgId]);
}

export async function applyRulesToOperation(op: Operation, rules: ParsedRule[], orgId: string): Promise<ApplyResult> {
  const sql = getSql();
  const changes: Record<string, any> = {};
  const rulesFired: string[] = [];
  const tagsAdded = new Set<string>();
  const skipped: { ruleId: string; fields: string[] }[] = [];

  for (const rule of rules) {
    if (!isRuleApplicable(rule, op)) continue;

    // Правило, чиє посилання веде в чужий довідник, не застосовується
    // ЦІЛКОМ — не «крім поганого поля». Половина правила це не правило:
    // операція дістала б комбінацію, якої готель ніколи не описував.
    const broken = rule.unreadable
      ? ['conditions_json/actions_json']
      : await brokenRuleFields(rule, orgId);
    if (broken.length > 0) {
      await markRuleBroken(rule, broken, orgId);
      skipped.push({ ruleId: rule.id, fields: broken });
      continue;
    }

    rulesFired.push(rule.id);
    const a = rule.actions;

    if (a.set_category_id !== undefined && op.op_type !== 'transfer' && changes.category_id === undefined) {
      changes.category_id = a.set_category_id;
    }
    if (a.set_project_id !== undefined && changes.project_id === undefined) {
      changes.project_id = a.set_project_id;
    }
    if (a.set_counterparty_id !== undefined && changes.counterparty_id === undefined) {
      changes.counterparty_id = a.set_counterparty_id;
    }
    if (a.auto_match_counterparty && changes.counterparty_id === undefined && op.counterparty_id === null) {
      const matchedId = await findCounterpartyByText(orgId, op.comment || '');
      if (matchedId) changes.counterparty_id = matchedId;
    }
    if (a.set_comment !== undefined && changes.comment === undefined) {
      changes.comment = a.set_comment;
    }
    if (Array.isArray(a.add_tag_ids)) {
      for (const t of a.add_tag_ids) tagsAdded.add(t);
    }

    if (rule.stop_on_match) break;
  }

  if (Object.keys(changes).length > 0) {
    const fields = Object.keys(changes).map((k) => `${k} = ?`).join(', ');
    const vals = Object.values(changes);
    vals.push(op.id, orgId);
    // The organization is named here too, not only where the operations were
    // selected: this is the statement that rewrites somebody's bookkeeping.
    await sql.run(
      `UPDATE fin_operations SET ${fields}, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?`,
      [...vals]);
  }

  if (tagsAdded.size > 0) {
    for (const t of tagsAdded) {
      await sql.run('INSERT INTO fin_operation_tags (operation_id, tag_id) VALUES (?, ?) ON CONFLICT DO NOTHING', [op.id, t]);
    }
  }

  if (rulesFired.length > 0) {
    for (const rid of rulesFired) {
      // Skip synthetic rules that don't exist in fin_auto_rules table
      if (rid.startsWith('synthetic_')) continue;
      await sql.run('INSERT INTO fin_auto_rule_matches (rule_id, operation_id) VALUES (?, ?)', [rid, op.id]);
    }
  }

  return { operationId: op.id, changes, rulesFired, tagsAdded: [...tagsAdded], skipped };
}

export async function loadActiveRules(orgId: string): Promise<ParsedRule[]> {
  const sql = getSql();
  const rows = await sql.rows<any>(`
    SELECT * FROM fin_auto_rules
    WHERE organization_id = ? AND is_active = TRUE
    ORDER BY sort_order ASC, created_at ASC
  `, [orgId]) as AutoRuleRow[];
  return rows.map(parseRule);
}
