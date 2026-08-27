/**
 * Лист гостю йде зі скриньки ГОТЕЛЮ.
 *
 *   node src/core/mail/email.check.ts
 *
 * ── Що тут ловиться ─────────────────────────────────────────────────────
 *
 * `sendEmail` мала один транспорт на весь сервер: `smtp.seznam.cz` з логіном
 * зі змінних оточення, спільний на всіх клієнтів. Назва готелю підставлялась
 * лише як ПІДПИС відправника — адреса лишалась нашою. Підтвердження броні
 * німецького готелю приходило гостю з чеської адреси, і відповідь на нього
 * летіла не в готель.
 *
 * Полагодити це в одному місці мало: правило тримається доти, доки КОЖЕН, хто
 * шле лист, називає організацію. Виклик без неї не падає (втратити
 * підтвердження броні гірше, ніж надіслати його не з тієї адреси) — а отже,
 * забутий `organizationId` не виявить себе нічим, крім скарги клієнта.
 *
 * Тому перевірка не про транспорт, а про виклики: кожен `sendEmail({…})` у
 * коді мусить передавати `organizationId`. Єдиний виняток названий поіменно.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Файли, яким дозволено кликати без організації. Порожньо — і це навмисно:
 * кожен теперішній відправник знає готель, за який пише. Новий рядок тут
 * вимагає причини, яку прочитає наступний.
 */
const ALLOWED_WITHOUT_ORG = new Set<string>([]);

const ROOT = 'src';
const files: string[] = [];
(function walk(dir: string) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.tsx?$/.test(entry.name)) files.push(full);
  }
})(ROOT);

const SELF = path.join('src', 'core', 'mail', 'email.ts');
let checked = 0;
const missing: string[] = [];

for (const file of files) {
  if (file === SELF || file.endsWith('email.check.ts')) continue;
  const src = fs.readFileSync(file, 'utf8');
  if (!src.includes('sendEmail(')) continue;

  // Кожен виклик разом із його аргументами. Межа — закриваюча дужка з
  // однаковим рівнем вкладеності, щоб вкладені обʼєкти (attachments) не
  // обривали виклик посередині.
  for (const m of src.matchAll(/\bsendEmail\(/g)) {
    let depth = 0;
    let i = m.index! + m[0].length - 1;
    for (; i < src.length; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') { depth--; if (depth === 0) break; }
    }
    const call = src.slice(m.index!, i + 1);
    checked++;
    if (/\borganizationId\b/.test(call)) continue;
    if (ALLOWED_WITHOUT_ORG.has(file)) continue;
    const line = src.slice(0, m.index!).split('\n').length;
    missing.push(`${file}:${line}`);
  }
}

assert.ok(checked > 0, 'жодного виклику sendEmail не знайдено — перевірка дивиться не туди');
assert.deepStrictEqual(missing, [],
  `ці листи підуть зі скриньки сервісу, а не готелю:\n    ${missing.join('\n    ')}\n` +
  '  Додайте organizationId — його знає кожен, хто знає бронь або обʼєкт.');
console.log(`  ok  ${checked} викликів sendEmail називають організацію`);

// ── Транспорт не кешується за організацією ──────────────────────────────
//
// Ключ за `organizationId` не помітив би зміни ПАРОЛЯ під тим самим логіном:
// процес ходив би зі старим до перезапуску, а екран казав би «збережено».
const email = fs.readFileSync(SELF, 'utf8');
assert.ok(/transports\.get\(key\)/.test(email) && /const key = `\$\{host\}\|\$\{user\}`/.test(email),
  'кеш транспортів має ключуватись хостом і логіном, а не організацією');
assert.ok(/export function forgetMailTransports/.test(email),
  'без способу скинути кеш зміна пароля не подіє до перезапуску');
console.log('  ok  транспорт ключується скринькою і скидається при зміні ключів');

// ── Збереження ключів справді скидає кеш ────────────────────────────────
const saver = fs.readFileSync('src/modules/auth/api/integration-credentials.handlers.ts', 'utf8');
assert.ok(/forgetMailTransports\(\)/.test(saver),
  'збереження SMTP-ключів не скидає кеш транспортів — новий пароль не подіє');
console.log('  ok  збереження ключів скидає кеш');

console.log('  ok  email: лист гостю йде зі скриньки готелю');
