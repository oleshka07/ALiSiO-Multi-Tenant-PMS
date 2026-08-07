/**
 * Wrap the interface's Ukrainian text in t(), so it can be translated.
 *
 *   node scripts/extract-strings.mjs --dry            # report, change nothing
 *   node scripts/extract-strings.mjs <path> [<path>]  # rewrite those files
 *   node scripts/extract-strings.mjs --all            # the whole operator UI
 *
 * Parsed with the TypeScript compiler, not matched with regexes. The thing
 * being edited is 95 files of working JSX with nested expressions, ternaries
 * and template literals in it; a regex that is 99% right across 3,500 edits is
 * wrong 35 times, and each one is a broken screen.
 *
 * What it touches, and nothing else:
 *
 *   <div>Текст</div>              → <div>{t('Текст')}</div>
 *   placeholder="Текст"           → placeholder={t('Текст')}
 *   showToast('Збережено')        → showToast(t('Збережено'))
 *   {STATUS_MAP[b.status].label}  → {t(STATUS_MAP[b.status].label)}
 *
 * Attributes are an allow-list, not a deny-list: className, href, id and
 * friends look like text and are not.
 *
 * That last case is the tab strip, the status dropdown, the month names and
 * the settings tiles — text that never appears as JSX at all, because it lives
 * in a module-level table. Its literals cannot be wrapped where they are
 * written (module scope, where no hook runs), so the wrap goes on the render
 * site and the constant's literals are what land in the catalogue. Which names
 * count is decided by provenance, not by property name; see trackConstants.
 *
 * What it refuses to touch, and says so:
 *
 *   - files without 'use client' — useT() is a hook, and a server component
 *     calling one fails at build time rather than in review;
 *   - text with HTML entities (&apos;, &nbsp;) — moving those into a string
 *     literal changes what renders;
 *   - JSX inside a function that is not a component, where a hook cannot go.
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {
  CYRILLIC,
  MESSAGE_FUNCTIONS,
  NON_TEXT_PROPERTIES,
  ROOTS,
  TEXT_ATTRIBUTES,
  decodeEntities,
  hasUnknownEntity,
  insideLanguageSwitch,
  isClientComponent,
  isLanguageMap,
  isRenderedPosition,
  isTranslateCall,
  parse,
  renderedText,
  rendersHere,
  walk,
} from './lib/i18n-ast.mjs';

/**
 * Server messages, translated on the client.
 *
 * The API answers in Ukrainian — `{ error: 'Не авторизовано' }` — from
 * hundreds of handlers. Because the dictionary is keyed by the Ukrainian
 * string itself, the client can translate what it receives without a single
 * handler changing: `showToast(data.error)` becomes `showToast(t(data.error))`
 * and an entry for 'Не авторизовано' covers every route that returns it.
 */
const SERVER_MESSAGE = /\.(error|message)$/;

/**
 * String methods that return a piece of the same text.
 *
 * The calendar prints `MONTH_NAMES[m].substring(0, 3)`. Wrapping the whole
 * expression would look up the truncation in the dictionary; wrapping the
 * receiver translates the month and then truncates it, which is what the code
 * meant.
 */
const TEXT_METHODS = /^(substring|slice|toUpperCase|toLowerCase|trim|padStart|padEnd)$/;

/**
 * Labels that live in a constant, not in the JSX.
 *
 * A large part of what a person reads never appears as JSX text at all — the
 * tab strip, the status badge, the month names and the settings tiles are
 * string literals inside a module-level table that the markup renders as
 * `{ZOOM_LEVELS[z].label}`. Wrapping the literal is not an option: it sits at
 * module scope, where a hook cannot run. So the wrap goes on the render site
 * instead, and the constant's literals are what land in the catalogue.
 *
 * Which names qualify is decided by where the value came from, not by what it
 * is called: a name is tracked only if it is a module-level `const` holding
 * Ukrainian literals, or is bound from one — `Object.entries(MAP).map(([k, v]) => …)`,
 * `for (const row of ROWS)`. That distinction matters. Wrapping by property
 * name instead would also catch `{unit.label}`, where the text is the hotel's
 * own data, and a unit someone named «Номери» would render to a German user as
 * «Zimmer».
 */
const DERIVING_METHODS = /^(map|flatMap|filter|find|forEach|sort|some|every|slice)$/;

/**
 * Where an import specifier lives on disk.
 *
 * The role labels are `ROLE_LABELS` in `@core/auth/permissions`, and the
 * screens that show them import the table rather than declaring it. Without
 * this, «Власник / Директор / Рецепціоніст» stays Ukrainian on a German
 * hotel's users screen with nothing to explain why.
 *
 * The aliases come from tsconfig, so this follows the same map the compiler
 * does instead of a second, drifting copy.
 */
const ALIASES = (() => {
  const json = fs.readFileSync('tsconfig.json', 'utf8').replace(/^\s*\/\/.*$/gm, '');
  const paths = JSON.parse(json).compilerOptions?.paths ?? {};
  return Object.entries(paths).map(([pattern, [target]]) => ({
    prefix: pattern.replace(/\*$/, ''),
    target: target.replace(/^\.\//, '').replace(/\*$/, ''),
    wildcard: pattern.endsWith('*'),
  }));
})();

function resolveImport(specifier, fromFile) {
  let base = null;
  if (specifier.startsWith('.')) {
    base = path.join(path.dirname(fromFile), specifier);
  } else {
    const alias = ALIASES.filter((a) => specifier.startsWith(a.prefix)).sort(
      (a, b) => b.prefix.length - a.prefix.length,
    )[0];
    if (!alias) return null;
    base = alias.wildcard ? alias.target + specifier.slice(alias.prefix.length) : alias.target;
  }
  for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Exported module-level constants of a file, and their Ukrainian literals.
 *
 * Cached: the users screen, the sidebar and three settings tabs all import the
 * same permissions module, and re-parsing it per importer is the difference
 * between a codemod that runs in a second and one nobody runs.
 */
const importedConstantsCache = new Map();
function importedConstants(file) {
  const cached = importedConstantsCache.get(file);
  if (cached) return cached;

  const result = new Map();
  importedConstantsCache.set(file, result);
  const source = parse(file, fs.readFileSync(file, 'utf8'));

  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const exported = statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      // A function's literals are not a table of labels, and its result is not
      // something a render site can be assumed to display.
      if (
        ts.isArrowFunction(declaration.initializer) ||
        ts.isFunctionExpression(declaration.initializer)
      ) {
        continue;
      }
      const found = new Set();
      const collect = (node) => {
        if (
          (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
          CYRILLIC.test(node.text)
        ) {
          found.add(renderedText(node.text));
        }
        ts.forEachChild(node, collect);
      };
      collect(declaration.initializer);
      if (found.size) result.set(declaration.name.text, found);
    }
  }
  return result;
}

// ─── emit a JS string literal for arbitrary text ─────────────────────────────
function literal(text) {
  return `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
}

/**
 * Is the name `t` already taken in this file?
 *
 * The booking widget carries its own `t` — a translations object, not a
 * function — and several finance tabs bind `t` as a row variable. Declaring a
 * second one shadows theirs and the file stops compiling, which is how the
 * first run of this produced 83 errors. When the name is taken, the hook goes
 * in under another one.
 */
function nameIsTaken(source, name) {
  let taken = false;
  const check = (node) => {
    if (taken) return;
    if (
      (ts.isVariableDeclaration(node) ||
        ts.isParameter(node) ||
        ts.isImportSpecifier(node) ||
        ts.isBindingElement(node) ||
        ts.isFunctionDeclaration(node)) &&
      node.name &&
      ts.isIdentifier(node.name) &&
      node.name.text === name
    ) {
      taken = true;
      return;
    }
    ts.forEachChild(node, check);
  };
  check(source);
  return taken;
}

/**
 * The nearest enclosing function that a hook may be called in — a component.
 * Returns null when the JSX lives in a plain helper, which is the case this
 * refuses to edit rather than generating code that fails the rules of hooks.
 */
function enclosingComponent(node) {
  let candidate = null;
  for (let n = node.parent; n; n = n.parent) {
    let name = null;
    let body = null;

    if (ts.isFunctionDeclaration(n)) {
      name = n.name?.text ?? null;
      body = n.body;
    } else if (
      (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) &&
      n.parent &&
      ts.isVariableDeclaration(n.parent) &&
      ts.isIdentifier(n.parent.name)
    ) {
      name = n.parent.name.text;
      body = n.body;
    }

    // A component's name is capitalised; a helper's is not, and useT() cannot
    // legally run inside one.
    if (name && body && ts.isBlock(body) && /^[A-Z]/.test(name)) candidate = { node: n, body };
  }
  return candidate;
}

/** The identifier an expression ultimately reads from, or null. */
function rootIdentifier(node) {
  for (let n = node; n; ) {
    if (ts.isIdentifier(n)) return n.text;
    if (
      ts.isPropertyAccessExpression(n) ||
      ts.isElementAccessExpression(n) ||
      ts.isNonNullExpression(n) ||
      ts.isParenthesizedExpression(n) ||
      ts.isAsExpression(n)
    ) {
      n = n.expression;
    } else if (
      ts.isBinaryExpression(n) &&
      (n.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        n.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
    ) {
      n = n.left;
    } else if (ts.isConditionalExpression(n)) {
      n = n.whenTrue;
    } else {
      // A call — `MONTH_NAMES[i].substring(0, 3)` — is not a label but a
      // derivation of one, and wrapping it would translate the truncation
      // rather than the month.
      return null;
    }
  }
  return null;
}

/**
 * Does any branch of this expression read a field that is not text?
 *
 * Only the value path is inspected, never an index: in
 * `MONTH_NAMES[days[days.length - 1].getMonth()]` the `.length` belongs to the
 * subscript, and reading the whole subtree made this refuse the month name.
 */
function readsNonText(node) {
  for (let n = node; n; ) {
    if (ts.isPropertyAccessExpression(n)) {
      if (NON_TEXT_PROPERTIES.has(n.name.text)) return true;
      n = n.expression;
    } else if (ts.isElementAccessExpression(n)) {
      n = n.expression;
    } else if (
      ts.isNonNullExpression(n) ||
      ts.isParenthesizedExpression(n) ||
      ts.isAsExpression(n)
    ) {
      n = n.expression;
    } else if (ts.isBinaryExpression(n)) {
      return readsNonText(n.left) || readsNonText(n.right);
    } else if (ts.isConditionalExpression(n)) {
      return readsNonText(n.whenTrue) || readsNonText(n.whenFalse);
    } else {
      return false;
    }
  }
  return false;
}

/**
 * What a `.map()` or a `for…of` is actually walking.
 *
 * `Object.entries(STATUS_MAP).map(([k, v]) => …)` is the ordinary way this
 * codebase renders a status dropdown, and the plain root of that expression is
 * `Object`. Looking through the call is what makes `v` a tracked name.
 */
function iterationSource(node) {
  for (let n = node; ; ) {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      ts.isIdentifier(n.expression.expression) &&
      n.expression.expression.text === 'Object' &&
      /^(entries|values|keys)$/.test(n.expression.name.text) &&
      n.arguments.length === 1
    ) {
      n = n.arguments[0];
    } else if (
      // `const tabs = TABS.filter(…)` — narrowing a table of labels leaves a
      // table of labels, and the finance tab strip is built exactly this way.
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      DERIVING_METHODS.test(n.expression.name.text)
    ) {
      n = n.expression.expression;
    } else {
      return rootIdentifier(n);
    }
  }
}

/** Every name a binding pattern introduces. */
function boundNames(name, out = []) {
  if (ts.isIdentifier(name)) out.push(name.text);
  else if (ts.isArrayBindingPattern(name) || ts.isObjectBindingPattern(name)) {
    for (const element of name.elements) {
      if (!ts.isOmittedExpression(element)) boundNames(element.name, out);
    }
  }
  return out;
}

/**
 * Names that hold text from a module-level constant, and which constant it was.
 *
 * The origin is carried through so that a constant contributes to the catalogue
 * only once something actually renders it — otherwise a table nobody displays
 * adds entries no screen can ever show, and they read as missing translations
 * forever.
 */
function trackConstants(source, file) {
  const origin = new Map(); // name → the module constant it came from
  const literals = new Map(); // constant → its Ukrainian literals
  const helpers = new Map(); // same-file function → its Ukrainian literals

  const ukrainianIn = (node) => {
    const found = new Set();
    const collect = (n) => {
      if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && CYRILLIC.test(n.text)) {
        found.add(renderedText(n.text));
      }
      ts.forEachChild(n, collect);
    };
    collect(node);
    return found;
  };

  for (const statement of source.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
        // An arrow at module scope is a helper, not a table of labels — the
        // difference decides whether it is called or subscripted.
        const isFunction =
          ts.isArrowFunction(declaration.initializer) ||
          ts.isFunctionExpression(declaration.initializer);
        const found = ukrainianIn(declaration.initializer);
        if (!found.size) continue;
        if (isFunction) helpers.set(declaration.name.text, found);
        else {
          origin.set(declaration.name.text, declaration.name.text);
          literals.set(declaration.name.text, found);
        }
      }
    } else if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) {
      // `monthLabel(m)` builds its own array of month names and returns one.
      // Its literals are still literals, and its result is still text.
      const found = ukrainianIn(statement.body);
      if (found.size && !/^[A-Z]/.test(statement.name.text)) {
        helpers.set(statement.name.text, found);
      }
    }
  }
  // Imported tables of labels — ROLE_LABELS and friends. Only a module-level
  // const in the imported file counts, by exactly the same rule as a local one.
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const clause = statement.importClause;
    if (!clause?.namedBindings || !ts.isNamedImports(clause.namedBindings)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const wanted = clause.namedBindings.elements.filter((e) => !origin.has(e.name.text));
    if (!wanted.length) continue;
    const target = resolveImport(statement.moduleSpecifier.text, file);
    if (!target) continue;
    const imported = importedConstants(target);
    for (const element of wanted) {
      const found = imported.get((element.propertyName ?? element.name).text);
      if (!found?.size) continue;
      origin.set(element.name.text, element.name.text);
      literals.set(element.name.text, found);
    }
  }

  if (!origin.size && !helpers.size) return { origin, literals, helpers };

  // A row variable is only tracked once the thing it iterates is, so this runs
  // to a fixpoint rather than in a single pass.
  for (let pass = 0; pass < 5; pass++) {
    const before = origin.size;
    const derive = (node) => {
      if (ts.isVariableDeclaration(node) && node.initializer) {
        const from = origin.get(iterationSource(node.initializer));
        if (from) for (const name of boundNames(node.name)) origin.set(name, from);
      } else if (ts.isForOfStatement(node) && ts.isVariableDeclarationList(node.initializer)) {
        const from = origin.get(iterationSource(node.expression));
        if (from) {
          for (const declaration of node.initializer.declarations) {
            for (const name of boundNames(declaration.name)) origin.set(name, from);
          }
        }
      } else if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        DERIVING_METHODS.test(node.expression.name.text)
      ) {
        const from = origin.get(iterationSource(node.expression.expression));
        if (from) {
          for (const argument of node.arguments) {
            if (!ts.isArrowFunction(argument) && !ts.isFunctionExpression(argument)) continue;
            for (const parameter of argument.parameters) {
              for (const name of boundNames(parameter.name)) origin.set(name, from);
            }
          }
        }
      }
      ts.forEachChild(node, derive);
    };
    derive(source);
    if (origin.size === before) break;
  }
  return { origin, literals, helpers };
}

/**
 * A literal written straight into the markup, in a place that renders.
 *
 * `{p === 'day' ? 'День' : 'Все'}` and the column table written inline in the
 * JSX are both text a person reads, and both sit inside the component where
 * the hook is in scope — they simply never became JSX text.
 *
 * The allow-list is the point, and it is narrow on purpose. Inside a rendered
 * expression a Ukrainian literal can also be a **value**: `.includes('Оплачено')`,
 * `status === 'Оплачено'`, `setFilter('Оплачено')`. Translating one of those
 * does not change what a person reads — it changes what the code compares, and
 * the filter quietly stops matching. So: a branch of a ternary, an element of
 * an array, or a field of an object literal, and nothing else.
 */
function inlineLabel(node, source) {
  // `loading ? (<Spinner />) : ('Увійти')` — the parentheses are formatting,
  // and reading them as the parent hid the login button's only word.
  let inner = node;
  while (inner.parent && ts.isParenthesizedExpression(inner.parent)) inner = inner.parent;
  const parent = inner.parent;
  if (!parent) return false;

  const allowed =
    (ts.isConditionalExpression(parent) &&
      (parent.whenTrue === inner || parent.whenFalse === inner)) ||
    // `{log.user_name || 'Система'}` — a display fallback is a label written in
    // another shape, and the right operand is the only place it can be.
    (ts.isBinaryExpression(parent) &&
      parent.right === inner &&
      (parent.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
        parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken)) ||
    ts.isArrayLiteralExpression(parent) ||
    (ts.isPropertyAssignment(parent) &&
      parent.initializer === inner &&
      !NON_TEXT_PROPERTIES.has(parent.name.getText(source)));
  if (!allowed) return false;

  return rendersHere(node, source);
}

// ─── one file ────────────────────────────────────────────────────────────────
function processFile(file, catalogue, report) {
  const original = fs.readFileSync(file, 'utf8');
  if (!CYRILLIC.test(original)) return null;

  // 'use client' has to precede the statements, not the comments — three
  // screens carry an eslint-disable above it and were skipped as server
  // components for it.
  if (!isClientComponent(original)) {
    report.serverComponents.push(file);
    return null;
  }

  const source = parse(file, original);

  // Which name the hook goes in under.
  //
  // Re-runnable: a second pass over a file this already touched must reuse the
  // declaration it made, not add another one beside it. Checking only whether
  // the name is taken sees its own `const t = useT()` from the first run and
  // steps aside into `tUi` — which is how a rerun produced 36 redeclarations.
  const ours = /const (t|tUi) = useT\(\);/.exec(original);
  const fn = ours ? ours[1] : nameIsTaken(source, 't') ? 'tUi' : 't';

  const edits = [];
  const components = new Map(); // body node → insertion offset
  let skippedEntities = 0;
  let skippedHelpers = 0;

  const {
    origin: constantOrigin,
    literals: constantLiterals,
    helpers: constantHelpers,
  } = trackConstants(source, file);
  const renderedConstants = new Set();

  const useIn = (node) => {
    const component = enclosingComponent(node);
    if (!component) {
      skippedHelpers++;
      return false;
    }
    // after the opening brace of the component body
    components.set(component.body, component.body.getStart(source) + 1);
    return true;
  };

  const visit = (node) => {
    if (ts.isJsxText(node)) {
      const raw = node.getText(source);
      const trimmed = raw.trim();
      const key = renderedText(trimmed);
      if (key && CYRILLIC.test(key)) {
        // An entity is markup, not text: '&apos;' inside a string literal
        // renders as those six characters.
        const decoded = decodeEntities(key);
        // A '&' that is not one of the entities above stays unknown, and
        // guessing at it is how text quietly changes.
        if (hasUnknownEntity(decoded)) {
          skippedEntities++;
        } else if (useIn(node)) {
          const start = node.getStart(source) + raw.indexOf(trimmed);
          edits.push({ start, end: start + trimmed.length, text: `{${fn}(${literal(decoded)})}` });
          catalogue.add(decoded);
        }
      }
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : null;

      if (name && MESSAGE_FUNCTIONS.has(name) && node.arguments.length) {
        const arg = node.arguments[0];
        const already =
          ts.isCallExpression(arg) &&
          ts.isIdentifier(arg.expression) &&
          (arg.expression.text === 't' || arg.expression.text === 'tUi');

        if (!already) {
          const wrap = (target, key) => {
            if (!useIn(node)) return;
            edits.push({
              start: target.getStart(source),
              end: target.getEnd(),
              text: `${fn}(${target.getText(source)})`,
            });
            if (key) catalogue.add(key);
          };

          if (
            (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) &&
            CYRILLIC.test(arg.text)
          ) {
            // The literal keeps its quotes: `t('Збережено')`.
            if (useIn(node)) {
              edits.push({
                start: arg.getStart(source),
                end: arg.getEnd(),
                text: `${fn}(${literal(renderedText(arg.text))})`,
              });
              catalogue.add(renderedText(arg.text));
            }
          } else if (
            ts.isPropertyAccessExpression(arg) &&
            SERVER_MESSAGE.test(arg.getText(source))
          ) {
            wrap(arg, null);
          } else if (ts.isTemplateExpression(arg)) {
            // `❌ ${data.error}` — the decoration is ours, the sentence is the
            // server's, so only the substitution is translated.
            for (const span of arg.templateSpans) {
              if (
                ts.isPropertyAccessExpression(span.expression) &&
                SERVER_MESSAGE.test(span.expression.getText(source))
              ) {
                wrap(span.expression, null);
              }
            }
          }
        }
      }
    } else if (ts.isJsxAttribute(node) && node.initializer) {
      const name = node.name.getText(source);
      if (TEXT_ATTRIBUTES.has(name) && ts.isStringLiteral(node.initializer)) {
        const value = renderedText(node.initializer.text);
        if (CYRILLIC.test(value) && useIn(node)) {
          edits.push({
            start: node.initializer.getStart(source),
            end: node.initializer.getEnd(),
            text: `{${fn}(${literal(value)})}`,
          });
          catalogue.add(value);
        }
      }
    } else if (ts.isJsxExpression(node) && node.expression) {
      // `{STATUS_MAP[b.status].label}` → `{t(STATUS_MAP[b.status].label)}`. The
      // text is in the constant; only the render site can call the hook.
      //
      // On a second run the site is already `{t(…)}`, and it still has to be
      // read: the constant's literals have to reach the catalogue every run,
      // or its translations are reported dead.
      const already =
        ts.isCallExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        (node.expression.expression.text === 't' || node.expression.expression.text === 'tUi') &&
        node.expression.arguments.length === 1;
      const inner = already ? node.expression.arguments[0] : node.expression;
      // `{monthLabel(m)}` — a same-file helper that builds its answer out of
      // Ukrainian literals. Its result is text just as much as a table entry is.
      const helper =
        ts.isCallExpression(inner) && ts.isIdentifier(inner.expression)
          ? inner.expression.text
          : null;
      // `MONTH_NAMES[m].substring(0, 3)` — translate the month, then truncate.
      const sliced =
        !already &&
        ts.isCallExpression(inner) &&
        ts.isPropertyAccessExpression(inner.expression) &&
        TEXT_METHODS.test(inner.expression.name.text) &&
        constantOrigin.has(rootIdentifier(inner.expression.expression))
          ? inner.expression.expression
          : null;
      const from = constantHelpers.has(helper)
        ? helper
        : sliced
          ? constantOrigin.get(rootIdentifier(sliced))
          : constantOrigin.get(rootIdentifier(inner));

      const target = sliced ?? node.expression;
      if (from && isRenderedPosition(node, source) && !readsNonText(sliced ?? inner)) {
        if (already) {
          renderedConstants.add(from);
        } else if (useIn(node)) {
          edits.push({
            start: target.getStart(source),
            end: target.getEnd(),
            text: `${fn}(${target.getText(source)})`,
          });
          renderedConstants.add(from);
        }
      }
    } else if (ts.isTemplateExpression(node) && rendersHere(node, source)) {
      // `${total} записів` — the words are text, the substitution is not, and
      // the two cannot be separated by wrapping the whole thing. Each literal
      // chunk becomes its own substitution: `${total} ${t('записів')}`.
      const chunks = [node.head, ...node.templateSpans.map((s) => s.literal)];
      for (const chunk of chunks) {
        if (!CYRILLIC.test(chunk.text)) continue;
        const value = renderedText(chunk.text);
        if (!value || !useIn(node)) continue;
        // The delimiters are part of the node: `…${ is one token, }…` another.
        const inner = chunk.getStart(source) + 1;
        const end = chunk.getEnd() - (ts.isTemplateTail(chunk) ? 1 : 2);
        const raw = source.text.slice(inner, end);
        const offset = raw.indexOf(value.trim() ? chunk.text.trim() : chunk.text);
        if (offset < 0) continue;
        edits.push({
          start: inner + offset,
          end: inner + offset + chunk.text.trim().length,
          text: `\${${fn}(${literal(value)})}`,
        });
        catalogue.add(value);
      }
    } else if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      CYRILLIC.test(node.text) &&
      inlineLabel(node, source)
    ) {
      // `{p === 'day' ? 'День' : 'Все'}` and the column table written inline in
      // the JSX. The literal is inside the component, so the hook is in scope —
      // it just never became JSX text and so was never seen.
      const value = renderedText(node.text);
      if (useIn(node)) {
        edits.push({
          start: node.getStart(source),
          end: node.getEnd(),
          text: `${fn}(${literal(value)})`,
        });
        catalogue.add(value);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  // Everything already wrapped, on every run — not just what this run changed.
  // Without it the catalogue can only grow: a key whose screen was deleted, or
  // whose wrap was reverted, stays in it forever and reads as an untranslated
  // string nobody can find. Reading them back makes the file regenerable.
  const collectWrapped = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      (node.expression.text === 't' || node.expression.text === 'tUi') &&
      node.arguments.length === 1
    ) {
      const arg = node.arguments[0];
      if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
        if (CYRILLIC.test(arg.text)) catalogue.add(renderedText(arg.text));
      }
    }
    ts.forEachChild(node, collectWrapped);
  };
  collectWrapped(source);

  for (const constant of renderedConstants) {
    for (const text of constantLiterals.get(constant) ?? constantHelpers.get(constant) ?? []) {
      catalogue.add(text);
    }
  }

  if (skippedEntities) report.entities.push(`${file} (${skippedEntities})`);
  if (skippedHelpers) report.helpers.push(`${file} (${skippedHelpers})`);
  if (!edits.length) return null;

  // Declare the hook once per component that needs it — and not again in a
  // component that already has it.
  const declaration = `const ${fn} = useT();`;
  let declared = 0;
  for (const [body, offset] of components) {
    if (body.getText(source).includes(declaration)) continue;
    edits.push({ start: offset, end: offset, text: `\n  ${declaration}` });
    declared++;
  }

  // Back to front, so earlier offsets stay valid.
  edits.sort((a, b) => b.start - a.start);
  let output = original;
  for (const edit of edits) {
    output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  }

  // The module may already be imported for I18nProvider — extend that import
  // rather than skipping, which silently left useT undefined.
  const existing = output.match(/import\s*\{([^}]*)\}\s*from '@core\/i18n\/client';/);
  if (existing) {
    if (!/\buseT\b/.test(existing[1])) {
      output = output.replace(
        existing[0],
        `import {${existing[1].replace(/\s*$/, '')}, useT } from '@core/i18n/client';`,
      );
    }
  } else {
    // After the directive, and the directive may sit below a comment. Getting
    // this wrong puts the import ABOVE 'use client', which stops it being a
    // directive at all — the file silently becomes a server component and its
    // hooks stop working.
    const useClient = output.match(
      /^(?:\s*(?:\/\*[\s\S]*?\*\/|\/\/[^\n]*)\s*)*['"]use client['"];?\r?\n/,
    );
    const at = useClient ? useClient[0].length : 0;
    output = `${output.slice(0, at)}\nimport { useT } from '@core/i18n/client';${output.slice(at)}`;
  }

  return { output, count: edits.length - declared };
}

// ─── run ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const dry = argv.includes('--dry');
const all = argv.includes('--all');
const targets = argv.filter((a) => !a.startsWith('--'));

const files = targets.length
  ? targets.flatMap((t) => (fs.statSync(t).isDirectory() ? [...walk(t)] : [t]))
  : all || dry
    ? ROOTS.flatMap((r) => [...walk(r)])
    : [];

if (!files.length) {
  console.error('Вкажіть файл або теку, або --all для всього операторського UI.');
  process.exit(2);
}

const catalogue = new Set();
const report = { serverComponents: [], entities: [], helpers: [] };
let changedFiles = 0;
let changedStrings = 0;

for (const file of files) {
  const result = processFile(file, catalogue, report);
  if (!result) continue;
  changedFiles++;
  changedStrings += result.count;
  if (!dry) fs.writeFileSync(file, result.output);
  console.log(`${String(result.count).padStart(4)}  ${file}`);
}

console.log(
  `\n${changedStrings} рядків у ${changedFiles} файлах${dry ? ' (нічого не записано)' : ''}`,
);
console.log(`каталог: ${catalogue.size} унікальних`);

// Everything refused is printed: a silent skip is how half a screen stays
// Ukrainian and nobody can say why.
for (const [label, list] of [
  ['серверні компоненти (hook не можна)', report.serverComponents],
  ['текст із HTML-сутностями', report.entities],
  ['JSX поза компонентом', report.helpers],
]) {
  if (list.length) {
    console.log(`\nпропущено — ${label}: ${list.length}`);
    for (const item of list.slice(0, 8)) console.log(`  ${item}`);
    if (list.length > 8) console.log(`  …ще ${list.length - 8}`);
  }
}

if (!dry) {
  const cataloguePath = 'src/core/i18n/messages/catalogue.json';
  const existing = fs.existsSync(cataloguePath)
    ? JSON.parse(fs.readFileSync(cataloguePath, 'utf8'))
    : [];
  const merged = [...new Set([...existing, ...catalogue])].sort((a, b) => a.localeCompare(b, 'uk'));
  fs.writeFileSync(cataloguePath, `${JSON.stringify(merged, null, 2)}\n`);
  console.log(`\nкаталог записано: ${cataloguePath} (${merged.length})`);
}
