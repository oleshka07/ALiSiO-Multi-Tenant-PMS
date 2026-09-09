/**
 * Два шляхи, що різняться лише регістром, — це один файл на половині машин.
 *
 *   node scripts/check-case-collisions.mjs
 *   node scripts/check-case-collisions.mjs --strict     # у npm run check і в CI
 *
 * ── Що саме сталося ─────────────────────────────────────────────────────
 *
 * `docs/vendor/channex/README.md` (наш опис теки) і
 * `docs/vendor/channex/readme.md` (вендорська головна сторінка) були в git
 * двома різними файлами. На NTFS і APFS — файлові системи Windows і macOS
 * нечутливі до регістру — це ОДИН файл: git виклав другий поверх першого,
 * робоча копія власника ніколи не показувалась чистою, а наш опис теки
 * мовчки зникав при кожному `checkout`.
 *
 * На Linux-CI цього не видно взагалі: там обидва файли існують окремо і все
 * зелене. Рід «зелено, бо середовище ховає» — найдорожчий, бо ламається він
 * лише в людини, і лише в тієї, у якої інша ФС.
 *
 * Причина була в самій команді перезняття, яку той же README і описує:
 * `https://docs.channex.io/readme.md` лягає в `readme.md`. Контролер
 * перейменував вендорську сторінку у `vendor-readme.md` і полагодив команду
 * (коміт `fe340fc`); цей гейт — щоб клас не повернувся.
 *
 * ── Що стверджується ────────────────────────────────────────────────────
 *
 * ВЛАСТИВІСТЬ, не список: серед `git ls-files` немає двох шляхів, чиї
 * нижньорегістрові форми збігаються. Тобто гейт ловить не ту одну пару, яка
 * була, а будь-яку нову — і в docs/, і в src/, і в скриптах.
 *
 * Порівнюється ВЕСЬ шлях, а не імʼя файла: `Docs/x.md` і `docs/x.md`
 * зіткнуться так само, і винна там тека.
 *
 * Джерело — `git ls-files`, а не обхід диска: на нечутливій до регістру ФС
 * обхід диска показав би один файл і не побачив би нічого. Git знає обидва
 * імені, бо в індексі вони різні.
 */
import { execFileSync } from 'node:child_process';

const strict = process.argv.includes('--strict');

let files;
try {
  files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0')
    .filter(Boolean);
} catch (e) {
  console.error('check-case-collisions: не вдалося прочитати git ls-files —', e.message);
  process.exit(strict ? 1 : 0);
}

const byLower = new Map();
for (const f of files) {
  const key = f.toLowerCase();
  if (!byLower.has(key)) byLower.set(key, []);
  byLower.get(key).push(f);
}

const collisions = [...byLower.entries()]
  .filter(([, paths]) => paths.length > 1)
  .sort(([a], [b]) => a.localeCompare(b));

console.log('═'.repeat(78));
console.log('ЗІТКНЕННЯ ЗА РЕГІСТРОМ — шляхи, які на Windows і macOS є одним файлом');
console.log('═'.repeat(78));
console.log();
console.log(`  файлів у дереві: ${files.length}`);
console.log(`  зіткнень:        ${collisions.length}`);

if (collisions.length) {
  console.log();
  for (const [lower, paths] of collisions) {
    console.log(`  ${lower}`);
    for (const p of paths) console.log(`      ${p}`);
  }
}

console.log();

if (!collisions.length) {
  console.log('check-case-collisions: жодної пари шляхів, що різняться лише регістром');
  process.exit(0);
}

if (strict) {
  console.log('ЗБІРКА ЗУПИНЕНА:');
  console.log('  Ці шляхи різні лише в git і на Linux. На робочій копії з NTFS або APFS');
  console.log('  це ОДИН файл: один вміст мовчки лягає поверх іншого, і `git status` там');
  console.log('  ніколи не буває чистим. Перейменуйте так, щоб імена різнились не лише');
  console.log('  регістром (як `readme.md` → `vendor-readme.md`, коміт fe340fc), і');
  console.log('  полагодьте те, що створює друге імʼя, — зазвичай це команда завантаження.');
  console.log();
  process.exit(1);
}

process.exit(0);
