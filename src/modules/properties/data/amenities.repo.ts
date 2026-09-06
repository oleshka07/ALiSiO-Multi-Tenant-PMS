import { getSql, type Sql } from '@core/db/async';
import { AMENITIES, AMENITY_CATEGORIES, amenityName, scopeAllows, type AmenityScope } from '../domain/amenity-catalog';

/**
 * Зручності: довідник організації і два призначення.
 *
 * ── Що тут головне ──────────────────────────────────────────────────────
 *
 * Призначення — це НАБІР, а не журнал. Екран каже «ось що є в цьому готелі»
 * цілком, і писач замінює набір цілком: інакше «зняв галочку» тихо нічого не
 * робить, і готель бачить у себе на сайті сауну, яку продав торік.
 *
 * Область (`scope`) перевіряється ТУТ, а не лише на екрані: тіло запиту
 * приходить іззовні, і «матриця не покаже» — це не заборона, а зручність.
 *
 * Кожен id із тіла запиту перевіряється на належність орендарю окремо: свій
 * обʼєкт не робить чужу зручність своєю, і навпаки (клас INC-010).
 */

export interface AmenityRow {
  id: string;
  code: string;
  name: string;
  icon: string | null;
  scope: AmenityScope;
  sortOrder: number;
}

export interface AmenityCategoryRow {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
  amenities: AmenityRow[];
}

/** Скільки рядків завелося цим проходом. Нулі — каталог уже був. */
export interface SeedResult {
  categories: number;
  amenities: number;
}

/**
 * Завести стартовий каталог організації — рівно один раз.
 *
 * Ідемпотентність тримає `UNIQUE(organization_id, code)` і `ON CONFLICT DO
 * NOTHING`, а не «спершу подивимось, чи є»: між читанням і вставкою
 * вміщається другий процес (два адміни, два вкладки, крон і людина), і саме
 * там і народжується друга «Сауна».
 *
 * `t` — транзакція викликача. Обовʼязкова за змістом: 72 окремі вставки без
 * неї означають, що обрив посередині (рестарт контейнера, розрив пулу) лишає
 * ПІВКАТАЛОГУ — а сторож `ensureAmenityCatalog` дивиться на «є хоч один
 * рядок», тобто другого шансу досіяти не буде ніколи. Тому єдиний виклик у
 * застосунку (`ensureAmenityCatalog`) відкриває транзакцію сам; параметр
 * лишається для викликача, який уже в своїй.
 */
export async function seedAmenityCatalog(
  organizationId: string,
  language: string,
  t?: Sql,
): Promise<SeedResult> {
  const sql = t ?? getSql();
  const result: SeedResult = { categories: 0, amenities: 0 };

  const categoryIds = new Map<string, string>();
  for (const c of AMENITY_CATEGORIES) {
    // Ключ рядка НЕ походить від орендаря шматком.
    //
    // Тут стояло `am_cat_${organizationId.slice(-8)}_${code}` — і це не
    // теоретична колізія: `org_` + 16 hex, обрізані до восьми, це 32 біти, а
    // рядків каталогу 72 на готель. Другий готель зі спільним хвостом падав
    // на `duplicate key … _pkey` ще до першого рядка `amenities`, тобто
    // `GET /api/amenities` віддавав 500 назавжди. Ідемпотентність тримає не
    // ідентифікатор, а `ON CONFLICT (organization_id, code)`, тож id тут
    // потрібен лише унікальний.
    const id = crypto.randomUUID();
    const made = await sql.run(
      `INSERT INTO amenity_categories (id, organization_id, code, name, sort_order)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (organization_id, code) DO NOTHING`,
      [id, organizationId, c.code, amenityName(c, language), c.sortOrder],
    );
    if (made.changes > 0) result.categories++;
    const row = await sql.row<any>(
      'SELECT id FROM amenity_categories WHERE organization_id = ? AND code = ?',
      [organizationId, c.code]) as any;
    if (row?.id) categoryIds.set(c.code, String(row.id));
  }

  let order = 0;
  for (const a of AMENITIES) {
    order++;
    const categoryId = categoryIds.get(a.category);
    // Зручність без своєї категорії не заводиться мовчки: це помилка
    // каталогу в коді, і побачити її має той, хто його правив.
    if (!categoryId) throw new Error(`amenities: unknown category ${a.category} for ${a.code}`);
    const made = await sql.run(
      `INSERT INTO amenities (id, organization_id, category_id, code, name, icon, scope, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (organization_id, code) DO NOTHING`,
      [crypto.randomUUID(), organizationId, categoryId,
        a.code, amenityName(a, language), a.icon ?? null, a.scope, order],
    );
    if (made.changes > 0) result.amenities++;
  }

  return result;
}

/**
 * Каталог є в кожного готелю — навіть у того, кого завели до 0111.
 *
 * Заведення нового готелю каталогу НЕ сіє: `provisionOrganization` живе в
 * ядрі, а ядро не знає модулів — навіть через фасад (`55df209`: імпорт
 * `@properties` звідти зламав заведення готелю цілком, бо `provision-org.mjs`
 * виконує ядро голим node). А готелі, які вже працюють, через ту функцію
 * більше не проходять НІКОЛИ, і міграція, яка сіяла б за них, мусила б
 * вгадати мову кожного просто в SQL. Тому обидва приходять до каталогу одним
 * шляхом — першим читанням: мова береться з організації, вставка ідемпотентна
 * (`ON CONFLICT DO NOTHING`), і другого разу вона не робить нічого.
 *
 * Читання, яке пише, — свідомий виняток, і межа в нього вузька: сіється лише
 * коли рядків НУЛЬ, і лише стартовий словник продукту.
 */
export async function ensureAmenityCatalog(organizationId: string): Promise<void> {
  const sql = getSql();
  const has = await sql.row<any>(
    'SELECT 1 AS ok FROM amenities WHERE organization_id = ? LIMIT 1', [organizationId]);
  if (has) return;
  const org = await sql.row<any>('SELECT language FROM organizations WHERE id = ?', [organizationId]) as any;
  // Цілком або ніяк: половина каталогу лишилась би назавжди — сторож вище
  // бачить перший же рядок і більше не сіє.
  await sql.tx(async (t) => {
    await seedAmenityCatalog(organizationId, String(org?.language ?? 'uk'), t);
  });
}

/** Каталог організації категоріями. Порожньо — його ще не сіяли. */
export async function amenityCatalog(organizationId: string): Promise<AmenityCategoryRow[]> {
  const sql = getSql();
  const categories = await sql.rows<any>(
    `SELECT id, code, name, sort_order FROM amenity_categories
      WHERE organization_id = ? ORDER BY sort_order, name`,
    [organizationId]) as any[];
  const amenities = await sql.rows<any>(
    `SELECT id, category_id, code, name, icon, scope, sort_order FROM amenities
      WHERE organization_id = ? AND is_active = TRUE ORDER BY sort_order, name`,
    [organizationId]) as any[];

  return categories.map((c) => ({
    id: String(c.id),
    code: String(c.code),
    name: String(c.name),
    sortOrder: Number(c.sort_order ?? 0),
    amenities: amenities.filter((a) => String(a.category_id) === String(c.id)).map(toAmenity),
  }));
}

const toAmenity = (a: any): AmenityRow => ({
  id: String(a.id),
  code: String(a.code),
  name: String(a.name),
  icon: a.icon ?? null,
  scope: (String(a.scope) as AmenityScope),
  sortOrder: Number(a.sort_order ?? 0),
});

/** Зручності обʼєкта. */
export async function propertyAmenities(organizationId: string, propertyId: string): Promise<AmenityRow[]> {
  const sql = getSql();
  return (await sql.rows<any>(
    `SELECT a.id, a.code, a.name, a.icon, a.scope, a.sort_order
       FROM property_amenities pa
       JOIN amenities a ON a.id = pa.amenity_id
      WHERE pa.organization_id = ? AND pa.property_id = ?
      ORDER BY a.sort_order, a.name`,
    [organizationId, propertyId]) as any[]).map(toAmenity);
}

/** Зручності типу номера. */
export async function unitTypeAmenities(organizationId: string, unitTypeId: string): Promise<AmenityRow[]> {
  const sql = getSql();
  return (await sql.rows<any>(
    `SELECT a.id, a.code, a.name, a.icon, a.scope, a.sort_order
       FROM unit_type_amenities ua
       JOIN amenities a ON a.id = ua.amenity_id
      WHERE ua.organization_id = ? AND ua.unit_type_id = ?
      ORDER BY a.sort_order, a.name`,
    [organizationId, unitTypeId]) as any[]).map(toAmenity);
}

/**
 * Замінити набір зручностей обʼєкта. `null` — відмова з причиною в логах.
 *
 * Відмова, а не «пропустимо погані id»: половина набору, яка мовчки не лягла,
 * виглядає на екрані як збережена (інваріант 13).
 */
export async function setPropertyAmenities(
  organizationId: string, propertyId: string, amenityIds: string[],
): Promise<AmenityRow[] | null> {
  return await setAssignment({
    organizationId, table: 'property_amenities', column: 'property_id',
    ownerId: propertyId, ownerTable: 'properties', target: 'property', amenityIds,
    read: () => propertyAmenities(organizationId, propertyId),
  });
}

/** Те саме для типу номера. Орендар типу — через його обʼєкт. */
export async function setUnitTypeAmenities(
  organizationId: string, unitTypeId: string, amenityIds: string[],
): Promise<AmenityRow[] | null> {
  return await setAssignment({
    organizationId, table: 'unit_type_amenities', column: 'unit_type_id',
    ownerId: unitTypeId, ownerTable: 'unit_types', target: 'unit_type', amenityIds,
    read: () => unitTypeAmenities(organizationId, unitTypeId),
  });
}

async function setAssignment(input: {
  organizationId: string;
  table: 'property_amenities' | 'unit_type_amenities';
  column: 'property_id' | 'unit_type_id';
  ownerId: string;
  ownerTable: 'properties' | 'unit_types';
  target: 'property' | 'unit_type';
  amenityIds: string[];
  read: () => Promise<AmenityRow[]>;
}): Promise<AmenityRow[] | null> {
  const sql = getSql();
  const { organizationId, table, column, ownerId, ownerTable, target, amenityIds } = input;

  // Обʼєкт (чи тип) — цієї організації. `WHERE id = ?` без орендаря на
  // SQLite не рятує НІЩО, а SQLite стоїть у кожного розробника.
  const owns = ownerTable === 'properties'
    ? await sql.row<any>('SELECT 1 AS ok FROM properties WHERE id = ? AND organization_id = ?', [ownerId, organizationId])
    : await sql.row<any>(
      `SELECT 1 AS ok FROM unit_types ut
         JOIN properties p ON p.id = ut.property_id
        WHERE ut.id = ? AND p.organization_id = ?`, [ownerId, organizationId]);
  if (!owns) {
    console.error(`amenities: ${ownerTable} ${ownerId} is not this tenant's`);
    return null;
  }

  const wanted = [...new Set(amenityIds.map((id) => String(id)).filter(Boolean))];
  if (wanted.length > 0) {
    const rows = await sql.rows<any>(
      `SELECT id, scope FROM amenities
        WHERE organization_id = ? AND id IN (${wanted.map(() => '?').join(', ')})`,
      [organizationId, ...wanted]) as any[];
    // Не «скільки знайшлось», а «чи знайшлися ВСІ»: одна чужа зручність у
    // наборі — це відмова, а не тихо збережені решта.
    if (rows.length !== wanted.length) {
      console.error(`amenities: ${wanted.length - rows.length} of ${wanted.length} ids are not this tenant's`);
      return null;
    }
    const wrongScope = rows.filter((r) => !scopeAllows(String(r.scope) as AmenityScope, target));
    if (wrongScope.length > 0) {
      console.error(`amenities: ${wrongScope.length} amenities cannot be assigned to a ${target}`);
      return null;
    }
  }

  await sql.tx(async (t) => {
    await t.run(`DELETE FROM ${table} WHERE organization_id = ? AND ${column} = ?`, [organizationId, ownerId]);
    for (const amenityId of wanted) {
      await t.run(
        `INSERT INTO ${table} (id, organization_id, ${column}, amenity_id) VALUES (?, ?, ?, ?)`,
        [crypto.randomUUID(), organizationId, ownerId, amenityId]);
    }
  });

  return await input.read();
}

/**
 * Своя зручність готелю понад стартовий каталог.
 *
 * Код нормалізується, бо він — ключ: пробіли й регістр у ньому дали б два
 * рядки для однієї речі, і мапінг на канал розійшовся б із показом.
 */
export async function createAmenity(
  organizationId: string,
  input: { categoryId: string; code: string; name: string; scope: AmenityScope; icon?: string | null },
): Promise<AmenityRow | null> {
  const sql = getSql();
  const code = input.code.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  const name = input.name.trim();
  if (!code || !name) return null;
  if (!['property', 'unit_type', 'both'].includes(input.scope)) return null;

  const category = await sql.row<any>(
    'SELECT id FROM amenity_categories WHERE id = ? AND organization_id = ?',
    [input.categoryId, organizationId]);
  if (!category) return null;

  const row = await sql.row<any>(
    `INSERT INTO amenities (id, organization_id, category_id, code, name, icon, scope, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (organization_id, code) DO NOTHING
     RETURNING id, code, name, icon, scope, sort_order`,
    [crypto.randomUUID(), organizationId, input.categoryId, code, name,
      input.icon ?? null, input.scope, 1000],
  ) as any;
  return row ? toAmenity(row) : null;
}

/** Свій розділ каталогу. Категорія без зручностей — це порожній розділ, не помилка. */
export async function createAmenityCategory(
  organizationId: string, input: { code: string; name: string },
): Promise<AmenityCategoryRow | null> {
  const sql = getSql();
  const code = input.code.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  const name = input.name.trim();
  if (!code || !name) return null;
  const row = await sql.row<any>(
    `INSERT INTO amenity_categories (id, organization_id, code, name, sort_order)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (organization_id, code) DO NOTHING
     RETURNING id, code, name, sort_order`,
    [crypto.randomUUID(), organizationId, code, name, 900]) as any;
  return row ? { id: String(row.id), code: String(row.code), name: String(row.name), sortOrder: Number(row.sort_order ?? 0), amenities: [] } : null;
}
