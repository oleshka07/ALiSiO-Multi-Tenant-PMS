/**
 * Which dictionary keys are used with a count.
 *
 * Read from the source rather than kept in a list, because a list would be a
 * second place to update and the first thing anyone forgets. A key becomes a
 * plural key the moment someone writes `plural(n, 'записів')`, and from then on
 * its entry has to carry every form the language needs.
 */
import fs from 'node:fs';
import ts from 'typescript';
import { ROOTS, parse, walk } from './i18n-ast.mjs';

export function pluralKeys() {
  const keys = new Set();
  for (const file of ROOTS.flatMap((r) => [...walk(r)])) {
    const text = fs.readFileSync(file, 'utf8');
    // `pluralUi(` does not contain `plural(` — screening on that string alone
    // silently skipped two thirds of the call sites.
    if (!/\bplural(Ui)?\(/.test(text)) continue;
    const source = parse(file, text);
    const visit = (node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        /^plural(Ui)?$/.test(node.expression.text) &&
        node.arguments.length === 2
      ) {
        const arg = node.arguments[1];
        if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) keys.add(arg.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return keys;
}
