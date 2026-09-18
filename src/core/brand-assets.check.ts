/**
 * Роль зображення заводиться РАЗОМ ІЗ ЧИТАЧЕМ.
 *
 *   node src/core/brand-assets.check.ts
 *
 * ── Що саме тут стережеться і чому воно варте гейта ─────────────────────
 *
 * Типізовані фото обʼєкта в цьому проєкті вже вмирали. `property_photos`
 * мала `photo_type` із CHECK на `building / territory / common / aerial`;
 * зараз її немає — вона в `DEAD_COLUMNS` у `src/lib/db.ts`, тобто її знесло
 * прибирання мертвих даних. Писач був, читача не було ЖОДНОГО, і оператор,
 * який позначав фотографії типами, ніколи не дізнався, куди вони поділись.
 *
 * Тому реєстр ролей називає читача кожної, а цей гейт ВІДКРИВАЄ названі
 * файли й вимагає, щоб ключ ролі в них справді згадувався. Роль, читача якої
 * немає або який її не читає, валить збірку — отже померти вдруге вона не
 * може мовчки.
 *
 * Межа названа чесно: це перевірка ЧЕСНОСТІ РЕЄСТРУ, не доказ того, що
 * читач малює зображення на екрані. Довести друге можна лише живим проходом;
 * доти гейт тримає те, що здатний, і не вдає більшого.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import '../../scripts/lib/module-aliases.mjs';

const { BRAND_ASSET_ROLES, BRAND_ASSET_ROLE_KEYS, readBrandAssetRole, readBrandAssets, logoFor } =
  await import('./brand-assets.ts');

let ok = 0;
const say = (what: string) => { console.log(`  ok  ${what}`); ok += 1; };

// ── 1. Реєстр цілий ─────────────────────────────────────────────────────
assert.ok(BRAND_ASSET_ROLES.length >= 2, 'реєстр з однієї ролі — це не набір');
assert.strictEqual(new Set(BRAND_ASSET_ROLE_KEYS).size, BRAND_ASSET_ROLE_KEYS.length,
  'у реєстрі повторюється ключ ролі');
say(`реєстр: ${BRAND_ASSET_ROLES.length} ролей, усі імена різні`);

// ── 2. КОЖНА роль має читача, і читач її справді читає — КОДОМ ──────────
//
// Перша редакція цього твердження питала `text.includes(role.key)` на цілому
// файлі, і саме тому була ВІЗЕРУНКОМ, а не властивістю (AGENTS §3.2.1):
// коментар, який лише ЗГАДУЄ роль, її задовольняв. Двоє з трьох читачів
// проходили саме так, а `a4-sheet.ts` згадував `logo_light`, щоб сказати,
// що НЕ читає його, — тобто гейт зараховував читачем того, хто прямо писав
// протилежне. Роль, задоволена прозою, це знову `photo_type`: реєстр
// обіцяє споживача, якого немає.
//
// Тому коментарі вирізаються, і лишається дві законні форми читання:
//
//   пряма   — файл називає ключ ролі у КОДІ (`assets.cover`, `'logo'`);
//   дверима — файл кличе двері вибору (`logoFor`), а самі двері галузяться
//             на цьому ключі. Поверхні свідомо не знають, коли брати
//             `logo_light`: це правило одне на всіх, і живе воно в дверях.
//
// Другу форму гейт теж не бере на слово: він читає ВЛАСНИЙ код дверей.
const CHOOSERS = ['logoFor'] as const;
const stripComments = (src: string) => {
  const out: string[] = [];
  let inBlock = false;
  for (const line of src.split('\n')) {
    if (inBlock) {
      const end = line.indexOf('*/');
      if (end === -1) continue;
      inBlock = false;
      out.push(line.slice(end + 2));
      continue;
    }
    const t = line.trimStart();
    if (t.startsWith('//')) continue;
    if (t.startsWith('/*')) {
      const end = t.indexOf('*/', 2);
      if (end === -1) { inBlock = true; continue; }
      out.push(t.slice(end + 2));
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
};

const registryCode = stripComments(fs.readFileSync('src/core/brand-assets.ts', 'utf8'));
// Двері, названі тут, мусять справді галузитись на ролях — інакше «читає
// дверима» стало б новим способом задовольнити гейт словом.
for (const door of CHOOSERS) {
  assert.ok(registryCode.includes(`function ${door}`),
    `двері «${door}» названі вибирачем ролі, а такої функції в реєстрі немає`);
}
assert.ok(BRAND_ASSET_ROLE_KEYS.some((k) => registryCode.includes(`'${k}'`)
    || registryCode.includes(`.${k}`)),
  'жодні двері не галузяться на ролі — вибір ролі десь є, і він не тут');

for (const role of BRAND_ASSET_ROLES) {
  assert.ok(role.readBy.length > 0,
    `роль «${role.key}» не називає жодного читача — так помер photo_type`);
  // Ключ ролі обирається ДВЕРИМА, якщо їхній власний код на ньому галузиться.
  const viaDoor = CHOOSERS.filter((door) => {
    const body = registryCode.slice(registryCode.indexOf(`function ${door}`));
    return body.slice(0, body.indexOf('\n}')).includes(role.key);
  });
  for (const file of role.readBy) {
    assert.ok(fs.existsSync(file),
      `роль «${role.key}» називає читачем ${file}, а такого файла немає`);
    const code = stripComments(fs.readFileSync(file, 'utf8'));
    const direct = code.includes(role.key);
    const through = viaDoor.some((door) => code.includes(`${door}(`));
    assert.ok(direct || through,
      `${file} названий читачем ролі «${role.key}», але в його КОДІ її немає — `
      + `ні прямо, ні через двері (${CHOOSERS.join(', ')}). `
      + 'Коментар про роль читачем не робить (§3.2.1): реєстр обіцяв би '
      + 'споживача, якого немає, — рівно так помер photo_type');
  }
}
say(`кожна роль названа читачем, і читач її бере КОДОМ (прямо або через ${CHOOSERS.join('/')})`);

// ── 2б. І кожна роль має ПІДПИС на екрані оператора ─────────────────────
//
// Той самий клас, що палітра без підпису (`brand-palettes.check`): роль,
// доданої в реєстр і забутої на екрані, оператор побачить сирим ключем —
// `logo_light` замість «Лого для темного тла». Підписи живуть на екрані, а
// не в реєстрі, бо саме звідти їх бере `extract-strings` (§3.2.1, шостий
// випадок: рядок поза каталогом дає 100 % покриття і українське слово
// німецькому адміністраторові).
const CARD = 'src/modules/properties/ui/PropertyBrandCard.tsx';
const cardCode = stripComments(fs.readFileSync(CARD, 'utf8'));
const labels = cardCode.slice(cardCode.indexOf('ROLE_NAMES'));
const labelBlock = labels.slice(0, labels.indexOf('\n};'));
for (const role of BRAND_ASSET_ROLES) {
  assert.ok(labelBlock.includes(`${role.key}:`),
    `роль «${role.key}» не має підпису в ROLE_NAMES (${CARD}) — `
    + 'оператор побачить сирий ключ');
}
say(`кожна роль має підпис на екрані (${BRAND_ASSET_ROLES.length} із ${BRAND_ASSET_ROLES.length})`);

// ── 3. Невідома роль не проходить ───────────────────────────────────────
//
// Фікстура не вироджена: два різних ВІДОМИХ і шість різних невідомих. З
// одним відомим ключем сцена була б зелена й на коді, що завжди віддає одне.
assert.strictEqual(readBrandAssetRole(BRAND_ASSET_ROLE_KEYS[0]), BRAND_ASSET_ROLE_KEYS[0]);
assert.strictEqual(readBrandAssetRole(BRAND_ASSET_ROLE_KEYS[1]), BRAND_ASSET_ROLE_KEYS[1]);
assert.notStrictEqual(readBrandAssetRole(BRAND_ASSET_ROLE_KEYS[0]),
  readBrandAssetRole(BRAND_ASSET_ROLE_KEYS[1]),
  'дві різні відомі ролі дали однакову відповідь — слово не читається');
for (const junk of [null, undefined, '', 'photo_type', 'building', 42, {}]) {
  assert.strictEqual(readBrandAssetRole(junk), null,
    `невідома роль ${JSON.stringify(junk)} мусить дати null`);
}
say('відома роль лишається собою, невідома — null');

// ── 4. Адреса перевіряється тією ж міркою, що лого 0419 ─────────────────
const rows = [
  { role: 'logo', url: 'https://x.test/logo.svg' },
  { role: 'cover', url: '/uploads/brand/cover.jpg' },
  // Ці три не мають потрапити на екран, і кожен зі своєї причини.
  { role: 'logo_light', url: 'http://x.test/insecure.png' },
  { role: 'building', url: 'https://x.test/orphan.png' },
  { role: 'logo_light', url: '   ' },
];
const assets = readBrandAssets(rows);
assert.deepStrictEqual(Object.keys(assets).sort(), ['cover', 'logo'],
  `на екран пішло ${JSON.stringify(Object.keys(assets))}: `
  + 'http дає порожній прямокутник (браузер блокує змішаний вміст), '
  + 'невідома роль — чуже імʼя, порожня адреса — нічого');
say('http, невідома роль і порожня адреса не доходять до екрана');

// ── 5. Лого для темного тла ─────────────────────────────────────────────
//
// Вісь ТЛА не вироджена: два значення, і для готелю з ДВОМА лого вони мусять
// дати РІЗНЕ, інакше твердження зелене й на коді, який тла не бачить.
const two = { logo: '/a.png', logo_light: '/b.png' };
assert.strictEqual(logoFor(two, 'light'), '/a.png');
assert.strictEqual(logoFor(two, 'dark'), '/b.png');
assert.notStrictEqual(logoFor(two, 'light'), logoFor(two, 'dark'),
  'світле й темне тло дали одне лого — вісь тла не читається');
// А готель з ОДНИМ лого нічого не втрачає: це покращення для тих, хто дав
// два, а не умова для решти.
assert.strictEqual(logoFor({ logo: '/a.png' }, 'dark'), '/a.png',
  'готель з одним лого лишився без лого на темному тлі');
assert.strictEqual(logoFor({ logo_light: '/b.png' }, 'light'), '/b.png',
  'готель, який дав лише світле лого, лишився без лого зовсім');
assert.strictEqual(logoFor({}, 'light'), null, 'порожнє мусить дати null, а не порожній рядок');
say('темне тло бере своє лого; один файл працює скрізь');

console.log(`brand-assets: роль без читача й без підпису не заводиться, ${ok} тверджень`);
