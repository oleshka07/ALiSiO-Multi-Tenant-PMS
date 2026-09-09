/**
 * Область обʼєкта — ТИП, а не необовʼязковий параметр.
 *
 * ── Що зламалося ────────────────────────────────────────────────────────
 *
 * Власник із двома обʼєктами бачить на екрані «Номери» номери обох, маючи
 * вибраним один. `properties/api/units.handlers.ts` кличе `listUnits(orgId,
 * filters)` — `property_id` не є навіть параметром; репозиторій обмежує запит
 * `propertyScopeSql('u')`, а це вісь ОРЕНДАРЯ («усі обʼєкти цього рахунку»),
 * не вісь обʼєкта. Запит виглядає проскоупленим і не є ним.
 *
 * Асиметрія точна і вона ж корінь: **писачі вісь знають** — `createUnit` бере
 * `requirePropertyId`, репозиторій питає `ownsProperty`, — **а читачі не
 * питають нічого.** Це не витік між орендарями: RLS працює, організація
 * тримається. Це друга вісь, у якої не було ні RLS-аналога, ні гейта, ні
 * інваріанта, — і саме її оператор бачить очима, бо один рахунок може мати
 * кілька обʼєктів (INC-029).
 *
 * ── Чому тип, а не `property_id?: string` ───────────────────────────────
 *
 * Бо `undefined` сьогодні ТИХО означає «всі обʼєкти», і це значення, яке
 * забувають, а не обирають. Той самий клас, що інваріант 8 (публічний
 * маршрут не має мовчазного дефолту) і 13 (не знайшли — відмовляємо):
 * відсутність не буває відповіддю.
 *
 * Після цього модуля «усі» лишається законним — зведений звіт по рахунку,
 * синк каналу, консолідована шахматка справді дивляться на всі обʼєкти, — але
 * воно написане словами (`ALL_PROPERTIES`), його видно грепом і воно проходить
 * рецензію як рішення, а не як пропуск. Читач scoped-таблиці приймає
 * `PropertyScope` і НЕ МАЄ значення за замовчуванням.
 *
 * ── Чому не RLS, як для орендаря ────────────────────────────────────────
 *
 * Спокуса є, і вона хибна: частина екранів ЗАКОННО дивиться на всі обʼєкти
 * рахунку, і під політикою вони або зламаються, або потребуватимуть
 * аварійного вимикача — а вимикач, доданий у відповідь на законну відмову, і
 * є тим, як гейти вмирають. Орендар абсолютний, обʼєкт — ні: різні осі, різні
 * механізми (Ц51, docs/DECISIONS.md).
 *
 * Тримає `scripts/check-property-scope.mjs --strict`, вісь «читання».
 */
import { getSql } from './db/async.ts';
import { requireOrganizationId, PropertyNotFound } from './auth/tenant-context.ts';
import { refuse } from './http/refusal.ts';

/**
 * Який обʼєкт читаємо.
 *
 * Двозначно навмисно: третього стану («не знаю») тут немає, бо саме він і був
 * помилкою. Хто не знає — питає `requirePropertyScope`, і той або відповість,
 * або відмовить.
 */
export type PropertyScope =
  | { kind: 'one'; id: string }
  | { kind: 'all' };

/**
 * Усі обʼєкти рахунку — законно і НАЗВАНО.
 *
 * Кожне вживання пишеться з коментарем, чому саме всі: зведений звіт, синк
 * каналу, консолідована шахматка. Без причини поруч це `undefined`, лише
 * набране літерами.
 */
export const ALL_PROPERTIES: PropertyScope = { kind: 'all' };

/** Один обʼєкт. Id вже має бути доведений як свій — див. `requirePropertyScope`. */
export function oneProperty(id: string): PropertyScope {
  return { kind: 'one', id };
}

/** Id обраного обʼєкта, або `null` для «усіх». Для логів і повідомлень. */
export function scopedPropertyId(scope: PropertyScope): string | null {
  return scope.kind === 'one' ? scope.id : null;
}

/** Фрагмент `WHERE` і його параметри — в тому самому порядку. */
export interface PropertyScopeFilter {
  sql: string;
  params: string[];
}

/**
 * Область як шматок SQL.
 *
 * `{ kind: 'all' }` дає `TRUE`, а не порожній рядок: порожній треба вміти
 * приклеїти («AND» перед нічим — синтаксична помилка), і кожен виклик
 * винаходив би це склеювання по-своєму. `TRUE` вставляється всюди однаково і
 * читається як те, чим є.
 *
 * ⚠️ У девʼяти таблиць `property_id` NULLABLE (`fin_folios`,
 * `fin_folio_payments`, `partner_reports`, `tasks`, `task_projects`,
 * `price_occupancy`, `price_los_tiers`, `channel_rate_rules`,
 * `fin_fiscal_outages`). Для них `{ kind: 'one' }` ТИХО ховає рядки з NULL —
 * рівно той самий звір, що рядок без орендаря (інваріант 12): рядок є, його
 * не видно, у логах нічого. Тому переведення такого читача починається не з
 * фільтра, а з відповіді на питання «що означає NULL у цій таблиці»:
 * засипати міграцією чи назвати «спільний для рахунку» і читати
 * `(… = ? OR … IS NULL)` свідомо. Мовчки додати фільтр — це втратити рядки.
 */
/**
 * Область, якої не передали, — це НЕ «усі обʼєкти».
 *
 * `tsc` тримає це в TypeScript і не тримає ніде більше: `scripts/*.mjs`
 * імпортують репозиторії через хук аліасів, тобто типів там немає взагалі.
 * 09.09.2026 `apply-hotel.mjs` кликав `listCategories(organizationId)` з одним
 * аргументом — заведення КОЖНОГО готелю падало з
 * `Cannot read properties of undefined (reading 'kind')`, і на це пішло
 * чотири коміти, бо повідомлення не називало ні дверей, ні винного.
 *
 * Тому двері питають самі. Не `?? ALL_PROPERTIES`: мовчазний дефолт зробив би
 * з пропущеного аргументу «усі обʼєкти» — рівно ту ваду, від якої весь
 * INC-029 (інваріант 8: дефолту, якого ніхто не називав, не буває).
 */
function scopeOrRefuse(scope: PropertyScope, door: string): PropertyScope {
  if (!scope || typeof (scope as { kind?: unknown }).kind !== 'string') {
    throw new TypeError(
      `${door}: область обʼєкта не передана. Викличте з oneProperty(id) або ALL_PROPERTIES — ` +
      'пропущений аргумент НЕ означає «усі обʼєкти» (INC-029).');
  }
  return scope;
}

export function propertyScopeFilter(scope: PropertyScope, alias: string): PropertyScopeFilter {
  const column = alias ? `${alias}.property_id` : 'property_id';
  const asked = scopeOrRefuse(scope, 'propertyScopeFilter');
  return asked.kind === 'one'
    ? { sql: `${column} = ?`, params: [asked.id] }
    : { sql: 'TRUE', params: [] };
}

/**
 * Область для таблиці, де NULL у `property_id` означає «СПІЛЬНЕ для рахунку».
 *
 * ── Навіщо другі двері ──────────────────────────────────────────────────
 *
 * У девʼяти таблиць `property_id` NULLABLE, і NULL там не завжди «забули».
 * У `tasks` і `task_projects` він означає рівно те, що написано: задача не
 * привʼязана до будинку — «оновити прайс на сайті», «продовжити домен». Такі
 * рядки належать КОЖНОМУ будинку, бо не належать жодному.
 *
 * `propertyScopeFilter` для них неправильний: `property_id = ?` тихо ховає
 * саме ті рядки, які мали б бути в кожному списку, — і зникають вони без
 * помилки й без сліду в логах (той самий звір, що рядок без орендаря,
 * інваріант 12). Тому двері окремі, а не прапорець: вибір «спільне видно чи
 * ні» — властивість ТАБЛИЦІ, і робиться він один раз при переведенні читача,
 * а не на кожному виклику.
 *
 * Куди які двері — вирішує власник таблиці, і рішення пишеться в
 * `docs/DECISIONS.md` (для `tasks` і `task_projects` — О14).
 */
export function propertyOrSharedFilter(scope: PropertyScope, alias: string): PropertyScopeFilter {
  const column = alias ? `${alias}.property_id` : 'property_id';
  const asked = scopeOrRefuse(scope, 'propertyOrSharedFilter');
  return asked.kind === 'one'
    ? { sql: `(${column} = ? OR ${column} IS NULL)`, params: [asked.id] }
    : { sql: 'TRUE', params: [] };
}

/** Значення параметра адреси, що означає «усі обʼєкти» — те саме слово, що в шапці. */
export const ALL_PROPERTIES_PARAM = 'all';

/**
 * КАНОНІЧНЕ імʼя параметра осі обʼєкта (рішення контролера 09.09.2026).
 * Так уже питають чотирнадцять екранів; новий код пише лише його.
 */
export const PROPERTY_ID_PARAM = 'property_id';

/**
 * ЗАСТАРІЛИЙ синонім — те, що провайдер пише в адресу вкладки
 * (`src/ui/PropertyScopeContext.tsx`). Читається, бо посилання з ним уже
 * пересилають колегам; не пишеться. Прибирається разом із переведенням
 * провайдера на канонічне імʼя.
 */
export const PROPERTY_PARAM = 'property';

/**
 * Що сказав виклик про обʼєкт: id, `''`/`all` — «усі», `null` — не сказав.
 *
 * ── Одне канонічне імʼя і один застарілий синонім ───────────────────────
 *
 * `property_id` — КАНОНІЧНЕ (рішення контролера 09.09.2026). Так уже питають
 * чотирнадцять екранів (`/api/reports`, `/api/dashboard`, `/api/pricing/*`,
 * `/api/settings/*`), беручи значення з `usePropertyScope()`; новий код пише
 * лише його.
 *
 * `property` — ЗАСТАРІЛИЙ синонім: його пише провайдер в адресу вкладки, і
 * посилання з ним уже пересилають колегам. Тому він читається, але не
 * пишеться; коли провайдер перейде на канонічне імʼя, рядок нижче зникне.
 *
 * Одні двері на обидва — щоб кожен хендлер не вирішував заново, і щоб третя
 * назва не зʼявилась непоміченою. NAMING §8.
 *
 * **Порожнє значення — це СКАЗАНЕ «усі», а не мовчання** (рішення контролера
 * 09.09.2026). Саме так екрани пишуть «Усі обʼєкти»: форма, яка шле поле
 * завжди, надсилає його порожнім. Мовчання — це `null`, тобто параметра не
 * було взагалі, і воно означає «виклик про обʼєкт нічого не сказав». Два
 * різні стани; їх злиття робило б «покажи всі» невідрізнимим від «памʼятай,
 * що я обрав минулого разу».
 */
export function requestedPropertyParam(url: string): string | null {
  const q = new URL(url).searchParams;
  for (const name of [PROPERTY_ID_PARAM, PROPERTY_PARAM]) {
    if (q.has(name)) return q.get(name) ?? '';
  }
  return null;
}

/**
 * Область із запиту — симетрично до `requirePropertyId()` для писачів.
 *
 * Порядок такий:
 *   - `all` або порожній рядок — усі обʼєкти рахунку, сказано словом (порожнє
 *     значення параметра — це ВІДПОВІДЬ «усі», а `null`/`undefined` —
 *     мовчання; два різні стани, і саме їх злиття було вадою);
 *   - id — перевіряється на власність; чужий чи видалений → 404, не 403
 *     (інваріант 5), і не «отже, всі» (інваріант 13);
 *   - нічого, а обʼєкт у рахунку один — він і є область. Обирати нема з чого,
 *     перемикача в шапці немає, і вимагати параметр означало б зламати кожен
 *     екран заради випадку, якого в цього клієнта не буває;
 *   - нічого, а обʼєктів кілька — 400 «скажіть який, або all». Саме тут
 *     раніше стояло мовчазне «всі».
 */
export async function requirePropertyScope(raw?: string | null): Promise<PropertyScope> {
  const organizationId = await requireOrganizationId();

  if (raw === ALL_PROPERTIES_PARAM || raw === '') return ALL_PROPERTIES;

  const sql = getSql();
  if (raw) {
    const owned = await sql.row<{ id: string }>(
      'SELECT id FROM properties WHERE id = ? AND organization_id = ?',
      [raw, organizationId],
    );
    if (!owned) throw new PropertyNotFound();
    return oneProperty(raw);
  }

  const rows = await sql.rows<{ id: string }>(
    'SELECT id FROM properties WHERE organization_id = ? LIMIT 2',
    [organizationId],
  );
  if (rows.length === 1) return oneProperty(rows[0].id);
  if (rows.length === 0) refuse('This organization has no property yet', 400);
  refuse('This organization has more than one property — say which, or "all"', 400);
}
