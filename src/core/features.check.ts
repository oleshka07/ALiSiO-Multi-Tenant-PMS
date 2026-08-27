/**
 * Модуль, вимкнений у налаштуваннях, вимкнений і в меню, і в маршруті.
 *
 *   node src/core/features.check.ts
 *
 * ── Що тут ловиться ─────────────────────────────────────────────────────
 *
 * Реєстр фіч має три сторони, і вони вміють розходитись мовчки:
 *
 *   1. `FEATURE_SPEC` — що взагалі вмикається;
 *   2. `Sidebar.tsx` — що зникає з меню;
 *   3. маршрути — що перестає відповідати.
 *
 * Розходження між (1) і (2) дає пункт меню, який неможливо прибрати. Між (2)
 * і (3) — гірше: модуль зникає з меню, але `/api/tasks` відповідає далі, тобто
 * «вимкнено» означає «сховано від того, хто не знає адреси». Це не теорія: до
 * `withModule` рівно так і було з усіма пʼятьма модулями.
 *
 * ── І чому дефолти — теж перевірка ──────────────────────────────────────
 *
 * `hasFeature` без рядка в базі повертає дефолт. Для інтеграції дефолт `ON`
 * означав би, що новий клієнт мовчки отримав німецьку фіскалізацію — тобто
 * PMS стала б незареєстрованою касою (docs/TSE-KASSENSICHV.md §6.4). Для
 * модуля дефолт `OFF` означав би, що в день додавання ключа кожен наявний
 * готель втратив би розділ меню. Обидві помилки тихі, тому перелічені поіменно.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import { FEATURE_SPEC, FEATURES, featureDefault } from './features.ts';

type Key = keyof typeof FEATURE_SPEC;

// ── Дефолти названі поіменно ────────────────────────────────────────────
//
// Список тут, а не виведений із FEATURE_SPEC: інакше перевірка звірялася б
// сама з собою і пропустила б будь-яку зміну.
const EXPECTED_DEFAULT: Record<Key, boolean> = {
  widget: false,
  fiscal_de: false,
  online_payments: false,
  tasks: true,
  events: true,
  reports: true,
  dashboard: true,
  day_sheets: true,
};

for (const key of Object.keys(FEATURE_SPEC) as Key[]) {
  assert.ok(key in EXPECTED_DEFAULT,
    `новий ключ «${key}» без рішення про дефолт — впишіть його в features.check.ts і подумайте, ON це чи OFF`);
  assert.strictEqual(featureDefault(key), EXPECTED_DEFAULT[key],
    `дефолт «${key}» змінився на ${featureDefault(key)}. Якщо навмисно — тут теж; якщо ні, це або незареєстрована каса, або зниклий розділ меню`);
}
for (const key of Object.keys(EXPECTED_DEFAULT)) {
  assert.ok(key in FEATURE_SPEC, `«${key}» є в очікуваннях, але зник із реєстру`);
}
console.log(`  ok  дефолти ${Object.keys(FEATURE_SPEC).length} ключів — такі, як вирішено`);

// ── Каталог для екрана не втратив жодного ключа ─────────────────────────
assert.deepStrictEqual(Object.keys(FEATURES).sort(), Object.keys(FEATURE_SPEC).sort(),
  'FEATURES і FEATURE_SPEC розійшлись — екран налаштувань покаже не ті перемикачі');
for (const [key, label] of Object.entries(FEATURES)) {
  assert.ok(typeof label === 'string' && label.length > 2,
    `«${key}» без людської назви — на екрані буде порожній рядок з перемикачем`);
}
console.log('  ok  каталог для екрана збігається з реєстром');

// ── Модулі: меню і маршрут читають той самий ключ ───────────────────────
//
// `day_sheets` у меню пишеться так само, як у реєстрі — підкресленням. Дефіс
// у ключі («day-sheets») дав би пункт, який ніколи не ховається: `features`
// такого ключа не має, і `!features[undefined]` — це просто `true`.
const MODULES: Key[] = ['tasks', 'events', 'reports', 'dashboard', 'day_sheets'];

const sidebar = fs.readFileSync('src/components/layout/Sidebar.tsx', 'utf8');
for (const key of MODULES) {
  assert.ok(sidebar.includes(`feature: '${key}'`),
    `модуль «${key}» вмикається в налаштуваннях, але його пункт меню не питає фічу — вимкнути його неможливо`);
}
console.log(`  ok  ${MODULES.length} модулів ховаються з меню`);

// ── Маршрути справді відмовляють ────────────────────────────────────────
//
// Файл, що ВОЛОДІЄ вартою: або сам маршрут, або хендлер, у який він
// делегує. Перевірка на текст `withModule('<ключ>'` — вона не доводить, що
// варта правильна, але доводить, що фіча взагалі питається; до цього не
// питалась ніде.
const OWNERS: Record<Exclude<Key, 'widget' | 'fiscal_de' | 'online_payments'>, string[]> = {
  tasks: [
    'src/app/api/tasks/route.ts',
    'src/app/api/tasks/[id]/route.ts',
    'src/app/api/tasks/projects/route.ts',
    'src/app/api/tasks/projects/[id]/route.ts',
    'src/app/api/tasks/tags/route.ts',
    'src/app/api/tasks/tags/[id]/route.ts',
    'src/modules/tasks/api/attachments.handlers.ts',
  ],
  events: ['src/modules/events/api/events.handlers.ts'],
  reports: ['src/app/api/reports/route.ts', 'src/app/api/reports/city-tax/route.ts'],
  dashboard: ['src/app/api/dashboard/route.ts'],
  day_sheets: ['src/modules/day-sheets/api/day-sheets.handlers.ts'],
};

let guarded = 0;
for (const [key, files] of Object.entries(OWNERS)) {
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    assert.ok(src.includes(`withModule('${key}'`),
      `${file} обслуговує модуль «${key}», але не питає фічу — вимкнений модуль усе одно відповість`);
    guarded++;
  }
}
console.log(`  ok  ${guarded} файлів маршрутів відмовляють вимкненому модулю`);

// ── Жоден модуль не лишився на голому withActor/withPermission ──────────
//
// Половина модуля за фічею, половина ні — це найгірший із трьох станів:
// налаштування виглядає робочим, екран частково живий, і зрозуміти, чому
// «Зали» вимкнені, а один запит усе одно проходить, можна лише з коду.
for (const files of Object.values(OWNERS)) {
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    const stray = [...src.matchAll(/\bexport const \w+ = (?:await )?with(Actor|Permission)\(/g)];
    assert.strictEqual(stray.length, 0,
      `${file}: ${stray.length} експорт(ів) на withActor/withPermission повз withModule — ці двері лишились відчиненими`);
  }
}
console.log('  ok  у файлах модулів не лишилось варти повз withModule');

console.log('  ok  features: реєстр, меню і маршрути кажуть одне');
