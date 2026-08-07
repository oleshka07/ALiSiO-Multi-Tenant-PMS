/**
 * The operator's language must not reach anything but the operator's screen.
 *
 *   node scripts/check-i18n-leak.mjs
 *
 * A receptionist switching to German is changing what SHE reads. It must not
 * change the invoice a Czech accountant files, the email a guest opens, or the
 * payload Booking.com receives. That is not a preference — a translated
 * invoice line is a document that says something different from what was
 * agreed, and a translated integration field is a value the other side does
 * not recognise.
 *
 * Today this holds, but only by accident of layering: documents are generated
 * on the server and `t()` is a React hook, so it cannot physically get there.
 * Accidents stop holding. Twice while building this the wrap went into a
 * guest-facing message — `lang === 'uk' ? …` in a WhatsApp composer, and
 * `{ uk: …, en: … }[lang]` in the booking widget — and both were client code,
 * where nothing structural was in the way.
 *
 * So the rule is checked rather than remembered:
 *
 *   1. no translator may be imported into a document, export, email or
 *      integration path;
 *   2. within those paths, no call to one may appear at all — including a
 *      helper that got there by another name.
 *
 * What this does NOT try to decide is whether a given string should be
 * translated. It decides where the operator's language is allowed to be read,
 * which is a question with an answer.
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

/**
 * Paths whose output is read by somebody other than the operator.
 *
 * A directory rather than a file list, because the next invoice renderer will
 * land next to this one and should be covered the day it is written.
 */
const PROTECTED = [
  { dir: 'src/modules/finance/domain', why: 'документ (фактура, ISDOC, PDF)' },
  { dir: 'src/modules/finance/data', why: 'документ і експорт' },
  { dir: 'src/modules/bookings/data', why: 'лист гостю' },
  { dir: 'src/core/mail', why: 'лист' },
  { dir: 'src/modules/channels/data', why: 'інтеграція з OTA' },
  { dir: 'src/app/api', why: 'відповідь API і файли на віддачу' },
];

/** The names that read the operator's language. */
const TRANSLATORS = /^(t|tUi|plural|pluralUi|useT|usePlural|translate|translatePlural)$/;
/**
 * Any way of reaching the interface dictionary — by alias, by relative path,
 * by index. `@core/i18n/dictionary` slipped past a narrower pattern that only
 * knew about `client`, and only the call site gave it away.
 */
const I18N_CLIENT = /(^|\/)i18n(\/(client|dictionary))?$/;

function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.tsx?$/.test(full) && !/\.check\.tsx?$/.test(full)) yield full;
  }
}

const findings = [];

for (const { dir, why } of PROTECTED) {
  for (const file of walk(dir)) {
    const text = fs.readFileSync(file, 'utf8');
    // Cheap screen before parsing. It has to include the module path, not only
    // the call: a file that imports the dictionary and does not call it yet is
    // one edit away from doing so, and screening on `translate(` alone let
    // exactly that case through.
    const interesting =
      /\b(t|tUi|plural|pluralUi|useT|usePlural|translate|translatePlural)\s*\(/.test(text) ||
      /i18n\/(client|dictionary)/.test(text);
    if (!interesting) continue;
    const source = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    const at = (node, what) => {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      findings.push({ file, line: line + 1, what, why });
    };

    const visit = (node) => {
      // import { useT } from '@core/i18n/client'
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        I18N_CLIENT.test(node.moduleSpecifier.text)
      ) {
        at(node, `імпорт ${node.moduleSpecifier.text}`);
      }
      // t('…') — including one reached under a different name
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        TRANSLATORS.test(node.expression.text)
      ) {
        at(node, `виклик ${node.expression.text}()`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
}

if (!findings.length) {
  console.log('✓ мова інтерфейсу не дістає до документів, листів і інтеграцій');
  console.log(`  перевірено: ${PROTECTED.map((p) => p.dir).join(', ')}`);
  process.exit(0);
}

console.log(`✗ мова оператора протікає у ${findings.length} місцях\n`);
for (const f of findings) {
  console.log(`  ${f.file}:${f.line}`);
  console.log(`    ${f.what} — це ${f.why}`);
}
console.log(`
Тут читати мову оператора не можна: цей текст бачить не він. Мова документа
береться з юрисдикції, мова листа — з мови гостя (reservations.booking_lang),
мова інтеграції — з протоколу другої сторони. Див. core/i18n/resolve.ts.
`);
process.exit(1);
