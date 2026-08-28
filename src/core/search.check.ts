/**
 * Пошук не показує того, чого людині бачити не можна.
 *
 *   node src/core/search.check.ts
 *
 * ── Чому це окрема перевірка ────────────────────────────────────────────
 *
 * Пошук — єдине місце застосунку, яке одним запитом торкається чотирьох
 * модулів і чотирьох таблиць. Кожна інша сторінка захищена своєю вартою і
 * своїм правом; тут одна варта на всі розділи, і помилка в одному рядку
 * відкриває розділ цілком.
 *
 * Дві речі, які тут ламаються тихо:
 *
 * 1. **Розділ без права.** Забути `permission` у `SECTIONS` — це не помилка
 *    компіляції й не помилка виконання: розділ просто починає показуватись
 *    усім. Оператор без `nav:documents` бачить номери фактур; без
 *    `nav:finance` — назви екранів налаштувань. Назва сама по собі є
 *    інформацією про готель.
 *
 * 2. **Провайдер без орендаря.** На Postgres політика прикриє, на SQLite —
 *    ні. Тобто розробник шукав би по ВСІХ готелях і бачив би це як «пошук
 *    працює». Саме цей клас описаний у AGENTS.md §7.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

// ── 1. Кожен провайдер обмежує запит організацією ────────────────────────
//
// Не «десь у файлі є слово organization_id», а саме в WHERE: провайдер, який
// вибирає колонку `organization_id` і не фільтрує по ній, виглядав би
// правильним у grep-і й віддавав би чужі рядки.
const PROVIDERS = [
  'src/modules/guests/data/guest-search.ts',
  'src/modules/bookings/data/booking-search.ts',
  'src/modules/properties/data/unit-search.ts',
  'src/modules/finance/data/invoice-search.ts',
];

for (const file of PROVIDERS) {
  const src = fs.readFileSync(file, 'utf8');
  const name = path.basename(file);

  assert.ok(/organization_id = \?/.test(src),
    `${name}: у запиті немає \`organization_id = ?\` — на SQLite пошук піде по всіх готелях`);

  // Параметр орендаря має йти ПЕРШИМ у масиві: інакше він підставиться в
  // умову LIKE, а шаблон — в умову орендаря, і запит поверне порожньо на
  // Postgres і все на SQLite. Обидва варіанти виглядають як «щось із
  // пошуком», а не як дірка.
  const call = src.match(/\}\s*`,\s*\[([^\]]*)\]/);
  assert.ok(call, `${name}: не знайшов масив параметрів запиту`);
  assert.ok(/^\s*organizationId\s*,/.test(call![1]),
    `${name}: перший параметр запиту має бути organizationId, а не ${call![1].split(',')[0].trim()}`);

  // Ліміт — не оптимізація. Без нього запит «а» повертає всіх гостей готелю.
  assert.ok(/LIMIT \$\{SEARCH_LIMIT\}/.test(src),
    `${name}: запит без LIMIT — пошук стає вивантаженням бази`);

  // Регістр. `LIKE` напряму означає різне у двох двигунах і неправильне в
  // обох; шов для цього вже є.
  assert.ok(/sql\.dialect\.ilike/.test(src) && !/\bLIKE \?/.test(src.replace(/dialect\.ilike/g, '')),
    `${name}: порівняння через LIKE замість dialect.ilike — «іван» не знайде «Іван»`);
}
console.log(`  ok  ${PROVIDERS.length} провайдери пошуку названі орендарем, з лімітом і без сирого LIKE`);

// ── 2. Кожен розділ маршруту має право ───────────────────────────────────
const route = fs.readFileSync('src/app/api/search/route.ts', 'utf8');

// Лише блок SECTIONS. Ширший пошук ловив би й `{ key: 'screens', … }` —
// групу у відповіді, яка правом не описується, бо фільтрується рядком нижче
// (це перевіряється окремо).
const sectionsBlock = route.slice(
  route.indexOf('const SECTIONS'),
  route.indexOf('\n];', route.indexOf('const SECTIONS')),
);
assert.ok(sectionsBlock.length > 100, 'блок SECTIONS не розібрався — перевірка дивиться не туди');
const sections = [...sectionsBlock.matchAll(/\{\s*key:\s*'([a-z]+)',[^}]*?\}/g)].map((m) => m[0]);
assert.ok(sections.length >= 4, `розділів у SECTIONS знайдено ${sections.length} — перевірка дивиться не туди`);
for (const s of sections) {
  const key = s.match(/key:\s*'([a-z]+)'/)![1];
  assert.ok(/permission:\s*'[a-z_:]+'/.test(s),
    `розділ пошуку '${key}' без permission — його побачить кожен, хто вміє відкрити пошук`);
}
console.log(`  ok  ${sections.length} розділів пошуку названі правом`);

// Право перевіряється ДО запиту, а не після. Відфільтрувати відповідь —
// означало б прочитати те, чого читати не можна, і сподіватись, що воно не
// витече дорогою.
assert.ok(/const allowed = SECTIONS\.filter\(\(s\) => hasPermission/.test(route),
  'розділи фільтруються не до запиту — дані читаються, а потім відкидаються');
console.log('  ok  права перевіряються до запиту, не після');

// Екрани шукаються на клієнті — і теж за правом. Це не заміна варти (кожен
// екран має власну), а обіцянка не пропонувати перехід, що дасть 403.
const palette = fs.readFileSync('src/components/layout/GlobalSearch.tsx', 'utf8');
assert.ok(/hasPermission\(user\.permissions, d\.permission\)/.test(palette),
  'екрани в палітрі не фільтруються за правом — пошук пропонуватиме те, що відмовить');
assert.ok(/\(d\.keywords \?\? \[\]\)\.map\(\(k\) => t\(k\)\)/.test(palette),
  'ключові слова екранів шукаються без t() — чеський адміністратор мусив би набирати «ПДВ»');
console.log('  ok  екрани шукаються за правом і перекладеними словами');

// ── 3. Кожен екран каталогу існує ────────────────────────────────────────
//
// Каталог — це список посилань, і посилання, що веде в 404, гірше за
// відсутнє: воно виглядає як поломка застосунку, а не як відсутня сторінка.
const nav = fs.readFileSync('src/core/navigation.ts', 'utf8');
const hrefs = [...nav.matchAll(/href:\s*'(\/app\/[^']+)'/g)].map((m) => m[1]);
assert.ok(hrefs.length >= 20, `у каталозі ${hrefs.length} екранів — перевірка дивиться не туди`);
const missing = hrefs.filter((h) => !fs.existsSync(path.join('src/app/app/(dashboard)', h.replace(/^\/app\//, ''), 'page.tsx')));
assert.deepStrictEqual(missing, [], `у каталозі є екрани, яких немає:\n    ${missing.join('\n    ')}`);
console.log(`  ok  ${hrefs.length} екранів каталогу справді існують`);

// ── 4. Мертвих кнопок у шапці не лишилось ────────────────────────────────
//
// Кнопка без обробника і без `disabled` стояла на всіх 77 екранах: вона
// виглядає робочою і не робить нічого, тобто читається як поломка.
for (const file of ['src/components/layout/Header.tsx', 'src/components/mobile/MobileHeader.tsx']) {
  const src = fs.readFileSync(file, 'utf8');
  for (const btn of src.matchAll(/<button[\s\S]*?>/g)) {
    const tag = btn[0];
    if (/onClick|disabled|type="submit"/.test(tag)) continue;
    const line = src.slice(0, btn.index!).split('\n').length;
    assert.fail(`${file}:${line} — кнопка без onClick і без disabled: виглядає робочою, не робить нічого`);
  }
}
console.log('  ok  у шапці немає кнопок без обробника й без disabled');

console.log('  ok  пошук: знаходить те, що можна, і лише в своєму готелі');
