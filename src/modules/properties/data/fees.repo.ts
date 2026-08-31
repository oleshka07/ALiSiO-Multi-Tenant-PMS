import { getSql } from '@core/db/async';
import { ownsProperty, ownsViaProperty, propertyScopeSql } from './tenant-scope';

/**
 * Збори поверх ціни за ніч: чим готель їх заводить.
 *
 * ── Чому цього файлу не було десять місяців ─────────────────────────────
 *
 * `fees_taxes` існує від початку. Квота її читає й додає до підсумку. Але
 * наповнював таблицю ЛИШЕ demo-seed: ні репозиторію, ні хендлера, ні екрана.
 * Тобто в кожного реального готелю міське мито й прибирання в квоті були
 * нулем — і виглядало це не як помилка, а як «цей готель таких зборів не
 * має». Портьє називає гостю суму саме з того екрана.
 *
 * Секція у файлі готелю зʼявилася раніше (`scripts/apply-hotel.mjs`), тобто
 * завести збір при онбордингу вже було чим. Змінити його потім — ні.
 *
 * ── Область ─────────────────────────────────────────────────────────────
 *
 * `fees_taxes` не має `organization_id` — вона досягає організації через
 * `property_id`, як `categories` й `unit_types`. Отже кожен запит тут іде
 * через `properties`: id приходить з URL, і будь-який орендар може ввести
 * будь-який. `null` замість винятку — щоб хендлер відповів 404 і не
 * підтвердив існування чужого рядка (інваріант 5).
 *
 * ── Що означає кожне поле ───────────────────────────────────────────────
 *
 *   type           ЯК множити: per_stay / per_night / per_person /
 *                  per_person_per_night / percentage
 *   applies_to     КОГО рахувати: all | adults (звільнення дітей)
 *   collected_for  ЧИЇ це гроші: property (виручка) | authority (збір для
 *                  громади — у документі окремий рядок без ПДВ)
 *   is_included_in_price  збір уже в ціні ночі: показується, не додається
 *
 * Арифметика — не тут, а в `modules/pricing/domain/fees.ts` (інваріант 16:
 * одна відповідь на «скільки це коштує»).
 */

export const FEE_TYPES = ['per_stay', 'per_night', 'per_person', 'per_person_per_night', 'percentage'] as const;
export const FEE_APPLIES_TO = ['all', 'adults'] as const;
export const FEE_COLLECTED_FOR = ['property', 'authority'] as const;

export type FeeType = (typeof FEE_TYPES)[number];
export type FeeAppliesTo = (typeof FEE_APPLIES_TO)[number];
export type FeeCollectedFor = (typeof FEE_COLLECTED_FOR)[number];

export interface FeeRow {
  id: string;
  property_id: string;
  name: string;
  type: FeeType;
  amount: number;
  applies_to: FeeAppliesTo;
  collected_for: FeeCollectedFor;
  is_included_in_price: boolean;
  is_active: boolean;
}

export interface FeeInput {
  property_id?: string;
  name?: string;
  type?: string;
  amount?: number | string;
  applies_to?: string;
  collected_for?: string;
  is_included_in_price?: boolean;
  is_active?: boolean;
}

/** Що саме не так із введеним збором. Кожне — речення, яке готель може виправити. */
export type FeeRefusal =
  | { field: 'name'; reason: 'required' }
  | { field: 'type'; reason: 'unknown'; allowed: readonly string[] }
  | { field: 'amount'; reason: 'not_a_number' | 'negative' }
  | { field: 'applies_to'; reason: 'unknown'; allowed: readonly string[] }
  | { field: 'collected_for'; reason: 'unknown'; allowed: readonly string[] }
  | { field: 'collected_for'; reason: 'city_tax_already_on_property'; rate: number };

/**
 * Перевірка полів збору, без бази.
 *
 * Винесена окремо, щоб її фіксував гейт: словники тут дублюють CHECK у схемі,
 * і розходження між ними — це 500 від драйвера замість 400 з назвою поля.
 */
export function validateFee(input: FeeInput): FeeRefusal | null {
  if (!input.name || !String(input.name).trim()) return { field: 'name', reason: 'required' };
  if (!FEE_TYPES.includes(input.type as FeeType)) {
    return { field: 'type', reason: 'unknown', allowed: FEE_TYPES };
  }
  const amount = Number(input.amount);
  if (!Number.isFinite(amount)) return { field: 'amount', reason: 'not_a_number' };
  // Відʼємний збір — це знижка, і вона живе не тут (див. `applyFees`, який
  // такий рядок мовчки відкидає). Краще сказати про це на введенні.
  if (amount < 0) return { field: 'amount', reason: 'negative' };
  const appliesTo = input.applies_to ?? 'all';
  if (!FEE_APPLIES_TO.includes(appliesTo as FeeAppliesTo)) {
    return { field: 'applies_to', reason: 'unknown', allowed: FEE_APPLIES_TO };
  }
  const collectedFor = input.collected_for ?? 'property';
  if (!FEE_COLLECTED_FOR.includes(collectedFor as FeeCollectedFor)) {
    return { field: 'collected_for', reason: 'unknown', allowed: FEE_COLLECTED_FOR };
  }
  return null;
}

/**
 * Двох турзборів не буває.
 *
 * Збір «для громади» живе АБО колонкою обʼєкта (`city_tax_per_night` →
 * `city_tax_amount` на броні → рядок фоліо), АБО рядком тут (→ квота).
 * Обидва разом дали б те саме двічі — раз у квоті, раз на рахунку, і гість
 * заплатив би обидва. Те саме правило тримає `apply-hotel.mjs` для файлів
 * готелів; тут воно для екрана.
 */
export async function cityTaxRateOf(propertyId: string): Promise<number> {
  const sql = getSql();
  const row = await sql.row<any>(
    'SELECT city_tax_per_night FROM properties WHERE id = ?', [propertyId]) as any;
  return Number(row?.city_tax_per_night) || 0;
}

export async function listFees(organizationId: string): Promise<FeeRow[]> {
  const sql = getSql();
  return await sql.rows<FeeRow>(`
    SELECT f.id, f.property_id, f.name, f.type, f.amount,
           f.applies_to, f.collected_for, f.is_included_in_price, f.is_active
      FROM fees_taxes f
     WHERE ${propertyScopeSql('f')}
     ORDER BY f.name
  `, [organizationId]);
}

export async function createFee(
  organizationId: string,
  input: FeeInput & { property_id: string },
): Promise<FeeRow | null> {
  const sql = getSql();
  if (!await ownsProperty(organizationId, input.property_id)) return null;

  const id = crypto.randomUUID();
  // `organization_id` тут немає — таблиця його не несе (інваріант 12 вимагає
  // називати колонку там, де вона є; тут орендар доводиться через property_id,
  // і саме його перевірив `ownsProperty` рядком вище).
  await sql.run(
    `INSERT INTO fees_taxes (id, property_id, name, type, amount,
                             applies_to, collected_for, is_included_in_price, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.property_id, String(input.name).trim(), input.type, Number(input.amount),
      input.applies_to ?? 'all', input.collected_for ?? 'property',
      input.is_included_in_price ?? false, input.is_active ?? true]);

  return await getFee(organizationId, id);
}

export async function getFee(organizationId: string, id: string): Promise<FeeRow | null> {
  const sql = getSql();
  const row = await sql.row<FeeRow>(`
    SELECT f.id, f.property_id, f.name, f.type, f.amount,
           f.applies_to, f.collected_for, f.is_included_in_price, f.is_active
      FROM fees_taxes f
      JOIN properties p ON p.id = f.property_id
     WHERE f.id = ? AND p.organization_id = ?`, [id, organizationId]) as FeeRow | undefined;
  return row ?? null;
}

export async function updateFee(
  organizationId: string,
  id: string,
  input: FeeInput,
): Promise<FeeRow | null> {
  const sql = getSql();
  if (!await ownsViaProperty(organizationId, 'fees_taxes', id)) return null;

  // Список дозволених колонок, а не `Object.keys(body)`: інакше клієнт міг би
  // переставити `property_id` і перекинути збір на чужий обʼєкт.
  const allowed: (keyof FeeInput)[] = [
    'name', 'type', 'amount', 'applies_to', 'collected_for', 'is_included_in_price', 'is_active',
  ];
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const key of allowed) {
    if (input[key] === undefined) continue;
    sets.push(`${key} = ?`);
    values.push(key === 'amount' ? Number(input[key]) : input[key]);
  }
  if (sets.length) {
    values.push(id);
    await sql.run(`UPDATE fees_taxes SET ${sets.join(', ')} WHERE id = ?`, values as never[]);
  }
  return await getFee(organizationId, id);
}

export async function deleteFee(organizationId: string, id: string): Promise<boolean> {
  const sql = getSql();
  if (!await ownsViaProperty(organizationId, 'fees_taxes', id)) return false;
  await sql.run('DELETE FROM fees_taxes WHERE id = ?', [id]);
  return true;
}
