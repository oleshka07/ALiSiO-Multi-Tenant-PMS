import crypto from 'node:crypto';
import { getSql, type Sql } from '@core/db/async';
import { currentOrganizationId } from '@core/auth/tenant-context';
import { money } from '@core/money';
import { noteRatesChanged } from '@channels/outbox';
import {
  SELL_MODES, ADJUSTMENT_KINDS, ADJUSTMENT_DIRECTIONS,
  type SellMode, type PricingType, type AdjustmentKind, type AdjustmentDirection, type RateAdjustment,
} from '../domain/types';
import { renderDerivedPlan } from './price-calendar.repo';

/**
 * Тарифи обʼєкта — створити, змінити, перелічити. Екран «Тарифи».
 *
 *   node src/modules/pricing/data/rate-plans.repo.check.ts
 *
 * Форма — звичайна акуратність (інваріант 29). Писач — ні: з тарифу береться
 * валюта обʼєкта у вендора (`channels/data/catalog-sync.ts`), а пара «тип ×
 * тариф» — адреса ціни в каналі (Ц10). Тому:
 *
 *   - обʼєкт лише свого орендаря; чужий — «not found» (інваріант 5);
 *   - код унікальний у межах обʼєкта (`UNIQUE(property_id, code)`), і
 *     відмова названа, а не 500 з бази;
 *   - валюта замкнена, щойно під тарифом є ціна: у вендора тариф заведено з
 *     валютою, і тиха зміна тут дала б ціни в іншій валюті на тому боці без
 *     жодної помилки.
 *
 * Ціни на дати тут НЕ ставляться — це календар (П2 карти сертифікації).
 * Тариф без ціни існує, показується, але не продається (інваріант 17) —
 * `propertyRatePlans()` віддає його з `sellable: false`.
 *
 * ── Зняти з продажу (Блок 2.1) ──────────────────────────────────────────
 *
 * Заведений у вендора тариф видалити не можна (`mapped`): дзеркало без
 * оригіналу — це ціна, яку батчер не порахує і не закриє. Тому тариф, який
 * готель більше не продає, ЗНІМАЄТЬСЯ з продажу (`is_active = FALSE`), і це
 * означає рівно три речі, разом і в одній транзакції:
 *
 *   - ціни в нього більше не існує ні для кого — `priceNights()` віддає
 *     кожну ніч як `missing` з `ratePlanRetired` (інваріант 17), навіть
 *     якщо рядки в календарі лежать; вони лишаються на випадок повернення;
 *   - `propertyRatePlans()` його не віддає — у каталог він більше не йде;
 *   - у чергу лягає координата на КОЖНУ його пару з дзеркала до горизонту
 *     (`noteRatesChanged`): батчер не знайде джерела ціни і закриє ночі
 *     (И14 — «закрито» треба сказати явно, інакше канал продає далі за
 *     останньою ціною, і помилки немає ніде).
 *
 * Повернення (`is_active = TRUE`) — та сама дорога: координати до горизонту,
 * ціни з календаря знову їдуть. Дзеркало не чіпається в обидва боки.
 *
 * ── Режим ціни (Блок 2.2, Ц26) ──────────────────────────────────────────
 *
 * `sell_mode` обирає готель при створенні: «за номер» (`per_room`) чи «за
 * особу» (`per_person`); без вибору — за особу, як заводились усі тарифи
 * досі. Режим задає набір опцій заселеності у вендора, а набір опцій після
 * створення не переробити (виміряно: PUT з options — нуль змін або 422), тож
 * заведений тариф (є в дзеркалі) режиму не міняє — `sell_mode_locked`.
 * Незаведений міняє вільно.
 */

export interface RatePlanSetting {
  id: string;
  propertyId: string;
  name: string;
  code: string;
  currency: string;
  mealPlan: string | null;
  /**
   * Умови скасування — дослівний текст готелю, як він стоїть у довіднику.
   * Читається; цей довідник його не редагує і не переказує своїми словами:
   * вигадане «безкоштовне скасування» на картці бронювання це обіцянка,
   * якої готель не давав.
   */
  cancellationPolicy: string | null;
  isActive: boolean;
  /** Як рахує гостей: за номер чи за особу (Ц26). Замкнений після заведення у вендора. */
  sellMode: SellMode;
  /** Заведений у менеджері каналів (є в дзеркалі): не видаляється, режим не міняє. */
  mapped: boolean;
  /** Коди типів номерів, під якими тариф має хоч одну ціну на дату. Порожньо — не продається. */
  pricedUnitTypes: string[];
  /** Не показувати на сайті й у віджеті; у канал такий тариф теж не йде. */
  isHidden: boolean;
  /** `manual` — свої ціни; `derived` — ціни рахуються від бази і рендеряться в календар (Ц28). */
  pricingType: PricingType;
  basedOnRatePlanId: string | null;
  /** Правило похідного; `null` для звичайного тарифу. */
  adjustment: RateAdjustment | null;
}

/** Похідний тариф — база й коригування (Ц28). Без цих полів — звичайний тариф. */
export interface DerivedInput {
  pricingType?: PricingType | null;
  basedOnRatePlanId?: string | null;
  adjustmentKind?: AdjustmentKind | null;
  adjustmentValue?: number | null;
  adjustmentDirection?: AdjustmentDirection | null;
}

export interface CreateRatePlanInput extends DerivedInput {
  propertyId: string;
  name: string;
  code: string;
  currency: string;
  mealPlan: string | null;
  /** Порожньо — `per_person`. */
  sellMode?: SellMode | null;
  isHidden?: boolean;
}

export interface UpdateRatePlanInput extends DerivedInput {
  name?: string;
  code?: string;
  currency?: string;
  mealPlan?: string | null;
  /** `false` — зняти з продажу, `true` — повернути. Див. шапку. */
  isActive?: boolean;
  /** Лише доки тариф не заведено у вендора — інакше `sell_mode_locked`. */
  sellMode?: SellMode;
  isHidden?: boolean;
}

/** Похідний тариф у вигляді колонок — після перевірки. */
interface DerivedColumns {
  pricing_type: PricingType;
  based_on_rate_plan_id: string | null;
  adjustment_kind: AdjustmentKind | null;
  adjustment_value: number | null;
  adjustment_direction: AdjustmentDirection | null;
}

const MANUAL: DerivedColumns = { pricing_type: 'manual', based_on_rate_plan_id: null, adjustment_kind: null, adjustment_value: null, adjustment_direction: null };

/**
 * Правило похідного тарифу — перевірене (Ц28): база названа, свого обʼєкта,
 * сама не похідна і не цей тариф (`based_on_required` / `based_on_invalid`);
 * коригування — відомий вид і напрям, додатне число, а відсоток зменшення
 * менший за сотню (`adjustment_invalid`): «мінус сто відсотків» — це не
 * тариф, а ніч без ціни на кожну дату.
 */
async function normalizeDerived(t: Sql, propertyId: string, input: DerivedInput, selfId: string | null): Promise<DerivedColumns> {
  if ((input.pricingType ?? 'manual') !== 'derived') return MANUAL;
  const basedOn = input.basedOnRatePlanId ? String(input.basedOnRatePlanId) : '';
  if (!basedOn) throw new Error('based_on_required');
  if (selfId && basedOn === selfId) throw new Error('based_on_invalid');
  const base = await t.row<any>('SELECT id, pricing_type FROM rate_plans WHERE id = ? AND property_id = ?', [basedOn, propertyId]);
  if (!base || String(base.pricing_type ?? 'manual') === 'derived') throw new Error('based_on_invalid');
  const kind = input.adjustmentKind as AdjustmentKind;
  const direction = input.adjustmentDirection as AdjustmentDirection;
  const value = Number(input.adjustmentValue);
  if (!ADJUSTMENT_KINDS.includes(kind) || !ADJUSTMENT_DIRECTIONS.includes(direction)) throw new Error('adjustment_invalid');
  if (!Number.isFinite(value) || value <= 0) throw new Error('adjustment_invalid');
  if (kind === 'percent' && direction === 'decrease' && value >= 100) throw new Error('adjustment_invalid');
  return { pricing_type: 'derived', based_on_rate_plan_id: basedOn, adjustment_kind: kind, adjustment_value: money(value), adjustment_direction: direction };
}

const sameRule = (a: DerivedColumns, b: DerivedColumns): boolean =>
  a.pricing_type === b.pricing_type && a.based_on_rate_plan_id === b.based_on_rate_plan_id
  && a.adjustment_kind === b.adjustment_kind && a.adjustment_value === b.adjustment_value && a.adjustment_direction === b.adjustment_direction;

function ruleOf(row: Record<string, any>): DerivedColumns {
  if (String(row.pricing_type ?? 'manual') !== 'derived') return MANUAL;
  return {
    pricing_type: 'derived', based_on_rate_plan_id: row.based_on_rate_plan_id == null ? null : String(row.based_on_rate_plan_id),
    adjustment_kind: row.adjustment_kind ?? null, adjustment_value: row.adjustment_value == null ? null : Number(row.adjustment_value),
    adjustment_direction: row.adjustment_direction ?? null,
  };
}

const CODE = /^[A-Z0-9][A-Z0-9_-]{0,19}$/;
const CURRENCY = /^[A-Z]{3}$/;

function normalizeCode(code: string): string {
  const c = String(code ?? '').trim().toUpperCase();
  if (!CODE.test(c)) throw new Error('code_invalid');
  return c;
}
function normalizeCurrency(currency: string): string {
  const c = String(currency ?? '').trim().toUpperCase();
  if (!CURRENCY.test(c)) throw new Error('currency_invalid');
  return c;
}
function normalizeName(name: string): string {
  const n = String(name ?? '').trim();
  if (!n) throw new Error('name_required');
  return n;
}
function normalizeSellMode(value: unknown, fallback: SellMode): SellMode {
  if (value === null || value === undefined || value === '') return fallback;
  if (!SELL_MODES.includes(value as SellMode)) throw new Error('sell_mode_invalid');
  return value as SellMode;
}

/**
 * Режим із РЯДКА БАЗИ — на читанні не кидає (розділ A п.4, 05.09.2026).
 *
 * `toSetting` кидав `sell_mode_invalid`, і один рядок, записаний повз
 * писача, робив увесь список «Тарифи» помилкою 500. Невідоме читається як
 * `per_person` — дефолт, яким заводились усі тарифи, — з рядком у
 * серверному журналі; відмова лишається на ЗАПИСІ (`normalizeSellMode`), а
 * базу Postgres тримає CHECK (0067) — тож сюди таке потрапить хіба з SQLite.
 */
export function readSellMode(value: unknown, id: unknown): SellMode {
  if (value === null || value === undefined || value === '') return 'per_person';
  if (SELL_MODES.includes(value as SellMode)) return value as SellMode;
  console.error(`rate_plans.sell_mode: unknown value ${JSON.stringify(value)} on ${String(id)} — read as per_person`);
  return 'per_person';
}

function toSetting(row: Record<string, any>, priced: string[], mapped: boolean): RatePlanSetting {
  return {
    id: String(row.id),
    propertyId: String(row.property_id),
    name: String(row.name),
    code: String(row.code),
    currency: String(row.currency),
    mealPlan: row.meal_plan == null ? null : String(row.meal_plan),
    cancellationPolicy: row.cancellation_policy == null ? null : String(row.cancellation_policy),
    isActive: Boolean(Number(row.is_active)),
    sellMode: readSellMode(row.sell_mode, row.id),
    mapped,
    pricedUnitTypes: priced,
    isHidden: Boolean(Number(row.is_hidden ?? 0)),
    pricingType: String(row.pricing_type ?? 'manual') === 'derived' ? 'derived' : 'manual',
    basedOnRatePlanId: row.based_on_rate_plan_id == null ? null : String(row.based_on_rate_plan_id),
    adjustment: String(row.pricing_type ?? 'manual') === 'derived' && row.adjustment_kind && row.adjustment_direction
      ? { kind: row.adjustment_kind, value: Number(row.adjustment_value), direction: row.adjustment_direction }
      : null,
  };
}

/** Тарифи, заведені у вендора, — ті, що є в дзеркалі хоч на одному зʼєднанні. */
async function mappedOf(t: Sql, planIds: string[]): Promise<Set<string>> {
  if (planIds.length === 0) return new Set();
  const rows = await t.rows<any>(
    `SELECT DISTINCT local_id FROM cm_mappings
      WHERE entity_type = 'rate_plan' AND local_id IN (${planIds.map(() => '?').join(', ')})`,
    planIds,
  );
  return new Set(rows.map((r) => String(r.local_id)));
}

/** Обʼєкт свого орендаря, або «not found». */
async function ownedProperty(t: Sql, propertyId: string): Promise<{ id: string }> {
  const organizationId = currentOrganizationId();
  if (!organizationId) throw new Error('rate plans: write without a tenant');
  const row = await t.row<any>('SELECT id FROM properties WHERE id = ? AND organization_id = ?', [propertyId, organizationId]);
  if (!row) throw new Error('rate plans: property not found');
  return { id: String(row.id) };
}

/** Тариф свого орендаря — через обʼєкт, як усі читання тарифів. */
async function ownedPlan(t: Sql, id: string): Promise<Record<string, any>> {
  const organizationId = currentOrganizationId();
  if (!organizationId) throw new Error('rate plans: write without a tenant');
  const row = await t.row<any>(
    `SELECT rp.* FROM rate_plans rp JOIN properties p ON p.id = rp.property_id
      WHERE rp.id = ? AND p.organization_id = ?`,
    [id, organizationId],
  );
  if (!row) throw new Error('rate plans: rate plan not found');
  return row;
}

async function codeTaken(t: Sql, propertyId: string, code: string, exceptId: string | null): Promise<boolean> {
  const row = await t.row<any>(
    `SELECT id FROM rate_plans WHERE property_id = ? AND UPPER(code) = ? ${exceptId ? 'AND id <> ?' : ''}`,
    exceptId ? [propertyId, code, exceptId] : [propertyId, code],
  );
  return !!row;
}

/** Коди типів, під якими тариф має ціну на хоч одну дату. */
async function pricedUnitTypesOf(t: Sql, planIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (planIds.length === 0) return out;
  const rows = await t.rows<any>(
    `SELECT DISTINCT pc.rate_plan_id, ut.code
       FROM price_calendar pc JOIN unit_types ut ON ut.id = pc.unit_type_id
      WHERE pc.rate_plan_id IN (${planIds.map(() => '?').join(', ')})
      ORDER BY ut.code`,
    planIds,
  );
  for (const r of rows) (out.get(String(r.rate_plan_id)) ?? out.set(String(r.rate_plan_id), []).get(String(r.rate_plan_id))!).push(String(r.code));
  return out;
}

export async function listRatePlans(propertyId: string): Promise<RatePlanSetting[]> {
  const organizationId = currentOrganizationId();
  if (!organizationId) throw new Error('rate plans: read without a tenant');
  const sql = getSql();
  const rows = await sql.rows<any>(
    `SELECT rp.* FROM rate_plans rp JOIN properties p ON p.id = rp.property_id
      WHERE rp.property_id = ? AND p.organization_id = ?
      ORDER BY rp.priority, rp.code`,
    [propertyId, organizationId],
  );
  const ids = rows.map((r) => String(r.id));
  const priced = await pricedUnitTypesOf(sql, ids);
  const mapped = await mappedOf(sql, ids);
  return rows.map((r) => toSetting(r, priced.get(String(r.id)) ?? [], mapped.has(String(r.id))));
}

export async function createRatePlan(input: CreateRatePlanInput): Promise<RatePlanSetting> {
  const name = normalizeName(input.name);
  const code = normalizeCode(input.code);
  const currency = normalizeCurrency(input.currency);
  const meal = input.mealPlan ? String(input.mealPlan) : null;
  const sellMode = normalizeSellMode(input.sellMode, 'per_person');
  const id = `rp_${crypto.randomBytes(8).toString('hex')}`;

  const created = await getSql().tx(async (t) => {
    const property = await ownedProperty(t, input.propertyId);
    if (await codeTaken(t, property.id, code, null)) throw new Error('code_taken');
    const derived = await normalizeDerived(t, property.id, input, null);
    // Валюта похідного — валюта бази: його числа рахуються з її чисел.
    const finalCurrency = derived.based_on_rate_plan_id
      ? String((await t.row<any>('SELECT currency FROM rate_plans WHERE id = ?', [derived.based_on_rate_plan_id]))?.currency ?? currency)
      : currency;
    const next = await t.row<any>('SELECT COALESCE(MAX(priority), 0) + 1 AS n FROM rate_plans WHERE property_id = ?', [property.id]);
    await t.run(
      `INSERT INTO rate_plans (id, property_id, name, code, pricing_model, currency, meal_plan, sell_mode, priority, is_hidden,
                               pricing_type, based_on_rate_plan_id, adjustment_kind, adjustment_value, adjustment_direction)
       VALUES (?, ?, ?, ?, 'standard', ?, ?, ?, ?, ${input.isHidden ? 'TRUE' : 'FALSE'}, ?, ?, ?, ?, ?)`,
      [id, property.id, name, code, finalCurrency, meal, sellMode, Number(next?.n ?? 1),
        derived.pricing_type, derived.based_on_rate_plan_id, derived.adjustment_kind, derived.adjustment_value, derived.adjustment_direction],
    );
    // Ц16: новий тариф — нова пара в каналі. Пар ще немає (ціни немає), тож
    // двері напишуть нуль; але писач тарифів проходить через двері завжди —
    // щойно пара зʼявиться, зміни тарифу поїдуть.
    await noteRatesChanged(t, { propertyId: property.id, ratePlanId: id, from: todayIso(), to: null });
    const row = await t.row<any>('SELECT * FROM rate_plans WHERE id = ?', [id]);
    return toSetting(row, [], false);
  });
  // Похідний — одразу з цінами: рендер від сьогодні до горизонту (Ц28), поза
  // транзакцією тарифу — писач календаря має свої.
  if (created.pricingType === 'derived') await renderDerivedPlan(created.id);
  return created;
}

export async function updateRatePlan(id: string, patch: UpdateRatePlanInput): Promise<RatePlanSetting> {
  let rerender = false;
  const updated = await getSql().tx(async (t) => {
    const before = await ownedPlan(t, id);
    const sets: string[] = [];
    const values: unknown[] = [];

    // Правило похідного (Ц28) — лише коли патч його називає; інакше як було.
    if (patch.pricingType !== undefined || patch.basedOnRatePlanId !== undefined || patch.adjustmentKind !== undefined
      || patch.adjustmentValue !== undefined || patch.adjustmentDirection !== undefined) {
      const was = ruleOf(before);
      const merged: DerivedInput = {
        pricingType: patch.pricingType ?? was.pricing_type,
        basedOnRatePlanId: patch.basedOnRatePlanId !== undefined ? patch.basedOnRatePlanId : was.based_on_rate_plan_id,
        adjustmentKind: patch.adjustmentKind !== undefined ? patch.adjustmentKind : was.adjustment_kind,
        adjustmentValue: patch.adjustmentValue !== undefined ? patch.adjustmentValue : was.adjustment_value,
        adjustmentDirection: patch.adjustmentDirection !== undefined ? patch.adjustmentDirection : was.adjustment_direction,
      };
      const now = await normalizeDerived(t, String(before.property_id), merged, id);
      if (!sameRule(was, now)) {
        // Тариф, на який уже спираються похідні, сам похідним не стає.
        if (now.pricing_type === 'derived') {
          const dependents = await t.row<any>("SELECT id FROM rate_plans WHERE based_on_rate_plan_id = ? AND pricing_type = 'derived' LIMIT 1", [id]);
          if (dependents) throw new Error('has_dependents');
        }
        sets.push('pricing_type = ?', 'based_on_rate_plan_id = ?', 'adjustment_kind = ?', 'adjustment_value = ?', 'adjustment_direction = ?');
        values.push(now.pricing_type, now.based_on_rate_plan_id, now.adjustment_kind, now.adjustment_value, now.adjustment_direction);
        rerender = now.pricing_type === 'derived';
        // Похідний → звичайний: рядки лишаються цінами тарифу, але вже
        // рукою поставленими — далі їх нічого не перерендерює.
        if (was.pricing_type === 'derived' && now.pricing_type === 'manual') {
          await t.run("UPDATE price_calendar SET source = 'manual' WHERE rate_plan_id = ? AND source = 'derived'", [id]);
        }
      }
    }
    if (patch.isHidden !== undefined) sets.push(patch.isHidden ? 'is_hidden = TRUE' : 'is_hidden = FALSE');

    if (patch.name !== undefined) { sets.push('name = ?'); values.push(normalizeName(patch.name)); }
    if (patch.code !== undefined) {
      const code = normalizeCode(patch.code);
      if (code !== String(before.code) && await codeTaken(t, String(before.property_id), code, id)) throw new Error('code_taken');
      sets.push('code = ?'); values.push(code);
    }
    if (patch.currency !== undefined) {
      const currency = normalizeCurrency(patch.currency);
      if (currency !== String(before.currency)) {
        const priced = await pricedUnitTypesOf(t, [id]);
        if ((priced.get(id) ?? []).length > 0) throw new Error('currency_locked');
        sets.push('currency = ?'); values.push(currency);
      }
    }
    if (patch.mealPlan !== undefined) { sets.push('meal_plan = ?'); values.push(patch.mealPlan ? String(patch.mealPlan) : null); }
    // Літералом, не параметром: SQLite не привʼязує boolean, а `1` у колонку
    // BOOLEAN відхиляє Postgres (check-boolean-flags).
    if (patch.isActive !== undefined) {
      // Зняти БАЗУ з продажу, поки на неї спирається активний похідний, не
      // можна (рецензія 07.09 п.2): похідний продавав би від знятої бази, а
      // каскадне зняття — рішення, якого оператор не ухвалював. Спершу зняти
      // похідні — явно.
      if (!patch.isActive && Number(before.is_active)) {
        const activeDependent = await t.row<any>(
          "SELECT id FROM rate_plans WHERE based_on_rate_plan_id = ? AND pricing_type = 'derived' AND is_active = TRUE LIMIT 1", [id]);
        if (activeDependent) throw new Error('has_dependents');
      }
      sets.push(patch.isActive ? 'is_active = TRUE' : 'is_active = FALSE');
      // Повернутий у продаж похідний — перерендер: поки він був знятий, база
      // могла змінитись, а його рядки стояли (derivedPlansOf знятих не чіпає).
      if (patch.isActive && !Number(before.is_active) && String(before.pricing_type ?? 'manual') === 'derived') rerender = true;
    }
    const wasMapped = (await mappedOf(t, [id])).has(id);
    if (patch.sellMode !== undefined) {
      const mode = normalizeSellMode(patch.sellMode, readSellMode(before.sell_mode, before.id));
      if (mode !== readSellMode(before.sell_mode, before.id)) {
        // Набір опцій заселеності у вендора не переробити — режим замкнений.
        if (wasMapped) throw new Error('sell_mode_locked');
        sets.push('sell_mode = ?'); values.push(mode);
      }
    }

    if (sets.length) {
      sets.push('updated_at = ?'); values.push(new Date().toISOString());
      await t.run(`UPDATE rate_plans SET ${sets.join(', ')} WHERE id = ?`, [...values, id]);
      // Ц16: те, що змінилось у тарифі, канал має почути через його пари.
      // Для зняття з продажу це і є механізм «закрито до горизонту»: джерела
      // ціни для вимкненого тарифу немає, батчер розвʼяже кожну ніч у stop_sell.
      await noteRatesChanged(t, { propertyId: String(before.property_id), ratePlanId: id, from: todayIso(), to: null });
    }
    const row = await t.row<any>('SELECT * FROM rate_plans WHERE id = ?', [id]);
    const priced = await pricedUnitTypesOf(t, [id]);
    return toSetting(row, priced.get(id) ?? [], wasMapped);
  });
  if (rerender) await renderDerivedPlan(id);
  return updated;
}

/**
 * Прибрати тариф, на який ніхто не спирається.
 *
 * 02.09.2026: на беті тариф ліг не на той обʼєкт (селектор обʼєкта на
 * екрані «Тарифи» був без підпису, дефолт — перший за датою створення), а
 * прибрати його не було чим. Видаляється лише ЧИСТИЙ тариф — і кожна відмова
 * названа, бо мовчазне «не вийшло» тут — це тариф-привид, який канал далі
 * бачить продаваним:
 *
 *   `has_prices` — під ним є ціни (`price_calendar.rate_plan_id`);
 *   `mapped`     — його заведено у вендора (`cm_mappings`): дзеркало без
 *                  оригіналу — це ціна, яку батчер не зможе ні порахувати, ні
 *                  закрити;
 *   `in_use`     — на нього є бронювання.
 *
 * Координати черги (`cm_outbox`) цього тарифу йдуть разом із ним: інакше
 * батчер шукатиме тариф, якого немає, і кластиме рядок у «потребує уваги».
 */
export async function deleteRatePlan(id: string): Promise<void> {
  await getSql().tx(async (t) => {
    const plan = await ownedPlan(t, id);
    const derived = String(plan.pricing_type ?? 'manual') === 'derived';
    // На базу спираються похідні — вона не видаляється, поки вони є (Ц28).
    const dependent = await t.row<any>("SELECT id FROM rate_plans WHERE based_on_rate_plan_id = ? AND pricing_type = 'derived' LIMIT 1", [id]);
    if (dependent) throw new Error('has_dependents');
    // Рядки похідного — порахованi з бази, а не поставлені рукою: ідуть разом
    // із ним. Ціни звичайного тарифу — ні: їх спершу прибирають у календарі.
    const priced = await pricedUnitTypesOf(t, [id]);
    if (!derived && (priced.get(id) ?? []).length > 0) throw new Error('has_prices');
    const mapped = await t.row<any>(
      "SELECT id FROM cm_mappings WHERE entity_type = 'rate_plan' AND local_id = ? LIMIT 1", [id],
    );
    if (mapped) throw new Error('mapped');
    const booked = await t.row<any>('SELECT id FROM reservations WHERE rate_plan_id = ? LIMIT 1', [id]);
    if (booked) throw new Error('in_use');

    if (derived) await t.run('DELETE FROM price_calendar WHERE rate_plan_id = ?', [id]);
    await t.run('DELETE FROM cm_outbox WHERE rate_plan_id = ?', [id]);
    await t.run('DELETE FROM rate_plans WHERE id = ?', [id]);
  });
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
