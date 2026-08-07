/**
 * What counts as interface text, and what only looks like it.
 *
 * Shared by the two tools that have to agree on the answer:
 *
 *   extract-strings.mjs   wraps it     (a migration — run when text is added)
 *   check-unwrapped.mjs   demands it   (a gate — runs on every push)
 *
 * They must not drift. If the gate's idea of "text" is wider than the codemod's,
 * it nags about lines the codemod deliberately refuses to touch; if it is
 * narrower, text ships untranslated and nobody hears about it. One definition,
 * imported twice.
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export const CYRILLIC = /[А-Яа-яЇїІіЄєҐґ]/;

/**
 * The key is the text as it renders, not as it is indented.
 *
 * JSX collapses runs of whitespace, so a paragraph wrapped across four source
 * lines renders as one line — but its source text carries the file's
 * indentation. Left alone, the dictionary key would contain twenty spaces and
 * a newline, and re-indenting the file would silently orphan the translation.
 */
export const renderedText = (text) => text.replace(/\s+/g, ' ').trim();

/**
 * The named entities this markup actually uses.
 *
 * An entity is markup: '&amp;' inside a string literal renders as those five
 * characters, so text containing one was skipped. Decoding it first makes the
 * literal render identically — and '&' is by far the most common, in every
 * "Гості &amp; послуги" heading in the product.
 */
export const ENTITIES = {
  '&amp;': '&',
  '&nbsp;': '\u00a0',
  '&quot;': '"',
  '&apos;': "'",
  '&lt;': '<',
  '&gt;': '>',
  '&mdash;': '—',
  '&ndash;': '–',
};
export const decodeEntities = (text) =>
  text.replace(/&(?:amp|nbsp|quot|apos|lt|gt|mdash|ndash);/g, (m) => ENTITIES[m]);

/** An entity this does not know is not guessed at — that is how text changes quietly. */
export const hasUnknownEntity = (text) => text.includes('&') && /&[a-z#][a-z0-9]*;/i.test(text);

/**
 * Functions whose first argument is read by a person.
 *
 * Toasts and validation messages are the half of the interface that is NOT in
 * the JSX: a screen can be fully German and still answer «Збережено» when you
 * press the button.
 */
export const MESSAGE_FUNCTIONS = new Set([
  'showToast',
  'setError',
  'setToast',
  'alert',
  'confirm',
]);

/** Attributes whose value is shown to a person. */
export const TEXT_ATTRIBUTES = new Set([
  'placeholder',
  'title',
  'alt',
  'aria-label',
  'aria-placeholder',
  'label',
]);

/**
 * Fields that are not text even when they sit beside text.
 *
 * `{item.icon}` roots at the same constant as `{item.title}` and is a `<Home />`
 * element or an emoji; `CLEANER_ITEMS.length` is a number.
 */
export const NON_TEXT_PROPERTIES = new Set([
  'icon',
  'color',
  'badge',
  'className',
  'href',
  'url',
  'path',
  'id',
  'key',
  'length',
  'size',
  'count',
  'width',
  'height',
]);

export const ROOTS = ['src/app/app', 'src/components', 'src/modules'];
const SKIP_DIRS = new Set(['node_modules', '.next', '_design']);

export function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.name.endsWith('.tsx') && !entry.name.endsWith('.check.tsx')) yield full;
  }
}

export function parse(file, text) {
  return ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

/**
 * Does this file run on the client?
 *
 * 'use client' has to precede the statements, not the comments — three screens
 * carry an eslint-disable above it and were read as server components for it.
 */
export function isClientComponent(text) {
  const beforeCode = text.replace(/^\s*(?:\/\*[\s\S]*?\*\/|\/\/[^\n]*)\s*/g, '');
  return /^['"]use client['"]/.test(beforeCode);
}

/** Is this a call to our own t() / tUi()? */
export function isTranslateCall(node) {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    (node.expression.text === 't' || node.expression.text === 'tUi')
  );
}

// ─── text that has already chosen its own language ───────────────────────────

const LANGUAGE_CODE = /^(uk|ua|en|de|cs|cz|pl|nl|fr|sk|es|it|ru)$/i;

/** `{ uk: …, en: …, de: … }` — a phrase written once per language. */
export function isLanguageMap(node) {
  if (!ts.isObjectLiteralExpression(node)) return false;
  const names = node.properties
    .filter(
      (p) => ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)),
    )
    .map((p) => p.name.text);
  return names.length >= 2 && names.every((n) => LANGUAGE_CODE.test(n));
}

/**
 * `lang === 'uk' ? «Доброго дня…» : «Dobrý den…»` is the message sent to a
 * **guest**, in the guest's language. Translating the Ukrainian branch into the
 * operator's language does not translate anything — it splices German into a
 * Ukrainian message. Whoever wrote a language switch has already said this
 * string is content, not interface.
 */
export function insideLanguageSwitch(node) {
  for (let n = node.parent; n; n = n.parent) {
    if (isLanguageMap(n)) return true;

    // `{ uk: …, en: … }[lang] || «українською»` — the fallback is the last
    // branch of that same switch, not interface text sitting beside it.
    if (
      ts.isBinaryExpression(n) &&
      (n.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        n.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
    ) {
      let map = false;
      const look = (c) => {
        if (isLanguageMap(c)) map = true;
        else ts.forEachChild(c, look);
      };
      look(n.left);
      if (map) return true;
    }

    if (!ts.isConditionalExpression(n)) continue;
    let found = false;
    const scan = (c) => {
      if (
        ts.isBinaryExpression(c) &&
        (c.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
          c.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken) &&
        ts.isStringLiteral(c.right) &&
        LANGUAGE_CODE.test(c.right.text)
      ) {
        found = true;
      }
      ts.forEachChild(c, scan);
    };
    scan(n.condition);
    if (found) return true;
  }
  return false;
}

// ─── where a person actually reads ───────────────────────────────────────────

/**
 * Is this expression container somewhere a person reads?
 *
 * Only children and the text attributes. `style={STYLES.card}` roots at the
 * same constant and is an object; `onClick={() => setFilter('Оплачено')}` holds
 * a **value**, and translating it stops the filter matching.
 */
export function isRenderedPosition(node, source) {
  const parent = node.parent;
  if (!parent) return false;
  if (ts.isJsxElement(parent) || ts.isJsxFragment(parent)) return true;
  if (ts.isJsxAttribute(parent)) return TEXT_ATTRIBUTES.has(parent.name.getText(source));
  return false;
}

/**
 * Methods whose argument is matched against, not shown.
 *
 * `b.notes.includes('Джерело')` sits inside a rendered `{…}` — it is the
 * condition of the ternary that decides what to render. Translating it does
 * not change a word on screen; it changes what the code compares, and the
 * check silently stops matching. This is the same class of mistake as
 * translating the Ukrainian branch of a guest message, and it is worth being
 * as blunt about.
 */
const VALUE_METHODS =
  /^(includes|indexOf|lastIndexOf|startsWith|endsWith|match|matchAll|search|split|replace|replaceAll|localeCompare|has|get|set|add|delete|push|test)$/;

/**
 * Is this literal a value the code compares or stores, rather than text?
 *
 * Climbs out of `||` / `??` first: in `notes.includes(a || 'Джерело')` the
 * literal's immediate parent is the `||`, and only the expression above it
 * says what the value is for.
 */
export function isValuePosition(node, source) {
  let inner = node;
  while (
    inner.parent &&
    ((ts.isBinaryExpression(inner.parent) &&
      (inner.parent.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        inner.parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)) ||
      ts.isParenthesizedExpression(inner.parent))
  ) {
    inner = inner.parent;
  }
  const parent = inner.parent;
  if (!parent) return false;

  // status === 'Оплачено'
  if (
    ts.isBinaryExpression(parent) &&
    [
      ts.SyntaxKind.EqualsEqualsEqualsToken,
      ts.SyntaxKind.ExclamationEqualsEqualsToken,
      ts.SyntaxKind.EqualsEqualsToken,
      ts.SyntaxKind.ExclamationEqualsToken,
    ].includes(parent.operatorToken.kind)
  ) {
    return true;
  }

  // switch (x) { case 'Оплачено': }
  if (ts.isCaseClause(parent)) return true;

  // .includes('Джерело')
  if (
    ts.isCallExpression(parent) &&
    parent.arguments.includes(inner) &&
    ts.isPropertyAccessExpression(parent.expression) &&
    VALUE_METHODS.test(parent.expression.name.text)
  ) {
    return true;
  }

  // { key: 'Оплачено' } — a field this already knows is not text
  if (
    ts.isPropertyAssignment(parent) &&
    parent.initializer === inner &&
    NON_TEXT_PROPERTIES.has(parent.name.getText(source))
  ) {
    return true;
  }

  return false;
}

/** Is this node inside a rendered JSX expression, and not already inside t()? */
export function rendersHere(node, source) {
  if (insideLanguageSwitch(node)) return false;
  if (isValuePosition(node, source)) return false;
  for (let n = node.parent; n; n = n.parent) {
    if (isTranslateCall(n)) return false;
    if (ts.isJsxExpression(n)) return isRenderedPosition(n, source);
    if (ts.isJsxAttribute(n)) return false;
  }
  return false;
}
