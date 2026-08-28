/**
 * grep, чия порожнеча мовчки вбиває скрипт.
 *
 *   node scripts/check-fatal-grep.mjs [--strict]
 *
 * Історія. deploy/apply-db-limits.sh запустили на сервері — і він завершився
 * без ЖОДНОГО рядка виводу. Не відмовив, не впав з помилкою — просто нічого,
 * і наступна команда з вставленого блоку поїхала далі. Рядок-вбивця:
 *
 *   LIMIT_RAW="$(val PG_MEM_LIMIT)"    # val() { grep -E "^$1=" "$ENV_FILE" | ...; }
 *
 * PG_MEM_LIMIT — саме той ключ, якому ДОЗВОЛЕНО бути відсутнім у env-файлі:
 * compose має дефолт `640m`. grep, який нічого не знайшов, виходить з 1;
 * `pipefail` проносить статус крізь конвеєр; присвоєння віддає його як статус
 * команди; `set -e` зупиняє скрипт — до першого echo. Порожній випадок тут
 * нормальний, і саме він виявився фатальним.
 *
 * deploy.sh уже описує цей самий клас у власному коментарі (apply_hotels,
 * «The empty case is the normal one; it must not be the failing one») — і все
 * одно наступний скрипт наступив на ті самі граблі. Правило, про яке треба
 * пам'ятати, — не правило; звідси гейт.
 *
 * Що ловить: у shell-скриптах під `set -e` — підстановки `$(grep ...)` у
 * присвоєннях та однорядкові функції-читачі `x() { grep ...; }`, де на рядку
 * немає `||`, який поглинає порожнечу. Лікується хвостом `|| true` (відсутній
 * ключ стає порожнім рядком), а дефолт лишається за `${X:-дефолт}` поруч.
 * grep в умові (`if grep`, `grep && ...`, цикли) не звітується — там статус
 * і є відповіддю.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOTS = ['deploy', '.claude/hooks'];

const files = [];
for (const root of ROOTS) {
  if (!fs.existsSync(root)) continue;
  for (const entry of fs.readdirSync(root)) {
    if (entry.endsWith('.sh')) files.push(path.join(root, entry));
  }
}

const problems = [];
let guarded = 0;

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  // Без set -e невдале присвоєння не зупиняє скрипт — клас не застосовний.
  if (!/^\s*set\s+-[a-z]*e/m.test(src)) continue;
  guarded++;

  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    // Спершу вирізати коментарі — інакше гейт рахує власну документацію
    // (правило з AGENTS §4; deploy.sh описує цей клас багу текстом).
    const line = lines[i].replace(/^\s*#.*$/, '').replace(/\s#.*$/, '');
    if (!line.includes('grep')) continue;

    const assignment = /=\s*"?\$\(\s*(?:\[\s*-f[^\]]*\]\s*&&\s*)?grep\b/.test(line);
    const readerFn = /^\s*\w+\(\)\s*\{\s*(?:\[\s*-f[^\]]*\]\s*&&\s*)?grep\b/.test(line);
    // Та сама пастка в арифметичній обгортці: X="$(( $(grep -c …) + 1 ))" —
    // grep -c без збігу друкує 0 І виходить з 1, статус внутрішньої
    // підстановки стає статусом присвоєння.
    const arithmetic = /=\s*"?\$\(\(\s*\$\(\s*grep\b/.test(line);
    if (!assignment && !readerFn && !arithmetic) continue;
    if (line.includes('||')) continue; // порожнеча поглинута — статус не фатальний

    problems.push({ file, line: i + 1, text: lines[i].trim() });
  }
}

if (problems.length === 0) {
  console.log('check-fatal-grep');
  console.log(
    `  чисто — ${guarded} скриптів під set -e, жоден порожній grep не вбиває мовчки`
  );
  console.log('');
  process.exit(0);
}

console.log('check-fatal-grep: grep, чия порожнеча мовчки зупинить скрипт');
console.log('');
for (const p of problems) {
  console.log(`  ${p.file}:${p.line}`);
  console.log(`    ${p.text}`);
}
console.log('');
console.log(
  'Скрипт під `set -e`: grep без збігу виходить з 1, присвоєння віддає цей'
);
console.log(
  'статус, і скрипт помирає ДО першого рядка виводу. Відсутній ключ — це'
);
console.log(
  'нормально: додайте `|| true` у кінець конвеєра, дефолт тримає `${X:-…}`.'
);
process.exit(1);
