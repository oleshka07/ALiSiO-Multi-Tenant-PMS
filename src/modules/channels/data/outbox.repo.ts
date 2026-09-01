import { getSql, type Sql } from '@core/db/async';
import { currentOrganizationId } from '@core/auth/tenant-context';
import { connectionInTenant } from './connections.repo';
import { DEFAULT_MAX_ATTEMPTS } from '../domain/ari-batch.ts';

/**
 * Черга вихідних змін: що змінилося, а не на що.
 *
 * ── Чому тут немає значень ──────────────────────────────────────────────
 *
 * Рядок — це координата: «наявність типу X на дату D змінилась». Поточне
 * число батчер читає з джерела (`availabilityByDay()`, `priceNights()` —
 * інваріант 16). Колонки під значення в схемі немає, і це не забудькуватість:
 * два записи за 40 секунд дали б дві відправки з РІЗНИМИ числами, і яке
 * доїде останнім — питання порядку в черзі, а не стану готелю.
 *
 * ── Дві смуги ───────────────────────────────────────────────────────────
 *
 * Менеджер каналів обробляє наявність окремим, швидшим шляхом і просить
 * слати її окремо. Змішати означає сповільнити найтерміновіше: застаріла
 * наявність продає номер, якого немає, а застаріла ціна — лише неправильні
 * гроші.
 *
 * ── Захоплення без FOR UPDATE SKIP LOCKED ───────────────────────────────
 *
 * Той Postgres-only, а розробка й CI ходять і по SQLite. Тому позначаємо
 * `claimed_at` умовним `UPDATE` і читаємо позначене — однаково на обох.
 *
 * З цього ж випливає найтонше правило файла: зміна, що прийшла ПІСЛЯ
 * захоплення, НЕ зливається із захопленим рядком. Той уже в польоті зі
 * старим числом; злиття означало б, що нова ціна не поїде ніколи — і жодної
 * помилки при цьому не станеться.
 *
 * ── Межа спроб: застрягле видно оператору, а не крону ───────────────────
 *
 * Рядок, що впав `DEFAULT_MAX_ATTEMPTS` разів, більше не роздається. Без
 * межі гучна відмова через тиждень така ж тиха, як мовчання: журнал повний
 * однакових рядків, які ніхто не читає (рецензія 01.09.2026). Застряглі
 * читає `stuckChanges()`, повертає в чергу `retryStuck()` — рукою, і це
 * єдиний шлях назад. Нова зміна тієї самої координати рядка не додає
 * (індекс злиття) і лічильника не скидає: координата вже названа як така,
 * що потребує уваги, і після повернення поїде її ПОТОЧНЕ значення.
 *
 * ── Знято без відправлення — третій стан, названий ─────────────────────
 *
 * Минула дата не поїде ніколи. `retireChanges()` виводить її з черги тим
 * самим `sent_at`, за яким черга рахує, і залишає `last_error` з префіксом
 * `retired:`. Тобто `sent_at` означає «вийшло з черги», а не «ми це
 * слали»: доказ «слали» — це `sent_at` БЕЗ такого префікса. Окремої колонки
 * тут немає навмисно — стан рідкісний, і читає його лише людина.
 */

export type ChangeKind = 'availability' | 'rate';

export interface Change {
  kind: ChangeKind;
  /** Тип номера. Обовʼязковий для обох смуг: наявність висить на ньому, а ціна адресується парою (Ц10). */
  unitTypeId?: string | null;
  /** Тариф. Для наявності порожній: вона не залежить від тарифу. */
  ratePlanId?: string | null;
  /** Перша (або єдина) ніч, `YYYY-MM-DD`. */
  date: string;
  /**
   * Остання ніч діапазону, ВКЛЮЧНО (Ц15). Порожньо — одна ніч.
   *
   * Запис матриці без дат — це кожна майбутня ніч; діапазон кладе його
   * одним рядком. Перекриття безпечне: черга тримає координату, не число
   * (Ц13). Не раніше за `date` — інакше рядок не розкладеться на жодну ніч.
   */
  dateTo?: string | null;
}

export interface ClaimedChange {
  id: string;
  kind: ChangeKind;
  unitTypeId: string | null;
  ratePlanId: string | null;
  date: string;
  /** Остання ніч включно; `null` — та сама, що `date`. */
  dateTo: string | null;
  attempts: number;
  lastError: string | null;
}

/**
 * Скільки ночей уперед сягає координата без кінця (матриця без дат, тир без
 * вікна, видалений тариф). Стільки ж бере повний синк у менеджера каналів
 * (INVENTORY §4.4: «500 днів, 2 виклики»). Далі ночі не існує ні для кого.
 */
export const OUTBOX_HORIZON_DAYS = 500;

/**
 * Поставити координату в чергу.
 *
 * Викликається В ТІЙ САМІЙ транзакції, що й сама зміна: черга, яка
 * поповнюється окремим кроком, розходиться зі станом при першому ж падінні
 * між ними.
 *
 * Повторна зміна тієї самої координати НЕ додає рядка, поки попередній не
 * захоплений: значення однаково читається з джерела, тож другий рядок — це
 * зайвий виклик із ліміту 10 на хвилину. Але щойно рядок захоплено, нова
 * зміна створює НОВИЙ — див. шапку.
 */
export async function enqueueChange(t: Sql, connectionId: string, change: Change): Promise<void> {
  const conn = await connectionInTenant(connectionId);
  if (!conn) throw new Error('cm_outbox: connection not found');

  const sql = t;
  const unitTypeId = change.unitTypeId ?? null;
  const ratePlanId = change.ratePlanId ?? null;
  const dateTo = change.dateTo && change.dateTo !== change.date ? change.dateTo : null;
  if (dateTo && dateTo < change.date) {
    throw new Error(`cm_outbox: range end ${dateTo} is before its start ${change.date}`);
  }

  // Координата без адресата не лягає взагалі: наявність без типу нема на що
  // покласти, ціну без типу або тарифу — нема чим ні цінувати, ні
  // адресувати (пара тип × тариф, Ц10). У черзі це був би рядок, який не
  // поїде ніколи.
  if (!unitTypeId) throw new Error('cm_outbox: a coordinate names its unit type');
  if (change.kind === 'rate' && !ratePlanId) throw new Error('cm_outbox: a rate coordinate names its rate plan');

  // Злиття тримає ІНДЕКС, а не цей код. Перша версія робила «спитати, чи є
  // такий рядок, потім вставити» — між цими двома кроками вміщається другий
  // писач, і злиття існує рівно доти, доки писач один. Та сама пастка, від
  // якої застерігає коментар у `inbound-bookings.repo.ts`, і я потрапив у неї
  // тут-таки, через файл.
  //
  // Ціль конфлікту мусить дослівно повторювати вираз індексу — `ON CONFLICT`
  // збігається з ІНДЕКСОМ, а не з наміром: розбіжність дає «does not match any
  // PRIMARY KEY or UNIQUE constraint» на першій же зміні ціни, на обох
  // двигунах. Той самий прийом, що в `price-calendar.repo.ts`.
  await sql.run(
    `INSERT INTO cm_outbox
       (id, organization_id, connection_id, kind, unit_type_id, rate_plan_id, stay_date, stay_date_to)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (connection_id, kind, (COALESCE(unit_type_id, '')), (COALESCE(rate_plan_id, '')), stay_date, (COALESCE(stay_date_to, stay_date)))
       WHERE claimed_at IS NULL AND sent_at IS NULL
       DO NOTHING`,
    [crypto.randomUUID(), conn.organizationId, connectionId,
      change.kind, unitTypeId, ratePlanId, change.date, dateTo],
  );
}

/**
 * Скільки координат чекає відправлення.
 *
 * Захоплені не рахуються — вони в польоті; застряглі теж — вони не чекають,
 * а стоять, і показувати їх як чергу означало б чергу, яка ніколи не
 * порожніє без пояснення чому. Їх рахує `stuckChanges()`.
 */
export async function pendingCount(
  connectionId: string,
  kind?: ChangeKind,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
): Promise<number> {
  const organizationId = currentOrganizationId();
  if (!organizationId) throw new Error('cm_outbox: read without a tenant');

  const sql = getSql();
  const row = await sql.row<any>(
    `SELECT COUNT(*) AS n FROM cm_outbox
      WHERE connection_id = ? AND organization_id = ?
        AND sent_at IS NULL AND claimed_at IS NULL AND attempts < ?
        ${kind ? 'AND kind = ?' : ''}`,
    kind ? [connectionId, organizationId, maxAttempts, kind] : [connectionId, organizationId, maxAttempts],
  ) as { n: number | string };
  return Number(row?.n ?? 0);
}

const toClaimed = (r: Record<string, unknown>): ClaimedChange => ({
  id: String(r.id),
  kind: String(r.kind) as ChangeKind,
  unitTypeId: r.unit_type_id == null ? null : String(r.unit_type_id),
  ratePlanId: r.rate_plan_id == null ? null : String(r.rate_plan_id),
  date: String(r.stay_date).slice(0, 10),
  dateTo: r.stay_date_to == null ? null : String(r.stay_date_to).slice(0, 10),
  attempts: Number(r.attempts) || 0,
  lastError: r.last_error == null ? null : String(r.last_error),
});

/**
 * Що зараз чекає відправлення — для екрана оператора й для перевірок.
 *
 * Не для батчера: він захоплює через `claimBatch`, а це лише читання.
 */
export async function queuedChanges(
  connectionId: string,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
): Promise<ClaimedChange[]> {
  const organizationId = currentOrganizationId();
  if (!organizationId) throw new Error('cm_outbox: read without a tenant');

  const sql = getSql();
  const rows = await sql.rows<any>(
    `SELECT id, kind, unit_type_id, rate_plan_id, stay_date, stay_date_to, attempts, last_error
       FROM cm_outbox
      WHERE connection_id = ? AND organization_id = ?
        AND sent_at IS NULL AND claimed_at IS NULL AND attempts < ?
      ORDER BY created_at`,
    [connectionId, organizationId, maxAttempts],
  ) as Record<string, unknown>[];
  return rows.map(toClaimed);
}

/**
 * Координати, які впали стільки разів, що черга їх більше не роздає.
 *
 * Це екран оператора, не крона: тут відповідь на «чому ціна не доїхала»
 * лежить у `lastError` поруч із координатою, а не в журналі сервера.
 */
export async function stuckChanges(
  connectionId: string,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
): Promise<ClaimedChange[]> {
  const organizationId = currentOrganizationId();
  if (!organizationId) throw new Error('cm_outbox: read without a tenant');

  const sql = getSql();
  const rows = await sql.rows<any>(
    `SELECT id, kind, unit_type_id, rate_plan_id, stay_date, stay_date_to, attempts, last_error
       FROM cm_outbox
      WHERE connection_id = ? AND organization_id = ?
        AND sent_at IS NULL AND claimed_at IS NULL AND attempts >= ?
      ORDER BY created_at`,
    [connectionId, organizationId, maxAttempts],
  ) as Record<string, unknown>[];
  return rows.map(toClaimed);
}

/**
 * Повернути застрягле в чергу — рукою оператора, після того як причину
 * усунено (змапили тариф, полагодили ключ).
 *
 * Лічильник обнуляється: інакше рядок застряг би на першій же наступній
 * невдачі, і кнопка «повторити» означала б «повторити один раз».
 */
export async function retryStuck(
  connectionId: string,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
): Promise<void> {
  const organizationId = currentOrganizationId();
  if (!organizationId) throw new Error('cm_outbox: write without a tenant');

  const sql = getSql();
  await sql.run(
    `UPDATE cm_outbox SET attempts = 0, last_error = NULL
      WHERE connection_id = ? AND organization_id = ?
        AND sent_at IS NULL AND claimed_at IS NULL AND attempts >= ?`,
    [connectionId, organizationId, maxAttempts],
  );
}

/**
 * Забрати пачку однієї смуги — позначити своєю і повернути.
 *
 * Двоє батчерів не отримають один рядок: другий `UPDATE` не побачить його
 * серед `claimed_at IS NULL`. Це заміна `FOR UPDATE SKIP LOCKED`, яка працює
 * на обох двигунах.
 *
 * ── Захоплене читається з `RETURNING`, не за міткою ──────────────────────
 *
 * Перша версія писала в `claimed_at` текстову мітку `claim:<uuid>` і читала
 * рядки назад за нею. На SQLite це працювало — колонка там TEXT. На Postgres
 * `claimed_at` це TIMESTAMPTZ, і перше ж захоплення падало з
 * `invalid input syntax for type timestamp with time zone` — тобто батчер не
 * забрав би з черги ЖОДНОГО рядка на проді, а всі перевірки черги були
 * зеленими, бо ганялись лише на SQLite. Знайдено 01.09.2026 на стенді
 * Postgres (AGENTS §7); вісь «який двигун» у `npm run check` вироджена
 * (інваріант 26), тому DB-перевірки каналів мають і `npm run check:pg`.
 *
 * `UPDATE … RETURNING` віддає рівно ті рядки, які ЦЕЙ виклик позначив — без
 * мітки й без гонки «прочитати останні N захоплених». Обидва двигуни його
 * вміють (SQLite з 3.35).
 */
export async function claimBatch(
  connectionId: string,
  kind: ChangeKind,
  limit: number,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
): Promise<ClaimedChange[]> {
  const organizationId = currentOrganizationId();
  if (!organizationId) throw new Error('cm_outbox: claim without a tenant');

  const sql = getSql();

  // Спершу обираємо кандидатів, потім позначаємо їх поіменно: `UPDATE … LIMIT`
  // існує не в кожній збірці SQLite і не в Postgres, а `IN (SELECT … LIMIT)`
  // на Postgres читає без блокування — саме та гонка, від якої ми тут і
  // захищаємось. Умова `claimed_at IS NULL` у самому `UPDATE` лишається
  // арбітром: хто дописав першим, той і забрав.
  // `attempts < ?` — межа спроб (див. шапку): застрягле лишається лежати,
  // доки його не поверне оператор.
  const candidates = await sql.rows<any>(
    `SELECT id FROM cm_outbox
      WHERE connection_id = ? AND organization_id = ? AND kind = ?
        AND sent_at IS NULL AND claimed_at IS NULL AND attempts < ?
      ORDER BY created_at
      LIMIT ?`,
    [connectionId, organizationId, kind, maxAttempts, limit],
  ) as { id: string }[];
  if (candidates.length === 0) return [];

  const holes = candidates.map(() => '?').join(', ');
  const rows = await sql.rows<any>(
    `UPDATE cm_outbox SET claimed_at = CURRENT_TIMESTAMP, last_error = NULL
      WHERE id IN (${holes}) AND organization_id = ? AND claimed_at IS NULL AND sent_at IS NULL
      RETURNING id, kind, unit_type_id, rate_plan_id, stay_date, stay_date_to, attempts, last_error, created_at`,
    [...candidates.map((c) => c.id), organizationId],
  ) as Record<string, unknown>[];

  // RETURNING не впорядковує; порядок черги — за часом появи.
  rows.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  return rows.map(toClaimed);
}

/** Пачка доїхала. Рядок лишається — він доказ у суперечці «ми це слали». */
export async function markSent(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const organizationId = currentOrganizationId();
  if (!organizationId) throw new Error('cm_outbox: write without a tenant');

  const sql = getSql();
  const holes = ids.map(() => '?').join(', ');
  await sql.run(
    `UPDATE cm_outbox SET sent_at = CURRENT_TIMESTAMP
      WHERE id IN (${holes}) AND organization_id = ?`,
    [...ids, organizationId],
  );
}

/**
 * Пачка не доїхала — повернути в чергу.
 *
 * Без цього захоплений і незданий рядок лишається захопленим НАЗАВЖДИ: зміна
 * не поїде, черга виглядає порожньою, і ніхто про це не дізнається. Лічильник
 * спроб — щоб вічний цикл було видно числом, а не здогадом.
 */
export async function releaseFailed(ids: string[], reason: string): Promise<void> {
  if (ids.length === 0) return;
  const organizationId = currentOrganizationId();
  if (!organizationId) throw new Error('cm_outbox: write without a tenant');

  const sql = getSql();
  const holes = ids.map(() => '?').join(', ');
  await sql.run(
    `UPDATE cm_outbox
        SET claimed_at = NULL, attempts = attempts + 1, last_error = ?
      WHERE id IN (${holes}) AND organization_id = ? AND sent_at IS NULL`,
    [reason.slice(0, 500), ...ids, organizationId],
  );
}

/**
 * Зняти з черги без відправлення — координата не поїде НІКОЛИ (минула дата).
 *
 * Не `markSent`: нічого не відправлено, і журнал не має казати «слали». Не
 * `releaseFailed`: повернення — вічне коло. Виходить із черги тим самим
 * `sent_at`, за яким черга рахує, а причина лишається поруч із префіксом
 * `retired:` — див. шапку.
 */
export async function retireChanges(ids: string[], reason: string): Promise<void> {
  if (ids.length === 0) return;
  const organizationId = currentOrganizationId();
  if (!organizationId) throw new Error('cm_outbox: write without a tenant');

  const sql = getSql();
  const holes = ids.map(() => '?').join(', ');
  await sql.run(
    `UPDATE cm_outbox
        SET claimed_at = NULL, sent_at = CURRENT_TIMESTAMP, last_error = ?
      WHERE id IN (${holes}) AND organization_id = ? AND sent_at IS NULL`,
    [`retired: ${reason}`.slice(0, 500), ...ids, organizationId],
  );
}
