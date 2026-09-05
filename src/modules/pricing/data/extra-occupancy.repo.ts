/* eslint-disable @typescript-eslint/no-explicit-any */
import crypto from 'node:crypto';
import { getSql, type Sql } from '@core/db/async';
import { currentOrganizationId } from '@core/auth/tenant-context';
import { money } from '@core/money';
import { noteRatesChanged } from '@channels/outbox';
import {
  GUEST_KINDS, SURCHARGE_MODES, ruleConflict, bandsFrom,
  type OccupancyRule, type GuestKind, type SurchargeMode,
} from '../domain/extra-occupancy';

/**
 * Надбавки за заселеність — писач і читач (Блок 2 крок 3, Ц30).
 *
 *   node src/modules/pricing/data/extra-occupancy.repo.check.ts
 *
 * Правило міняє ціну ночі для кожної заселеності понад базу — тобто число,
 * яке їде в канал опціями заселеності. Тому запис іде через двері
 * `@channels/outbox` (Ц16): координата на пари тарифу (або всі пари обʼєкта,
 * коли тариф не названо) від сьогодні до горизонту з маскою «ціна».
 *
 * Строгість — як у писачів ціни (інваріант 29): обʼєкт, тариф і тип — лише
 * свого орендаря (чуже — `not found`, інваріант 5); словники закриті; два
 * правила на одну клітинку — `rule_conflict`; відсоток і сума — невідʼємні
 * числа (нуль — «безкоштовно», названий готелем); вилка — лише в межах вилок
 * організації і лише для дитини.
 */

export interface RuleInput {
  ratePlanId?: string | null;
  unitTypeId?: string | null;
  guestKind: GuestKind;
  ageBandIndex?: number | null;
  lodgingMode?: SurchargeMode | null;
  lodgingValue?: number | null;
  mealMode?: SurchargeMode | null;
  mealValue?: number | null;
  extraBed?: boolean;
}

function requireOrganizationId(): string {
  const organizationId = currentOrganizationId();
  if (!organizationId) throw new Error('extra occupancy: without a tenant');
  return organizationId;
}

function toRule(row: any): OccupancyRule {
  return {
    id: String(row.id),
    ratePlanId: row.rate_plan_id == null ? null : String(row.rate_plan_id),
    unitTypeId: row.unit_type_id == null ? null : String(row.unit_type_id),
    guestKind: row.guest_kind,
    ageBandIndex: row.age_band_index == null ? null : Number(row.age_band_index),
    lodgingMode: row.lodging_mode ?? null,
    lodgingValue: row.lodging_value == null ? null : Number(row.lodging_value),
    mealMode: row.meal_mode ?? null,
    mealValue: row.meal_value == null ? null : Number(row.meal_value),
    extraBed: Boolean(Number(row.extra_bed ?? 0)),
  };
}

/**
 * Правила обʼєкта — для котирування. Без орендаря на сесії (публічний шлях
 * віджета) орендар береться з обʼєкта: правила ключовані `property_id`, і
 * `organization_id` звіряється з рядком обʼєкта, а не з сесією.
 */
export async function rulesForProperty(propertyId: string, organizationId: string): Promise<OccupancyRule[]> {
  const rows = await getSql().rows<any>(
    'SELECT * FROM extra_occupancy_rules WHERE property_id = ? AND organization_id = ? ORDER BY guest_kind, rate_plan_id, unit_type_id, age_band_index',
    [propertyId, organizationId],
  );
  return rows.map(toRule);
}

/** Вилки організації — з `organizations.child_age_bands`. */
export async function ageBandsOf(organizationId: string): Promise<{ from: number; to: number }[]> {
  const row = await getSql().row<any>('SELECT child_age_bands FROM organizations WHERE id = ?', [organizationId]);
  return bandsFrom(parseBands(row?.child_age_bands));
}

export function parseBands(raw: unknown): number[] {
  if (Array.isArray(raw)) return raw.map(Number);
  try {
    const parsed = JSON.parse(String(raw ?? '[]'));
    return Array.isArray(parsed) ? parsed.map(Number) : [];
  } catch {
    return [];
  }
}

async function ownedProperty(t: Sql, propertyId: string): Promise<{ id: string; organizationId: string }> {
  const organizationId = requireOrganizationId();
  const row = await t.row<any>('SELECT id FROM properties WHERE id = ? AND organization_id = ?', [propertyId, organizationId]);
  if (!row) throw new Error('property_not_found');
  return { id: String(row.id), organizationId };
}

async function ownedRuleRow(t: Sql, id: string): Promise<any> {
  const row = await t.row<any>('SELECT * FROM extra_occupancy_rules WHERE id = ? AND organization_id = ?', [id, requireOrganizationId()]);
  if (!row) throw new Error('rule_not_found');
  return row;
}

function mode(value: unknown): SurchargeMode | null {
  if (value == null || value === '') return null;
  if (!SURCHARGE_MODES.includes(value as SurchargeMode)) throw new Error('rule_invalid');
  return value as SurchargeMode;
}

function amount(value: unknown, m: SurchargeMode | null): number | null {
  if (m == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error('rule_invalid');
  return money(n);
}

/** Перевірене правило у вигляді колонок. */
async function normalize(t: Sql, propertyId: string, organizationId: string, input: RuleInput): Promise<Omit<OccupancyRule, 'id'>> {
  if (!GUEST_KINDS.includes(input.guestKind)) throw new Error('rule_invalid');
  const ratePlanId = input.ratePlanId ? String(input.ratePlanId) : null;
  const unitTypeId = input.unitTypeId ? String(input.unitTypeId) : null;
  if (ratePlanId) {
    const rp = await t.row<any>('SELECT id FROM rate_plans WHERE id = ? AND property_id = ?', [ratePlanId, propertyId]);
    if (!rp) throw new Error('rate_plan_not_found');
  }
  if (unitTypeId) {
    const ut = await t.row<any>('SELECT id FROM unit_types WHERE id = ? AND property_id = ?', [unitTypeId, propertyId]);
    if (!ut) throw new Error('unit_type_not_found');
  }
  let ageBandIndex: number | null = null;
  if (input.guestKind === 'child' && input.ageBandIndex != null && input.ageBandIndex !== ('' as unknown)) {
    const bands = await ageBandsOf(organizationId);
    const i = Number(input.ageBandIndex);
    if (!Number.isInteger(i) || i < 0 || i >= bands.length) throw new Error('rule_invalid');
    ageBandIndex = i;
  }
  const lodgingMode = mode(input.lodgingMode);
  const mealMode = mode(input.mealMode);
  if (lodgingMode == null && mealMode == null) throw new Error('rule_invalid');
  return {
    ratePlanId, unitTypeId, guestKind: input.guestKind, ageBandIndex,
    lodgingMode, lodgingValue: amount(input.lodgingValue, lodgingMode),
    mealMode, mealValue: amount(input.mealValue, mealMode),
    extraBed: Boolean(input.extraBed),
  };
}

const todayIso = () => new Date().toISOString().slice(0, 10);

/** Канал: ціни опцій заселеності змінились — координата на пари тарифу (або всі) до горизонту (Ц16). */
async function tellChannels(t: Sql, propertyId: string, ratePlanId: string | null, unitTypeId: string | null): Promise<void> {
  await noteRatesChanged(t, {
    propertyId, ratePlanId: ratePlanId ?? undefined, unitTypeId: unitTypeId ?? undefined,
    from: todayIso(), to: null, fields: ['prices'],
  });
}

export async function listRules(propertyId: string): Promise<OccupancyRule[]> {
  const sql = getSql();
  const property = await ownedProperty(sql, propertyId);
  return rulesForProperty(property.id, property.organizationId);
}

export async function createRule(propertyId: string, input: RuleInput): Promise<OccupancyRule> {
  return getSql().tx(async (t) => {
    const property = await ownedProperty(t, propertyId);
    const rule = await normalize(t, property.id, property.organizationId, input);
    const id = `eor_${crypto.randomBytes(8).toString('hex')}`;
    const existing = await rulesForProperty(property.id, property.organizationId);
    const clash = ruleConflict(existing, { id, ...rule });
    if (clash) throw new Error('rule_conflict');
    await t.run(
      `INSERT INTO extra_occupancy_rules (id, organization_id, property_id, rate_plan_id, unit_type_id, guest_kind, age_band_index,
                                          lodging_mode, lodging_value, meal_mode, meal_value, extra_bed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${rule.extraBed ? 'TRUE' : 'FALSE'})`,
      [id, property.organizationId, property.id, rule.ratePlanId, rule.unitTypeId, rule.guestKind, rule.ageBandIndex,
        rule.lodgingMode, rule.lodgingValue, rule.mealMode, rule.mealValue],
    );
    await tellChannels(t, property.id, rule.ratePlanId, rule.unitTypeId);
    return { id, ...rule };
  });
}

export async function updateRule(id: string, input: RuleInput): Promise<OccupancyRule> {
  return getSql().tx(async (t) => {
    const before = await ownedRuleRow(t, id);
    const propertyId = String(before.property_id);
    const organizationId = String(before.organization_id);
    const rule = await normalize(t, propertyId, organizationId, input);
    const existing = await rulesForProperty(propertyId, organizationId);
    if (ruleConflict(existing, { id, ...rule }, id)) throw new Error('rule_conflict');
    await t.run(
      `UPDATE extra_occupancy_rules SET rate_plan_id = ?, unit_type_id = ?, guest_kind = ?, age_band_index = ?,
              lodging_mode = ?, lodging_value = ?, meal_mode = ?, meal_value = ?, extra_bed = ${rule.extraBed ? 'TRUE' : 'FALSE'},
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND organization_id = ?`,
      [rule.ratePlanId, rule.unitTypeId, rule.guestKind, rule.ageBandIndex, rule.lodgingMode, rule.lodgingValue, rule.mealMode, rule.mealValue, id, organizationId],
    );
    // Старе й нове місце правила — обидва почули: клітинка могла переїхати.
    await tellChannels(t, propertyId, before.rate_plan_id ?? null, before.unit_type_id ?? null);
    await tellChannels(t, propertyId, rule.ratePlanId, rule.unitTypeId);
    return { id, ...rule };
  });
}

export async function deleteRule(id: string): Promise<void> {
  await getSql().tx(async (t) => {
    const before = await ownedRuleRow(t, id);
    await t.run('DELETE FROM extra_occupancy_rules WHERE id = ? AND organization_id = ?', [id, String(before.organization_id)]);
    await tellChannels(t, String(before.property_id), before.rate_plan_id ?? null, before.unit_type_id ?? null);
  });
}

/** Вікові вилки організації — межі, як їх ставить готель у загальних налаштуваннях. */
export function normalizeBoundaries(raw: unknown): number[] {
  const list = Array.isArray(raw) ? raw : String(raw ?? '').split(/[,\s;]+/).filter(Boolean);
  const out = [...new Set(list.map((v) => Math.trunc(Number(v))))];
  if (out.some((n) => !Number.isFinite(n) || n < 1 || n > 17)) throw new Error('age_bands_invalid');
  return out.sort((a, b) => a - b);
}
