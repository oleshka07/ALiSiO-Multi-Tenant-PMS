/**
 * Палітра, яку можна обрати, справді щось міняє — на ОБОХ поверхнях.
 *
 * ── Твердження, а не візерунок (§3.2.1) ─────────────────────────────────
 *
 * Питання не «чи є в CSS слово teal_warm_grey», а «чи збігаються дві множини»:
 * імена в реєстрі і блоки в таблицях стилів. Тому перевіряються ОБИДВА
 * напрямки — ключ без блоку і блок без ключа, — і на обох поверхнях окремо.
 *
 * Односторонній гейт («кожен ключ має блок») пропустив би найтихішу з двох
 * помилок: блок, який лишився в CSS після перейменування ключа. Він нікому не
 * заважає, нічого не ламає і через місяць читається як діючий.
 *
 * ── Чому це взагалі гейт, а не «подивитись очима» ───────────────────────
 *
 * Палітра — вимикач на екрані налаштувань. Вимикач, який нічого не вмикає,
 * це П5 дослівно: адміністратор обирає, бачить «Збережено», їде показувати
 * власнику — і власник бачить кольори чужого готелю. Помилка мовчить.
 *
 * ── І ще одне твердження, дорожче за перші два ──────────────────────────
 *
 * Кожен блок мусить називати ВЕСЬ набір токенів своєї поверхні. Блок, у якому
 * забули один токен, успадковує його від попереднього набору — тобто дає
 * бірюзову сторінку з латунною кнопкою, і саме на кнопці це помітять
 * останньою. Це той самий клас, що П18: значення, не перевизначене в другій
 * темі, лишається кольором першої.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import '../../scripts/lib/module-aliases.mjs';

const { BRAND_PALETTES, FIRST_BRAND_PALETTE, readBrandPalette, readBrandLogoUrl } =
  await import('./brand-palettes.ts') as typeof import('./brand-palettes');

let ok = 0;
const say = (what: string) => { console.log(`  ok  ${what}`); ok += 1; };

/** Імена палітр, оголошені в реєстрі. */
const keys = BRAND_PALETTES.map((p) => p.key);
assert.ok(keys.length >= 2, 'реєстр з однієї палітри — це не вибір');
assert.strictEqual(new Set(keys).size, keys.length, 'у реєстрі повторюється ключ');
say(`реєстр: ${keys.length} палітр, усі імена різні`);

assert.ok(keys.includes(FIRST_BRAND_PALETTE), 'перша палітра відсутня у власному реєстрі');
assert.strictEqual(keys[0], FIRST_BRAND_PALETTE,
  'перша палітра списку має збігатися з FIRST_BRAND_PALETTE — інакше порядок на екрані розходиться з тим, що ми про нього кажемо');
say(`${FIRST_BRAND_PALETTE} стоїть першим рядком`);

/**
 * Поверхні, кожна зі своїм префіксом токенів.
 *
 * Дві, а не одна: гейт, який дивиться лише на застосунок, лишився б зеленим,
 * якби гостьова сторінка не знала половини імен — а гість проходить обидві
 * підряд і побачив би зміну кольору посеред шляху.
 */
const SURFACES = [
  { file: 'src/app/stay/guest-app.css', prefix: '--ga-', what: 'гостьовий застосунок' },
  { file: 'src/app/guest/[token]/guest-page.css', prefix: '--gp-', what: 'гостьова сторінка' },
];

for (const surface of SURFACES) {
  const css = fs.readFileSync(surface.file, 'utf8');

  // Блоки, оголошені в цій таблиці стилів.
  const declared = new Set(
    [...css.matchAll(/\[data-palette='([a-z_]+)'\]/g)].map((m) => m[1]),
  );

  for (const key of keys) {
    assert.ok(declared.has(key),
      `${surface.what}: палітру «${key}» можна обрати, а блоку [data-palette='${key}'] у ${surface.file} немає — вибір нічого не міняє`);
  }
  say(`${surface.what}: усі ${keys.length} палітр мають блок`);

  for (const found of declared) {
    assert.ok(keys.includes(found),
      `${surface.what}: блок [data-palette='${found}'] є, а такої палітри в реєстрі немає — залишок від перейменування`);
  }
  say(`${surface.what}: жодного блоку-сироти`);

  // ── Повнота набору ────────────────────────────────────────────────────
  //
  // Еталон — набір токенів ПЕРШОЇ палітри. Вона ж дефолтна, тобто та, від
  // якої решта успадкувала б забуте.
  const bodyOf = (key: string): string => {
    const at = css.indexOf(`[data-palette='${key}']`);
    assert.ok(at >= 0, `${surface.what}: блок ${key} зник між двома читаннями файла`);
    const open = css.indexOf('{', at);
    const close = css.indexOf('}', open);
    return css.slice(open, close);
  };
  const tokensIn = (key: string) =>
    new Set([...bodyOf(key).matchAll(new RegExp(`(${surface.prefix}[a-z-]+)\\s*:`, 'g'))].map((m) => m[1]));

  const reference = tokensIn(keys[0]);
  assert.ok(reference.size >= 4,
    `${surface.what}: у зразковій палітрі лише ${reference.size} токенів — перевірка повноти нічого не стереже`);

  for (const key of keys.slice(1)) {
    const mine = tokensIn(key);
    const missing = [...reference].filter((t) => !mine.has(t));
    assert.strictEqual(missing.length, 0,
      `${surface.what}: палітра «${key}» не називає ${missing.join(', ')} — ці токени лишаться кольорами «${keys[0]}»`);
  }
  say(`${surface.what}: кожна палітра називає всі ${reference.size} токенів`);
}

// ── Підпис для оператора ────────────────────────────────────────────────
//
// Палітра без підпису показалась би адміністратору сирим ключем
// (`teal_warm_grey`) — і це не косметика: екран вибору, у якому один рядок
// написаний машинною мовою, читається як недороблений, а не як «забули
// підпис». Реєстр підписів живе на екрані (там його бачить `extract-strings`),
// тож звіряється саме файл екрана.
const SETTINGS = 'src/app/app/(dashboard)/settings/guest-page/page.tsx';
const screen = fs.readFileSync(SETTINGS, 'utf8');
const namesAt = screen.indexOf('const PALETTE_NAMES');
assert.ok(namesAt >= 0, `${SETTINGS}: PALETTE_NAMES зник — вибір палітри лишився без підписів`);
const namesBody = screen.slice(namesAt, screen.indexOf('};', namesAt));
const named = new Set([...namesBody.matchAll(/^\s*([a-z_]+)\s*:/gm)].map((m) => m[1]));
for (const key of keys) {
  assert.ok(named.has(key), `палітра «${key}» не має підпису в PALETTE_NAMES — оператор побачить сирий ключ`);
}
for (const found of named) {
  assert.ok(keys.includes(found), `підпис «${found}» є, а такої палітри в реєстрі немає — залишок`);
}
say(`підписи для оператора: ${named.size}, рівно стільки ж, скільки палітр`);

// ── Базовий набір повний ────────────────────────────────────────────────
//
// Твердження, заради якого `readBrandPalette` віддає `null`, а не палітру.
//
// Історичний вигляд ДВОХ поверхонь різний: застосунок жив у піску й латуні,
// гостьова сторінка — у лісовій зелені. Одне значення «за замовчуванням» на
// обидві перефарбувало б кожному наявному готелю гостьову сторінку від самої
// міграції, хоч ніхто нічого не обирав. Тому готель без вибору не дістає
// стрічки `data-palette` взагалі — і тоді базовий блок мусить називати ВЕСЬ
// набір сам, інакше сторінка лишиться без частини кольорів.
const BASE = [
  { file: 'src/app/stay/guest-app.css', prefix: '--ga-', at: '.guest-root,', what: 'гостьовий застосунок' },
  { file: 'src/app/guest/[token]/guest-page.css', prefix: '--gp-', at: ':root {', what: 'гостьова сторінка' },
];
for (const base of BASE) {
  const css = fs.readFileSync(base.file, 'utf8');
  const at = css.indexOf(base.at);
  assert.ok(at >= 0, `${base.what}: базового блоку (${base.at}) немає — готель без вибору лишиться без кольорів`);
  const body = css.slice(css.indexOf('{', at), css.indexOf('}', css.indexOf('{', at)));
  const baseTokens = new Set([...body.matchAll(new RegExp(`(${base.prefix}[a-z-]+)\\s*:`, 'g'))].map((m) => m[1]));
  const surface = SURFACES.find((x) => x.file === base.file)!;
  const cssAll = fs.readFileSync(surface.file, 'utf8');
  const firstAt = cssAll.indexOf(`[data-palette='${keys[0]}']`);
  const firstBody = cssAll.slice(cssAll.indexOf('{', firstAt), cssAll.indexOf('}', cssAll.indexOf('{', firstAt)));
  const inPalette = [...firstBody.matchAll(new RegExp(`(${base.prefix}[a-z-]+)\\s*:`, 'g'))].map((m) => m[1]);
  const missing = inPalette.filter((tkn) => !baseTokens.has(tkn));
  assert.strictEqual(missing.length, 0,
    `${base.what}: базовий блок не називає ${missing.join(', ')} — готель без обраної палітри лишиться без цих кольорів`);
  say(`${base.what}: базовий набір повний (${baseTokens.size} токенів), готель без вибору нічого не втрачає`);
}

// ── Читання слова з бази ────────────────────────────────────────────────
//
// Фікстура не вироджена: два РІЗНИХ відомих і шість різних невідомих. Сцена
// з одним відомим ключем була б зелена і на коді, який завжди віддає одне й
// те саме.
assert.strictEqual(readBrandPalette(keys[1]), keys[1], 'відоме імʼя має лишатись собою');
assert.strictEqual(readBrandPalette(keys[0]), keys[0], 'перше імʼя теж лишається собою');
assert.notStrictEqual(readBrandPalette(keys[1]), readBrandPalette(keys[2]),
  'два різних відомих імені дали однакову відповідь — колонка не читається');
for (const junk of [null, undefined, '', 'schlossberghotel', 42, {}]) {
  assert.strictEqual(readBrandPalette(junk), null,
    `невідоме значення ${JSON.stringify(junk)} мусить дати null — «готель не обирав», а не чужу палітру`);
}
say('слово з колонки: відоме лишається собою, невідоме = «не обирав»');

// ── Адреса лого ─────────────────────────────────────────────────────────
assert.strictEqual(readBrandLogoUrl('https://example.test/logo.svg'), 'https://example.test/logo.svg');
assert.strictEqual(readBrandLogoUrl('  https://example.test/logo.svg  '), 'https://example.test/logo.svg');
assert.strictEqual(readBrandLogoUrl('/uploads/logo.png'), '/uploads/logo.png');
for (const bad of ['http://example.test/logo.png', '//example.test/logo.png',
  'javascript:alert(1)', 'data:image/png;base64,AAA', '', '   ', null, 7]) {
  assert.strictEqual(readBrandLogoUrl(bad), null,
    `адреса ${JSON.stringify(bad)} не має потрапити в <img src>`);
}
say('лого: https і власний шлях проходять, решта дає порожньо');

console.log(`brand-palettes: вибір справді міняє вигляд на обох поверхнях, ${ok} тверджень`);
