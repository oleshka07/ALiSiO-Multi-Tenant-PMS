/**
 * Гроші округлює money(), а не Math.round.
 *
 *   node scripts/check-money-rounding.mjs --strict
 *
 * ── Чому цього гейта не було, а помилка була ────────────────────────────
 *
 * `core/money.ts` існує з розписаною причиною: суми лежать у базі як double,
 * а double не має 0.10. Інваріант 9 AGENTS.md вимагає рахувати через `money()`
 * — і його порушували в пʼяти місцях одночасно, включно з файлом, написаним
 * того самого тижня. Жоден гейт цього не бачив, бо `Math.round` — звичайна
 * функція мови, і в некошторисному коді вона доречна.
 *
 * Тому гейт дивиться не на `Math.round` взагалі, а на дві його форми, які
 * означають саме гроші:
 *
 *   Math.round(x * 100) / 100      — «округлити до центів», причому НЕПРАВИЛЬНО:
 *                                    1.005 * 100 = 100.49999999999999 → вниз
 *   Math.round(x * pct / 100)      — відсоток від суми, з утратою центів:
 *                                    10 % від 119 давало 12 замість 11.90
 *
 * і на ділення суми на кількість без `splitMoney` — 100 на три кімнати давало
 * 33+33+33 = 99, і підсумок групи назавжди розходився з сумою своїх кімнат.
 *
 * ── Чому іменований список, а не «нуль знахідок» ────────────────────────
 *
 * `Math.round` у датах і відсотках заповненості — не гроші. Такі місця
 * перелічені ІМЕНОВАНО: список видно в кожному прогоні, він може тільки
 * коротшати, а будь-яка НОВА грошова форма валить збірку.
 */
import fs from 'node:fs';
import path from 'node:path';

const STRICT = process.argv.includes('--strict');

/** Не гроші. Кожен рядок — із причиною, чому саме тут Math.round доречний. */
const ALLOWED = new Map([
  ['src/modules/widget/api/site-analytics.handlers.ts',
    'конверсія у відсотках із двома знаками — коефіцієнт, а не гроші: у рахунок не потрапляє'],
]);

/** Файли, де гроші не рахують узагалі: гейти самі про себе, тести, скрипти. */
const SKIP_DIRS = ['src/app/(marketing)'];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name).replace(/\\/g, '/');
    if (SKIP_DIRS.some((d) => full.startsWith(d))) continue;
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.check.ts')) out.push(full);
  }
  return out;
}

const problems = [];
const seen = new Set();

for (const file of walk('src')) {
  const src = fs.readFileSync(file, 'utf8');
  // Коментарі пояснюють форми, яких БІЛЬШЕ немає. Гейт, який їх не відрізняє,
  // падає на власній документації — цей проєкт це вже проходив двічі.
  //
  // Вирізати їх не можна, а тільки ЗАБІЛИТИ, зберігши переводи рядків: інакше
  // номер рядка в звіті зсувається на довжину викинутих коментарів і показує
  // на чужий код. Перший прогін цього гейта вказав на docstring замість самої
  // помилки — і я мало не пішов виправляти не те місце.
  const blank = (m) => m.replace(/[^\n]/g, ' ');
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/^([ \t]*)\/\/.*$/gm, (m) => blank(m));

  // Повний збіг разом із хвостом `/ 100`, а не лише вміст дужок: саме хвіст
  // відрізняє «округлити до центів» від будь-якого іншого округлення.
  // Один рівень вкладених дужок обовʼязково: `Math.round((total || 0) / n)`
  // при нежадібному `[^;\n]*?` обривався на першій закривній дужці, і хвіст
  // `/ n)` — тобто саме те, що робить це діленням суми — у збіг не потрапляв.
  // Гейт мовчав на власному ж прикладі.
  for (const m of code.matchAll(/Math\.round\((?:[^;\n()]|\([^;\n()]*\))*\)(\s*\/\s*100)?/g)) {
    const whole = m[0];

    // Три форми, і всі три означають саме гроші. Решту `Math.round` гейт не
    // судить свідомо: округлення суми ДЛЯ ПОКАЗУ («1 234 Kč» без копійок) не
    // псує збережене значення, а відсоток для прогрес-бара — це не гроші.
    //
    // Відсоток від суми — множення, потім поділ на 100:
    //   Math.round(total * pct / 100)
    // Відсоток ДЛЯ ПОКАЗУ — навпаки, поділ, потім множення:
    //   Math.round(paid / total * 100)
    // Тому дивимось на порядок, а не на присутність «100».
    const percentOfMoney = /\*[^*/]*\/\s*100\s*\)/.test(whole);
    const toCents = /\*\s*100\s*\)\s*\/\s*100/.test(whole);
    const splitByCount = /\/\s*[A-Za-z_.$][A-Za-z_.$0-9]*\.length\s*\)/.test(whole);
    if (!percentOfMoney && !toCents && !splitByCount) continue;

    const line = code.slice(0, m.index).split('\n').length;
    const key = `${file}:${line}`;
    const named = [...ALLOWED.keys()].find((k) => key.startsWith(`${k.split(':')[0]}:`));
    if (named && ALLOWED.has(named)) { seen.add(named); continue; }
    problems.push(splitByCount
      ? `${key}  ділення суми без splitMoney — ${whole.trim().slice(0, 70)}`
      : `${key}  ${whole.trim().slice(0, 90)}`);
  }
}

for (const [where, why] of ALLOWED) {
  if (seen.has(where)) console.log(`  ⊘ ${where} — ${why}`);
  else console.log(`  ✓ ${where} — місця більше немає, рядок зі списку можна прибрати`);
}

const unique = [...new Set(problems)];
if (unique.length) {
  console.error('\nГроші округлені не через money() — інваріант 9:\n');
  for (const p of unique) console.error(`  ${p}`);
  console.error('\n  money(x)              — до мінімальної одиниці, half away from zero');
  console.error('  percentOf(x, pct)     — частка суми');
  console.error('  sumMoney([...])       — сума з одним округленням у кінці');
  console.error('  splitMoney(x, n)      — n частин, які складаються назад рівно в x\n');
  console.error('Math.round(x * 100) / 100 — не еквівалент: 1.005 * 100 = 100.49999999999999.\n');
  if (STRICT) process.exit(1);
} else {
  console.log('гроші рахуються через money(), а не Math.round');
}
