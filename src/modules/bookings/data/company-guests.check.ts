/**
 * Хто саме стоїть за лічильником «гостей» у картці компанії.
 *
 *   node src/modules/bookings/data/company-guests.check.ts
 *
 * ── Осі, по яких фікстура не вироджена (інваріант 26) ───────────────────
 *
 * 1. ДВІ компанії в одного готелю, і в кожної свої гості. З однією
 *    твердження «віддає гостей цієї фірми» зелене і на читачі, який
 *    `company_id` не фільтрує зовсім.
 * 2. ДВА готелі: гість сусіда з ТИМ САМИМ `company_id` не має потрапити.
 *    Без другого готелю вісь орендаря порожня.
 * 3. Гість, який їздив і за рахунок фірми, і СВОЇМ коштом: у списку фірми
 *    він має бути один раз і з лічильником 1, а не 2 — інакше «скільки
 *    разів фірма платила» неправда.
 * 4. Скасована бронь: не рахується. Інакше фірма бачить людей, за яких
 *    не платила.
 *
 * Числа різні навмисно (2 проти 1 проти 1): однакові сумісні з будь-яким
 * прочитанням.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-company-guests-'));
process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { runWithOrganization } = await import('@core/auth/tenant-context.ts');
const { companyGuests, companyStays } = await import('./company-stays.repo.ts');

const sql = getSql();
const ORG = '__cg__org';
const NEIGHBOUR = '__cg__neighbour';


/**
 * Прибирання ПЕРЕД засівом — бо на Postgres база СПІЛЬНА на весь `check:pg`.
 *
 * На SQLite кожен гейт має свою теку (`ALISIO_DATA_DIR`), тож сталі
 * ідентифікатори фікстури нічому не заважають. На Postgres другий прогін
 * падає на `organizations_pkey`, і падає шумно — але гірше те, що після
 * ПЕРШОГО червоного прогону наступний вже не дійде до тверджень і буде
 * виглядати «зламаним гейтом», а не «неприбраним стендом».
 *
 * Броні знімаються В КОНТЕКСТІ ОРЕНДАРЯ (INC-014): `reservations` під
 * політикою, і без контексту `DELETE` прибирає НУЛЬ рядків — мовчки, бо
 * «нічого не видалено» не помилка, — і наступний `DELETE FROM organizations`
 * падає не там, де причина.
 */
const cleanup = async () => {
  for (const org of [ORG, NEIGHBOUR]) {
    await runWithOrganization(org, async () => {
      await sql.run("DELETE FROM reservations WHERE id LIKE '__cg__%'", []);
      await sql.run("DELETE FROM guests WHERE id LIKE '__cg__%'", []);
      await sql.run("DELETE FROM companies WHERE id LIKE '__cg__%'", []);
      await sql.run("DELETE FROM properties WHERE id LIKE '__cg__%'", []);
    });
    await sql.run('DELETE FROM organizations WHERE id = ?', [org]);
  }
};
await cleanup();

const seedOrg = async (org: string, prop: string) => {
  await sql.run('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)', [org, org, org]);
  await runWithOrganization(org, async () => {
    await sql.run('INSERT INTO properties (id, organization_id, name, slug) VALUES (?, ?, ?, ?)',
      [prop, org, 'Дім', prop]);
  });
};
await seedOrg(ORG, '__cg__prop');
await seedOrg(NEIGHBOUR, '__cg__prop_n');

const stay = (id: string, org: string, prop: string, guest: string, company: string | null,
  checkIn: string, status = 'confirmed') =>
  runWithOrganization(org, () => sql.run(
    `INSERT INTO reservations (id, organization_id, property_id, guest_id, check_in, check_out,
                               nights, adults, status, currency)
     VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, 'EUR')`,
    [id, org, prop, guest, checkIn, checkIn, status])
    .then(() => sql.run('UPDATE reservations SET company_id = ? WHERE id = ?', [company, id])));

await runWithOrganization(ORG, async () => {
  for (const [id, first, last] of [
    ['__cg__g1', 'Анна', 'Перша'], ['__cg__g2', 'Богдан', 'Другий'], ['__cg__g3', 'Віра', 'Третя'],
  ]) {
    await sql.run('INSERT INTO guests (id, organization_id, first_name, last_name) VALUES (?, ?, ?, ?)',
      [id, ORG, first, last]);
  }
  for (const [id, name] of [['__cg__c1', 'Фірма А'], ['__cg__c2', 'Фірма Б']]) {
    await sql.run('INSERT INTO companies (id, organization_id, name) VALUES (?, ?, ?)', [id, ORG, name]);
  }
});
await runWithOrganization(NEIGHBOUR, async () => {
  await sql.run('INSERT INTO guests (id, organization_id, first_name, last_name) VALUES (?, ?, ?, ?)',
    ['__cg__gn', NEIGHBOUR, 'Сусід', 'Сусідов']);
});

// Фірма А платить за двох; Б — за одного. Віра їздила і сама (без фірми).
await stay('__cg__r1', ORG, '__cg__prop', '__cg__g1', '__cg__c1', '2027-01-10');
await stay('__cg__r2', ORG, '__cg__prop', '__cg__g2', '__cg__c1', '2027-02-10');
await stay('__cg__r3', ORG, '__cg__prop', '__cg__g3', '__cg__c2', '2027-03-10');
await stay('__cg__r4', ORG, '__cg__prop', '__cg__g3', null,       '2027-04-10');
// Скасована бронь фірми А — не рахується.
await stay('__cg__r5', ORG, '__cg__prop', '__cg__g3', '__cg__c1', '2027-05-10', 'cancelled');
// Сусід із ТИМ САМИМ ідентифікатором фірми.
await stay('__cg__rn', NEIGHBOUR, '__cg__prop_n', '__cg__gn', '__cg__c1', '2027-01-10');

// ── Зіпсований рядок: НАША бронь вказує на гостя СУСІДА ─────────────────
//
// Такого не має бути — але саме проти цього стоїть друга умова орендаря (на
// `guests`), і без такого рядка вона НЕ ПЕРЕВІРЯЄТЬСЯ: фільтр по будинку вже
// відсікає сусідову бронь, тож злом другої умови лишався зеленим. Це та сама
// перевірка «чи ловить гейт клас», яку вимагає AGENTS §3.2.1: зелений на
// другій формі тієї самої помилки — вирок гейту, а не коду.
//
// На Postgres зовнішній ключ і політика такого не пустять; на SQLite, під
// яким біжить цей гейт, не спиняє ніщо — і саме тому умова в SQL, а не
// «політика розбереться».
await stay('__cg__rbad', ORG, '__cg__prop', '__cg__gn', '__cg__c1', '2027-06-10');

const fails: string[] = [];
const say = (cond: boolean, what: string) => {
  if (cond) console.log(`  ok  ${what}`);
  else { fails.push(what); console.log(`  ЧЕРВОНЕ  ${what}`); }
};

await runWithOrganization(ORG, async () => {
  const a = await companyGuests(ORG, '__cg__c1');
  say(a.length === 2, `фірма А — двоє гостей, отримали ${a.length}`);
  say(a.every((g) => g.id !== '__cg__gn'),
    'гостя СУСІДА немає у списку — ні через його бронь, ні через зіпсований рядок у нашій');
  say(!a.some((g) => g.id === '__cg__g3'), 'скасована бронь не робить людину гостем фірми');

  const b = await companyGuests(ORG, '__cg__c2');
  say(b.length === 1 && b[0].id === '__cg__g3', `фірма Б — один гість, отримали ${b.length}`);
  say(Number(b[0].stays) === 1,
    `лічильник рахує лише оплати ФІРМИ: очікували 1, отримали ${b[0].stays} (Віра їздила двічі, друга — своїм коштом)`);

  // Порядок — за останнім заїздом: Богдан (02) перед Анною (01).
  say(a[0].id === '__cg__g2', `першим іде хто заїжджав пізніше (${a[0].id})`);

  // Число і список мусять сходитись — інакше картка суперечить сама собі.
  const stats = await companyStays(ORG);
  say(Number(stats.get('__cg__c1')?.guests) === a.length,
    `лічильник і список сходяться: ${stats.get('__cg__c1')?.guests} проти ${a.length}`);

});

// Та сама фірма З БОКУ СУСІДА — його гість, і лише він.
//
// ОКРЕМИМ `runWithOrganization`, а не всередині блоку НАШОГО готелю, і
// це не косметика. Перша редакція кликала `companyGuests(NEIGHBOUR, …)`
// прямо в контексті ORG — на SQLite це зелене (політик немає, умови в SQL
// вистачає), а на справжньому Postgres — нуль рядків: RLS ріже ще й за
// змінною ЗʼЄДНАННЯ, і перетин двох орендарів порожній. Тобто виклик
// «аргумент один орендар, зʼєднання інший» взагалі не буває в живому коді
// (інваріант 11: орендар належить зʼєднанню), і твердження про нього було б
// твердженням про те, чого не буває. Знайшлось саме на Postgres, і це рівно
// той різновид розбіжності, про який AGENTS §7.
await runWithOrganization(NEIGHBOUR, async () => {
  const alien = await companyGuests(NEIGHBOUR, '__cg__c1');
  say(alien.length === 1 && alien[0].id === '__cg__gn',
    `сусід бачить СВОГО гостя тієї ж фірми і лише його (${alien.length})`);
});

fs.rmSync(tmp, { recursive: true, force: true });
if (fails.length) { console.error(`\ncompany-guests: ${fails.length} червоних`); process.exit(1); }
console.log('company-guests: список гостей фірми — по фірмі, по орендарю, без скасованих; число сходиться зі списком');
