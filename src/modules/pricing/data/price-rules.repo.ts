/* eslint-disable @typescript-eslint/no-explicit-any */
import crypto from 'node:crypto';
import { getSql, type Sql } from '@core/db/async';
import { currentOrganizationId } from '@core/auth/tenant-context';
import { money } from '@core/money';
import { noteRatesChanged } from '@channels/outbox';
import {
  RULE_KINDS, RULE_CONDITIONS, RULE_ACTIONS, RULE_VALUE_KINDS,
  type PriceRule, type RuleKind, type RuleCondition, type RuleAction, type RuleValueKind,
} from '../domain/price-rules';

/**
 * Правила цін і промо — писач і читач (Блок 2 крок 4, Ц31).
 *
 *   node src/modules/pricing/data/price-rules.repo.check.ts
 *
 * Правило міняє ціну ночі, яка їде в канал опціями заселеності, — тож запис
 * іде через двері `@channels/outbox` (Ц16): координата на пари названих
 * тарифів (або всі пари обʼєкта) від сьогодні до горизонту, маска «ціна».
 * Промо в канал не їде (код там нема кому назвати), і двері для нього не
 * кличуться.
 *
 * Строгість — як у писачів ціни (інваріант 29): обʼєкт, тарифи й типи — лише
 * свого орендаря; словники закриті; значення додатне (нуль — не правило);
 * відсоток зменшення < 100; межі узгоджені (from ≤ to); промо без коду або з
 * зайнятим кодом — відмова; звичайне правило коду не носить.
 */

export interface RuleInput {
  name: string;
  titleForGuest?: string | null;
  kind?: RuleKind;
  code?: string | null;
  conditionKind?: RuleCondition | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  weekDays?: readonly number[] | null;
  ratePlanIds?: readonly string[] | null;
  unitTypeIds?: readonly string[] | null;
  minLos?: number | null;
  maxLos?: number | null;
  bookedDaysBeforeFrom?: number | null;
  bookedDaysBeforeTo?: number | null;
  occupancyFrom?: number | null;
  occupancyTo?: number | null;
  action: RuleAction;
  value: number;
  valueKind: RuleValueKind;
  priority?: number | null;
  isActive?: boolean;
  onlineOnly?: boolean;
  maxUses?: number | null;
}

function requireOrganizationId(): string {
  const organizationId = currentOrganizationId();
  if (!organizationId) throw new Error('price rules: without a tenant');
  return organizationId;
}

function list<T>(raw: unknown): T[] | null {
  if (raw == null || raw === '') return null;
  if (Array.isArray(raw)) return raw as T[];
  try {
    const parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? (parsed as T[]) : null;
  } catch {
    return null;
  }
}

export function toRule(row: any): PriceRule {
  const intOrNull = (v: unknown) => (v == null ? null : Number(v));
  return {
    id: String(row.id),
    name: String(row.name),
    titleForGuest: row.title_for_guest == null ? null : String(row.title_for_guest),
    kind: row.kind === 'promo' ? 'promo' : 'rule',
    code: row.code == null ? null : String(row.code),
    conditionKind: row.condition_kind ?? null,
    dateFrom: row.date_from == null ? null : String(row.date_from).slice(0, 10),
    dateTo: row.date_to == null ? null : String(row.date_to).slice(0, 10),
    weekDays: list<number>(row.week_days)?.map(Number) ?? null,
    ratePlanIds: list<string>(row.rate_plan_ids)?.map(String) ?? null,
    unitTypeIds: list<string>(row.unit_type_ids)?.map(String) ?? null,
    minLos: intOrNull(row.min_los),
    maxLos: intOrNull(row.max_los),
    bookedDaysBeforeFrom: intOrNull(row.booked_days_before_from),
    bookedDaysBeforeTo: intOrNull(row.booked_days_before_to),
    occupancyFrom: intOrNull(row.occupancy_from),
    occupancyTo: intOrNull(row.occupancy_to),
    action: row.action,
    value: Number(row.value),
    valueKind: row.value_kind,
    priority: Number(row.priority ?? 100),
    isActive: Boolean(Number(row.is_active ?? 1)),
    onlineOnly: Boolean(Number(row.online_only ?? 0)),
    maxUses: intOrNull(row.max_uses),
    currentUses: Number(row.current_uses ?? 0),
  };
}

/**
 * Правила обʼєкта — для котирування. Без орендаря на сесії (публічний шлях
 * віджета, канал) орендар береться з обʼєкта — як у надбавках.
 */
export async function rulesForProperty(propertyId: string, organizationId: string): Promise<PriceRule[]> {
  const rows = await getSql().rows<any>(
    'SELECT * FROM price_rules WHERE property_id = ? AND organization_id = ? ORDER BY priority, name',
    [propertyId, organizationId],
  );
  return rows.map(toRule);
}

async function ownedProperty(t: Sql, propertyId: string): Promise<{ id: string; organizationId: string }> {
  const organizationId = requireOrganizationId();
  const row = await t.row<any>('SELECT id FROM properties WHERE id = ? AND organization_id = ?', [propertyId, organizationId]);
  if (!row) throw new Error('property_not_found');
  return { id: String(row.id), organizationId };
}

async function ownedRuleRow(t: Sql, id: string): Promise<any> {
  const row = await t.row<any>('SELECT * FROM price_rules WHERE id = ? AND organization_id = ?', [id, requireOrganizationId()]);
  if (!row) throw new Error('rule_not_found');
  return row;
}

const intOrNull = (v: unknown, min = 0): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min) throw new Error('rule_invalid');
  return n;
};

const orderedOrThrow = (from: number | null, to: number | null) => {
  if (from != null && to != null && from > to) throw new Error('rule_invalid');
};

/** Перевірене правило у вигляді колонок (без id, лічильника і дат створення). */
async function normalize(t: Sql, propertyId: string, organizationId: string, input: RuleInput): Promise<Omit<PriceRule, 'id' | 'currentUses'>> {
  const name = String(input.name ?? '').trim();
  if (!name) throw new Error('rule_name_required');
  const kind: RuleKind = input.kind ?? 'rule';
  if (!RULE_KINDS.includes(kind)) throw new Error('rule_invalid');
  if (!RULE_ACTIONS.includes(input.action)) throw new Error('rule_invalid');
  if (!RULE_VALUE_KINDS.includes(input.valueKind)) throw new Error('rule_invalid');
  const value = Number(input.value);
  if (!Number.isFinite(value) || value <= 0) throw new Error('rule_value_invalid');
  if (input.valueKind === 'percent' && input.action === 'decrease' && value >= 100) throw new Error('rule_value_invalid');
  const conditionKind = input.conditionKind ? input.conditionKind : null;
  if (conditionKind != null && !RULE_CONDITIONS.includes(conditionKind)) throw new Error('rule_invalid');
  const dateFrom = input.dateFrom ? String(input.dateFrom).slice(0, 10) : null;
  const dateTo = input.dateTo ? String(input.dateTo).slice(0, 10) : null;
  for (const d of [dateFrom, dateTo]) if (d != null && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error('rule_invalid');
  if (dateFrom && dateTo && dateFrom > dateTo) throw new Error('rule_invalid');
  const weekDays = input.weekDays && input.weekDays.length ? [...new Set(input.weekDays.map(Number))].sort((a, b) => a - b) : null;
  if (weekDays && weekDays.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) throw new Error('rule_invalid');

  // Тарифи й типи — лише цього обʼєкта (інваріант 5: чуже не існує).
  const ratePlanIds = input.ratePlanIds && input.ratePlanIds.length ? [...new Set(input.ratePlanIds.map(String))] : null;
  if (ratePlanIds) {
    for (const id of ratePlanIds) {
      const rp = await t.row<any>('SELECT id FROM rate_plans WHERE id = ? AND property_id = ?', [id, propertyId]);
      if (!rp) throw new Error('rate_plan_not_found');
    }
  }
  const unitTypeIds = input.unitTypeIds && input.unitTypeIds.length ? [...new Set(input.unitTypeIds.map(String))] : null;
  if (unitTypeIds) {
    for (const id of unitTypeIds) {
      const ut = await t.row<any>('SELECT id FROM unit_types WHERE id = ? AND property_id = ?', [id, propertyId]);
      if (!ut) throw new Error('unit_type_not_found');
    }
  }

  const minLos = intOrNull(input.minLos, 1);
  const maxLos = intOrNull(input.maxLos, 1);
  orderedOrThrow(minLos, maxLos);
  const bookedDaysBeforeFrom = intOrNull(input.bookedDaysBeforeFrom);
  const bookedDaysBeforeTo = intOrNull(input.bookedDaysBeforeTo);
  orderedOrThrow(bookedDaysBeforeFrom, bookedDaysBeforeTo);
  const occupancyFrom = intOrNull(input.occupancyFrom, 1);
  const occupancyTo = intOrNull(input.occupancyTo, 1);
  orderedOrThrow(occupancyFrom, occupancyTo);
  const priority = input.priority == null || input.priority === ('' as unknown) ? 100 : Number(input.priority);
  if (!Number.isInteger(priority)) throw new Error('rule_invalid');

  // Промо — з кодом; звичайне правило — без. Код без пробілів, у верхньому регістрі.
  let code: string | null = null;
  let maxUses: number | null = null;
  if (kind === 'promo') {
    code = String(input.code ?? '').trim().toUpperCase();
    if (!code || /\s/.test(code)) throw new Error('promo_code_required');
    maxUses = intOrNull(input.maxUses, 1);
  }
  void organizationId;

  return {
    name, titleForGuest: input.titleForGuest ? String(input.titleForGuest).trim() || null : null,
    kind, code, conditionKind, dateFrom, dateTo, weekDays, ratePlanIds, unitTypeIds,
    minLos, maxLos, bookedDaysBeforeFrom, bookedDaysBeforeTo, occupancyFrom, occupancyTo,
    action: input.action, value: money(value), valueKind: input.valueKind, priority,
    isActive: input.isActive ?? true, onlineOnly: kind === 'promo' ? Boolean(input.onlineOnly) : false, maxUses,
  };
}

/** Промокод зайнятий іншим правилом цієї організації (без регістру). */
async function codeTaken(t: Sql, organizationId: string, code: string, exceptId: string | null): Promise<boolean> {
  const row = await t.row<any>(
    'SELECT id FROM price_rules WHERE organization_id = ? AND lower(code) = lower(?)' + (exceptId ? ' AND id <> ?' : ''),
    exceptId ? [organizationId, code, exceptId] : [organizationId, code],
  );
  return Boolean(row);
}

const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * Канал: ціна пар названих тарифів (або всіх) змінилась — координата від
 * сьогодні до горизонту маскою «ціна» (Ц16). Промо в канал не їде.
 */
async function tellChannels(t: Sql, propertyId: string, rule: Pick<PriceRule, 'kind' | 'ratePlanIds' | 'unitTypeIds'>): Promise<void> {
  if (rule.kind === 'promo') return;
  const plans = rule.ratePlanIds && rule.ratePlanIds.length ? rule.ratePlanIds : [undefined];
  const types = rule.unitTypeIds && rule.unitTypeIds.length ? rule.unitTypeIds : [undefined];
  for (const ratePlanId of plans) {
    for (const unitTypeId of types) {
      await noteRatesChanged(t, { propertyId, ratePlanId, unitTypeId, from: todayIso(), to: null, fields: ['prices'] });
    }
  }
}

const COLS = `name, title_for_guest, kind, code, condition_kind, date_from, date_to, week_days, rate_plan_ids, unit_type_ids,
              min_los, max_los, booked_days_before_from, booked_days_before_to, occupancy_from, occupancy_to,
              action, value, value_kind, priority, max_uses`;

function values(r: Omit<PriceRule, 'id' | 'currentUses'>): unknown[] {
  return [
    r.name, r.titleForGuest, r.kind, r.code, r.conditionKind, r.dateFrom, r.dateTo,
    r.weekDays ? JSON.stringify(r.weekDays) : null, r.ratePlanIds ? JSON.stringify(r.ratePlanIds) : null, r.unitTypeIds ? JSON.stringify(r.unitTypeIds) : null,
    r.minLos, r.maxLos, r.bookedDaysBeforeFrom, r.bookedDaysBeforeTo, r.occupancyFrom, r.occupancyTo,
    r.action, r.value, r.valueKind, r.priority, r.maxUses,
  ];
}

export async function listRules(propertyId: string): Promise<PriceRule[]> {
  const sql = getSql();
  const property = await ownedProperty(sql, propertyId);
  return rulesForProperty(property.id, property.organizationId);
}

export async function createRule(propertyId: string, input: RuleInput): Promise<PriceRule> {
  return getSql().tx(async (t) => {
    const property = await ownedProperty(t, propertyId);
    const rule = await normalize(t, property.id, property.organizationId, input);
    if (rule.code && await codeTaken(t, property.organizationId, rule.code, null)) throw new Error('promo_code_taken');
    const id = `pr_${crypto.randomBytes(8).toString('hex')}`;
    await t.run(
      `INSERT INTO price_rules (id, organization_id, property_id, ${COLS}, is_active, online_only)
       VALUES (?, ?, ?, ${new Array(21).fill('?').join(', ')}, ${rule.isActive ? 'TRUE' : 'FALSE'}, ${rule.onlineOnly ? 'TRUE' : 'FALSE'})`,
      [id, property.organizationId, property.id, ...values(rule)],
    );
    await tellChannels(t, property.id, rule);
    return { id, currentUses: 0, ...rule };
  });
}

export async function updateRule(id: string, input: RuleInput): Promise<PriceRule> {
  return getSql().tx(async (t) => {
    const before = await ownedRuleRow(t, id);
    const propertyId = String(before.property_id);
    const organizationId = String(before.organization_id);
    const rule = await normalize(t, propertyId, organizationId, input);
    if (rule.code && await codeTaken(t, organizationId, rule.code, id)) throw new Error('promo_code_taken');
    const sets = COLS.split(',').map((c) => `${c.trim()} = ?`).join(', ');
    await t.run(
      `UPDATE price_rules SET ${sets}, is_active = ${rule.isActive ? 'TRUE' : 'FALSE'}, online_only = ${rule.onlineOnly ? 'TRUE' : 'FALSE'}, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND organization_id = ?`,
      [...values(rule), id, organizationId],
    );
    // Канал чує і старе місце правила, і нове: межі могли переїхати.
    await tellChannels(t, propertyId, toRule(before));
    await tellChannels(t, propertyId, rule);
    return { id, currentUses: Number(before.current_uses ?? 0), ...rule };
  });
}

export async function deleteRule(id: string): Promise<void> {
  await getSql().tx(async (t) => {
    const before = await ownedRuleRow(t, id);
    await t.run('DELETE FROM price_rules WHERE id = ? AND organization_id = ?', [id, String(before.organization_id)]);
    await tellChannels(t, String(before.property_id), toRule(before));
  });
}

/**
 * Промокод використано ще раз — після того, як бронь СТВОРЕНА. Лічильник
 * росте лише в межах ліміту: два гості з останнім використанням одночасно —
 * другий отримує `false`, і бронь має або відмовити, або порахуватись без коду.
 * Орендар — з обʼєкта: шлях віджета сесії не має.
 */
export async function redeemPromoCode(propertyId: string, organizationId: string, code: string): Promise<boolean> {
  const changed = await getSql().run(
    `UPDATE price_rules SET current_uses = current_uses + 1, updated_at = CURRENT_TIMESTAMP
      WHERE property_id = ? AND organization_id = ? AND kind = 'promo' AND lower(code) = lower(?) AND is_active = TRUE
        AND (max_uses IS NULL OR current_uses < max_uses)`,
    [propertyId, organizationId, code.trim()],
  );
  return Number(changed.changes) > 0;
}
