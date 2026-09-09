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
 *   `names`   — `property_id` стоїть у ФІЛЬТРІ, тобто після першого `FROM`
 *               (`WHERE`, `JOIN … ON`, `USING`), або в оператор вставлено
 *               фрагмент від `propertyScopeFilter()` — тоді область прийшла
 *               ТИПОМ, і `{ kind: 'all' }` сказано словом вище за течією;
 *   `silent`  — оператор визначений і `property_id` у фільтрі не має;
 *   `unknown` — умова приїздить підстановкою, і статично не видно, що в ній.
 *
 * Храповик рахує **«не доведено» = silent + unknown**. Запит, що переїхав з
 * `unknown` у `names`, опускає стелю законно; той, що переїхав у `silent`, не
 * міняє нічого.
 *
 * ── Сліпа пляма цього означення, названа навмисно ───────────────────────
 *
 * `names` тут означає «`property_id` є у фільтрі», а не «фільтр обмежує ОДНИМ
 * обʼєктом». Тому `JOIN properties p ON p.id = u.property_id WHERE
 * p.organization_id = ?` рахується названим, хоч це вісь ОРЕНДАРЯ — «усі
 * обʼєкти цього рахунку», тобто рівно та форма, з якої почався INC-029.
 * Суворіше означення («`property_id` проти параметра») на тому самому дереві
 * дає на 100 операторів більше в «не доведено», і серед них є справжня діра
 * (`src/app/api/checklists/route.ts:28` — брудні номери ВСІХ обʼєктів рахунку).
 *
 * Означення лишається спільним, а не виправляється тут мовчки: три сесії
 * міряють одним інструментом, і зміна означення — рішення контролера, не
 * сесії. `strictNames` нижче рахує суворий варіант ПОРУЧ, щоб розмір ями був
 * видно числом, а не на слово.
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

/** Двері області: усе, що з них виходить, — це названа область. */
const SCOPE_DOOR = 'propertyScopeFilter';

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

/** Спільне означення: `property_id` будь-де у фільтрі. */
const NAMED_IN_FILTER = /property_id/i;

/**
 * Суворе означення — обмеження ОДНИМ обʼєктом, названим параметром.
 * Рахується поруч і в стелю не входить: див. «сліпа пляма» в шапці.
 */
const STRICTLY_NAMED = [
  /property_id\s*(?:=|<>|!=)\s*(?:\?|\$\d+|:\w+)/i,
  /property_id\s*(?:=|<>|!=)\s*\w+\.property_id\b/i,
  /property_id\s+(?:NOT\s+)?IN\s*\(\s*(?!SELECT\b)/i,
];

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
      && node.initializer.expression.getText(file).includes(SCOPE_DOOR)) {
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
 * `[{ line, table, tables, verdict, strict }]`, де `verdict` — кошик за
 * спільним означенням (`names`/`silent`/`unknown`), а `strict` — той самий
 * кошик за суворим означенням; у стелю входить `verdict`.
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
    const fromDoor = subs.some((s) => s.includes(SCOPE_DOOR)
      || [...fragments].some((n) => new RegExp(`\\b${n}\\b`).test(s)));

    const bucket = (named) => (named ? 'names' : (subs.length > 0 ? 'unknown' : 'silent'));
    const verdict = bucket(fromDoor || NAMED_IN_FILTER.test(where));
    const strict = bucket(fromDoor || STRICTLY_NAMED.some((re) => re.test(where)));

    const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
    // Одиниця — ПАРА «оператор × таблиця»: запит на три scoped-таблиці це три
    // одиниці. Так рахує спільний інструмент трьох сесій.
    for (const table of tables) found.push({ line, table, tables, verdict, strict });
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
