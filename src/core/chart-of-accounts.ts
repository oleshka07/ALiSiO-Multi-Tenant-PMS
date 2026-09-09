/**
 * План рахунків і бізнес-юніти — ОДИН комплект НА КОЖЕН ГОТЕЛЬ (INC-025).
 *
 * Довідник сіявся один раз на всю базу: `SELECT id FROM organizations LIMIT 1`
 * — прямо проти інваріанта 1 — і пʼятнадцять рядків із ЛІТЕРАЛЬНИМИ
 * первинними ключами (`ec_accommodation`, `ec_other_exp`, …). Другий комплект
 * неможливий за означенням PK, а справжній сівач (`provisionOrganization`)
 * статей не сіяв узагалі. `payment-bridge` при цьому пришпилював
 * `'ec_accommodation'` кожній готівковій оплаті будь-якого готелю.
 *
 * Обидві гілки наслідку погані:
 *   - чиста інсталяція — статей немає ні в кого, зовнішній ключ порушується,
 *     і готівкова оплата віддає 500 УЖЕ ПЕРШОМУ готелю;
 *   - база, налита з демо, — статті належать готелю №1, операції готелю №2
 *     тихо чіпляються на ЧУЖИЙ рядок: RI-тригери виконуються з вимкненою row
 *     security, тож ключ пропускає, а політика при читанні рядок ховає. Звіти
 *     йдуть через `LEFT JOIN`, тож виручка не зникає — вона лягає з порожньою
 *     назвою і `COALESCE(classifier,'other')`. Проживання другого готелю
 *     потрапляє в P&L не в той рядок, мовчки.
 *
 * Тому ідентифікатор рядка тепер випадковий і належить готелю, а СТАЛА
 * величина, за якою код його знаходить, — `code`. Код унікальний у межах
 * організації (інваріант 3), а не в межах бази.
 *
 * Файл лежить у ядрі і не імпортує нічого: `provisionOrganization`
 * виконується голим node зі `scripts/provision-org.mjs`, тож аліасів тут бути
 * не може (`check-bare-node`). Список один на всіх — два списки розійшлися б,
 * і другий готель отримав би довідник, якого немає в першого.
 */

/**
 * Рядок плану рахунків. `code` — стала величина, `id` належить готелю.
 *
 * `opType` і `classifier` — не прикраса і не дубль `stdGroup` (Р12.1). Це дві
 * колонки, за якими план рахунків ЧИТАЮТЬ, і без них стаття існує, показується
 * і приймає операції, а грошей по ній не видно:
 *
 *   - P&L розкладає рядки за `classifier`, а порожній бере
 *     `COALESCE(ec.classifier,'other')` — оренда, зарплата й податки лягають в
 *     «Інше», тобто НИЖЧЕ EBITDA. Виміряно на свіжому готелі: EBITDA
 *     дорівнювала виручці, 240 замість −60;
 *   - `/api/finance/categories?op_type=expense` — список, який відкриває форма
 *     витрати, — віддавав ПОРОЖНЬО;
 *   - `autoResolveCategory` шукає перший рядок з `op_type='income'|'expense'`
 *     і не знаходив нічого.
 *
 * Значення тут явні, а не виведені з `stdGroup`: два рядки навмисно
 * відхиляються від свого гурту — `variable` (COGS, але власний рядок P&L
 * «Змінні») і `investors` (Financing, але НАДХОДЖЕННЯ, тобто `income`).
 * Правило «вивести з групи» живе в `expense-categories.handlers.ts` і
 * стосується статей, які заводить сам готель.
 */
export interface ChartAccount {
  code: string;
  name: string;
  stdGroup: string;
  pnlLine: string;
  /** Куди стаття потрапляє у формі операції: income | expense | transfer. */
  opType: string;
  /** Рядок P&L: revenue | cogs | variable | operational | tax | capex | financing | other. */
  classifier: string;
  includeInPnl: boolean;
  includeInCash: boolean;
  allocMethod: string;
  isCapex: boolean;
  icon: string;
  color: string;
  sortOrder: number;
}

/**
 * Загальний готельний план рахунків.
 *
 * Рядки виручки, які належать пропозиції ОДНОГО обʼєкта (його сауна, його
 * ресторан), сюди не входять — їх заводить сам готель. Назви англійські й
 * загальні навмисно: це стартовий каркас, який перейменовують, а не готовий
 * облік конкретного клієнта (інваріант 20).
 */
export const CHART_OF_ACCOUNTS: ChartAccount[] = [
  { code: 'accommodation', name: 'Accommodation', stdGroup: 'Revenue', opType: 'income', classifier: 'revenue', pnlLine: 'Accommodation', includeInPnl: true, includeInCash: true, allocMethod: 'DIRECT', isCapex: false, icon: '🏠', color: '#22c55e', sortOrder: 1 },
  { code: 'services_rev', name: 'Services', stdGroup: 'Revenue', opType: 'income', classifier: 'revenue', pnlLine: 'Services', includeInPnl: true, includeInCash: true, allocMethod: 'DIRECT', isCapex: false, icon: '🛎️', color: '#f59e0b', sortOrder: 2 },
  { code: 'other_rev', name: 'Other income', stdGroup: 'Revenue', opType: 'income', classifier: 'revenue', pnlLine: 'Other income', includeInPnl: true, includeInCash: true, allocMethod: 'DIRECT', isCapex: false, icon: '💰', color: '#84cc16', sortOrder: 3 },
  { code: 'variable', name: 'Variable costs', stdGroup: 'COGS', opType: 'expense', classifier: 'variable', pnlLine: 'Variable costs', includeInPnl: true, includeInCash: true, allocMethod: 'DIRECT', isCapex: false, icon: '📦', color: '#991b1b', sortOrder: 4 },
  { code: 'rent', name: 'Rent', stdGroup: 'OPEX', opType: 'expense', classifier: 'operational', pnlLine: 'Rent', includeInPnl: true, includeInCash: true, allocMethod: 'RENT', isCapex: false, icon: '🏢', color: '#6366f1', sortOrder: 5 },
  { code: 'utilities', name: 'Utilities', stdGroup: 'OPEX', opType: 'expense', classifier: 'operational', pnlLine: 'Utilities', includeInPnl: true, includeInCash: true, allocMethod: 'UTILITIES', isCapex: false, icon: '🔌', color: '#8b5cf6', sortOrder: 6 },
  { code: 'payroll', name: 'Payroll', stdGroup: 'OPEX', opType: 'expense', classifier: 'operational', pnlLine: 'Payroll', includeInPnl: true, includeInCash: true, allocMethod: 'SHARED_PAYROLL', isCapex: false, icon: '👥', color: '#a855f7', sortOrder: 7 },
  { code: 'marketing', name: 'Marketing', stdGroup: 'OPEX', opType: 'expense', classifier: 'operational', pnlLine: 'Marketing', includeInPnl: true, includeInCash: true, allocMethod: 'HQ', isCapex: false, icon: '📢', color: '#ec4899', sortOrder: 8 },
  { code: 'professional', name: 'Professional services', stdGroup: 'OPEX', opType: 'expense', classifier: 'operational', pnlLine: 'Professional services', includeInPnl: true, includeInCash: true, allocMethod: 'HQ', isCapex: false, icon: '💼', color: '#14b8a6', sortOrder: 9 },
  { code: 'consumables', name: 'Consumables', stdGroup: 'OPEX', opType: 'expense', classifier: 'operational', pnlLine: 'Consumables', includeInPnl: true, includeInCash: true, allocMethod: 'HQ', isCapex: false, icon: '🧹', color: '#78716c', sortOrder: 10 },
  { code: 'other_exp', name: 'Other expenses', stdGroup: 'OPEX', opType: 'expense', classifier: 'operational', pnlLine: 'Other expenses', includeInPnl: true, includeInCash: true, allocMethod: 'HQ', isCapex: false, icon: '📋', color: '#6b7280', sortOrder: 11 },
  { code: 'taxes', name: 'Taxes', stdGroup: 'Taxes', opType: 'expense', classifier: 'tax', pnlLine: 'Taxes', includeInPnl: true, includeInCash: true, allocMethod: 'HQ', isCapex: false, icon: '🏛️', color: '#334155', sortOrder: 12 },
  { code: 'capex', name: 'Capital expenditure', stdGroup: 'CAPEX', opType: 'expense', classifier: 'capex', pnlLine: 'CAPEX', includeInPnl: false, includeInCash: true, allocMethod: 'NONE', isCapex: true, icon: '🏗️', color: '#0ea5e9', sortOrder: 13 },
  { code: 'investors', name: 'Financing', stdGroup: 'Financing', opType: 'income', classifier: 'financing', pnlLine: 'Financing', includeInPnl: false, includeInCash: true, allocMethod: 'NONE', isCapex: false, icon: '🏦', color: '#059669', sortOrder: 14 },
  { code: 'transfer', name: 'Transfer', stdGroup: 'Transfer', opType: 'transfer', classifier: 'other', pnlLine: 'Transfer', includeInPnl: false, includeInCash: true, allocMethod: 'NONE', isCapex: false, icon: '↔️', color: '#94a3b8', sortOrder: 15 },
];

/**
 * Осі за групою обліку — ОДНЕ правило на весь продукт (Р13.5).
 *
 * Правило «вивести вісь із `stdGroup`» жило у трьох місцях і в двох із них
 * розходилося з засівом:
 *
 *   - `expense-categories.handlers.ts` (стаття, яку заводить сам готель) казав
 *     `Financing → expense`;
 *   - засів каже `investors: Financing, opType 'income'` (рядок нижче);
 *   - легасі-бекфіл у `db.ts` не мав `Financing` у жодному `WHEN` узагалі, тож
 *     стаття діставала `other/other`.
 *
 * Наслідок був не в коді, а в грошах: готель, який заводив ВЛАСНУ статтю
 * фінансування, діставав статтю, якої немає у формі надходження — тобто внесок
 * власника нікуди було провести; а стаття з `other/other` клала цей внесок у
 * «Інше» нижче EBITDA, і чистий результат зменшувався на суму, яку в готель
 * ПРИНЕСЛИ.
 *
 * Джерело правди тут, бо саме цей файл сіє. `Financing → income` — за засівом.
 *
 * ЧЕКПОІНТ, свідомо лишений відкритим: чи має «Financing» бути видимим і у
 * формі надходження, і у формі витрати (внесок і повернення позики — це різні
 * боки однієї групи). Це питання про форму обліку, не про код; варіанти в
 * `docs/tasks/2026-09-09-finance-reference-ownership.notes.md`. Доти діє одне
 * правило замість трьох різних.
 *
 * Рядок плану може відхилитись від своєї групи — і два відхиляються навмисно:
 * `variable` (COGS, але власний рядок P&L «Змінні») і `investors` (Financing,
 * але надходження). Тому значення в `CHART_OF_ACCOUNTS` явні: ця мапа —
 * правило для статей, яких у плані немає.
 */
export const AXIS_BY_STD_GROUP: Record<string, { opType: string; classifier: string }> = {
  Revenue:   { opType: 'income',   classifier: 'revenue' },
  COGS:      { opType: 'expense',  classifier: 'cogs' },
  OPEX:      { opType: 'expense',  classifier: 'operational' },
  Taxes:     { opType: 'expense',  classifier: 'tax' },
  CAPEX:     { opType: 'expense',  classifier: 'capex' },
  Financing: { opType: 'income',   classifier: 'financing' },
  Transfer:  { opType: 'transfer', classifier: 'other' },
};

/**
 * Осі, які знає читач звітів. Стаття, чий `classifier` не з цього списку, —
 * не «Інше», а НЕВІДОМЕ: читач П&L називає її і відмовляється (інваріант 13).
 */
export const KNOWN_CLASSIFIERS = [
  'revenue', 'cogs', 'variable', 'operational', 'tax', 'capex', 'financing',
  'other', 'uncategorized',
] as const;

/**
 * Яку вісь стаття МУСИТЬ мати — за `code`, а якщо коду немає, за `std_group`.
 *
 * Порядок не переставляється, і це не стиль (Р13.6). Два рядки плану навмисно
 * відхиляються від своєї групи: `variable` має `stdGroup: 'COGS'`, але власний
 * рядок P&L «Змінні», а `investors` має `stdGroup: 'Financing'` і є
 * НАДХОДЖЕННЯМ. Лікування за самою лише групою переписало б обидва — тобто
 * зламало б рівно ті рядки, заради яких значення в плані стоять явно.
 *
 * `null` означає «правила для цієї групи немає»: група, якої не знає ні план,
 * ні `AXIS_BY_STD_GROUP`. Таку статтю не вгадують — її НАЗИВАЮТЬ (інваріант
 * 13), бо будь-яке вгадане значення тут це гроші в чужому рядку звіту.
 */
export function expectedAxis(
  code: string | null | undefined,
  stdGroup: string | null | undefined,
): { opType: string; classifier: string } | null {
  const byCode = code ? CHART_OF_ACCOUNTS.find((a) => a.code === code) : undefined;
  if (byCode) return { opType: byCode.opType, classifier: byCode.classifier };
  const group = (stdGroup || '').trim();
  return AXIS_BY_STD_GROUP[group] || null;
}

/**
 * Чи розходиться нинішня вісь рядка з тією, яку він мусить мати.
 *
 * ПОРОЖНЯ вісь — окремий випадок неправильної, а не єдиний. Скрипт лікування,
 * міграція 0097 і `--list` рахували саме порожні (`NULL`/`''`) — і мовчали про
 * рядки, яким легасі-бекфіл поставив НЕПОРОЖНЄ й неправильне: `std_group =
 * 'Financing'` не потрапляв у жоден його `WHEN`, тож `investors` діставав
 * `other/other`, і надходження від інвестора рахувалося виручкою. «Без осей: 0»
 * при цьому виглядало як «усе гаразд».
 */
export function axisIsWrong(row: {
  code?: string | null; std_group?: string | null;
  op_type?: string | null; classifier?: string | null;
}): boolean {
  const want = expectedAxis(row.code, row.std_group);
  if (!want) return false;   // невідома група — не «неправильна», а неназвана
  return (row.op_type || '') !== want.opType
    || (row.classifier || '') !== want.classifier;
}

/** Бізнес-юніт. Той самий клас проблеми, той самий вигляд рішення. */
export interface BusinessUnitSeed {
  code: string;
  name: string;
  unitType: string;
  isShared: boolean;
  sortOrder: number;
}

/**
 * Лише два структурні юніти, без яких не збереться жоден P&L. Справжні
 * бізнес-юніти готелю (його ресторан, його велнес, його корпуси) — його
 * власні: засів чужої структури показував би клієнтові чужу оргсхему.
 */
export const BUSINESS_UNITS: BusinessUnitSeed[] = [
  { code: 'shared', name: 'Shared / HQ', unitType: 'Shared / HQ', isShared: true, sortOrder: 1 },
  { code: 'review', name: 'To review', unitType: 'Unassigned / review', isShared: false, sortOrder: 2 },
];

/** Історичні літеральні ключі → код. Читає лише міграція, яка їх підписує. */
export const LEGACY_CATEGORY_IDS: Record<string, string> = Object.fromEntries(
  CHART_OF_ACCOUNTS.map((a) => [`ec_${a.code}`, a.code]));

/** Те саме для бізнес-юнітів: `bu_shared` і `bu_review`. */
export const LEGACY_UNIT_IDS: Record<string, string> = Object.fromEntries(
  BUSINESS_UNITS.map((u) => [`bu_${u.code}`, u.code]));

/**
 * Знайти статтю ЦЬОГО готелю за сталим кодом.
 *
 * Саме сюди впирається кожна готівкова оплата: доти в містку стояв літерал
 * `'ec_accommodation'`, тобто ідентифікатор рядка, який належить готелю, що
 * завівся першим. `null` — стаття не заведена; викликач вирішує сам, і мовчки
 * підставляти чужу не має права (інваріант 13).
 *
 * Орендар тут із КОНТЕКСТУ, не з аргументу: функція кличеться зсередини
 * запиту, де він уже стоїть на зʼєднанні (інваріант 11).
 */
export async function categoryIdByCode(code: string): Promise<string | null> {
  const { getSql } = await import('./db/async.ts');
  const { requireOrganizationId } = await import('./auth/tenant-context.ts');
  const organizationId = await requireOrganizationId();
  const row = await getSql().row<{ id: string }>(
    'SELECT id FROM expense_categories WHERE organization_id = ? AND code = ?',
    [organizationId, code]);
  return row ? String(row.id) : null;
}
