/**
 * Вісь обʼєкта в запитах — розбором AST, а не регуляркою по літералах.
 *
 * Спільний інструмент трьох сесій блоку INC-029 (рішення контролера
 * 09.09.2026). Три сесії, що міряють трьома способами, дадуть три базлайни й
 * жодного храповика, тому вимір один і живе окремо від гейта, який його вживає.
 *
 * ── Чому AST, а не скан рядкових літералів ──────────────────────────────
 *
 * Перша редакція гейта різала файл на літерали регуляркою. Вона робила три
 * речі неправильно, і всі три виміряні:
 *
 *   1. **Шматувала запит.** `` `SELECT … ${cols} … FROM units` `` — це ОДИН
 *      оператор, а скан бачив два уламки навколо підстановки. Одиниця обліку
 *      мусить бути одна на всі три сесії, інакше стелі опускаються на різні
 *      числа за ту саму роботу.
 *   2. **Не мала третього кошика.** Запит, чия умова приїздить підстановкою
 *      (`WHERE ${where}`), статично не можна назвати ні «називає обʼєкт», ні
 *      «мовчить». Скан клав його в «мовчить» — і базлайн спадав САМ СОБОЮ,
 *      щойно хтось переписував динамічний запит на статичний.
 *   3. **Вважала «названим» будь-яку згадку `property_id`** — зокрема в
 *      СПИСКУ КОЛОНОК, тобто там, де поле повертається, а не фільтрує. Саме
 *      цією помилкою `fin_folios` виглядав як «4 названі / 6 мовчазних»,
 *      а насправді має НУЛЬ названих читань (вимір сесії 1).
 *
 * Пункт 3 — не дрібниця лічильника: він вирішує, які таблиці потрапляють у
 * список тривоги, тобто з чого починати роботу.
 *
 * ── Одиниця обліку ──────────────────────────────────────────────────────
 *
 * **Пара «оператор × scoped-таблиця».** Оператор — склеєний шаблон разом із
 * підстановками (не літерал і не уламок); якщо він читає три таблиці з
 * `property_id` одним джойном, це три одиниці.
 *
 * Одиницю встановив контролер, а звірка її підтвердила числом: на `05af394`
 * цей розбір дає 597 пар при 470 операторах, а сесія 1 доповіла 596, і
 * «не доведено» збігається ТОЧНО — 372 і 372. Одиниця «оператор» дала б 297,
 * тобто інший базлайн за ту саму роботу. Одиниця одна на три сесії, інакше
 * храповика немає.
 *
 * Склеюється: шаблонний рядок із `${…}` (текст підстановки лишається маркером),
 * конкатенація через `+`, звичайні лапки. Коментарі не потрапляють у розбір за
 * побудовою, а не тому, що їх вирізали (AGENTS §4, остання теза). Вкладені
 * вузли не рахуються вдруге: де текст зібрано повністю, туди розбір не заходить.
 *
 * ── Три кошики ──────────────────────────────────────────────────────────
 *
 *   `names`   — читання ОБМЕЖЕНЕ обʼєктом: `property_id` порівняно з
 *               параметром після першого `FROM` (`WHERE`, `JOIN … ON`,
 *               `USING`), або зчеплено з `property_id` іншої таблиці того ж
 *               запиту, або в оператор вставлено фрагмент від
 *               `propertyScopeFilter()` — тоді область прийшла ТИПОМ, і
 *               `{ kind: 'all' }` сказано словом вище за течією;
 *   `silent`  — оператор визначений і обʼєктом не обмежений;
 *   `unknown` — умова приїздить підстановкою, і статично не видно, що в ній.
 *
 * Храповик рахує **«не доведено» = silent + unknown**. Запит, що переїхав з
 * `unknown` у `names`, опускає стелю законно; той, що переїхав у `silent`, не
 * міняє нічого.
 *
 * ── Чому «є у фільтрі» замінено на «обмежує» ────────────────────────────
 *
 * Перше означення казало «`property_id` СТОЇТЬ у фільтрі», і під нього
 * підпадала вісь ОРЕНДАРЯ:
 *
 *   FROM units u JOIN properties p ON p.id = u.property_id
 *    WHERE p.organization_id = ?
 *
 * Це «усі обʼєкти цього рахунку» — рівно та форма, з якої почався INC-029, і
 * вона рахувалась захищеною. Різниця виміряна: 137 пар у 45 файлах, і серед
 * них справжня діра `src/app/api/checklists/route.ts:28` — брудні номери ВСІХ
 * обʼєктів рахунку в чеклісті покоївки одного з них.
 *
 * Звуження ухвалив контролер 09.09.2026 після звірки; список 137 пар —
 * `docs/tasks/2026-09-09-INC-029-tenant-join-list.md`. `loose` нижче лишається
 * порахованим ПОРУЧ, щоб той список відтворювався командою, а не пам'яттю.
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

/**
 * Межі підстановки в склеєному тексті — керівні символи, яких у SQL не буває.
 * За ними видно і ЩО підставили, і те, що в цьому місці умова приїхала ззовні.
 */
const SUB_OPEN = '\u0001';
const SUB_CLOSE = '\u0002';

/**
 * Двері області: усе, що з них виходить, — це названа область.
 *
 * Їх двоє, і різниця не косметична. `propertyScopeFilter` дає
 * `property_id = ?`; `propertyOrSharedFilter` — `(property_id = ? OR
 * property_id IS NULL)` для таблиць, де NULL означає «спільне для рахунку»
 * (`tasks`, `task_projects` — О14). Обидва означають «область прийшла типом»,
 * тож для гейта вони рівні; список, а не підрядок, — щоб треті двері не
 * зʼявились непоміченими через збіг імені.
 */
const SCOPE_DOORS = ['propertyScopeFilter', 'propertyOrSharedFilter'];

/** Таблиці з `property_id` — зі згенерованої схеми, не зі списку в голові. */
export function propertyScopedTables(root) {
  // `\r?\n` і зріз '\r': на Windows-копії схема лежить із CRLF, і якір `$` без
  // цього не збігається жодного разу (INC-009 ч.2 — гейт, який мовчить).
  const schema = fs.readFileSync(path.join(root, 'db/postgres/schema.sql'), 'utf8');
  const out = new Set();
  for (const m of schema.matchAll(/CREATE TABLE "(\w+)" \(([\s\S]*?)\r?\n\);/g)) {
    if (/"property_id"/.test(m[2])) out.add(m[1]);
  }
  return out;
}

/** Параметр — те, що приїжджає значенням: `?`, `$1`, `:name`. Не літерал. */
const PARAM = String.raw`(?:\?|\$\d+|:\w+)`;

/**
 * Чинне означення: читання ОБМЕЖЕНЕ названим обʼєктом.
 *
 * Форми — обмеження, а не згадка: проти параметра, зчеплення з `property_id`
 * іншої таблиці запиту (обмеження переноситься джойном), список параметрів, і
 * нуль-безпечне порівняння проти параметра. `IN (SELECT …)` сюди не входить
 * навмисно — це підзапит по `properties`, тобто вісь орендаря.
 *
 * Нуль-безпечні форми додано 09.09.2026, і не для повноти. `IS NOT DISTINCT
 * FROM ?` — це те, ЧИМ звужують NULLABLE-колонку: `= ?` там мовчки викидає
 * рядки з NULL. Фікс INC-033 (`reports/data/partner-report.repo.ts`) написаний
 * саме так, і вимір давав про нього дві неправильні відповіді нараз: «мовчить»
 * у стелі і рядок у списку осі орендаря. Помилка обмежувальна, не дозвільна —
 * дірки вона не пропускає, — але напрямок поганий: правильне звуження кредиту
 * не отримувало, а перепис на `= ?` (регресія!) опускав стелю і діставав
 * похвалу. Гейт, який винагороджує ваду, — AGENTS §3.2.1.
 *
 * `IS ?` — те саме діалектом SQLite. `IS NOT NULL` під ці форми НЕ підпадає:
 * там, де стоїть `PARAM`, `NULL` не збігається, а «колонка заповнена» — це не
 * «цей будинок».
 */
const NAMED_IN_FILTER = [
  new RegExp(String.raw`property_id\s*(?:=|<>|!=)\s*${PARAM}`, 'i'),
  /property_id\s*(?:=|<>|!=)\s*\w+\.property_id\b/i,
  /property_id\s+(?:NOT\s+)?IN\s*\(\s*(?!SELECT\b)/i,
  new RegExp(String.raw`property_id\s+IS\s+(?:NOT\s+)?DISTINCT\s+FROM\s+${PARAM}`, 'i'),
  new RegExp(String.raw`property_id\s+IS\s+(?:NOT\s+)?${PARAM}`, 'i'),
];

/**
 * Форми, які нічого не обмежують і які ми РОЗУМІЄМО, — вирізаються перед
 * питанням «чи тут є обмеження, якого ми не знаємо».
 *
 * Кожна з трьох зустрічається в дереві, і кожна не є обмеженням на область:
 *
 *   `property_id IN (SELECT … FROM properties …)` — вісь ОРЕНДАРЯ підзапитом;
 *   `x.property_id = p.id`                        — вісь орендаря ДЖОЙНОМ;
 *   `property_id IS [NOT] NULL`                   — «колонка заповнена».
 *
 * Друга — найважливіша, і вона знайшлася першим же прогоном цієї правки. Джойн
 * пишуть обома боками: `ON p.id = r.property_id` і `ON r.property_id = p.id`.
 * Перше формулювання цього правила питало «чи стоїть property_id ліворуч від
 * оператора» — і тоді ОДИН І ТОЙ САМИЙ джойн діставав різний кошик залежно від
 * того, як його набрав автор. Це рівно §3.2.1: візерунок треба вгадати,
 * властивість — ні.
 *
 * Властивість тут така: **обмежує те, що порівнюється зі ЗНАЧЕННЯМ**
 * (параметр, літерал, виклик, діапазон). Порівняння з КОЛОНКОЮ обмеження не
 * накладає, а переносить, — це джойн.
 */
const NOT_A_CONSTRAINT = [
  /property_id\s+(?:NOT\s+)?IN\s*\(\s*SELECT\b/gi,
  // `= p.id`, `= prop.id`: праворуч колонка, а не значення. `(?!\s*\()` —
  // щоб `= ANY(?)` і будь-який виклик сюди не потрапили.
  /property_id\s*(?:=|<>|!=)\s*\w+(?:\.\w+)?\b(?!\s*\()/gi,
  /property_id\s+IS\s+(?:NOT\s+)?NULL\b/gi,
];

/**
 * Що лишилось після вирізання: `property_id` поруч із оператором порівняння.
 *
 * Набір операторів у SQL закритий і малий — на відміну від набору ФОРМ, у які
 * їх складають, — тому питання «чи щось обмежує» ставиться операторами, а
 * питання «чи це те обмеження, яке нам треба» лишається за `NAMED_IN_FILTER`.
 */
const CONSTRAINED_SOMEHOW =
  /\bproperty_id\s*(?:=|<>|!=|<=|>=|<|>|\bIS\b|\bIN\b|\bBETWEEN\b|\bLIKE\b)/i;

/**
 * Означення до звуження — «`property_id` будь-де у фільтрі».
 * Рахується поруч і в стелю НЕ входить: пара, названа ним і не названа чинним,
 * — це вісь орендаря, вдягнена як вісь обʼєкта, і саме з таких складається
 * список 137.
 */
const LOOSELY_NAMED = /property_id/i;

/** Склеєний текст SQL-виразу, або `null`, якщо вузол текстом не є. */
function glue(node, source) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    let out = node.head.text;
    for (const span of node.templateSpans) {
      out += SUB_OPEN + span.expression.getText(source) + SUB_CLOSE + span.literal.text;
    }
    return out;
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = glue(node.left, source);
    const right = glue(node.right, source);
    if (left === null && right === null) return null;
    return (left ?? SUB_OPEN + node.left.getText(source) + SUB_CLOSE)
      + (right ?? SUB_OPEN + node.right.getText(source) + SUB_CLOSE);
  }
  if (ts.isParenthesizedExpression(node)) return glue(node.expression, source);
  return null;
}

/**
 * Імена, за якими в цьому файлі лежить фрагмент області.
 *
 * `const filter = propertyScopeFilter(scope, 'u')` дає `filter`;
 * `const { sql: scopeSql } = propertyScopeFilter(…)` дає `scopeSql`. Без цього
 * `${filter.sql}` виглядав би як звичайна підстановка, тобто «невизначений», —
 * і переведення читача на двері не опускало б стелю, хоч воно і є лікуванням.
 */
function scopeFragmentNames(file) {
  const names = new Set();
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.initializer
      && ts.isCallExpression(node.initializer)
      && SCOPE_DOORS.some((d) => node.initializer.expression.getText(file).includes(d))) {
      if (ts.isIdentifier(node.name)) names.add(node.name.text);
      else if (ts.isObjectBindingPattern(node.name)) {
        for (const el of node.name.elements) {
          if (ts.isIdentifier(el.name)) names.add(el.name.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(file, visit);
  return names;
}

/** Текст після ПЕРШОГО `FROM` — усе, що фільтрує; список колонок сюди не входить. */
function filterPart(text) {
  const m = /\bFROM\b/i.exec(text);
  return m ? text.slice(m.index) : '';
}

/** Тексти підстановок склеєного оператора. */
function substitutions(text) {
  return [...text.matchAll(/\u0001([\s\S]*?)\u0002/g)].map((m) => m[1]);
}

/**
 * Читання scoped-таблиць в одному файлі — по одному запису на ПАРУ
 * «оператор × таблиця».
 *
 * `[{ line, table, tables, verdict, loose, tenantJoinOnly, sql }]`, де
 * `verdict` — чинний кошик (`names`/`silent`/`unknown`) і саме він входить у
 * стелю, `loose` — кошик за означенням до звуження, `tenantJoinOnly` — пара,
 * яку старе означення рахувало названою, а чинне не рахує.
 */
export function scanSource(source, fileName, scopedTables) {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const fragments = scopeFragmentNames(file);
  const found = [];

  const visit = (node) => {
    const text = glue(node, file);
    // Вузол без тексту або текст без `SELECT` — заходимо всередину: вираз
    // `helper(x) + ' AND …'` склеюється в текст без запиту, а запит може
    // лежати в самому `helper(x)`. Зайвого підрахунку це не дає — оператор
    // лічиться там, де його текст ЗІБРАНО повністю, і туди ми вже не заходимо.
    if (text === null || !/\bSELECT\b/i.test(text)) { ts.forEachChild(node, visit); return; }

    const tables = [...new Set(
      [...text.matchAll(/\b(?:FROM|JOIN)\s+"?(\w+)"?\b/gi)].map((m) => m[1]).filter((t) => scopedTables.has(t)),
    )];
    if (tables.length === 0) return;

    const where = filterPart(text);
    const subs = substitutions(where);
    const fromDoor = subs.some((s) => SCOPE_DOORS.some((d) => s.includes(d))
      || [...fragments].some((n) => new RegExp(`\\b${n}\\b`).test(s)));

    // Невпізнана форма — це ТРЕТІЙ стан, а не «осі немає».
    //
    // Доти `unknown` видавався ЛИШЕ на підстановку, тож форма, яку видно
    // очима (`= ANY(?)`, `BETWEEN ? AND ?`, до 09.09 і `IS NOT DISTINCT FROM
    // ?`), падала в `silent` — нерозрізненно від запиту, у якому осі немає
    // взагалі. «Не доведено» від цього не міняється (стеля рахує silent +
    // unknown), але невпізнана форма більше не спадає САМА СОБОЮ, і її видно
    // в розбивці.
    //
    // Вісь ОРЕНДАРЯ підзапитом сюди не потрапляє навмисно: цю форму інструмент
    // знає точно — він же й ставить їй `tenantJoinOnly`, — тож вона лишається
    // `silent`. Тому підзапит вирізається ПЕРЕД питанням «чи щось обмежує».
    const stripped = NOT_A_CONSTRAINT.reduce((t, re) => t.replace(re, ' '), where);
    const constrainedUnrecognised = CONSTRAINED_SOMEHOW.test(stripped);
    const bucket = (named) => (named
      ? 'names'
      : (subs.length > 0 || constrainedUnrecognised ? 'unknown' : 'silent'));
    const verdict = bucket(fromDoor || NAMED_IN_FILTER.some((re) => re.test(where)));
    const loose = bucket(fromDoor || LOOSELY_NAMED.test(where));
    // Вісь орендаря, вдягнена як вісь обʼєкта: старе означення рахувало це
    // названим, чинне — ні. Саме з таких пар складається список 137.
    const tenantJoinOnly = loose === 'names' && verdict !== 'names';

    const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
    // Одиниця — ПАРА «оператор × таблиця»: запит на три scoped-таблиці це три
    // одиниці. Так рахує спільний інструмент трьох сесій.
    for (const table of tables) {
      found.push({ line, table, tables, verdict, loose, tenantJoinOnly, sql: where.replace(/\s+/g, ' ').slice(0, 160) });
    }
  };

  ts.forEachChild(file, visit);
  return found.sort((a, b) => a.line - b.line || a.table.localeCompare(b.table));
}

/** Файли, які вимірюються: увесь `src/`, крім самих перевірок. */
export function sourceFiles(root) {
  const out = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (/\.tsx?$/.test(e.name) && !/\.check\.tsx?$/.test(e.name)) out.push(p);
    }
  })(path.join(root, 'src'));
  return out;
}
