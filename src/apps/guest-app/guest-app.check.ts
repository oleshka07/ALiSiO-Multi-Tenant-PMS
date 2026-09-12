/**
 * Гостьовий застосунок: ключ у адресі називає ОДИН будинок, і саме свій.
 *
 *   node src/apps/guest-app/guest-app.check.ts
 *
 * ── Що тут стверджується і чому саме це ─────────────────────────────────
 *
 * Сторінка публічна: сесії немає за визначенням, і єдине, що відрізняє один
 * готель від другого, — ключ у адресі. Тобто весь орендар цього застосунку
 * тримається на одному запиті, і якщо він помиляється, гість бачить чужий
 * готель, чужі номери й чужі ціни — мовчки, з кодом 200.
 *
 * Осі не вироджені (інваріант 26): ДВА рахунки, у кожного свій обʼєкт і свій
 * ключ. Один рахунок доводив би нуль — читач, який просто віддає «єдиний
 * обʼєкт у базі», був би зелений.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-guest-app-'));
process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { runWithOrganization } = await import('@core/auth/tenant-context.ts');
const { propertyByAppKey } = await import('./data/property.repo.ts');
const { generateGuestAppKey, readGuestAppKey } = await import('./domain/key.ts');
const { languageFromHeader } = await import('./ui/translations.ts');
const lookup = await import('./api/lookup.handlers.ts');
const { coreSource } = await import('./source/core.source.ts');
const { upsertPrices } = await import('@pricing/live.ts');

const sql = getSql();

const A = '__guest_app__org_a';
const B = '__guest_app__org_b';
const PA = '__guest_app__prop_a';
const PB = '__guest_app__prop_b';

const keyA = generateGuestAppKey();
const keyB = generateGuestAppKey();

for (const [org, prop, name, key] of [
  [A, PA, 'Haus Alpha', keyA], [B, PB, 'Haus Beta', keyB],
] as const) {
  await sql.run('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)', [org, org, org]);
  await runWithOrganization(org, () => sql.run(
    `INSERT INTO properties (id, organization_id, name, slug, country, guest_app_key)
     VALUES (?, ?, ?, ?, 'DE', ?)`,
    [prop, org, name, prop, key]));
}

try {
  // ── 1. Ключ відчиняє СВІЙ будинок, і обидва боки ─────────────────────────
  //
  // Двома боками навмисно: «ключ А дав обʼєкт А» істинне й на читачі, який
  // завжди віддає перший рядок таблиці. Пара «і ключ Б дав обʼєкт Б» це
  // прочитання виключає.
  const homeA = await propertyByAppKey(keyA);
  const homeB = await propertyByAppKey(keyB);
  assert.strictEqual(homeA?.propertyId, PA, `ключ А відчинив ${homeA?.propertyId}`);
  assert.strictEqual(homeB?.propertyId, PB, `ключ Б відчинив ${homeB?.propertyId}`);
  assert.strictEqual(homeA?.organizationId, A, 'орендар А не той');
  assert.strictEqual(homeB?.organizationId, B, 'орендар Б не той');
  // Імена РІЗНІ й перевіряються: саме назву готелю гість бачить першим рядком,
  // і підміна тут — це чужий бренд на екрані.
  assert.strictEqual(homeA?.propertyName, 'Haus Alpha', 'на екрані чужа назва');
  assert.strictEqual(homeB?.propertyName, 'Haus Beta', 'на екрані чужа назва');
  console.log('  ok  1. кожен ключ відчиняє свій будинок і свій рахунок');

  // ── 2. Вигаданий ключ не відчиняє нічого ─────────────────────────────────
  //
  // Не «порожній обʼєкт», не «перший-ліпший»: немає рядка — немає відповіді,
  // і сторінка робить 404 (інваріанти 5 і 13).
  assert.strictEqual(await propertyByAppKey(generateGuestAppKey()), undefined,
    'ключ, якого немає в базі, щось відчинив');
  console.log('  ok  2. ключ, якого немає, не відчиняє нічого');

  // ── 3. Те, що не є ключем, не стає умовою запиту ─────────────────────────
  //
  // Форму перевіряє домен ДО бази: сегмент адреси приходить від будь-кого з
  // інтернету. Порожньо, коротко, задовго, чужі літери, спроба підставити
  // шаблон — усе це `null`, тобто 404 без жодного запиту.
  // `0`, `1`, `l`, `o`, `i`, `u` в алфавіт не входять навмисно — їх плутають
  // на око й на слух, коли ключ диктують або набирають з паперу.
  for (const bad of ['', ' ', 'abc', keyA.slice(0, 15), `${keyA}x`, '%', `${keyA.slice(0, 15)}%`,
    '0000000000000000', '1111111111111111', 'llllllllllllllll', 'oooooooooooooooo',
    'iiiiiiiiiiiiiiii', 'uuuuuuuuuuuuuuuu']) {
    assert.strictEqual(readGuestAppKey(bad), null, `«${bad}» прийнято за ключ`);
  }
  // І зустрічна вісь: справжній ключ приймається — інакше твердження вище
  // було б зелене й на функції, яка відмовляє завжди.
  assert.strictEqual(readGuestAppKey(keyA), keyA, 'справжній ключ не прийнято');
  assert.strictEqual(readGuestAppKey(keyA.toUpperCase()), keyA,
    'ключ із паперу, набраний великими літерами, не прийнято');
  console.log('  ok  3. не-ключ відсіюється до бази; справжній — приймається');

  // ── 4. Два ключі не бувають однакові ─────────────────────────────────────
  //
  // Тримає це УНІКАЛЬНИЙ індекс (0414), але сам генератор теж має не давати
  // збігів: індекс тут — друга лінія, а не перша.
  const many = new Set(Array.from({ length: 500 }, () => generateGuestAppKey()));
  assert.strictEqual(many.size, 500, `генератор дав ${500 - many.size} збігів на 500`);
  console.log('  ok  4. 500 ключів — 500 різних');

  // ── 5. Мова приходить із ТЕЛЕФОНА, і з ваги, а не з порядку ──────────────
  //
  // Заголовок — список із вагами в довільному порядку. Читач «перший підрядок»
  // на `cs,en;q=0.9` віддав би чеську, якої в нас немає, і сторінка мовчки
  // впала б у дефолт; на `de;q=0.2,en;q=0.9` він віддав би німецьку людині,
  // яка просила англійську. Тому осі дві: і вага, і невідома мова.
  assert.strictEqual(languageFromHeader('de-AT,de;q=0.9,en-US;q=0.8'), 'de', 'de-AT це de');
  assert.strictEqual(languageFromHeader('en-GB,en;q=0.9'), 'en', 'англієць дістав не англійську');
  assert.strictEqual(languageFromHeader('de;q=0.2,en;q=0.9'), 'en',
    'вага знехтувана — узято перший рядок, а не найбажаніший');
  assert.strictEqual(languageFromHeader('cs,en;q=0.8'), 'en',
    'чех із англійською другою мусить дістати англійську, а не дефолт');
  assert.strictEqual(languageFromHeader('cs,sk;q=0.8'), 'de',
    'мова, якої ми не знаємо, має впасти в дефолт');
  assert.strictEqual(languageFromHeader(''), 'de', 'порожній заголовок');
  assert.strictEqual(languageFromHeader(undefined), 'de', 'заголовка немає взагалі');
  assert.strictEqual(languageFromHeader('en;q=0'), 'de',
    'вага 0 означає «не треба», а не «треба найбільше»');
  console.log('  ok  5. мова з Accept-Language: за вагою, з регіоном, із запасним дефолтом');

  // ── 6. Пошук своєї броні: обидва чинники, вузьке вікно, лише токен ──────
  //
  // Найчутливіше місце застосунку: маршрут шукає ЖИВИХ ЛЮДЕЙ без жодної
  // автентифікації і відкритий з будь-якого телефона. Тому тут не одне
  // твердження, а всі чотири властивості з розбору односерверної вирви, і
  // кожна — обома боками: «чуже не знаходиться» істинне й на маршруті, який
  // не знаходить нічого ніколи.
  const today = new Date().toISOString().slice(0, 10);
  const day = (n: number) =>
    new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

  const seedStay = async (org: string, prop: string, id: string, opts: {
    first: string; last: string; phone: string | null; from: number;
    token?: string | null; unit?: string | null;
  }) => runWithOrganization(org, async () => {
    await sql.run(
      'INSERT INTO guests (id, organization_id, first_name, last_name, phone) VALUES (?, ?, ?, ?, ?)',
      [`${id}_g`, org, opts.first, opts.last, opts.phone]);
    await sql.run(
      `INSERT INTO reservations (id, organization_id, property_id, guest_id, check_in, check_out,
                                 nights, adults, status, currency, guest_page_token)
       VALUES (?, ?, ?, ?, ?, ?, 1, 2, 'confirmed', 'EUR', ?)`,
      [id, org, prop, `${id}_g`, day(opts.from), day(opts.from + 1),
        opts.token === undefined ? `${id}_tok` : opts.token]);
  });

  await seedStay(A, PA, 'ga_ok', { first: 'Anna', last: 'Beispiel', phone: '+49 170 5551234', from: 0 });
  await seedStay(A, PA, 'ga_far', { first: 'Fern', last: 'Weit', phone: '+49 170 5559999', from: 30 });
  await seedStay(A, PA, 'ga_nopage', { first: 'Ohne', last: 'Seite', phone: '+49 170 5557777', from: 0, token: null });
  // Той самий рахунок, ДРУГИЙ обʼєкт: вісь будинку, якої не видно з осі орендаря.
  await runWithOrganization(A, () => sql.run(
    `INSERT INTO properties (id, organization_id, name, slug, country) VALUES (?, ?, ?, ?, 'DE')`,
    [`${PA}_2`, A, 'Haus Alpha Zwei', `${PA}_2`]));
  await seedStay(A, `${PA}_2`, 'ga_other_house', { first: 'Neben', last: 'Haus', phone: '+49 170 5556666', from: 0 });
  // Чужий рахунок.
  await seedStay(B, PB, 'gb_alien', { first: 'Fremd', last: 'Gast', phone: '+49 170 5554444', from: 0 });

  // Кожен виклик — зі СВОЄЇ адреси, і це не дрібниця сцени.
  //
  // Маршрут рахує невдалі спроби на IP (десять за чверть години), тож
  // двадцять тверджень з однієї адреси впираються в ліміт, і кожне наступне
  // починає стверджувати про 429 замість того, про що написано. Перша
  // редакція цієї сцени так і впала — «бронь без сторінки віддала токен» на
  // відповіді `429`. Ліміт перевіряється ОКРЕМО, унизу, і саме там він і
  // має спрацювати.
  let probe = 0;
  const find = async (body: unknown, ip?: string) => {
    probe += 1;
    const res = await lookup.findStay(new Request('http://local/api/apps/guest/find', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip ?? `10.0.0.${probe}` },
      body: JSON.stringify(body),
    }));
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  };

  // а) правильна пара знаходить — і віддає ЛИШЕ токен
  const hit = await find({ key: keyA, phone: '+49 170 5551234', name: 'Beispiel' });
  assert.strictEqual(hit.body.found, true, `правильна пара не знайшла: ${JSON.stringify(hit.body)}`);
  assert.strictEqual(hit.body.token, 'ga_ok_tok', 'віддано не той токен');
  assert.deepStrictEqual(Object.keys(hit.body).sort(), ['found', 'token'],
    `у відповіді є щось, крім токена: ${JSON.stringify(hit.body)}`);
  const asText = JSON.stringify(hit.body);
  for (const leak of ['Anna', 'Beispiel', day(0), '5551234']) {
    assert.ok(!asText.includes(leak), `у відповідь протекло «${leak}»: ${asText}`);
  }

  // б) один чинник без другого — не знаходить. ОБИДВА боки.
  assert.strictEqual((await find({ key: keyA, phone: '+49 170 5551234', name: 'Falsch' })).body.found, false,
    'правильний телефон із чужим імʼям знайшов бронь — другий чинник не працює');
  assert.strictEqual((await find({ key: keyA, phone: '+49 170 5550000', name: 'Beispiel' })).body.found, false,
    'чужий телефон із правильним імʼям знайшов бронь');

  // в) телефон у будь-якій формі — той самий номер (останні шість цифр)
  for (const form of ['+49 170 5551234', '01705551234', '00491705551234', '170-555-1234']) {
    assert.strictEqual((await find({ key: keyA, phone: form, name: 'Beispiel' })).body.found, true,
      `форма номера «${form}» не знайшла ту саму бронь`);
  }
  // І зустрічна вісь: занадто короткий номер чинником НЕ є.
  assert.strictEqual((await find({ key: keyA, phone: '1234', name: 'Beispiel' })).body.found, false,
    'чотири цифри зійшли за номер — пошук звузився до половини готелю');

  // г) імʼя і прізвище взаємозамінні: канали привозять їх переставленими
  assert.strictEqual((await find({ key: keyA, phone: '+49 170 5551234', name: 'Anna' })).body.found, true,
    'імʼя замість прізвища не спрацювало — гість із переставленою бронню розвернеться');

  // ґ) вікно: бронь за 30 днів не знаходиться, сьогоднішня — так
  assert.strictEqual((await find({ key: keyA, phone: '+49 170 5559999', name: 'Weit' })).body.found, false,
    'бронь за 30 днів знайшлась — вікно не працює, і множина для вгадування знову вся база');

  // д) бронь є, сторінки немає — ОКРЕМИЙ рід, не «не знайдено»
  const noPage = await find({ key: keyA, phone: '+49 170 5557777', name: 'Seite' });
  assert.strictEqual(noPage.body.found, false, 'бронь без сторінки віддала токен');
  assert.strictEqual(noPage.body.reason, 'no_page',
    'бронь без гостьової сторінки не відрізнена від «не знайдено» — гість шукатиме помилку в тому, що набрав');

  // е) чужий БУДИНОК того самого рахунку — не своя бронь (INC-029)
  assert.strictEqual((await find({ key: keyA, phone: '+49 170 5556666', name: 'Haus' })).body.found, false,
    'ключ корпусу А знайшов бронь корпусу Б того ж рахунку');
  // ж) чужий РАХУНОК — тим більше
  assert.strictEqual((await find({ key: keyA, phone: '+49 170 5554444', name: 'Gast' })).body.found, false,
    'ключ рахунку А знайшов бронь рахунку Б');
  // І зустрічна вісь для обох: своїм ключем ці броні ЗНАХОДЯТЬСЯ — інакше
  // твердження вище були б зелені й на маршруті, що не знаходить нічого.
  assert.strictEqual((await find({ key: keyB, phone: '+49 170 5554444', name: 'Gast' })).body.found, true,
    'рахунок Б не знаходить власної броні — тоді «чуже не знайшлось» нічого не доводить');

  // з) сміття і неправильне — ОДНАКОВА відповідь: різниця це спосіб промацати
  const garbage = await find({ key: keyA, phone: null, name: 42 });
  const wrong = await find({ key: keyA, phone: '+49 170 5550000', name: 'Niemand' });
  assert.deepStrictEqual(garbage.body, wrong.body,
    `криве і неправильне відповідають по-різному: ${JSON.stringify(garbage.body)} проти ${JSON.stringify(wrong.body)}`);
  assert.strictEqual(garbage.status, wrong.status, 'різні статуси на криве і на неправильне');

  // и) без ключа — 404, як і на сторінці
  assert.strictEqual((await find({ phone: '+49 170 5551234', name: 'Beispiel' })).status, 404,
    'запит без ключа не відмовив 404');
  console.log('  ok  6. пошук: два чинники, вікно, лише токен, окремий no_page, свій будинок і свій рахунок');

  // ── 7. Лічильник спроб: четверта властивість, без якої решта марна ───────
  //
  // Вікно ±1 день робить множину для вгадування маленькою — і це ж робить її
  // придатною до ПЕРЕБОРУ. Пара «телефон + імʼя» без ліміту підбирається за
  // вечір. Тому десять невдач на адресу за чверть години — і адреса відмовлена.
  //
  // Обидва боки, як і скрізь: одинадцята спроба з ТІЄЇ САМОЇ адреси
  // відмовляється, а з іншої — ні. Без другої половини твердження було б
  // зелене й на маршруті, який відмовляє всім.
  const attacker = '203.0.113.7';
  for (let i = 0; i < 10; i++) {
    await find({ key: keyA, phone: `+49 170 111${String(i).padStart(4, '0')}`, name: 'Niemand' }, attacker);
  }
  const blocked = await find({ key: keyA, phone: '+49 170 5551234', name: 'Beispiel' }, attacker);
  assert.strictEqual(blocked.status, 429,
    `одинадцята спроба з тієї самої адреси пройшла (${blocked.status}) — пару «телефон + імʼя» можна підбирати перебором`);
  const fromElsewhere = await find({ key: keyA, phone: '+49 170 5551234', name: 'Beispiel' }, '198.51.100.4');
  assert.strictEqual(fromElsewhere.body.found, true,
    'інша адреса теж відмовлена — ліміт стоїть не на адресі, і один перебірник закриває готель для всіх гостей');
  console.log('  ok  7. десять невдач — адреса відмовлена; сусідня адреса працює');

  // ── 8. Пропозиції: лише те, що справді можна продати ────────────────────
  //
  // Крок «немає бронювання» показує гостю типи номерів із цінами. Двоє
  // джерела помилки тут коштують по-різному, і обидва мовчазні:
  //
  //   тип БЕЗ вільної кімнати у списку — продали те, чого немає;
  //   тип БЕЗ ціни у списку            — продали за ціною, якої не називали.
  //
  // Тому обидва боки кожної осі: показується те, що має, і НЕ показується те,
  // що не має. Односторонні твердження зелені на джерелі, яке віддає порожньо.
  const offersFor = (from: string, to: string, adults = 2) =>
    runWithOrganization(A, () => coreSource.offers({
      organizationId: A, propertyId: PA, from, to, adults,
    }));

  // Дві кімнати одного типу і одна другого: осі не вироджені (інваріант 26) —
  // «усі типи» (2) не сплутати ні з «тип А» (1), ні з «тип Б» (1).
  await runWithOrganization(A, async () => {
    await sql.run("INSERT INTO categories (id, property_id, name, type) VALUES (?, ?, 'Zimmer', 'room')", ['ga_cat', PA]);
    // Три типи, і кожен закриває СВОЮ вісь:
    //   ga_t1 — вільний і з ціною: має показуватись;
    //   ga_t2 — вільний, але БЕЗ ціни: інваріант 17;
    //   ga_t3 — вільний і з ціною, але готель ЗАБОРОНИВ продавати онлайн.
    // Без третього «bookable_online ігнорується» лишалось би зеленим: обидва
    // інші типи дозволені, і зняття умови нічого б не змінило (§3.2.1).
    for (const [id, name, code, online] of [
      ['ga_t1', 'Doppelzimmer', 'DBL', true],
      ['ga_t2', 'Einzelzimmer', 'SGL', true],
      ['ga_t3', 'Suite', 'SUI', false],
    ] as const) {
      await sql.run(
        `INSERT INTO unit_types (id, property_id, category_id, name, code, bookable_online, max_occupancy, max_adults)
         VALUES (?, ?, 'ga_cat', ?, ?, ?, 4, 4)`, [id, PA, name, code, online]);
    }
    for (const [id, type, name] of [
      ['ga_u1', 'ga_t1', '101'], ['ga_u2', 'ga_t1', '102'],
      ['ga_u3', 'ga_t2', '201'], ['ga_u4', 'ga_t3', '301'],
    ] as const) {
      await sql.run(
        `INSERT INTO units (id, property_id, unit_type_id, category_id, name, code)
         VALUES (?, ?, ?, 'ga_cat', ?, ?)`, [id, PA, type, name, name]);
    }
    // Ціна — лише ПЕРШОМУ типу. Другий лишається без жодного джерела ціни, і
    // саме на ньому перевіряється інваріант 17.
    // Ціни ночей РІЗНІ (100 і 150), і це не косметика: на однакових сума
    // «дві ночі по 100» збігається з «ночей × 100», тож підміна котирування
    // власним множенням лишалась би зеленою (інваріант 26, друга половина).
    // 250 не дорівнює ні 100, ні 150, ні 200, ні 300.
    const nightly = [100, 150, 100, 150];
    for (const type of ['ga_t1', 'ga_t3']) {
      await upsertPrices(type, nightly.map((price, d) => ({ date: day(d), base_price: price })));
    }
  });

  const listed = await offersFor(day(0), day(2));
  assert.deepStrictEqual(listed.map((o) => o.unitTypeId), ['ga_t1'],
    `у списку не те: ${JSON.stringify(listed.map((o) => o.unitTypeId))} — тип без ціни не має показуватись (інваріант 17)`);
  assert.strictEqual(listed[0].free, 2, `вільних кімнат ${listed[0].free}, а їх дві`);
  assert.strictEqual(listed[0].nights, 2, `ночей ${listed[0].nights}, а їх дві`);
  assert.strictEqual(listed[0].total, 250,
    `сума ${listed[0].total} — ночі 100 і 150 дають 250, і рахує їх НЕ застосунок, а calculateQuote`);
  // І третій тип, який готель заборонив продавати онлайн, не зʼявляється —
  // хоч кімната в нього вільна, і ціна на ці ночі є.
  assert.ok(!listed.some((o) => o.unitTypeId === 'ga_t3'),
    'тип із bookable_online = FALSE потрапив у список — рішення готелю обійдено');
  console.log('  ok  8. у списку лише тип, у якого є і вільна кімната, і повна ціна');

  // ── 9. Зайнято — зникає зі списку; звільнилось — вертається ─────────────
  //
  // Зустрічна вісь до попереднього: «показується» перевірено вище, тут
  // «перестає показуватись». Без пари твердження було б зелене й на джерелі,
  // яке ніколи нікого не прибирає.
  await runWithOrganization(A, () => sql.run(
    `INSERT INTO guests (id, organization_id, first_name, last_name) VALUES ('ga_bg', ?, 'Belegt', 'Gast')`, [A]));
  const occupy = async (unitId: string, id: string) => runWithOrganization(A, () => sql.run(
    `INSERT INTO reservations (id, organization_id, property_id, unit_id, unit_type_id, guest_id,
                               check_in, check_out, nights, adults, status, currency)
     VALUES (?, ?, ?, ?, 'ga_t1', 'ga_bg', ?, ?, 2, 2, 'confirmed', 'EUR')`,
    [id, A, PA, unitId, day(0), day(2)]));

  await occupy('ga_u1', 'ga_occ1');
  const oneLeft = await offersFor(day(0), day(2));
  assert.strictEqual(oneLeft[0]?.free, 1,
    `одна кімната зайнята — мало лишитись 1, а лишилось ${oneLeft[0]?.free}`);

  await occupy('ga_u2', 'ga_occ2');
  const noneLeft = await offersFor(day(0), day(2));
  assert.deepStrictEqual(noneLeft.map((o) => o.unitTypeId), [],
    `обидві кімнати зайняті, а тип усе одно в списку: ${JSON.stringify(noneLeft)}`);
  // І на ІНШІ дати він вільний — інакше «зник» могло б означати «зник назавжди».
  const later = await offersFor(day(2), day(3));
  assert.strictEqual(later.length, 1, 'на вільні дати тип не повернувся — прибирає не за датами');
  console.log('  ok  9. зайняте зникає зі списку, а на інші дати лишається');

  console.log('guest-app: ключ називає один будинок — свій, і сторінка говорить мовою телефона');
} finally {
  for (const org of [A, B]) {
    await runWithOrganization(org, () => sql.run('DELETE FROM properties WHERE organization_id = ?', [org]));
    await sql.run('DELETE FROM organizations WHERE id = ?', [org]);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}
