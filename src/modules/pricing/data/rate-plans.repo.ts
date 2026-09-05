import crypto from 'node:crypto';
import { getSql, type Sql } from '@core/db/async';
import { currentOrganizationId } from '@core/auth/tenant-context';
import { money } from '@core/money';
import { noteRatesChanged } from '@channels/outbox';

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
 */

export interface RatePlanSetting {
  id: string;
  propertyId: string;
  name: string;
  code: string;
  currency: string;
  mealPlan: string | null;
  /** Ціна дитини за ніч на цьому тарифі (Ц12). `null` — готель не називав. */
  childExtraGross: number | null;
  isActive: boolean;
  /** Коди типів номерів, під якими тариф має хоч одну ціну на дату. Порожньо — не продається. */
  pricedUnitTypes: string[];
}

export interface CreateRatePlanInput {
  propertyId: string;
  name: string;
  code: string;
  currency: string;
  mealPlan: string | null;
  childExtraGross: number | null;
}

export interface UpdateRatePlanInput {
  name?: string;
  code?: string;
  currency?: string;
  mealPlan?: string | null;
  childExtraGross?: number | null;
  /** `false` — зняти з продажу, `true` — повернути. Див. шапку. */
  isActive?: boolean;
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
function normalizeChild(value: number | null | undefined): number | null {
  if (value === null || value === undefined || value === ('' as unknown)) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error('child_price_invalid');
  return money(n);
}

function toSetting(row: Record<string, any>, priced: string[]): RatePlanSetting {
  return {
    id: String(row.id),
    propertyId: String(row.property_id),
    name: String(row.name),
    code: String(row.code),
    currency: String(row.currency),
    mealPlan: row.meal_plan == null ? null : String(row.meal_plan),
    childExtraGross: row.child_extra_gross == null ? null : Number(row.child_extra_gross),
    isActive: Boolean(Number(row.is_active)),
    pricedUnitTypes: priced,
  };
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
  const priced = await pricedUnitTypesOf(sql, rows.map((r) => String(r.id)));
  return rows.map((r) => toSetting(r, priced.get(String(r.id)) ?? []));
}

export async function createRatePlan(input: CreateRatePlanInput): Promise<RatePlanSetting> {
  const name = normalizeName(input.name);
  const code = normalizeCode(input.code);
  const currency = normalizeCurrency(input.currency);
  const child = normalizeChild(input.childExtraGross);
  const meal = input.mealPlan ? String(input.mealPlan) : null;
  const id = `rp_${crypto.randomBytes(8).toString('hex')}`;

  return getSql().tx(async (t) => {
    const property = await ownedProperty(t, input.propertyId);
    if (await codeTaken(t, property.id, code, null)) throw new Error('code_taken');
    const next = await t.row<any>('SELECT COALESCE(MAX(priority), 0) + 1 AS n FROM rate_plans WHERE property_id = ?', [property.id]);
    await t.run(
      `INSERT INTO rate_plans (id, property_id, name, code, pricing_model, currency, meal_plan, child_extra_gross, priority)
       VALUES (?, ?, ?, ?, 'standard', ?, ?, ?, ?)`,
      [id, property.id, name, code, currency, meal, child, Number(next?.n ?? 1)],
    );
    // Ц16: новий тариф — нова пара в каналі. Пар ще немає (ціни немає), тож
    // двері напишуть нуль; але писач тарифів проходить через двері завжди —
    // щойно пара зʼявиться, зміни тарифу поїдуть.
    await noteRatesChanged(t, { propertyId: property.id, ratePlanId: id, from: todayIso(), to: null });
    const row = await t.row<any>('SELECT * FROM rate_plans WHERE id = ?', [id]);
    return toSetting(row, []);
  });
}

export async function updateRatePlan(id: string, patch: UpdateRatePlanInput): Promise<RatePlanSetting> {
  return getSql().tx(async (t) => {
    const before = await ownedPlan(t, id);
    const sets: string[] = [];
    const values: unknown[] = [];

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
    if (patch.childExtraGross !== undefined) { sets.push('child_extra_gross = ?'); values.push(normalizeChild(patch.childExtraGross)); }
    // Літералом, не параметром: SQLite не привʼязує boolean, а `1` у колонку
    // BOOLEAN відхиляє Postgres (check-boolean-flags).
    if (patch.isActive !== undefined) sets.push(patch.isActive ? 'is_active = TRUE' : 'is_active = FALSE');

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
    return toSetting(row, priced.get(id) ?? []);
  });
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
    await ownedPlan(t, id);
    const priced = await pricedUnitTypesOf(t, [id]);
    if ((priced.get(id) ?? []).length > 0) throw new Error('has_prices');
    const mapped = await t.row<any>(
      "SELECT id FROM cm_mappings WHERE entity_type = 'rate_plan' AND local_id = ? LIMIT 1", [id],
    );
    if (mapped) throw new Error('mapped');
    const booked = await t.row<any>('SELECT id FROM reservations WHERE rate_plan_id = ? LIMIT 1', [id]);
    if (booked) throw new Error('in_use');

    await t.run('DELETE FROM cm_outbox WHERE rate_plan_id = ?', [id]);
    await t.run('DELETE FROM rate_plans WHERE id = ?', [id]);
  });
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
