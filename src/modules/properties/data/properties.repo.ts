import { getSql } from '@core/db/async';
// Рід житла — з ЯДРА, не з модуля каналів (Р13.15). Базовий писач обʼєкта
// не має відмовляти за списком вендора каналів готелю, який каналів не
// купував; вендорські значення мапить сам модуль каналів у себе
// (`channels/channex/property-type.ts`).
import { isLodgingKind } from '@core/lodging-kinds';
import { refuse } from '@core/http/refusal';
import { unitColumnsSql } from './units.repo';

/**
 * Every function here takes the caller's organization and constrains on it.
 *
 * None of them did before: listProperties returned every tenant's properties,
 * get/update/deleteProperty acted on whatever id the URL carried, createProperty
 * attached the new row to `SELECT id FROM organizations LIMIT 1` — whichever
 * tenant happened to be first — and the "cannot delete the last property" guard
 * counted across all tenants, so one customer's second property unlocked
 * deleting another customer's only one.
 *
 * A wrong-tenant id returns null rather than throwing, so callers answer 404 and
 * never confirm that someone else's row exists.
 */

export async function listProperties(organizationId: string) {
  const sql = getSql();
  return await sql.rows<any>(`
    SELECT
      p.*,
      (SELECT COUNT(*) FROM categories c WHERE c.property_id = p.id) as category_count,
      (SELECT COUNT(*) FROM units u WHERE u.property_id = p.id AND u.is_active = TRUE) as unit_count,
      (SELECT COUNT(*) FROM unit_types ut WHERE ut.property_id = p.id AND ut.is_active = TRUE) as unit_type_count
    FROM properties p
    WHERE p.organization_id = ?
    ORDER BY p.created_at
  `, [organizationId]);
}

/** True when the property exists *and* belongs to this organization. */
async function owns(organizationId: string, id: string): Promise<boolean> {
  const sql = getSql();
  return !!await sql.row<any>('SELECT 1 FROM properties WHERE id = ? AND organization_id = ?', [id, organizationId]);
}

/**
 * Картка обʼєкта: сам обʼєкт, його категорії, типи номерів і номери.
 *
 * `secrets` — те саме, що в `listUnits`, і з тієї ж причини: список номерів
 * тут другий у застосунку, а маршрут теж під `withActor`. Поки він брав
 * номери зірочкою, покоївка отримувала звідси пароль мережі й код замка
 * кожного номера — тобто правка, зроблена в одному списку, другого не
 * стосувалась (рецензія раунду 6, п. 3.1). Обидва тепер беруть колонки з
 * одного закритого переліку — `unitColumnsSql`.
 */
export async function getPropertyById(
  organizationId: string,
  id: string,
  options: { secrets?: boolean } = {},
) {
  const sql = getSql();

  const property = await sql.row<any>('SELECT * FROM properties WHERE id = ? AND organization_id = ?', [id, organizationId]);
  if (!property) return null;

  // The children below are reached through property_id, which the lookup above
  // has already tied to this organization.
  const categories = await sql.rows<any>(`
    SELECT c.*, COUNT(u.id) as unit_count
    FROM categories c
    LEFT JOIN units u ON u.category_id = c.id AND u.is_active = TRUE
    WHERE c.property_id = ?
    GROUP BY c.id
    ORDER BY c.sort_order
  `, [id]);

  const unitTypes = await sql.rows<any>(`
    SELECT ut.*, COUNT(u.id) as unit_count
    FROM unit_types ut
    LEFT JOIN units u ON u.unit_type_id = ut.id AND u.is_active = TRUE
    WHERE ut.property_id = ? AND ut.is_active = TRUE
    GROUP BY ut.id
    ORDER BY ut.sort_order
  `, [id]);

  const units = await sql.rows<any>(`
    SELECT ${unitColumnsSql(options.secrets === true)}
      ut.id as unit_type_id, ut.name as unit_type_name, ut.code as unit_type_code,
      c.id as category_id, c.name as category_name, c.type as category_type, c.icon as category_icon, c.color as category_color
    FROM units u
    JOIN unit_types ut ON u.unit_type_id = ut.id
    JOIN categories c ON u.category_id = c.id
    WHERE u.property_id = ?
    ORDER BY c.sort_order, ut.sort_order, u.sort_order
  `, [id]);

  return { property, categories, unitTypes, units };
}

export interface CreatePropertyInput {
  name: string;
  slug: string;
  address?: string;
  city?: string;
  country?: string;
  phone?: string;
  email?: string;
  check_in_time?: string;
  check_out_time?: string;
  /** Рід житла для каналу; порожнє значення означає «готель ще не назвався». */
  property_type?: string | null;
}

export async function createProperty(organizationId: string, input: CreatePropertyInput) {
  const sql = getSql();
  // Той самий перелік, що й у `updateProperty`, і з тієї ж причини: форма
  // обʼєкта одна на створення й на правку, тож тип, набраний при створенні,
  // мовчки губився б, якби писач його не приймав.
  //
  // ОБОВʼЯЗКОВИЙ саме тут (В1): новий обʼєкт без роду житла — це обʼєкт, чий
  // каталог не поїде в канал і чий рахунок вендор порахує не за тим. Той
  // самий розклад, що з поясом у `provisionOrganization`.
  const propertyType = validPropertyType(input.property_type, true);
  const result = await sql.row<any>(
    `
    INSERT INTO properties (organization_id, name, slug, address, city, country, phone, email, check_in_time, check_out_time, property_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *`,
    [organizationId, input.name, input.slug,
    input.address ?? null, input.city ?? null, input.country ?? 'CZ',
    input.phone ?? null, input.email ?? null,
    input.check_in_time ?? '15:00', input.check_out_time ?? '11:00',
    propertyType],
  );
  return result;
}

/**
 * Рід житла з переліку — або названа відмова.
 *
 * Звіряє писач, а не CHECK бази: перелік чужий і може зрости
 * (`@core/lodging-kinds`).
 *
 * ── Мова відмови (Р15.2) ────────────────────────────────────────────────
 *
 * Тут стояло `property_type must be one of: <22 машинні значення>` —
 * англійською, назвою колонки і всім переліком нараз. Це три різні вади в
 * одному рядку: продукт відмовляє українською скрізь, окрім цього місця;
 * «property_type» — це наша колонка, а не слово оператора; а 22 значення
 * в один рядок — не допомога, а стіна, у якій потрібного не видно. Перелік
 * оператор бачить списком у формі обʼєкта, і саме туди його відсилаємо.
 *
 * ── Порожнє значення (В1) ───────────────────────────────────────────────
 *
 * При СТВОРЕННІ порожнє — відмова: рід житла обирає готель, один раз, і без
 * нього обʼєкта не існує.
 *
 * При ПРАВЦІ порожнє означає «форма про це мовчить», і поле НЕ пишеться
 * взагалі — див. `updateProperty`. Тут ця гілка не повертає `null`, бо
 * `null` пішов би в `UPDATE` і стер би вибір; повертається `undefined`, а
 * писач за ним і впізнає «не чіпати».
 *
 * Перша редакція цієї функції повертала `null` і на правці — і саме це
 * ламало В1 на єдиному шляху, яким рід міняють: форма шле `{...propForm}`
 * ЗАВЖДИ, тобто `property_type: ''` приїжджає в кожному PATCH, ставало
 * `null`, а `null !== undefined` — і цикл писав `property_type = NULL`
 * ПОВЕРХ названого роду. Сусідня сцена цього не бачила, бо перевіряла
 * правку БЕЗ поля, а не з порожнім (рецензія раунду 20, П1).
 */
function validPropertyType(value: unknown, required: boolean): string | undefined {
  if (value === undefined || value === null || value === '') {
    if (required) {
      refuse('Оберіть рід житла: від нього залежить, за що менеджер каналів бере гроші — '
        + 'за обʼєкт чи за кожен юніт. Ми його не вгадуємо.');
    }
    return undefined;
  }
  if (!isLodgingKind(value)) {
    // `refuse` (400), не голий Error: рід житла поза переліком — помилка
    // ВИКЛИКАЧА, і маршрут віддавав її 500 із текстом назовні (Р13.10,
    // інваріант 6). Тепер 400 своїм текстом, а 500 не переказує нічого.
    refuse(`Рід житла «${String(value)}» нам невідомий — оберіть зі списку у формі обʼєкта.`);
  }
  return value;
}

export async function updateProperty(organizationId: string, id: string, fields: Record<string, unknown>) {
  const sql = getSql();
  if (!await owns(organizationId, id)) return null;

  const allowed = ['name', 'slug', 'address', 'city', 'country', 'phone', 'email', 'check_in_time', 'check_out_time', 'city_tax_per_night', 'is_active', 'checkout_balance_policy', 'property_type'];
  // Рід житла: назване значення звіряється, порожнє ЗНІМАЄТЬСЯ з патча.
  //
  // Саме зняття, а не запис `null`: форма обʼєкта шле `{...propForm}` цілком,
  // тож `property_type: ''` приїжджає в КОЖНОМУ PATCH — і `null` у патчі
  // означав би, що будь-яке збереження екрана стирає рід житла, який готель
  // обрав. В1 каже протилежне: «обирається один раз і закріплюється».
  //
  // Зняти вибір можна лише свідомо — назвавши інший рід. Способу «стерти в
  // порожнечу» немає навмисно: обʼєкт без роду не їде в канал, тобто це не
  // стан, у який готель має вміти впасти випадковим збереженням форми.
  if (fields.property_type !== undefined) {
    const kind = validPropertyType(fields.property_type, false);
    fields = { ...fields };
    if (kind === undefined) delete fields.property_type;
    else fields.property_type = kind;
  }
  // Політика виселення з боргом (0091) — одне з трьох слів. Звіряє писач, а
  // не лише CHECK бази: на SQLite обмеження до наявної таблиці не додати.
  if (fields.checkout_balance_policy !== undefined
      && !['none', 'warning', 'blocking'].includes(String(fields.checkout_balance_policy))) {
    throw new Error('checkout_balance_policy must be one of none, warning, blocking');
  }
  const updates: string[] = [];
  const values: unknown[] = [];

  for (const field of allowed) {
    if (fields[field] !== undefined) {
      updates.push(`${field} = ?`);
      values.push(fields[field]);
    }
  }

  if (updates.length === 0) return null;

  updates.push("updated_at = CURRENT_TIMESTAMP");
  values.push(id, organizationId);

  // organization_id is repeated in the WHERE clause, not left to the check
  // above alone: the guard and the write must not be able to drift apart.
  await sql.run(`UPDATE properties SET ${updates.join(', ')} WHERE id = ? AND organization_id = ?`, [...values]);
  return await sql.row<any>('SELECT * FROM properties WHERE id = ? AND organization_id = ?', [id, organizationId]);
}

export async function deleteProperty(organizationId: string, id: string): Promise<{ ok: boolean; error?: string }> {
  const sql = getSql();
  if (!await owns(organizationId, id)) return { ok: false, error: 'Not found' };

  const count = await sql.row<any>('SELECT COUNT(*) as cnt FROM properties WHERE organization_id = ?', [organizationId]) as { cnt: number };
  if (count.cnt <= 1) return { ok: false, error: 'Cannot delete the last property' };

  await sql.run('DELETE FROM properties WHERE id = ? AND organization_id = ?', [id, organizationId]);
  return { ok: true };
}
