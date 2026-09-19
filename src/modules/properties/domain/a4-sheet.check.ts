/**
 * Аркуш A4: QR веде туди, куди вказує підпис під ним.
 *
 *   node src/modules/properties/domain/a4-sheet.check.ts
 *
 * ── Чому саме це твердження ─────────────────────────────────────────────
 *
 * Аркуш вішають на скло й забувають про нього на місяці. Якщо код веде не
 * туди, куди адреса під ним, помилка МОВЧИТЬ двічі: сторінка відкриється
 * (просто не та), і папір про це не повідомить. Побачить гість.
 *
 * Тому QR тут не «зібрався», а **розкодовується назад** — `jsqr` читає
 * пікселі згенерованого PNG. Різниця не формальна: твердження «ми попросили
 * закодувати правильний рядок» зелене й тоді, коли в документ вклали інше
 * зображення; це ж читає те, що справді намальовано.
 *
 * ── Осі, і жодна не вироджена (інваріант 26) ────────────────────────────
 *
 *   ОБʼЄКТ — два обʼєкти з РІЗНИМИ ключами. З одним «узяв не той рядок»
 *     лишалось би зеленим, а це найдорожча помилка тут: готель надрукував
 *     аркуш сусіда;
 *   ПРАВКА — поле, яке оператор ЗМІНИВ, і поле, якого не торкнувся, і поле,
 *     яке він стер. Три значення, бо «стер» і «не торкнувся» приходять із
 *     форми однаково (порожнім рядком), а означати мусять одне: як у готелю;
 *   МОВА — готель німецький (два блоки) і готель англомовний (один). З одним
 *     готелем правило «не друкувати англійську двічі» недоказове.
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';

const { buildSheet, sheetUrl } = await import('./a4-sheet.ts');
const { renderSheetPdf } = await import('./a4-sheet-pdf.ts');
const { whatsappLink } = await import('../data/reception.repo.ts');
const QRCode = (await import('qrcode')).default;
const { PNG } = await import('pngjs');
const jsQR = (await import('jsqr')).default;

let ok = 0;
const say = (what: string) => { console.log(`  ok  ${what}`); ok += 1; };

const ORIGIN = 'https://beta.example.test';
const HOUSE = {
  name: 'Haus am Berg',
  address: 'Marienstr. 1',
  city: 'Greiz',
  phone: '+49 3661 000000',
  guestAppKey: 'avstta7hamqxcpva',
  hotelLanguage: 'de' as const,
};
// Другий обʼєкт: інший ключ, інша мова. Обидві осі одразу.
const NEIGHBOUR = {
  name: 'Seaside Lodge',
  address: 'Pier 4',
  city: 'Dover',
  phone: '+44 1304 000000',
  guestAppKey: 'bcdefghjkmnpqrst',
  hotelLanguage: 'en' as const,
};

// ── 1. Адреса в QR = адреса, надрукована текстом ────────────────────────
const sheet = buildSheet(HOUSE, ORIGIN);
assert.strictEqual(sheet.qrPayload, sheet.url,
  'вміст QR і надрукована адреса розійшлись — код веде не туди, куди підпис');
assert.strictEqual(sheet.url, `${ORIGIN}/stay/${HOUSE.guestAppKey}`,
  `адреса зібрана не так: ${sheet.url}`);
say('вміст QR дорівнює надрукованій адресі');

// ── 2. І це доводиться РОЗКОДУВАННЯМ, а не рівністю змінних ─────────────
//
// `qrcode` малює, `jsqr` читає. Якщо в документ колись покладуть не те
// зображення, рівність рядків вище лишиться зеленою, а це твердження — ні.
const decode = async (payload: string): Promise<string | null> => {
  const buf = await QRCode.toBuffer(payload, { margin: 4, width: 512, errorCorrectionLevel: 'M' });
  const png = PNG.sync.read(buf);
  const got = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  return got?.data ?? null;
};
assert.strictEqual(await decode(sheet.qrPayload), sheet.url,
  'згенерований QR розкодувався НЕ в ту адресу, що надрукована текстом');
say('QR розкодовано назад — у ньому рівно та адреса');

// ── 3. Вісь обʼєкта: аркуш сусіда — це інший аркуш ──────────────────────
const other = buildSheet(NEIGHBOUR, ORIGIN);
assert.notStrictEqual(other.url, sheet.url,
  'два обʼєкти з різними ключами дали ОДНУ адресу — аркуш веде на чужий готель');
assert.strictEqual(await decode(other.qrPayload), `${ORIGIN}/stay/${NEIGHBOUR.guestAppKey}`);
say('два обʼєкти — два різні коди, кожен на свій');

// ── 4. Тиха зона: без неї частина читачів коду не бачить ────────────────
//
// Твердження про ЗОБРАЖЕННЯ, не про аргумент: рахуються білі рядки зверху.
// `margin: 0` (як у фактурі, де код у власній рамці) дав би нуль.
const withMargin = PNG.sync.read(
  await QRCode.toBuffer(sheet.qrPayload, { margin: 4, width: 512, errorCorrectionLevel: 'M' }));
const whiteRows = (png: { data: Buffer; width: number; height: number }) => {
  let n = 0;
  for (let y = 0; y < png.height; y += 1) {
    let white = true;
    for (let x = 0; x < png.width; x += 1) {
      if (png.data[(y * png.width + x) * 4] < 200) { white = false; break; }
    }
    if (!white) break;
    n += 1;
  }
  return n;
};
const quiet = whiteRows(withMargin);
// 4 модулі від 512 px: модуль ≈ 512 / (21…49 + 8) — тобто десятки пікселів.
// Беремо обережну межу: менш як 20 px білого зверху означає, що тихої зони
// фактично немає.
assert.ok(quiet >= 20,
  `тиха зона ${quiet} px — замало; з margin: 0 частина читачів коду не бачить узагалі`);
const noMargin = PNG.sync.read(
  await QRCode.toBuffer(sheet.qrPayload, { margin: 0, width: 512, errorCorrectionLevel: 'M' }));
assert.ok(whiteRows(noMargin) < quiet,
  'вимір тихої зони нічого не розрізняє: margin 0 і margin 4 дали однаково');
say(`тиха зона на місці (${quiet} px), і вимір відрізняє її від margin: 0`);

// ── 5. Правки: змінене, незаймане і СТЕРТЕ ──────────────────────────────
const edited = buildSheet(HOUSE, ORIGIN, {
  phone: '+49 3661 999111',   // оператор дав інший телефон рецепції
  address: '',                // стер — а означає це «як у готелю»
  hotelName: '   ',           // самі пробіли — те саме
});
assert.strictEqual(edited.phone, '+49 3661 999111', 'правка телефону не доїхала до аркуша');
assert.strictEqual(edited.address, 'Marienstr. 1, Greiz',
  'порожнє поле стерло адресу, а мало лишити ту, що в готелю');
assert.strictEqual(edited.hotelName, HOUSE.name, 'пробіли в полі стерли назву готелю');
assert.notStrictEqual(edited.phone, sheet.phone,
  'правка й дефолт дали однаково — вісь правки у фікстурі вироджена');
say('правка діє; порожнє поле означає «як у готелю», не «зітри»');

// ── 6. Дві мови, і НЕ дві однакові ──────────────────────────────────────
assert.deepStrictEqual(sheet.blocks.map((b) => b.lang), ['de', 'en'],
  'німецький готель мусить дати свою мову і англійську, саме в такому порядку');
assert.notStrictEqual(sheet.blocks[0].lead, sheet.blocks[1].lead,
  'дві колонки з однаковим текстом — це не переклад, а копія');
// Підпис колонки — РІДНОЮ назвою мови, і в кожної свій: без нього гість не
// знає, котра колонка його, і читає обидві (або не читає жодної).
assert.deepStrictEqual(sheet.blocks.map((b) => b.langName), ['Deutsch', 'English'],
  'колонка без власного підпису мови не читається як окрема мова');
assert.deepStrictEqual(other.blocks.map((b) => b.lang), ['en'],
  'англомовний готель дістав англійську ДВІЧІ — другий блок тут зайвий');
say('дві мови для німецького готелю, одна для англомовного');

// ── 7. Власний заклик — лише в блок СВОЄЇ мови ──────────────────────────
const ownWords = buildSheet(HOUSE, ORIGIN, { headline: 'Hier einchecken' });
assert.strictEqual(ownWords.blocks[0].lead, 'Hier einchecken');
assert.strictEqual(ownWords.blocks[1].lead, sheet.blocks[1].lead,
  'німецький заклик оператора потрапив в АНГЛІЙСЬКУ колонку — це не переклад, це підміна');
say('власний заклик стоїть у своїй мові й не вдає переклад');

// ── 8. Години рецепції й чат: обидва НАЗВАНІ, обидва можуть бути відсутні ─
//
// Вісь не вироджена в обидва боки, і це тут головне: поле, якого готель не
// заповнив, мусить дати `null`, а не порожній рядок і не вигадане значення.
// Телефон без годин — обіцянка, якої ніхто не давав; «цілодобово» за
// замовчуванням було б тією обіцянкою, надрукованою нами (клас інваріанта 17).
const withDesk = buildSheet(
  { ...HOUSE, receptionHours: ' 8:00 – 22:00 ', whatsappUrl: 'https://wa.me/49366100000' }, ORIGIN);
assert.strictEqual(withDesk.hours, '8:00 – 22:00', 'години не доїхали або не обрізані');
assert.strictEqual(withDesk.whatsappUrl, 'https://wa.me/49366100000', 'посилання чату не доїхало');
assert.strictEqual(sheet.hours, null, 'готель без годин дістав НЕ null — це вигадана обіцянка');
assert.strictEqual(sheet.whatsappUrl, null, 'готель без WhatsApp дістав посилання нізвідки');
// І порожній рядок — це теж «немає», а не рядок: інакше на папері лишилась
// би порожня смужка під телефоном, яку читач сприйме за брак друку.
assert.strictEqual(buildSheet({ ...HOUSE, receptionHours: '   ' }, ORIGIN).hours, null,
  'самі пробіли в годинах мусять означати «немає», як і порожнє поле');
say('години й чат приїжджають названими, а їх відсутність — це null, не вигадка');

// ── 8б. Посилання чату будується з ЦИФР ─────────────────────────────────
//
// `wa.me` не розуміє пробілів і дужок: номер із ними у шляху дає
// сторінку помилки, і побачить її гість, а не ми. Замало цифр — `null`:
// код, що веде в нікуди, гірший за порожнє місце (той самий довід, що з
// адресою аркуша, тільки дешевший).
assert.strictEqual(whatsappLink('+11 222 333 444'), 'https://wa.me/11222333444',
  'номер із пробілами й плюсом мусить стати самими цифрами');
assert.strictEqual(whatsappLink('(0)55-66 77 88'), 'https://wa.me/055667788',
  'дужки й дефіси мусять зникнути так само, як пробіли');
assert.strictEqual(whatsappLink(null), null, 'немає номера — немає коду');
assert.strictEqual(whatsappLink('12345'), null, 'огризок номера не стає посиланням');
assert.notStrictEqual(whatsappLink('+11 222 333 444'), whatsappLink('(0)55-66 77 88'),
  'два різні номери дали одне посилання — вісь номера вироджена');
say('wa.me будується з самих цифр; огризок і порожнеча дають null');

// ── 8в. Того, що власник просив прибрати, у вмісті НЕМАЄ ────────────────
//
// Твердження про ВІДСУТНІСТЬ, і воно навмисно тут: обидва поля були в
// моделі, обидва друкувались, і повернути їх легше за все випадково —
// «додам хвіст ключа, щоб відрізняти старі аркуші» виглядає розумно доти,
// доки не згадаєш, що про це вже вирішили.
assert.ok(!('keyTail' in sheet), 'хвіст ключа повернувся у вміст аркуша (прибрано 19.09)');
assert.ok(!('printedOn' in sheet), 'дата друку повернулась у вміст аркуша (прибрано 19.09)');
say('хвоста ключа й дати друку у вмісті немає — як і просили');

// ── 8г. Аркуш A4 — це ОДИН аркуш ────────────────────────────────────────
//
// Твердження заведено після того, як їх стало два: pdfkit розриває сторінку
// сам, щойно текст не вміщається в нижнє поле, а підвал ставиться в саме
// поле навмисно. Рядок «підготуйте документ» поїхав на другу сторінку, і
// кожен друк давав зайвий майже порожній аркуш. Нічого не падало, жоден
// гейт не мовчав неправильно — просто ніхто про це не питав.
//
// Сторінки рахуються по об'єктах документа, а не по байтах: `/Type /Page`
// із межею слова, інакше `/Type /Pages` (вузол дерева, він один) рахувався б
// теж і відповідь була б завжди на одиницю більша.
const printed = await renderSheetPdf(withDesk);
const pages = (printed.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
assert.strictEqual(pages, 1,
  `аркуш A4 має бути ОДИН, а вийшло ${pages}: друк дасть зайвий майже порожній аркуш`);
// І не порожній: документ без вмісту теж «одна сторінка».
assert.ok(printed.length > 20_000, `PDF підозріло малий (${printed.length} Б) — сторінка одна, але порожня`);
say(`аркуш друкується однією сторінкою (${(printed.length / 1024).toFixed(0)} КБ)`);

// ── 9. Скісна риска в origin не подвоюється ─────────────────────────────
assert.strictEqual(sheetUrl('https://x.test/', 'abcdefghjkmnpqrs'),
  'https://x.test/stay/abcdefghjkmnpqrs',
  'подвійна риска в адресі — QR поведе на 404');
say('origin зі скісною і без неї дають ту саму адресу');

console.log(`a4-sheet: код веде туди, куди підпис, ${ok} тверджень`);
