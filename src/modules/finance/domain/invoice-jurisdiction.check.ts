/**
 * Німецький обʼєкт не друкується чеським рахунком.
 *
 *   node src/modules/finance/domain/invoice-jurisdiction.check.ts
 *
 * ── Що сталося на пілоті ────────────────────────────────────────────────
 *
 * Портьє згенерував фактуру гостю в німецькому готелі й отримав чеський
 * документ: «Ubytování», дати `cs-CZ`, без розбивки МПДВ за ставками — і суму,
 * ПЕРЕРАХОВАНУ в крони. Жодної помилки на екрані.
 *
 * Ланцюг був такий:
 *
 *   properties.country мала DEFAULT 'CZ'
 *     → documentLanguage() читає саме цю колонку й дає 'cs',
 *       ПЕРЕБИВАЮЧИ мову організації 'de'
 *     → loadInvoiceDocument() віддає локаль cs-CZ
 *     → маршрут /api/invoices/[id]/pdf не бачить de-DE
 *     → мовчазний фолбек у чеський рендерер.
 *
 * Найгірше в тому дефолті — що він АКТИВНО перебивав правильну відповідь:
 * при `country IS NULL` та сама функція падає на мову організації й дає 'de'.
 * Тобто порожнє значення працювало б, а «зручне» ні.
 *
 * ── Чому три перевірки, а не одна ───────────────────────────────────────
 *
 * Кожна ланка ламається окремо, і кожна дає той самий тихий результат: гість
 * отримує документ чужої юрисдикції з номером у книзі рахунків. Тому гейт
 * тримає всі три: дефолту немає в жодній зі схем, заведення не вгадує країну,
 * а маршрут не має шляху, яким німецький обʼєкт потрапляє в чеський рендерер.
 */
import assert from 'node:assert';
import fs from 'node:fs';

const blank = (m: string) => m.replace(/[^\n]/g, ' ');
const strip = (s: string) => s
  .replace(/\/\*[\s\S]*?\*\//g, blank)
  .replace(/^([ \t]*)\/\/.*$/gm, (m) => blank(m));

// ── Жодна схема не вгадує країну ─────────────────────────────────────
//
// Обидві, бо розходяться вони мовчки: на SQLite розробник бачить одне, на
// проді клієнт отримує інше.
const pg = fs.readFileSync('db/postgres/schema.sql', 'utf8');
const pgProperties = pg.slice(pg.indexOf('CREATE TABLE "properties" ('));
const pgCountry = pgProperties.slice(0, pgProperties.indexOf(');'))
  .split('\n').find((l) => /^\s*"country"/.test(l)) ?? '';
assert.ok(pgCountry, 'не знайшов properties.country у схемі Postgres');
assert.ok(!/DEFAULT/i.test(pgCountry),
  `properties.country має DEFAULT (${pgCountry.trim()}) — це юрисдикція, зашита в схему`);

const sqlite = fs.readFileSync('src/lib/db.ts', 'utf8');
const sqliteProperties = sqlite.slice(sqlite.indexOf('CREATE TABLE properties ('));
const sqliteCountry = strip(sqliteProperties.slice(0, sqliteProperties.indexOf('\n    )')))
  .split('\n').find((l) => /^\s*country\s+TEXT/.test(l)) ?? '';
assert.ok(sqliteCountry, 'не знайшов properties.country у схемі SQLite');
assert.ok(!/DEFAULT/i.test(sqliteCountry),
  `properties.country має DEFAULT (${sqliteCountry.trim()}) у схемі SQLite`);
console.log('  ok  жодна схема не вгадує країну обʼєкта');

// ── Заведення готелю теж не вгадує ───────────────────────────────────
// Без вікна навколо INSERT: забілені коментарі рахуються в довжину, і зріз
// «перші N символів» промахувався повз сам рядок. Країну не можна вгадувати
// НІДЕ в цьому файлі, тож і шукаємо по всьому.
const prov = strip(fs.readFileSync('src/core/provisioning.ts', 'utf8'));
assert.ok(/INSERT INTO properties/.test(prov), 'не знайшов заведення обʼєкта');
assert.ok(!/country\s*\|\|\s*['"][A-Za-z]{2}['"]/.test(prov),
  'provisionOrganization підставляє країну за замовчуванням — не названо означає NULL');
console.log('  ok  заведення готелю не вигадує країну');

// ── Маршрут PDF не має тихого шляху в чужий рендерер ─────────────────
//
// Перевірка текстова, бо це порядок гілок, а не арифметика: німецький обʼєкт
// мусить або дістати німецький рендерер, або гучну відмову.
const route = strip(fs.readFileSync('src/app/api/invoices/[id]/pdf/route.ts', 'utf8'));
assert.ok(/generateGermanInvoicePdf\(/.test(route), 'маршрут мусить уміти німецький рахунок');
assert.ok(/documentLanguage\(/.test(route),
  'маршрут мусить спитати юрисдикцію обʼєкта, перш ніж падати в інший рендерер');
const guard = route.indexOf('documentLanguage(');
const czech = route.indexOf('convertToCzkAuto(');
assert.ok(czech > 0, 'не знайшов чеську гілку — гейт дивиться не туди');
assert.ok(guard < czech,
  'перевірка юрисдикції мусить стояти ДО чеського рендерера, інакше німецький '
  + 'обʼєкт знову тихо отримає «Ubytování» і суму в кронах');
assert.ok(/status:\s*409/.test(route.slice(guard, czech)),
  'німецький обʼєкт без зібраного документа мусить дістати гучну відмову, а не інший рахунок');
console.log('  ok  німецький обʼєкт або німецький рахунок, або відмова');

console.log('юрисдикція рахунка: країна не вгадується, чужий рендерер не підміняє');
