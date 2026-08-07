/**
 * Interface text that nobody can translate.
 *
 *   node scripts/check-unwrapped.mjs
 *
 * This is the gate; `extract-strings.mjs` is the migration. The difference
 * matters more than it sounds.
 *
 * The codemod has to *understand* how you wrote your text in order to wrap it,
 * so every new way of writing text needs a new case in it — module constants,
 * imported constants, helpers, template chunks, ternary branches, `.substring()`.
 * That is seven cases so far, and the eighth arrives with the next module. A
 * tool that must be omniscient to stay correct is a tool that quietly stops
 * being correct.
 *
 * Recognising unwrapped text is far easier than rewriting it. So the rule is
 * inverted: write `t('Текст')` yourself, and this fails the build when you
 * forget. The codemod stays for bulk migration, and it stops being load-bearing.
 *
 * Both read the same definition of "text" from lib/i18n-ast.mjs. If they
 * disagree, one of them is lying.
 *
 * Two severities, because they need different things from a person:
 *
 *   ✗ blocked  a client component — wrap it in t(), the hook is right there
 *   ⚠ noted    a server component, or JSX in a plain helper — a hook cannot go
 *              there at all, so this needs restructuring, not a wrap. Reported
 *              so it is visible, not blocking, because there is no one-line fix.
 */
import fs from 'node:fs';
import ts from 'typescript';
import {
  CYRILLIC,
  MESSAGE_FUNCTIONS,
  ROOTS,
  TEXT_ATTRIBUTES,
  isClientComponent,
  isRenderedPosition,
  isTranslateCall,
  insideLanguageSwitch,
  parse,
  renderedText,
  rendersHere,
  walk,
} from './lib/i18n-ast.mjs';

/** The nearest function a hook could legally run in. */
function inComponent(node) {
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
    if (name && body && ts.isBlock(body) && /^[A-Z]/.test(name)) return true;
  }
  return false;
}

function findings(file) {
  const text = fs.readFileSync(file, 'utf8');
  if (!CYRILLIC.test(text)) return [];

  const client = isClientComponent(text);
  const source = parse(file, text);
  const found = [];

  const at = (node, sample, why) => {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    found.push({
      file,
      line: line + 1,
      sample: sample.length > 64 ? `${sample.slice(0, 61)}…` : sample,
      // A hook needs both a client file and a component to sit in. Either one
      // missing means this cannot be fixed by wrapping, so it is not a block.
      blocking: client && inComponent(node),
      why,
    });
  };

  const visit = (node) => {
    // Text between tags. Wrapping turns it into an expression, so anything
    // still shaped like JsxText is by definition unwrapped.
    if (ts.isJsxText(node)) {
      const value = renderedText(node.getText(source));
      if (value && CYRILLIC.test(value) && !insideLanguageSwitch(node)) at(node, value, 'JSX');
    } else if (ts.isJsxAttribute(node) && node.initializer) {
      const name = node.name.getText(source);
      if (
        TEXT_ATTRIBUTES.has(name) &&
        ts.isStringLiteral(node.initializer) &&
        CYRILLIC.test(node.initializer.text)
      ) {
        at(node.initializer, renderedText(node.initializer.text), `атрибут ${name}`);
      }
    } else if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      CYRILLIC.test(node.text) &&
      rendersHere(node, source)
    ) {
      at(node, renderedText(node.text), 'рядок у розмітці');
    } else if (ts.isTemplateExpression(node) && rendersHere(node, source)) {
      for (const chunk of [node.head, ...node.templateSpans.map((s) => s.literal)]) {
        const value = renderedText(chunk.text);
        if (value && CYRILLIC.test(value)) at(node, value, 'шаблонний рядок');
      }
    } else if (ts.isCallExpression(node) && node.arguments.length) {
      // showToast('Збережено') — the half of the interface that is not in the
      // markup at all, and the half a person reads at the moment something
      // happens.
      const callee = node.expression;
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : null;
      const arg = node.arguments[0];
      if (
        name &&
        MESSAGE_FUNCTIONS.has(name) &&
        (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) &&
        CYRILLIC.test(arg.text) &&
        !isTranslateCall(arg) &&
        !insideLanguageSwitch(arg)
      ) {
        at(arg, renderedText(arg.text), `${name}()`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

// ─── run ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const targets = argv.filter((a) => !a.startsWith('--'));
const files = targets.length
  ? targets.flatMap((t) => (fs.statSync(t).isDirectory() ? [...walk(t)] : [t]))
  : ROOTS.flatMap((r) => [...walk(r)]);

const all = files.flatMap(findings);
const blocked = all.filter((f) => f.blocking);
const noted = all.filter((f) => !f.blocking);

const show = (list, limit) => {
  const byFile = new Map();
  for (const f of list) byFile.set(f.file, [...(byFile.get(f.file) ?? []), f]);
  for (const [file, items] of [...byFile].slice(0, limit)) {
    console.log(`\n  ${file}`);
    for (const i of items.slice(0, 6)) {
      console.log(`    ${String(i.line).padStart(5)}  ${i.why.padEnd(18)} ${i.sample}`);
    }
    if (items.length > 6) console.log(`           …ще ${items.length - 6}`);
  }
  if (byFile.size > limit) console.log(`\n  …ще ${byFile.size - limit} файлів`);
};

if (noted.length) {
  console.log(`⚠ поза досяжністю хука: ${noted.length} (серверний компонент або не-компонент)`);
  console.log('  Хук туди не поставити — це треба переносити, а не обгортати.');
  show(noted, 5);
  console.log('');
}

if (!blocked.length) {
  console.log(`✓ незагорнутого тексту в клієнтських компонентах нема (${files.length} файлів)`);
  process.exit(0);
}

console.log(`✗ незагорнутий текст: ${blocked.length}`);
show(blocked, 12);
console.log(`
Обгорніть у t(). Хук уже в компоненті — або додайте \`const t = useT();\`:

    <div>Текст</div>          →  <div>{t('Текст')}</div>
    placeholder="Текст"       →  placeholder={t('Текст')}
    showToast('Збережено')    →  showToast(t('Збережено'))

Масово — \`npm run i18n:extract -- <файл>\`, але кодмод знає не всі форми:
що він не бере, дописується руками. Він для міграції, ця перевірка — правило.
`);
process.exit(1);
