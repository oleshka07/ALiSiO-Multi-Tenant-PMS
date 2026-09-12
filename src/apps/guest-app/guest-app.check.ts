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
const { calculateQuote } = await import('@pricing/quote.ts');
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
  // Валюта рахунку названа, а не лишена на дефолт колонки: котирування бере
  // її з організації, і послуги показуються лише в ТІЙ САМІЙ валюті. З
  // дефолтною крони проти євро в послугах сцена червоніла б з чужої причини
  // — і саме так вона й почервоніла першого разу.
  await sql.run('INSERT INTO organizations (id, name, slug, default_currency) VALUES (?, ?, ?, ?)',
    [org, org, org, 'EUR']);
  // Застосунок увімкнено ЯВНО: ключ реєстру фіч стоїть OFF за замовчуванням,
  // і без цього рядка кожна сцена нижче міряла б 404 від вимикача, а не те,
  // про що вона.
  //
  // Вставка — ВСЕРЕДИНІ `runWithOrganization`: `organization_features` під
  // політикою, і запис без орендаря на справжньому Postgres відхиляється
  // («new row violates row-level security policy»). На SQLite політик немає,
  // тож перша редакція була там зелена — рід INC-014.
  await runWithOrganization(org, () => sql.run(
    'INSERT INTO organization_features (organization_id, feature, enabled) VALUES (?, ?, TRUE)',
    [org, 'guest_app']));
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
  // Крок «немає бронювання» показує гостю пари «тип номера × тариф» із
  // цінами. Троє джерела помилки тут коштують по-різному, і всі мовчазні:
  //
  //   тип БЕЗ вільної кімнати у списку — продали те, чого немає;
  //   пара БЕЗ ціни у списку           — продали за ціною, якої не називали;
  //   тариф, знятий чи прихований,     — продали умову, якої готель не продає.
  //
  // Тому обидва боки кожної осі: показується те, що має, і НЕ показується те,
  // що не має. Односторонні твердження зелені на джерелі, яке віддає порожньо.
  const offersFor = (from: string, to: string, adults = 2) =>
    runWithOrganization(A, () => coreSource.offers({
      organizationId: A, propertyId: PA, from, to, adults,
    }));
  /** Пара «тип × тариф» рядком — щоб твердження читалось очима. */
  const pairs = (list: Awaited<ReturnType<typeof offersFor>>) =>
    list.map((o) => `${o.unitTypeId}/${o.ratePlanId ?? 'base'}`).sort();

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

  // Поки в готелю немає жодного видимого тарифу, пара вироджується в тип із
  // базовою ціною — найчастіший випадок малого готелю.
  const baseOnly = await offersFor(day(0), day(2));
  assert.deepStrictEqual(pairs(baseOnly), ['ga_t1/base'],
    `у списку не те: ${JSON.stringify(pairs(baseOnly))} — тип без ціни не має показуватись (інваріант 17)`);
  assert.strictEqual(baseOnly[0].free, 2, `вільних кімнат ${baseOnly[0].free}, а їх дві`);
  assert.strictEqual(baseOnly[0].nights, 2, `ночей ${baseOnly[0].nights}, а їх дві`);
  assert.strictEqual(baseOnly[0].total, 250,
    `сума ${baseOnly[0].total} — ночі 100 і 150 дають 250, і рахує їх НЕ застосунок, а calculateQuote`);
  assert.strictEqual(baseOnly[0].perNight, 125,
    `за ніч ${baseOnly[0].perNight} — 250 за дві ночі це 125, і це ПОДАННЯ суми, а не друга ціна`);
  // І третій тип, який готель заборонив продавати онлайн, не зʼявляється —
  // хоч кімната в нього вільна, і ціна на ці ночі є.
  assert.ok(!baseOnly.some((o) => o.unitTypeId === 'ga_t3'),
    'тип із bookable_online = FALSE потрапив у список — рішення готелю обійдено');
  console.log('  ok  8. у списку лише тип, у якого є і вільна кімната, і повна ціна');

  // ── 8б. Вісь тарифу: одна кімната — кілька умов продажу ─────────────────
  //
  // Та сама кімната на ті самі дати продається за різними умовами, і різниця
  // між ними — гроші й права гостя. Якщо застосунок цю вісь не має, він
  // обирає тариф ЗА ГОСТЯ: або завжди базовий (готель не продасть сніданок),
  // або завжди перший-ліпший (гість заплатить не за те, що бачив).
  //
  // Фікстура не вироджена по жодній з трьох осей, про які твердить сцена:
  //
  //   СУМА — `saver` має власні ціни 80/120 (200), `flex` власних не має і
  //     успадковує базові 100/150 (250). Однакові суми лишили б зеленим
  //     джерело, яке тариф читає, але в котирування не передає;
  //   ВИДИМІСТЬ — `hidden` прихований, `retired` знятий із продажу: по
  //     одному на кожну з двох різних причин не показувати. Тут є чесна
  //     деталь, і без неї сцена брехала б: зняття фільтра `isActive` у
  //     джерелі лишає сцену ЗЕЛЕНОЮ, і це перевірено зломом. Причина не в
  //     виродженій осі, а в другому замку: `priceNights` віддає кожну ніч
  //     знятого тарифу як `missing` (nightly-price.ts, `ratePlanRetired`),
  //     тож інваріант 17 прибирає картку раніше за будь-який фільтр. Замок,
  //     який СПРАВДІ тримає, і стверджується нижче — окремим рядком, щоб
  //     сцена почервоніла, якщо колись перестане тримати саме він;
  //   УМОВИ — у `saver` скасування немає, у `flex` є: картка, яка втратила
  //     умови, помітна лише там, де умови у двох тарифів РІЗНІ.
  await runWithOrganization(A, async () => {
    for (const [id, code, name, meal, cancel, active, hidden] of [
      ['ga_rp_flex', 'FLEX', 'Standardrate mit Frühstück', 'breakfast', 'Stornierbar bis 14:00 am Vortag', true, false],
      ['ga_rp_saver', 'SAVER', 'Nicht-refundierbare Rate', null, null, true, false],
      ['ga_rp_hidden', 'HID', 'Mitarbeiterrate', null, null, true, true],
      ['ga_rp_retired', 'OLD', 'Messerate 2025', null, null, false, false],
    ] as const) {
      await sql.run(
        `INSERT INTO rate_plans (id, property_id, name, code, currency, meal_plan, cancellation_policy, is_active, is_hidden)
         VALUES (?, ?, ?, ?, 'EUR', ?, ?, ?, ?)`,
        [id, PA, name, code, meal, cancel, active, hidden]);
    }
    // Власні ціни — лише в `saver`. `flex` лишається на базових, і саме тому
    // дві картки дають РІЗНІ суми при тій самій кімнаті.
    await upsertPrices('ga_t1', [80, 120, 80, 120].map((price, d) => ({ date: day(d), base_price: price })),
      { ratePlanId: 'ga_rp_saver' });
    // Прихований і знятий дістають ціну теж: інакше вони випали б за
    // інваріантом 17, і твердження «їх не показують» було б зеленим з іншої
    // причини, ніж перевіряється (§3.2.1).
    for (const plan of ['ga_rp_hidden', 'ga_rp_retired']) {
      await upsertPrices('ga_t1', [70, 70, 70, 70].map((price, d) => ({ date: day(d), base_price: price })),
        { ratePlanId: plan });
    }
  });

  const carded = await offersFor(day(0), day(2));
  assert.deepStrictEqual(pairs(carded), ['ga_t1/ga_rp_flex', 'ga_t1/ga_rp_saver'],
    `картки не ті: ${JSON.stringify(pairs(carded))} — видимі тарифи обидва, прихований і знятий жодного разу`);
  const byPlan = new Map(carded.map((o) => [o.ratePlanId, o]));
  assert.strictEqual(byPlan.get('ga_rp_saver')!.total, 200,
    `невідмінний тариф дав ${byPlan.get('ga_rp_saver')!.total} — його власні ночі 80 і 120 це 200`);
  assert.strictEqual(byPlan.get('ga_rp_flex')!.total, 250,
    `тариф без власних цін дав ${byPlan.get('ga_rp_flex')!.total} — він успадковує базові 100 і 150, тобто 250`);
  assert.strictEqual(byPlan.get('ga_rp_flex')!.cancellationPolicy, 'Stornierbar bis 14:00 am Vortag',
    'умови скасування зникли з картки — гість не бачить, що саме купує');
  assert.strictEqual(byPlan.get('ga_rp_saver')!.cancellationPolicy, null,
    'тарифу без умов домальовано умови — обіцянка, якої готель не давав');
  assert.strictEqual(byPlan.get('ga_rp_flex')!.mealPlan, 'breakfast', 'сніданок зник із картки');
  // Обидві картки — про ту саму кімнату, і вільна вона одна на двох.
  assert.strictEqual(byPlan.get('ga_rp_saver')!.free, 2,
    'вільні кімнати рахуються окремо для кожного тарифу — їх дві на обидва');
  // Замок, яким справді тримається знятий тариф: ціни в нього немає ні для
  // кого, і саме тому картка не зʼявляється навіть без фільтра в джерелі.
  // Фікстура тут не вироджена: у `ga_rp_retired` ціни в календарі ЛЕЖАТЬ
  // (70 на кожну ніч), тож «немає рядків» це не пояснення.
  const retired = await runWithOrganization(A,
    () => calculateQuote('ga_t1', day(0), day(2), 2, 0, { ratePlanId: 'ga_rp_retired' }));
  assert.strictEqual(retired.missingDays, 2,
    `знятий із продажу тариф котирується (${retired.missingDays} ночей без ціни з двох) — `
    + 'ціни в нього не існує ні для кого, інакше готель продає умову, яку зняв');
  console.log('  ok  8б. дві умови продажу однієї кімнати, і суми в них різні');

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
  assert.ok(oneLeft.length > 0 && oneLeft.every((o) => o.free === 1),
    `одна кімната зайнята — мало лишитись 1 на кожній картці, а лишилось ${JSON.stringify(oneLeft.map((o) => o.free))}`);

  await occupy('ga_u2', 'ga_occ2');
  const noneLeft = await offersFor(day(0), day(2));
  assert.deepStrictEqual(pairs(noneLeft), [],
    `обидві кімнати зайняті, а тип усе одно в списку: ${JSON.stringify(pairs(noneLeft))}`);
  // І на ІНШІ дати він вільний — інакше «зник» могло б означати «зник назавжди».
  const later = await offersFor(day(2), day(3));
  assert.strictEqual(later.length, 2, 'на вільні дати тип не повернувся — прибирає не за датами');
  console.log('  ok  9. зайняте зникає зі списку, а на інші дати лишається');

  // ── 10. Бронь із воріт: тримає номер, і ціну називає СЕРВЕР ─────────────
  //
  // Тут ламається найдорожче, і мовчки. Три осі, кожна обома боками:
  //
  //   ТРИМАЄ — після броні кімната зникає з пропозицій. Бронь, яка не тримає,
  //     дає двох гостей в одному номері, і скаже це рецепція, а не код;
  //   СУМА — у рядку лежить рівно те, що порахував той самий `calculateQuote`,
  //     і вона РІЗНА за різними тарифами (200 проти 250). Однакові суми
  //     лишили б зеленим писача, який тариф прийняв і не передав;
  //   ОРЕНДАР — рядок має `organization_id`, інакше він невидимий для всіх
  //     (інваріант 12), а на SQLite це стається БЕЗЗВУЧНО: 201 у відповідь,
  //     порожній список на екрані, нічого в логах.
  const booking = await import('./api/booking.handlers.ts');
  const { holdStay, confirmStay } = await import('./data/booking.repo.ts');
  const { releaseExpiredHolds } = await import('./data/release-holds.ts');
  const { HOLD_MINUTES } = await import('./domain/hold.ts');

  let call = 0;
  const gate = async (
    fn: (r: Request) => Promise<Response>, path: string, body: unknown, ip?: string,
  ) => {
    call += 1;
    const res = await fn(new Request(`http://local/api/apps/guest/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip ?? `10.1.0.${call}` },
      body: JSON.stringify(body),
    }));
    return { status: res.status, body: await res.json() as Record<string, any> };
  };

  // Вільні дати, на яких ще нічого не стоїть: сцена 9 зайняла day(0)..day(2).
  const IN = day(2);
  const OUT = day(4);
  const guestBody = {
    key: keyA, from: IN, to: OUT, adults: 2,
    firstName: 'Anna', lastName: 'Muster', phone: '+49 170 5559876', lang: 'de',
  };

  const beforeHold = await offersFor(IN, OUT);
  assert.strictEqual(beforeHold.length, 2, 'до броні мали бути дві картки — сцена нижче міряла б не те');

  // Зʼєднання з каналом і дзеркало на тип — щоб сцена могла спитати ЧЕТВЕРТУ
  // вісь: чи канал дізнався. Без них `noteAvailabilityChanged` не пише нічого
  // за побудовою (нема кому), і твердження про чергу було б зелене завжди —
  // тобто виродженим рівно по тій осі, про яку воно (інваріант 26).
  // Провайдер береться зі ШВА КОМПОЗИЦІЇ, а не пишеться рядком: імʼя вендора
  // поза його адаптером — це протікання порту, і `check-vendor-isolation`
  // ловить його навіть у фікстурі (і зловив). Тут потрібен не конкретний
  // вендор, а «той, якого ця збірка вміє», і саме це `knownProviders()` і
  // каже.
  const { knownProviders } = await import('../../modules/channels/providers.ts');
  const provider = knownProviders()[0]?.id;
  assert.ok(provider, 'жодного провайдера каналів не заведено — сцену про чергу міряти нема на чому');

  await runWithOrganization(A, async () => {
    await sql.run(
      `INSERT INTO cm_connections (id, organization_id, property_id, provider, environment,
                                   webhook_token, webhook_secret, is_enabled, remote_property_id)
       VALUES ('ga_conn', ?, ?, ?, 'staging', 'ga_tok', 'ga_sec', TRUE, 'ga_remote')`,
      [A, PA, provider]);
    await sql.run(
      `INSERT INTO cm_mappings (id, organization_id, connection_id, entity_type, local_id, unit_type_id, occupancy, remote_id)
       VALUES ('ga_map', ?, 'ga_conn', 'unit_type', 'ga_t1', '', 0, 'ga_remote_ut')`,
      [A]);
  });
  const queued = () => runWithOrganization(A, () => sql.row<any>(
    "SELECT COUNT(*) AS n FROM cm_outbox WHERE connection_id = 'ga_conn' AND kind = 'availability'"));
  const queueBefore = Number((await queued()).n);

  const saver = await gate(booking.holdOffer, 'hold',
    { ...guestBody, unitTypeId: 'ga_t1', ratePlanId: 'ga_rp_saver' });
  assert.strictEqual(saver.status, 201, `бронь не створилась: ${saver.status} ${JSON.stringify(saver.body)}`);
  assert.strictEqual(saver.body.total, 200,
    `у відповіді сума ${saver.body.total} — невідмінний тариф це 80 + 120, тобто 200`);

  const row = await runWithOrganization(A, () => sql.row<any>(
    `SELECT organization_id, property_id, unit_id, unit_type_id, rate_plan_id, status,
            total_price, nights, hold_expires_at, source, guest_page_token
       FROM reservations WHERE guest_page_token = ?`, [saver.body.token]));
  assert.ok(row, 'броні немає в базі, хоч маршрут відповів 201');
  assert.strictEqual(row.organization_id, A,
    'у броні порожній орендар — такий рядок не бачить ЖОДЕН готель (інваріант 12)');
  assert.strictEqual(row.status, 'tentative',
    `бронь народилась зі статусом «${row.status}» — справжньою її робить підтвердження гостя (КІ23)`);
  assert.strictEqual(Number(row.total_price), 200,
    `у рядку сума ${row.total_price} — сервер мав порахувати 200 за тарифом, а не взяти число з екрана`);
  assert.strictEqual(row.rate_plan_id, 'ga_rp_saver', 'бронь не памʼятає, за яким тарифом її продали');
  assert.ok(row.unit_id, 'бронь без номера нічого не тримає — вона лягає у смугу «Без номера»');
  assert.ok(row.hold_expires_at, 'бронь без строку тримає номер НАЗАВЖДИ: звільняти її нема кому');
  assert.strictEqual(row.source, 'guest_app', 'рецепція не бачить, звідки прийшла бронь');

  // Друга бронь — ІНШИМ тарифом, і сума інша. Це та сама вісь, що в 8б, але
  // на писачі: тариф, прийнятий і не переданий, дав би тут 250.
  const flex = await gate(booking.holdOffer, 'hold',
    { ...guestBody, unitTypeId: 'ga_t1', ratePlanId: 'ga_rp_flex' });
  assert.strictEqual(flex.status, 201, `друга бронь не створилась: ${JSON.stringify(flex.body)}`);
  assert.strictEqual(flex.body.total, 250,
    `другий тариф дав ${flex.body.total} — він успадковує базові 100 і 150, тобто 250`);
  assert.notStrictEqual(saver.body.unitName, flex.body.unitName,
    'дві броні на ті самі ночі дістали ОДИН номер — перша нічого не тримала');

  // Обидві кімнати типу зайняті — тип зникає з пропозицій. Це той самий
  // читач, яким гість обирає, тож він і доводить, що бронь тримає.
  const afterHold = await offersFor(IN, OUT);
  assert.deepStrictEqual(pairs(afterHold), [],
    `після двох броней тип усе ще продається: ${JSON.stringify(pairs(afterHold))}`);

  // Четверта вісь: канал дізнався про зайняті ночі. Без неї бронь із воріт
  // видно в нас і НЕ видно в каналі — той продає ту саму кімнату далі, і
  // помилки не лунає ніде (Ц16). `check-outbox-writers` стереже, що двері
  // покликано, але не те, що з-під них щось вийшло.
  assert.ok(Number((await queued()).n) > queueBefore,
    'у черзі каналів нічого не зʼявилось — канал торгує кімнатою, яку вже продано');
  console.log('  ok  10. бронь тримає номер, памʼятає тариф і має орендаря; суму називає сервер');

  // ── 11. Третій гість на дві кімнати: названа відмова, не 500 ────────────
  //
  // Інваріант 13: перевірка, яка не знайшла вільного номера, ВІДМОВЛЯЄ. У
  // зразку, з якого знято цей екран, у цьому місці селили в зайняте — «щоб
  // бронь не загубилась».
  //
  // Замків тут ДВА, і сцена каже, який із них вона доводить. Заміна відмови
  // на «візьму перший-ліпший номер» лишає сцену ЗЕЛЕНОЮ — перевірено зломом:
  // запис відхиляє сама база (`no_double_booking` на Postgres, серіалізація з
  // перевіркою на SQLite), `insertingStay` віддає `UnitOverlap`, і гість
  // дістає ТУ САМУ відмову 409. Знявши обидва замки, сцена червоніє 500-кою —
  // тобто доведено саме те, що замок є і він говорить по-людськи, а не те,
  // що наша перевірка спрацювала раніше за нього. Перевірка перед записом
  // лишається заради повідомлення й зекономленого котирування, а не заради
  // безпеки: безпеку тримає база.
  //
  // Тому поруч стверджується сама ВЛАСТИВІСТЬ, а не шлях до неї: більше
  // однієї броні на кімнату-ніч не існує.
  const third = await gate(booking.holdOffer, 'hold',
    { ...guestBody, unitTypeId: 'ga_t1', ratePlanId: 'ga_rp_saver' });
  assert.strictEqual(third.status, 409,
    `на зайнятий тип відповіли ${third.status} — має бути названа відмова 409, а не поломка`);
  assert.ok(!String(third.body.error ?? '').toLowerCase().includes('constraint'),
    `у відповідь поїхав текст бази: ${third.body.error} (інваріант 6)`);
  const perUnit = await runWithOrganization(A, () => sql.rows<any>(
    `SELECT unit_id, COUNT(*) AS n FROM reservations
      WHERE property_id = ? AND unit_type_id = 'ga_t1' AND check_in = ? AND status != 'cancelled'
      GROUP BY unit_id`, [PA, IN]));
  assert.ok(perUnit.every((u) => Number(u.n) === 1),
    `на кімнату-ніч припало більше однієї броні: ${JSON.stringify(perUnit)} — двоє гостей в одному номері`);
  assert.strictEqual(perUnit.length, 2,
    `броней на цю ніч ${perUnit.length}, а кімнат дві — сцена міряла б не те`);

  // Чужий тип під СВОЇМ ключем — 404, а не 403: інакше відповідь підтверджує,
  // що такий тип десь існує (інваріант 5). `ga_t3` існує, але він у цього ж
  // готелю знятий з онлайн-продажу; чужого готелю тип — ще й інший орендар.
  const notSold = await gate(booking.holdOffer, 'hold',
    { ...guestBody, from: day(6), to: day(7), unitTypeId: 'ga_t3', ratePlanId: null });
  assert.strictEqual(notSold.status, 404,
    `тип, який готель не продає онлайн, відповів ${notSold.status}`);
  const foreign = await gate(booking.holdOffer, 'hold',
    { ...guestBody, key: keyB, from: day(6), to: day(7), unitTypeId: 'ga_t1', ratePlanId: null });
  assert.strictEqual(foreign.status, 404,
    `чужим ключем забронювали наш тип (${foreign.status}) — орендар береться не з ключа`);
  console.log('  ok  11. зайнято, не продається і чуже — три названі відмови, жодного 500');

  // ── 12. Строк: невідтверджена бронь звільняє номер, відтверджена — ні ────
  //
  // Обидва боки обовʼязкові. «Прострочену скасовано» зелене й на кроні, який
  // скасовує ВСЕ; «свіжу не чіпають» зелене й на кроні, який не робить нічого.
  // Разом вони означають рівно те, що написано.
  assert.strictEqual(HOLD_MINUTES, 30, 'строк змінився — перевірте текст на екрані (КІ26)');

  // Свіжу бронь відсуваємо в минуле рівно одну: друга лишається свіжою і є
  // зустрічною віссю. Без неї крон, що скасовує все підряд, був би зеленим.
  await runWithOrganization(A, () => sql.run(
    "UPDATE reservations SET hold_expires_at = ? WHERE guest_page_token = ?",
    [new Date(Date.now() - 60_000).toISOString(), saver.body.token]));

  // Черга спорожнюється ПЕРЕД звільненням, і це не прибирання, а умова
  // вимірності: `cm_outbox` ключується КООРДИНАТОЮ (зʼєднання × вид × тип ×
  // тариф × дати), тож повторна звістка про ті самі ночі оновлює наявний
  // рядок, а не додає новий. Лічильник рядків після броні на ті самі дати не
  // зрушив би НІКОЛИ — і твердження про крон було б зелене на кроні, який
  // мовчить. Перша редакція сцени саме так і помилилась.
  await runWithOrganization(A, () => sql.run("DELETE FROM cm_outbox WHERE connection_id = 'ga_conn'"));
  assert.strictEqual(Number((await queued()).n), 0, 'черга не спорожнилась — вимір нижче нічого не значить');
  const released = await releaseExpiredHolds();
  assert.strictEqual(released.released, 1,
    `крон звільнив ${released.released} броней — мав рівно одну, прострочену`);
  assert.strictEqual(released.failedOrganizations, 0, 'крон упав на якомусь готелі');

  const gone = await runWithOrganization(A, () => sql.row<any>(
    'SELECT status, hold_expires_at FROM reservations WHERE guest_page_token = ?', [saver.body.token]));
  assert.strictEqual(gone.status, 'cancelled', `прострочена бронь лишилась «${gone.status}»`);
  const stillHeld = await runWithOrganization(A, () => sql.row<any>(
    'SELECT status FROM reservations WHERE guest_page_token = ?', [flex.body.token]));
  assert.strictEqual(stillHeld.status, 'tentative',
    `крон зачепив бронь, чий строк ще не минув («${stillHeld.status}») — гість втратив номер, поки набирав прізвище`);

  // Канал теж має дізнатись, і це ДРУГА половина Ц16, не та сама. Бронь, що
  // не доїхала в канал, продає кімнату двічі; звільнення, що не доїхало,
  // тримає кімнату закритою — готель не втрачає гостя, він його не отримує, і
  // це так само тихо.
  assert.ok(Number((await queued()).n) > 0,
    'звільнена ніч не поїхала в канал — кімната лишилась закритою на продаж');

  // І кімната справді повернулась у продаж — тим самим читачем, яким гість обирає.
  const backOnSale = await offersFor(IN, OUT);
  assert.strictEqual(backOnSale.length, 2,
    `звільнена кімната не повернулась у продаж: ${JSON.stringify(pairs(backOnSale))}`);
  console.log('  ok  12. прострочена бронь звільняє номер, свіжа лишається');

  // ── 13. Підтвердження знімає строк ──────────────────────────────────────
  //
  // Доки строк стоїть, крон забере кімнату — навіть у того, хто вже
  // підтвердив. Тому підтвердження мусить зняти саме строк, а не лише
  // перевести статус.
  const ok = await gate(booking.confirmHold, 'confirm', { key: keyA, token: flex.body.token });
  assert.strictEqual(ok.body.confirmed, true, `підтвердження не пройшло: ${JSON.stringify(ok.body)}`);
  const confirmed = await runWithOrganization(A, () => sql.row<any>(
    'SELECT status, hold_expires_at FROM reservations WHERE guest_page_token = ?', [flex.body.token]));
  assert.strictEqual(confirmed.status, 'confirmed', `після підтвердження статус «${confirmed.status}»`);
  assert.strictEqual(confirmed.hold_expires_at, null,
    'строк лишився на підтвердженій броні — крон забере номер у гостя, який уже все зробив');

  // Чужим ключем чужу бронь не підтвердити, хоч токен і вгадано.
  const stranger = await gate(booking.confirmHold, 'confirm', { key: keyB, token: flex.body.token });
  assert.strictEqual(stranger.body.confirmed, false,
    'бронь готелю А підтвердилась ключем готелю Б — орендар не тримає');
  console.log('  ok  13. підтвердження знімає строк, і лише своїм ключем');

  // ── 14. Бронь без прийнятих умов не створюється ─────────────────────────
  //
  // На зразку власника останній екран несе дві галочки — умови готелю і
  // захист даних, — і кнопка без них не працює. У нас бронь проходила без
  // жодної: рядок у базі був, гість нічого не приймав, і показати наглядачеві
  // не було чого.
  //
  // Осі не вироджені (інваріант 26), і їх тут ЧОТИРИ:
  //
  //   ОБОВʼЯЗКОВІСТЬ — `terms` тримає кнопку, `marketing` ні. З одним родом
  //     «усі згоди обовʼязкові» і «обовʼязкові лише ці» були б нерозрізненні,
  //     а різниця між ними — це штраф за згоду на розсилку під примусом;
  //   ВЕРСІЯ — галочка під «v1» не є згодою на чинну «v2». Однакові версії
  //     лишили б зеленим писача, який версію не звіряє взагалі;
  //   ЗАПИС — прийняте лягає рядком у `guest_consents`, інакше «гість
  //     погодився» знає лише браузер;
  //   ГОТЕЛЬ БЕЗ ТЕКСТІВ — бронює вільно. Інакше ця правка спинила б продаж
  //     у кожного, хто ще не дійшов до екрана умов.
  //
  // Четверта вісь тримається сама собою: готель Б текстів не має, і сцена 11
  // вище вже бронювала в А до того, як тексти зʼявились. Але покластись на
  // порядок сцен не можна — твердження про це стоїть окремо, нижче.
  const { activeConsentTexts, consentState } = await import('@guests/kernel.ts');
  // Ціна на дати цієї сцени — інакше писач відмовляє за інваріантом 17, і
  // твердження «бронь без галочки не пройшла» було б зелене з чужої причини
  // (перша редакція сцени саме так і помилилась: 409 замість 400).
  // Ціни на всі дати, якими користуються сцени 14 і 17. Кожна сцена бере свій
  // відрізок, щоб не тримати одну бронь на двох — інакше «зайнято» з однієї
  // сцени відмовляло б у другій, і та червоніла б із чужої причини.
  await runWithOrganization(A, () => upsertPrices('ga_t1',
    [6, 7, 8, 9, 10, 11].map((n) => ({ date: day(n), base_price: 100 }))));
  const consentBody = (kind: string, version: string) => `${kind} ${version} — текст готелю`;
  await runWithOrganization(A, async () => {
    for (const [kind, version, active] of [
      ['terms', 'v1', false],           // стара редакція: під нею згода вже не рахується
      ['terms', 'v2', true],
      ['data_processing', 'v2', true],
      ['marketing', 'v2', true],
    ] as const) {
      await sql.run(
        `INSERT INTO consent_texts (id, organization_id, consent_kind, version, locale, body, is_active)
         VALUES (?, ?, ?, ?, 'de', ?, ?)`,
        [`ga_ct_${kind}_${version}`, A, kind, version, consentBody(kind, version), active]);
    }
  });

  const shown = await runWithOrganization(A,
    () => activeConsentTexts(A, 'de', ['terms', 'data_processing', 'marketing']));
  assert.deepStrictEqual(shown.map((t) => `${t.consentKind}:${t.version}`),
    ['terms:v2', 'data_processing:v2', 'marketing:v2'],
    `гостю показали не ті редакції: ${JSON.stringify(shown.map((t) => `${t.consentKind}:${t.version}`))} `
    + '— знята з обігу редакція не пропонується, а порядок родів той, який назвали');

  const stay = {
    key: keyA, from: day(6), to: day(7), adults: 2, unitTypeId: 'ga_t1', ratePlanId: null,
    firstName: 'Clara', lastName: 'Zustimmung', phone: '+49 170 5550001', lang: 'de',
  };
  const noTicks = await gate(booking.holdOffer, 'hold', { ...stay });
  assert.strictEqual(noTicks.status, 400,
    `бронь без жодної галочки пройшла (${noTicks.status}) — під нею ніхто нічого не прийняв`);

  // Стара редакція — це НЕ згода на чинну.
  const staleTick = await gate(booking.holdOffer, 'hold', {
    ...stay, consents: [{ kind: 'terms', version: 'v1' }, { kind: 'data_processing', version: 'v2' }] });
  assert.strictEqual(staleTick.status, 400,
    `галочка під знятою редакцією «v1» зарахована як згода на чинну «v2» (${staleTick.status})`);

  // Половина обовʼязкових — теж ні.
  const halfTick = await gate(booking.holdOffer, 'hold', {
    ...stay, consents: [{ kind: 'terms', version: 'v2' }] });
  assert.strictEqual(halfTick.status, 400,
    `бракує згоди на обробку даних, а бронь пройшла (${halfTick.status})`);

  // Обидві обовʼязкові без розсилки — проходить. Це і є вісь обовʼязковості:
  // якби кнопку тримали ВСІ роди, цей запит відмовив би.
  const booked = await gate(booking.holdOffer, 'hold', {
    ...stay, consents: [{ kind: 'terms', version: 'v2' }, { kind: 'data_processing', version: 'v2' }] });
  assert.strictEqual(booked.status, 201,
    `згода на розсилку зроблена обовʼязковою (${booked.status} ${JSON.stringify(booked.body)}) — `
    + 'галочка, без якої не забронювати, добровільною не є');

  // Журнал читається ДВЕРИМА модуля (`consentState`), а не своїм SELECT-ом:
  // `guest_consents` належить гостям, і запит до чужої таблиці — це пробій
  // межі, який `check-boundaries` правильно зупинив. Заразом сцена стверджує
  // про те, чим цю згоду читатиме решта продукту, а не про рядки під нею.
  const bookedGuest = await runWithOrganization(A, () => sql.row<any>(
    'SELECT guest_id FROM reservations WHERE guest_page_token = ?', [booked.body.token]));
  const written = await runWithOrganization(A,
    () => consentState(A, String(bookedGuest.guest_id)));
  assert.deepStrictEqual(
    Object.entries(written).map(([kind, v]: [string, any]) => `${kind}:${v.version}`).sort(),
    ['data_processing:v2', 'terms:v2'],
    `у журналі згод не те: ${JSON.stringify(written)} — прийняте гостем мусить лишити рядок`);
  assert.strictEqual(written.terms.source, 'guest_app', 'у згоди не названо, звідки вона прийшла');
  assert.strictEqual(written.terms.revokedAt, null, 'згода записалась одразу відкликаною');

  // Готель Б текстів не заводив — і бронює вільно, без жодної галочки.
  // Без цього твердження правка спинила б продаж у кожного, хто ще не дійшов
  // до екрана умов, і сцена цього б не помітила.
  await runWithOrganization(B, async () => {
    await sql.run("INSERT INTO categories (id, property_id, name, type) VALUES ('gb_cat', ?, 'Zimmer', 'room')", [PB]);
    await sql.run(
      `INSERT INTO unit_types (id, property_id, category_id, name, code, bookable_online, max_occupancy, max_adults)
       VALUES ('gb_t1', ?, 'gb_cat', 'Doppelzimmer', 'DBL', TRUE, 4, 4)`, [PB]);
    await sql.run(
      `INSERT INTO units (id, property_id, unit_type_id, category_id, name, code)
       VALUES ('gb_u1', ?, 'gb_t1', 'gb_cat', '101', '101')`, [PB]);
    await upsertPrices('gb_t1', [day(6), day(7)].map((date) => ({ date, base_price: 100 })));
  });
  const otherHouse = await gate(booking.holdOffer, 'hold', {
    ...stay, key: keyB, unitTypeId: 'gb_t1',
  });
  assert.strictEqual(otherHouse.status, 201,
    `готель без заведених текстів згод більше не може продавати (${otherHouse.status} `
    + `${JSON.stringify(otherHouse.body)}) — прийняти те, чого немає, не можна`);
  console.log('  ok  14. бронь без прийнятих умов не створюється; розсилка лишається добровільною');

  // ── 15. Готель на СВОЇЙ системі: не продаємо, а передаємо ──────────────
  //
  // Фаза `external` означає, що наявність знає чужа система, а наше дзеркало
  // відстає на дельту. Продати звідси номер — це продати кімнату, якої вже
  // може не бути, за ціною, якої готель не називав. Обидві помилки мовчазні.
  //
  // Осі, і всі три обома боками:
  //
  //   ПРОДАЖ — той самий обʼєкт із тими самими кімнатами й цінами віддає
  //     пропозиції у фазі `alisio` і НЕ віддає у фазі `external`. Один стан
  //     нічого не доводив би: порожній список буває й від відсутності цін;
  //   ЗАПИС — `hold` у фазі `external` відмовляє названо, а не пише порожню
  //     бронь;
  //   ПЕРЕДАЧА — замість списку їде адреса сторінки готелю, і саме та, яку
  //     готель вписав.
  const HOTEL_PAGE = 'https://buchung.example.invalid/onlinebuchung/';
  const external = async (on: boolean) => runWithOrganization(A, () => sql.run(
    'UPDATE properties SET system_of_record = ?, kiosk_walkin_url = ? WHERE id = ? AND organization_id = ?',
    [on ? 'external' : 'alisio', on ? HOTEL_PAGE : null, PA, A]));

  const offersCall = (body: Record<string, unknown>) =>
    gate(booking.listOffers, 'offers', { key: keyA, from: day(6), to: day(7), adults: 2, ...body });

  const selling = await offersCall({});
  assert.ok((selling.body.offers as unknown[]).length > 0,
    'у фазі `alisio` обʼєкт нічого не продає — сцена нижче міряла б не те');
  assert.strictEqual(selling.body.handoff, null, 'наш готель віддає чужу адресу для бронювання');

  await external(true);
  const handedOff = await offersCall({});
  assert.deepStrictEqual(handedOff.body.offers, [],
    `готель на чужій системі продає з нашого списку: ${JSON.stringify(handedOff.body.offers)} — `
    + 'ці кімнати могли бути продані там пʼять хвилин тому');
  assert.strictEqual(handedOff.body.handoff, HOTEL_PAGE,
    `адреса сторінки готелю не доїхала: ${handedOff.body.handoff}`);

  const cannotHold = await gate(booking.holdOffer, 'hold', {
    key: keyA, from: day(6), to: day(7), adults: 2, unitTypeId: 'ga_t1', ratePlanId: null,
    firstName: 'Hans', lastName: 'Extern', phone: '+49 170 5550002', lang: 'de',
    consents: [{ kind: 'terms', version: 'v2' }, { kind: 'data_processing', version: 'v2' }],
  });
  assert.strictEqual(cannotHold.status, 409,
    `бронь у готелю на чужій системі пройшла (${cannotHold.status}) — вона розійшлася б із його базою`);
  console.log('  ok  15. готель на чужій системі не продає з нашого списку, а передає на свою сторінку');

  // ── 16. «Я щойно забронював»: одна бронь, свій дім, той самий ключ ──────
  //
  // Гість забронював у готелю і повернувся сказати про це. Заводиться
  // попередня бронь із ключем походження — за ним її потім знайде звірка.
  //
  //   ПОВТОР — та сама заявка двічі дає ТУ САМУ бронь, не другу. Це тримає
  //     UNIQUE на `external_ref`, і сцена стверджує саме наслідок;
  //   ДІМ — той самий номер підтвердження в сусідньому готелі це інша бронь,
  //     і чужу нам не віддають (інваріант 5);
  //   КЛЮЧ — рівно той вигляд, що пише кіоск. Два різні вигляди означали б,
  //     що звірка мусить знати про обидва, а забути про другий — найлегший
  //     спосіб дістати дубль.
  const { walkinRef } = await import('../kiosk/api/walkin.handlers.ts');
  const { claimRef } = await import('./domain/claim.ts');
  assert.strictEqual(claimRef('55123'), walkinRef('55123'),
    'ворота і кіоск пишуть РІЗНІ ключі походження — звірка знайде лише один, і в базі буде дубль');

  const claimBody = {
    key: keyA, confirmation: 'OB-771', lastName: 'Ankunft', firstName: 'Ingo',
    checkIn: today, adults: 2,
  };
  const first = await gate(booking.claimBooking, 'claim', claimBody);
  assert.strictEqual(first.status, 201, `заявку не прийнято: ${JSON.stringify(first.body)}`);

  const claimed = await runWithOrganization(A, () => sql.row<any>(
    `SELECT organization_id, property_id, unit_id, status, source, external_ref, total_price
       FROM reservations WHERE guest_page_token = ?`, [first.body.token]));
  assert.strictEqual(claimed.organization_id, A, 'у заявки порожній орендар (інваріант 12)');
  assert.strictEqual(claimed.status, 'tentative', `заявка створила бронь зі статусом «${claimed.status}»`);
  assert.strictEqual(claimed.external_ref, 'winhotel-ob:OB-771',
    `ключ походження не той: ${claimed.external_ref} — звірка шукає саме за ним`);
  assert.strictEqual(claimed.unit_id, null,
    'заявка призначила номер — яку кімнату продав готель, знає ГОТЕЛЬ, і ця могла піти іншому');
  assert.strictEqual(Number(claimed.total_price), 0,
    'заявка назвала свою суму — гість щойно бачив іншу в готелю (інваріант 17)');

  const again = await gate(booking.claimBooking, 'claim', claimBody);
  assert.strictEqual(again.status, 200, `повтор заявки дав ${again.status}, а мав віддати ту саму бронь`);
  assert.strictEqual(again.body.token, first.body.token,
    'повтор заявки видав ДРУГУ бронь — на одне перебування їх стало дві');
  assert.strictEqual(again.body.created, false, 'повтор не позначено повтором');

  const howMany = await runWithOrganization(A, () => sql.row<any>(
    "SELECT COUNT(*) AS n FROM reservations WHERE organization_id = ? AND external_ref = 'winhotel-ob:OB-771'", [A]));
  assert.strictEqual(Number(howMany.n), 1,
    `на один номер підтвердження ${howMany.n} броней — дельта звірятиметься з двома`);
  console.log('  ok  16. заявка «щойно забронював»: одна бронь, без номера, без ціни, ключ як у кіоска');

  // Повертаємо обʼєкт у нашу фазу — інакше наступні сцени (їх поки немає, але
  // будуть) міряли б готель, який не продає.
  await external(false);

  // ── 17. Послуги: продається лише НАЗВАНЕ, і ціну бере довідник ──────────
  //
  // Довідник послуг обʼєкта це повний список НАРАХУВАНЬ, а не вітрина. У
  // живого готелю там поруч зі сніданком лежать «втрачений ключ», «штраф за
  // скасування» і «знижка 10 %» — усі активні, бо рецепція ними нараховує.
  // Показати цей список гостю означало б запропонувати купити штраф за
  // власний неприїзд.
  //
  // Осі, і кожна обома боками:
  //
  //   НАЗВАНІСТЬ — активна послуга БЕЗ `bookable_online` не показується.
  //     Фікстура не вироджена: у готелю є і продажна, і непродажна, і обидві
  //     активні. З однією «усі активні продаються» було б зелене;
  //   ЦІНА — сума рахується з довідника, а не з тіла запиту. Кількість 2 при
  //     ціні 15 дає 30 — число, несумісне ні з ціною, ні з кількістю;
  //   ОКРЕМІСТЬ — сума послуг НЕ входить у `reservations.total_price`:
  //     послуги йдуть рядками замовлень і потрапляють у рахунок власним
  //     шляхом, тож долити їх у суму броні означало б порахувати двічі;
  //   ЧУЖЕ — послуга сусіднього готелю не купується навіть своїм ключем.
  await runWithOrganization(A, async () => {
    for (const [id, name, price, online] of [
      ['ga_svc_bf', 'Frühstück', 15, true],
      ['ga_svc_park', 'Tiefgarage', 10, true],
      // Активна, але НЕ продажна: рівно той рядок, який гість не має бачити.
      ['ga_svc_fine', 'Schlüsselverlust', 30, false],
    ] as const) {
      await sql.run(
        `INSERT INTO additional_services (id, property_id, name, price, currency, category, is_active, bookable_online)
         VALUES (?, ?, ?, ?, 'EUR', 'other', TRUE, ?)`,
        [id, PA, name, price, online]);
    }
  });
  // І послуга ЧУЖОГО готелю — з тим самим виглядом, теж продажна.
  await runWithOrganization(B, () => sql.run(
    `INSERT INTO additional_services (id, property_id, name, price, currency, category, is_active, bookable_online)
     VALUES ('gb_svc', ?, 'Frühstück', 15, 'EUR', 'other', TRUE, TRUE)`, [PB]));

  const shownSvc = await gate(booking.listOffers, 'offers',
    { key: keyA, from: day(6), to: day(7), adults: 2 });
  assert.deepStrictEqual(
    (shownSvc.body.services as any[]).map((x) => x.name).sort(),
    ['Frühstück', 'Tiefgarage'],
    `гостю показали не ті послуги: ${JSON.stringify((shownSvc.body.services as any[]).map((x) => x.name))} — `
    + 'активне нарахування без ознаки продажу це не товар');

  const withExtras = await gate(booking.holdOffer, 'hold', {
    key: keyA, from: day(8), to: day(9), adults: 2, unitTypeId: 'ga_t1', ratePlanId: null,
    firstName: 'Erna', lastName: 'Extra', phone: '+49 170 5550003', lang: 'de',
    consents: [{ kind: 'terms', version: 'v2' }, { kind: 'data_processing', version: 'v2' }],
    services: [{ serviceId: 'ga_svc_bf', quantity: 2 }],
  });
  assert.strictEqual(withExtras.status, 201, `бронь із послугою не створилась: ${JSON.stringify(withExtras.body)}`);
  assert.strictEqual(withExtras.body.servicesTotal, 30,
    `сума послуг ${withExtras.body.servicesTotal} — два сніданки по 15 це 30, і рахує їх ДОВІДНИК`);

  const stayRow = await runWithOrganization(A, () => sql.row<any>(
    'SELECT id, total_price FROM reservations WHERE guest_page_token = ?', [withExtras.body.token]));
  assert.strictEqual(Number(stayRow.total_price), 100,
    `у броні сума ${stayRow.total_price} — послуги долиті в суму проживання, тобто в рахунку вони будуть двічі`);
  const orders = await runWithOrganization(A, () => sql.rows<any>(
    'SELECT service_id, quantity, total_price, status, payment_status FROM service_orders WHERE reservation_id = ?',
    [stayRow.id]));
  assert.strictEqual(orders.length, 1, `рядків замовлення ${orders.length}, а мав бути один`);
  assert.strictEqual(Number(orders[0].total_price), 30, 'у замовленні не та сума');
  assert.strictEqual(orders[0].payment_status, 'none', 'замовлення позначено оплаченим — платять на рецепції (КІ1)');

  // Непродажну купити не можна — навіть назвавши її id прямо.
  const buysFine = await gate(booking.holdOffer, 'hold', {
    key: keyA, from: day(10), to: day(11), adults: 2, unitTypeId: 'ga_t1', ratePlanId: null,
    firstName: 'Erna', lastName: 'Extra', phone: '+49 170 5550004', lang: 'de',
    consents: [{ kind: 'terms', version: 'v2' }, { kind: 'data_processing', version: 'v2' }],
    services: [{ serviceId: 'ga_svc_fine', quantity: 1 }],
  });
  assert.strictEqual(buysFine.status, 409,
    `гість купив послугу, яку готель не продає онлайн (${buysFine.status})`);

  // І послугу сусіднього готелю — теж ні.
  const buysNeighbour = await gate(booking.holdOffer, 'hold', {
    key: keyA, from: day(10), to: day(11), adults: 2, unitTypeId: 'ga_t1', ratePlanId: null,
    firstName: 'Erna', lastName: 'Extra', phone: '+49 170 5550005', lang: 'de',
    consents: [{ kind: 'terms', version: 'v2' }, { kind: 'data_processing', version: 'v2' }],
    services: [{ serviceId: 'gb_svc', quantity: 1 }],
  });
  assert.strictEqual(buysNeighbour.status, 409,
    `гість купив послугу СУСІДНЬОГО готелю (${buysNeighbour.status}) — довідник читається без осі обʼєкта`);
  console.log('  ok  17. продається лише назване; ціну бере довідник; послуги окремо від суми проживання');

  // ── 18. Вимикач застосунку: вимкнено — 404 всюди, і ключ не рятує ──────
  //
  // Прапорець без варти це перемикач-обманка (П5), а за цим стоїть ПУБЛІЧНА
  // поверхня: з неї видно назву готелю, його вільні номери й ціни. Готель,
  // який застосунку не купував, не має віддавати цього нікому — навіть якщо
  // ключ у обʼєкта колись виписали.
  //
  // Осі обома боками: увімкнено — відчиняється (це доводять усі сцени вище),
  // вимкнено — 404, і саме 404, а не порожній список: «сторінки немає» і
  // «номерів немає» це різні відповіді.
  //
  // Вимикається ГОТЕЛЬ А, у якого ключ давно виписаний і працює: вимкнути
  // той, що й так нічого не віддає, не довело б нічого.
  // ВСЕРЕДИНІ `runWithOrganization`, і це не косметика: `organization_features`
  // під політикою, тож `UPDATE` без орендаря на Postgres не чіпає ЖОДНОГО
  // рядка — мовчки, без помилки. Вимикач не вимикався б, а сцена червоніла б
  // «застосунок усе одно віддає обʼєкт», показуючи пальцем на код варти
  // замість власного засіву. На SQLite політик немає, і перша редакція була
  // там зелена — рід INC-014, тільки цього разу у фікстурі.
  const feature = (on: boolean) => runWithOrganization(A, () => sql.run(
    'UPDATE organization_features SET enabled = ? WHERE organization_id = ? AND feature = ?',
    [on, A, 'guest_app']));

  await feature(false);
  const closedHome = await propertyByAppKey(keyA);
  assert.strictEqual(closedHome, undefined,
    'вимкнений застосунок усе одно віддає обʼєкт — сторінка відчиниться, і гість побачить чужі номери');
  const closedFind = await find({ key: keyA, phone: '+49 170 5551234', name: 'Beispiel' }, '198.51.100.9');
  assert.strictEqual(closedFind.status, 404,
    `пошук на вимкненому застосунку відповів ${closedFind.status}, а мав 404`);
  const closedOffers = await gate(booking.listOffers, 'offers',
    { key: keyA, from: day(6), to: day(7), adults: 2 });
  assert.strictEqual(closedOffers.status, 404,
    `пропозиції на вимкненому застосунку відповіли ${closedOffers.status} — «немає сторінки» це не «немає номерів»`);

  await feature(true);
  const openedAgain = await propertyByAppKey(keyA);
  assert.ok(openedAgain, 'увімкнений назад застосунок не відчинився — вимикач працює лише в один бік');
  console.log('  ok  18. вимкнений застосунок — 404 всюди, і виписаний ключ його не відчиняє');

  console.log('guest-app: ключ називає один будинок — свій, і сторінка говорить мовою телефона');
} finally {
  for (const org of [A, B]) {
    await runWithOrganization(org, async () => {
      // ТИПИ НОМЕРІВ — першими, і це не косметика прибирання.
      //
      // У `price_calendar` два зовнішні ключі й різна поведінка: на тип —
      // каскадний, на тариф — ні. Знесення обʼєкта каскадом бере і типи, і
      // тарифи, і рядки календаря з тарифом встигають потримати його рівно
      // стільки, щоб уся транзакція відкотилась. Знімаємо типи — каскад
      // прибирає календар цілком, і обʼєкт зноситься вже без перешкод.
      //
      // Прямого `DELETE FROM price_calendar` тут немає навмисно: цінову
      // таблицю поза `modules/pricing` не чіпають (інваріант 16), і
      // `check-price-source` правильно завалив першу редакцію цього
      // прибирання.
      //
      // Це прибирання, а не виправлення: сам дефект живий і записаний як
      // INC-208 — кнопка «видалити обʼєкт» не працює в готелю, який ставив
      // ціну на тариф. Сцена обходить його, бо лагодити чужу схему посеред
      // задачі про ворота — це два рішення в одному коміті.
      // Порядок: броні → типи → обʼєкти. Кожен крок знімає те, що тримає
      // наступний, і жоден не спирається на каскад, якого може не бути.
      // Броні посилаються на тип номера БЕЗ каскаду, тож «типи першими» падало
      // на них; типи каскадом прибирають календар; обʼєкти — решту.
      await sql.run('DELETE FROM reservations WHERE organization_id = ?', [org]);
      await sql.run(
        `DELETE FROM unit_types WHERE property_id IN
           (SELECT id FROM properties WHERE organization_id = ?)`, [org]);
      await sql.run('DELETE FROM properties WHERE organization_id = ?', [org]);
    });
    await sql.run('DELETE FROM organizations WHERE id = ?', [org]);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}
