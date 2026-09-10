import { noteAvailabilityChanged } from '@channels/outbox';
import { getSql } from '@core/db/async';
import { propertyScopeFilter, type PropertyScope } from '@core/property-scope';
import { ownsProperty, ownsViaProperty, propertyScopeSql } from './tenant-scope';

/**
 * Units hang off a property. listUnits filtered only by is_active, so it
 * returned every tenant's rooms, and create/update/delete acted on whatever
 * ids the request carried — including bulkCreateUnits, which could have
 * written a hundred rooms into another tenant's property in one call.
 */

/**
 * Список номерів. `secrets` — чи входять у нього пароль мережі й код замка.
 *
 * За замовчуванням НЕ входять, і це не обережність, а вимога задачі: цей
 * маршрут читають екрани зміни — мобільний чекліст покоївки, календар,
 * картка броні, — і роль `housekeeper` має рівно одне право (`nav:dashboard`).
 * Пароль мережі й код замка в тій відповіді — це ключ від дверей гостя в
 * телефоні кожного, хто ввійшов.
 *
 * Повний список бачить лише `manage_properties`, тобто екран налаштувань, де
 * ці поля й редагуються. `lock_code` лежав у відповіді ще до Блоку 5a — блок
 * діру розширив паролем мережі, і закриває тепер обидві.
 */
/**
 * Колонки номера, які взагалі виходять із модуля, — одним переліком.
 *
 * Один перелік, а не `u.*` у кожному запиті, і не тому що так охайніше.
 * `SELECT u.*` віддає те, чого в ньому ще немає: колонка, додана міграцією,
 * поїде клієнту тим самим днем, і ніхто цього не побачить. Саме так пароль
 * мережі (0110) опинився у відповіді `/api/properties/[id]` для покоївки —
 * список номерів там брався зірочкою, і правка `listUnits` його не
 * стосувалася (рецензія раунду 6, п. 3.1).
 *
 * Тому перелік ЗАКРИТИЙ: нова колонка не з'являється у відповіді, поки її
 * сюди не дописали. Забути дописати — видимий брак (порожнє поле на екрані),
 * забути прибрати — тихий витік.
 */
export function unitColumnsSql(secrets: boolean): string {
  return `
      u.id, u.property_id, u.name, u.code, u.beds, u.zone, u.floor, u.room_status, u.cleaning_status, u.sort_order, u.is_active, u.is_pool, u.entry_photo_url,
      u.view,
      ${secrets ? 'u.wifi_network, u.wifi_password, u.lock_code,' : ''}`;
}

export function listUnits(
  organizationId: string,
  scope: PropertyScope,
  filters: { category?: string; unitType?: string; includePool?: boolean } = {},
  options: { secrets?: boolean } = {},
) {
  const sql = getSql();
  const secrets = options.secrets === true;
  const inScope = propertyScopeFilter(scope, 'u');
  let query = `
    SELECT
      ${unitColumnsSql(secrets)}
      c.id as category_id, c.name as category_name, c.type as category_type, c.icon as category_icon, c.color as category_color,
      ut.id as unit_type_id, ut.name as unit_type_name, ut.code as unit_type_code, ut.max_adults, ut.base_occupancy
    FROM units u
    JOIN categories c ON u.category_id = c.id
    JOIN unit_types ut ON u.unit_type_id = ut.id
    WHERE u.is_active = TRUE AND ${propertyScopeSql('u')} AND ${inScope.sql}
  `;

  const params: string[] = [organizationId, ...inScope.params];

  // Pool/staging units never show up as bookable rooms. The room-allocation
  // modal opts in via includePool=true.
  if (!filters.includePool) {
    query += ' AND (u.is_pool IS NULL OR u.is_pool = FALSE)';
  }

  if (filters.category) {
    query += ' AND c.type = ?';
    params.push(filters.category);
  }

  if (filters.unitType) {
    query += ' AND ut.id = ?';
    params.push(filters.unitType);
  }

  query += ' ORDER BY c.sort_order, ut.sort_order, u.sort_order';

  return sql.rows<any>(query, params);
}

/**
 * Код скриньки з ключем — для ОДНОГО номера, призначеного ОДНІЙ броні.
 *
 * ── Чому це окремі двері, а не прапорець у `listUnits` ──────────────────
 *
 * `unitColumnsSql(secrets)` вище віддає `lock_code` лише під
 * `manage_properties`, і це правильно: список номерів читають екрани зміни,
 * а роль покоївки має одне право. Кіоск (Блок «Кіоск», §3.2 крок 5) мусить
 * назвати гостю код скриньки — але саме тому, що він відповідає БЕЗ СЕСІЇ,
 * дати йому `manage_properties` не можна, а дати `secrets: true` у список
 * означало б віддати терміналу коди ВСІХ номерів готелю за один запит.
 *
 * Тому виняток свідомо вузький, і вузькість тут — уся суть:
 *
 *   один номер   — той, що стоїть у броні (`reservations.unit_id`), і жоден
 *                  інший. Номера немає — немає й коду;
 *   одна бронь   — названа викликачем, і вона мусить бути цієї організації;
 *   один обʼєкт  — той, до якого припаяний термінал. Бронь сусіднього
 *                  будинку того самого рахунку → «немає» (вісь INC-029);
 *   один стан    — гість уже заселений. Код скриньки до заселення це ключ,
 *                  виданий тому, хто ще не заїхав.
 *
 * Пароля мережі тут немає навмисно, хоч кіоск його теж показує: Wi-Fi
 * належить ОБʼЄКТУ і читається зі своєї конфігурації гостя, а не з рядка
 * номера. Одні двері — одна таємниця.
 */
export async function lockCodeForStay(input: {
  organizationId: string;
  propertyId: string;
  reservationId: string;
}): Promise<{ unitId: string; unitName: string; lockCode: string | null } | null> {
  const sql = getSql();
  const row = await sql.row<{ unit_id: string; name: string; lock_code: string | null }>(`
    SELECT u.id AS unit_id, u.name, u.lock_code
      FROM reservations r
      JOIN units u ON u.id = r.unit_id
      JOIN properties p ON p.id = r.property_id
     WHERE r.id = ?
       AND r.organization_id = ?
       AND r.property_id = ?
       AND p.organization_id = ?
       AND u.property_id = r.property_id
       AND r.status = 'checked_in'
  `, [input.reservationId, input.organizationId, input.propertyId, input.organizationId]);
  if (!row) return null;
  return { unitId: row.unit_id, unitName: row.name, lockCode: row.lock_code ?? null };
}

export interface CreateUnitInput {
  unit_type_id: string;
  property_id: string;
  category_id: string;
  name: string;
  code: string;
  floor?: number;
  zone?: string;
  beds?: number;
  notes?: string;
  sort_order?: number;
  /** Вид із вікна ЦЬОГО номера, вільним текстом (0110). */
  view?: string;
  /** Мережа й пароль номера — рівень над типом і обʼєктом (0110). */
  wifi_network?: string;
  wifi_password?: string;
  lock_code?: string;
}

/** Every id below arrives in the request body, so each is checked separately. */
async function ownsAllRefs(
  organizationId: string,
  input: { property_id: string; category_id: string; unit_type_id: string },
): Promise<boolean> {
  if (!await ownsProperty(organizationId, input.property_id)) return false;
  if (!await ownsViaProperty(organizationId, 'categories', input.category_id)) return false;
  if (!await ownsViaProperty(organizationId, 'unit_types', input.unit_type_id)) return false;
  return true;
}

/**
 * Число з форми, де порожньо означає «не вказано».
 *
 * `'' ?? null` — це `''`: оператор бачить лише null/undefined, а форма шле
 * порожній РЯДОК. SQLite мовчки клав '' у INTEGER-колонку, Postgres чесно
 * відмовляв — `invalid input syntax for type bigint: ""` — і перший же
 * номер, заведений руками на проді, не створювався.
 */
function intOr<T>(v: unknown, fallback: T): number | T {
  if (v === '' || v == null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export async function createUnit(organizationId: string, input: CreateUnitInput) {
  if (!await ownsAllRefs(organizationId, input)) return null;

  const sql = getSql();
  const result = await sql.row<any>(
    `
    INSERT INTO units (unit_type_id, property_id, category_id, name, code, floor, zone, beds, notes, sort_order,
                       view, wifi_network, wifi_password, lock_code)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *`,
    [input.unit_type_id, input.property_id, input.category_id,
    input.name, input.code, intOr(input.floor, null), input.zone || null,
    intOr(input.beds, 0), input.notes || null, intOr(input.sort_order, 0),
    input.view || null, input.wifi_network || null, input.wifi_password || null, input.lock_code || null],
  );
  // Канали: у типу побільшало номерів — на кожну ніч до горизонту.
  await noteAvailabilityChanged(sql, { propertyId: input.property_id, unitTypeId: input.unit_type_id, from: todayIso(), to: null });
  return result;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

export interface BulkCreateUnitsInput {
  property_id: string;
  category_id: string;
  unit_type_id: string;
  prefix: string;
  from: number;
  to: number;
  beds?: number;
  zone?: string;
  /**
   * The floor these rooms are on.
   *
   * Missing here while `createUnit` had it, so a hotel entering rooms one at a
   * time got floors and the same hotel entering 202–206 as a range got none.
   * A range is normally exactly one floor — that is usually WHY it is a range —
   * so this was the case most likely to lose it. The pilot's first load put 18
   * of its 29 rooms in with no floor at all.
   */
  floor?: string | number | null;
}

export async function bulkCreateUnits(organizationId: string, input: BulkCreateUnitsInput) {
  // Unchecked, this wrote up to two hundred rooms into another tenant's
  // property in a single call.
  //
  // null, not []: the caller has to tell "these ids are not yours" from "every
  // one of those room numbers already exists". Both used to come back as an
  // empty array, so a hotel re-entering a range it had already entered was
  // told "Property, category or unit type not found" — an answer
  // about ownership to a question about duplicates. It cost an hour to read
  // that message as what it actually was.
  if (!await ownsAllRefs(organizationId, input)) return null;

  const sql = getSql();

  // Which of these numbers are already rooms — asked, not discovered by
  // failing.
  //
  // This used to insert every number in the range and swallow the error when
  // one already existed, testing `e.message.includes('UNIQUE')`. Two things
  // about that were true only of SQLite. Postgres words the same error
  // `duplicate key value violates unique constraint`, which does not contain
  // "UNIQUE", so the error was rethrown instead of skipped; and a failed
  // statement inside a Postgres transaction aborts the WHOLE transaction, so
  // even a matching test would have thrown away the rooms that did insert.
  //
  // A hotel re-entering a range that overlaps one it already has is the
  // ordinary case — it is how you add 207 to a floor that already has 201–206.
  // On Postgres that answered 500.
  const wanted: { name: string; code: string; sort: number }[] = [];
  for (let i = input.from; i <= input.to; i++) {
    wanted.push({ name: `${input.prefix}${i}`, code: `${input.prefix}${i}`, sort: i });
  }

  const taken = new Set(
    (await sql.rows<{ code: string }>(
      `SELECT code FROM units WHERE property_id = ? AND code IN (${wanted.map(() => '?').join(',')})`,
      [input.property_id, ...wanted.map((w) => w.code)],
    )).map((r) => r.code),
  );

  const fresh = wanted.filter((w) => !taken.has(w.code));
  if (fresh.length === 0) return [];

  await sql.tx(async (t) => {
    for (const w of fresh) {
      await t.run(`
        INSERT INTO units (unit_type_id, property_id, category_id, name, code, floor, beds, zone, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [input.unit_type_id, input.property_id, input.category_id, w.name, w.code,
        intOr(input.floor, null), intOr(input.beds, 0), input.zone || null, w.sort]);
    }
    // Канали — тим самим `t`: номерів побільшало на кожну ніч до горизонту.
    await noteAvailabilityChanged(t, { propertyId: input.property_id, unitTypeId: input.unit_type_id, from: todayIso(), to: null });
  });

  return fresh.map(({ name, code }) => ({ name, code }));
}

export async function updateUnit(organizationId: string, id: string, fields: Record<string, unknown>) {
  if (!await ownsViaProperty(organizationId, 'units', id)) return null;
  // Reassignment must not move the unit into another tenant.
  for (const [field, table] of [
    ['category_id', 'categories'], ['unit_type_id', 'unit_types'],
  ] as const) {
    if (fields[field] && !await ownsViaProperty(organizationId, table, String(fields[field]))) return null;
  }

  const sql = getSql();

  const nullableFields = ['floor', 'zone', 'notes', 'lock_code', 'entry_photo_url', 'view', 'wifi_network', 'wifi_password'];
  for (const f of nullableFields) {
    if (fields[f] === '') fields[f] = null;
  }
  // NOT NULL-числа: порожній рядок — це «не міняти», а не нуль і не помилка
  // Postgres про bigint: "".
  for (const f of ['beds', 'sort_order']) {
    if (fields[f] === '') delete fields[f];
  }

  const allowed = ['name', 'code', 'unit_type_id', 'category_id', 'floor', 'zone', 'beds', 'room_status', 'cleaning_status', 'notes', 'sort_order', 'is_active', 'lock_code', 'entry_photo_url', 'view', 'wifi_network', 'wifi_password'];
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

  // Канали: стан номера (активність, статус, тип) міняє наявність типу на
  // кожну ніч до горизонту — старого типу й нового, якщо номер переїхав.
  const moves = ['room_status', 'is_active', 'unit_type_id'].some((f) => fields[f] !== undefined);
  const before = moves ? await sql.row<any>('SELECT unit_type_id, property_id FROM units WHERE id = ?', [id]) : null;

  await sql.run(`UPDATE units SET ${updates.join(', ')} WHERE id = ? AND ${propertyScopeSql('units')}`, [...values]);
  const after = await sql.row<any>('SELECT * FROM units WHERE id = ?', [id]);
  if (before) {
    const types = new Set([String(before.unit_type_id), String(after?.unit_type_id ?? before.unit_type_id)]);
    for (const unitTypeId of types) {
      await noteAvailabilityChanged(sql, { propertyId: String(before.property_id), unitTypeId, from: todayIso(), to: null });
    }
  }
  return after;
}

export async function deleteUnit(organizationId: string, id: string): Promise<{ ok: boolean; error?: string }> {
  if (!await ownsViaProperty(organizationId, 'units', id)) return { ok: false, error: 'Not found' };

  const sql = getSql();
  const resCount = await sql.row<any>("SELECT COUNT(*) as cnt FROM reservations WHERE unit_id = ? AND status NOT IN ('cancelled', 'checked_out')", [id]) as { cnt: number };

  if (resCount.cnt > 0) {
    return { ok: false, error: `Cannot delete: ${resCount.cnt} active reservations exist for this unit.` };
  }

  // Канали: номера більше немає — ДО видалення, після нема що читати.
  const gone = await sql.row<any>('SELECT unit_type_id, property_id FROM units WHERE id = ?', [id]);
  await sql.run(`DELETE FROM units WHERE id = ? AND ${propertyScopeSql('units')}`, [id, organizationId]);
  if (gone?.unit_type_id) {
    await noteAvailabilityChanged(sql, { propertyId: String(gone.property_id), unitTypeId: String(gone.unit_type_id), from: todayIso(), to: null });
  }
  return { ok: true };
}
