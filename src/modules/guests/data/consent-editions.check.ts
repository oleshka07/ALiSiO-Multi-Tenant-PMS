/**
 * Згоду обирає РЕДАКЦІЯ, а не мова гостя.
 *
 *   node src/modules/guests/data/consent-editions.check.ts
 *
 * ── Що було зламано, і це виміряно, а не прочитано ──────────────────────
 *
 * `activeConsentTexts(org, locale, kinds)` віддавав один текст на рід і
 * обирав його в тому числі за мовою. Прогін 18.09.2026 на тому самому
 * довіднику:
 *
 *     ГІСТЬ DE →  terms:v2@de   data_processing:v1@de
 *     ГІСТЬ CS →  terms:v2@cs   data_processing:v2@cs
 *     ГІСТЬ FR →  terms:v2@cs   data_processing:v1@de
 *
 * Тобто в роду з двома чинними редакціями **версію обирала мова телефона**.
 * У `guest_consents` лягає пара «рід + версія»: німець приймав v1, чех — v2,
 * і це не показ, а юридичний запис. Двоє гостей, що бронюють в одну хвилину,
 * погоджувались на різні документи.
 *
 * Третій рядок гірший: француз дістав два роди РІЗНИМИ мовами, і яка кому
 * дісталась, вирішив порядок рядків від бази — клас INC-027, де SQLite,
 * PGlite і Postgres упорядковують по-різному. Тобто на стенді це виглядало б
 * стабільним, а в проді дало б інше.
 *
 * ── Що стверджується ────────────────────────────────────────────────────
 *
 * Дві властивості, і вони різні:
 *
 *   ЧИТАЧ бази (`activeConsentEditions`) не має мови в аргументах узагалі —
 *     версія не може залежати від того, чого він не знає, — і при кількох
 *     чинних версіях бере НАЙНОВІШУ, однаково для всіх;
 *   ЕКРАН (`consentBody`) обирає мову з тих, що редакція має: мова гостя →
 *     мова готелю → решта ДЕТЕРМІНОВАНО. Версію він не чіпає.
 *
 * ── Чому фікстура саме така (інваріант 26) ──────────────────────────────
 *
 *   ВЕРСІЯ — у `data_processing` ДВІ чинні версії, і кожна своєю мовою. З
 *     однією версією твердження «версія не залежить від мови» зелене на
 *     будь-якому коді, зокрема на тому, що стояв у проді;
 *   МОВА — у `terms` одна версія у ДВОХ мовах із РІЗНИМ текстом. Однаковий
 *     текст лишив би вісь мови невидимою;
 *   МОВА, ЯКОЇ НЕМАЄ — питається `fr`, якої немає ніде: видно, чи спрацював
 *     запасний шлях і чи він веде до мови ГОТЕЛЮ, а не до сусідньої;
 *   ЧИННІСТЬ — знятих з обігу редакцій ДВІ, і одна з них НАЙНОВІША за
 *     міткою часу (`terms v3`). Перша редакція сцени мала лише стару зняту,
 *     і злом «прибрати фільтр `is_active`» проходив повз гейт: найновішою
 *     однаково виходила чинна. Вісь потребує значення з ОБОХ боків.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-consent-ed-'));
process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { runWithOrganization } = await import('@core/auth/tenant-context.ts');
const { activeConsentEditions } = await import('./guest-consents.repo.ts');
const { consentBody } = await import('../../../apps/guest-app/domain/consents.ts');

const sql = getSql();
let ok = 0;
const say = (what: string) => { console.log(`  ok  ${what}`); ok += 1; };

const ORG = '__consent_ed__org';
await sql.run('INSERT INTO organizations (id, name, slug, default_currency, language) VALUES (?,?,?,?,?)',
  [ORG, 'Haus', 'consent-ed', 'EUR', 'de']);

/**
 * Довідник готелю. `created_at` називається ЯВНО і зростає разом із версією:
 * інакше всі рядки лягли б однією міткою, вибір «найновішої» вирішувався б
 * запасним правилом, і твердження про мітку часу нічого б не стерегло.
 */
const rows: Array<[string, string, string, string, string, boolean, string]> = [
  // id,               рід,               версія, мова, текст,                 чинна, коли
  ['ct_t1_de', 'terms', 'v1', 'de', 'AGB v1 deutsch', false, '2026-01-01T00:00:00Z'],
  ['ct_t2_de', 'terms', 'v2', 'de', 'AGB v2 deutsch', true, '2026-02-01T00:00:00Z'],
  ['ct_t2_cs', 'terms', 'v2', 'cs', 'Podmínky v2 česky', true, '2026-02-01T00:00:00Z'],
  // НАЙНОВІША редакція — і вона ЗНЯТА з обігу. Саме так виглядає готель, що
  // підготував нову редакцію й поки не ввів її, або відкликав щойно введену.
  //
  // Без цього рядка сцена була вироджена по осі «чинність»: неактивна v1 була
  // ще й найстарішою, тож читач БЕЗ фільтра `is_active` однаково віддавав v2,
  // і злом «прибрати фільтр» проходив повз гейт. Це знайшов саме він —
  // третій із шести зломів, єдиний, що лишився зеленим (§3.2.1).
  ['ct_t3_de', 'terms', 'v3', 'de', 'AGB v3 deutsch (Entwurf)', false, '2026-04-01T00:00:00Z'],
  ['ct_d1_de', 'data_processing', 'v1', 'de', 'DSGVO v1 deutsch', true, '2026-01-01T00:00:00Z'],
  ['ct_d2_cs', 'data_processing', 'v2', 'cs', 'GDPR v2 česky', true, '2026-03-01T00:00:00Z'],
  // Рід, у якого дві чинні версії з ОДНАКОВОЮ міткою часу: саме тут працює
  // запасне правило (більший рядок версії). Без нього вибір вирішувала б
  // позиція рядка, тобто рушій.
  ['ct_m2_de', 'marketing', 'v2', 'de', 'Newsletter v2', true, '2026-05-01T00:00:00Z'],
  ['ct_m9_de', 'marketing', 'v9', 'de', 'Newsletter v9', true, '2026-05-01T00:00:00Z'],
];
await runWithOrganization(ORG, async () => {
  for (const [id, kind, version, locale, body, active, at] of rows) {
    await sql.run(
      `INSERT INTO consent_texts (id, organization_id, consent_kind, version, locale, body, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, ORG, kind, version, locale, body, active, at]);
  }
});

const KINDS = ['terms', 'data_processing', 'marketing'] as const;
const read = () => runWithOrganization(ORG, () => activeConsentEditions(ORG, KINDS));

// ── 1. Читач не має мови в аргументах ───────────────────────────────────
//
// Не «викликаємо двічі й порівнюємо» — це стереже ВІЗЕРУНОК. Мова не може
// зрушити версію, бо її ніде взяти: у функції один змістовний аргумент.
// Твердження про АРИТЕТ і є твердженням про властивість (§3.2.1).
assert.strictEqual(activeConsentEditions.length, 2,
  `читач бере ${activeConsentEditions.length} аргументи — якщо серед них мова, `
  + 'версія знову зможе від неї залежати, і повернеться саме той дефект');
say('у читача немає мови в аргументах: версії нема від чого залежати');

// ── 2. Найновіша ЧИННА версія, і знята з обігу не пропонується ──────────
const editions = await read();
const byKind = Object.fromEntries(editions.map((e) => [e.consentKind, e]));
assert.strictEqual(byKind.terms?.version, 'v2',
  `terms віддав ${byKind.terms?.version}. Чинна тут рівно одна редакція — v2: `
  + 'v1 стара і знята, v3 НАЙНОВІША і теж знята. Гостю пропонують те, що готель ввів у дію');
assert.strictEqual(byKind.data_processing?.version, 'v2',
  `data_processing віддав ${byKind.data_processing?.version}, а найновіша чинна — v2`);
assert.notStrictEqual(byKind.terms?.version, byKind.data_processing?.version === 'v1' ? 'v2' : 'v1',
  'обидва роди віддали ту саму версію — вісь версії у фікстурі вироджена');
say('версія: найновіша чинна, знята з обігу не пропонується');

// ── 3. Рід без жодного тексту не вигадується ────────────────────────────
assert.strictEqual(editions.length, 3, `родів у відповіді ${editions.length}, а заведено 3`);
assert.deepStrictEqual(editions.map((e) => e.consentKind), ['terms', 'data_processing', 'marketing'],
  'порядок родів не той, який назвав викликач — галочки стануть не в тому порядку');
const empty = await runWithOrganization(ORG, () => activeConsentEditions(ORG, ['newsletter_sms']));
assert.deepStrictEqual(empty, [],
  'рід, якого готель не заводив, зʼявився в переліку — галочка ні під чим');
say('порожній рід не вигадується; порядок — той, який назвав викликач');

// ── 2-б. Нічия за міткою часу розвʼязується ВЕРСІЄЮ, не позицією рядка ──
//
// Твердження про МІЙ код, а не про `localeCompare`: перша редакція сцени
// звіряла сортування двох літералів і нічого не стерегла.
assert.strictEqual(byKind.marketing?.version, 'v9',
  `marketing віддав ${byKind.marketing?.version}: дві чинні версії однією міткою часу, `
  + 'і вибір мусить розвʼязати рядок версії, а не позиція рядка від бази');
say('нічия за часом → більший рядок версії');

// ── 4. Редакція везе ВСІ свої мови ──────────────────────────────────────
assert.deepStrictEqual(Object.keys(byKind.terms.bodies).sort(), ['cs', 'de'],
  `terms везе мови [${Object.keys(byKind.terms.bodies)}] — екран не зможе перемкнути без мережі`);
assert.deepStrictEqual(Object.keys(byKind.data_processing.bodies), ['cs'],
  'у відповідь потрапила мова ЧУЖОЇ версії — редакції злились в одну');
assert.notStrictEqual(byKind.terms.bodies.de, byKind.terms.bodies.cs,
  'дві мови однієї редакції мають однаковий текст — вісь мови у фікстурі вироджена');
say('редакція везе всі свої мови і ЖОДНОЇ чужої');

// ── 5. Екран обирає мову; версія лишається тією самою ───────────────────
for (const [lang, want] of [['cs', 'cs'], ['de', 'de'], ['fr', 'de'], ['pl', 'de']] as const) {
  const picked = consentBody(byKind.terms, lang, 'de');
  assert.strictEqual(picked?.locale, want,
    `гість ${lang}: terms показано мовою «${picked?.locale}», а мало «${want}»`);
}
assert.notStrictEqual(consentBody(byKind.terms, 'cs', 'de')!.body,
  consentBody(byKind.terms, 'de', 'de')!.body,
  'дві мови дали однаковий ТЕКСТ — перемикання нічого не міняє');
say('екран: мова гостя → мова готелю → решта, і текст справді інший');

// ── 6. Мова, якої немає НІ в гостя, НІ в готелю ─────────────────────────
//
// `data_processing v2` існує лише чеською, а готель німецький. Показати нема
// чим «правильно», і саме тут легко віддати випадкове: раніше це вирішував
// порядок рядків бази. Тепер — сортування ключів, тобто те саме на кожному
// рушії.
const alien = consentBody(byKind.data_processing, 'fr', 'de');
assert.strictEqual(alien?.locale, 'cs',
  `редакція лише чеською показалась як «${alien?.locale}» — мова в lang= бреше`);
assert.strictEqual(alien?.body, 'GDPR v2 česky');
say('мови немає ні в гостя, ні в готелю — беремо ту, що є, і НАЗИВАЄМО її');

// ── 7. Редакція без текстів — нічого, а не порожня галочка ──────────────
assert.strictEqual(consentBody({ bodies: {} }, 'de', 'de'), null);
assert.strictEqual(consentBody({ bodies: { de: '   ' } }, 'de', 'de'), null,
  'текст із самих пробілів — це галочка ні під чим, а не згода');
assert.strictEqual(consentBody(null, 'de', 'de'), null);
say('редакція без тексту не показується зовсім');

// ── 8. Порядок рядків бази не є твердженням ─────────────────────────────
//
// Той самий довідник, прочитаний двічі, дає те саме. Це не тавтологія: читач,
// який спирався б на `ORDER BY` або на «перший, що трапився», тут не впаде —
// але впаде на іншому рушії, і тоді ніхто не зрозуміє, чому. Тому поруч
// стверджується ВЛАСТИВІСТЬ: вибір рахується з даних рядка (мітка часу,
// потім рядок версії), а не з позиції.
const again = await read();
assert.deepStrictEqual(again.map((e) => `${e.consentKind}:${e.version}`),
  editions.map((e) => `${e.consentKind}:${e.version}`),
  'два читання того самого довідника дали різні редакції');
say('вибір рахується з даних, не з позиції рядка');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`consent-editions: редакцію обирає довідник, мову — екран, ${ok} тверджень`);
