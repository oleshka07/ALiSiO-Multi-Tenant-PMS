/**
 * Список гостей: фільтри звужують разом, а експорт віддає рівно те, що на
 * екрані (Блок 4 §2.5).
 *
 *   node src/modules/guests/data/guests-export.repo.check.ts
 *
 * Написано ДО коду і зламано навмисно: з `>` замість `>=` на межі дня гість,
 * що виїжджає СЬОГОДНІ, зникав із «має майбутні броні» — рецепція шукала
 * людину, яка стоїть перед нею.
 *
 * Осі (інваріант 26), кожна з двома значеннями:
 *   контакти — пошта / телефон / нічого;
 *   бронь    — виїхав учора / виїжджає сьогодні / скасована;
 *   платник  — компанія / фізособа;
 *   формат   — простий / розширений (різна кількість колонок).
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';

const { runWithOrganization } = await import('@core/auth/tenant-context');
const { getSql } = await import('@core/db/async');
const { todayFor } = await import('@core/hotel-day');
const { listGuests } = await import('./guests.repo.ts');
const { exportGuestsCsv, csvCell, csvDocument } = await import('./guests-export.repo.ts');
const { createCompanyForTests } = await import('@companies/kernel');

const sql = getSql();
const ORG = '__coexp__org';
const PROP = '__coexp__prop';

async function cleanup() {
  // Компанії йдуть каскадом за організацією (FK ON DELETE CASCADE): свого
  // SQL до чужого довідника тут немає (`check-boundaries`).
  await sql.run("DELETE FROM reservations WHERE id LIKE '__coexp__%'", []);
  await sql.run('DELETE FROM guests WHERE organization_id = ?', [ORG]);
  await sql.run('DELETE FROM properties WHERE organization_id = ?', [ORG]);
  await sql.run('DELETE FROM organizations WHERE id = ?', [ORG]);
}

await cleanup();
await sql.run("INSERT INTO organizations (id, name, slug, default_currency) VALUES (?, ?, ?, 'CZK')", [ORG, 'Exp', 'coexp']);

try {
  // ── CSV: поле, яке ламає рядок ─────────────────────────────────────────
  assert.strictEqual(csvCell('Novák, Jan'), '"Novák, Jan"', 'кома ховається в лапки');
  assert.strictEqual(csvCell('Він сказав "так"'), '"Він сказав ""так"""', 'лапки подвоюються');
  assert.strictEqual(csvCell('вул. Довга 1\nПрага'), '"вул. Довга 1\nПрага"', 'перенос рядка ховається');
  assert.strictEqual(csvCell(null), '');
  assert.strictEqual(csvCell(0), '0', 'нуль — це значення, не порожнеча');
  const doc = csvDocument(['A', 'B'], [['Novák, Jan', 1]]);
  assert.ok(doc.startsWith('﻿'), 'BOM попереду — інакше Excel читає UTF-8 як cp1251');
  assert.strictEqual(doc.split('\r\n')[1], '"Novák, Jan",1');
  console.log('  ok  CSV: кома, лапки й перенос не ламають рядок; BOM і CRLF на місці');

  await runWithOrganization(ORG, async () => {
    await sql.run("INSERT INTO properties (id, organization_id, name, slug, country) VALUES (?, ?, 'House', 'coexp', 'CZ')", [PROP, ORG]);
    const today = await todayFor(ORG);
    const shift = (days: number) => {
      const [y, m, d] = today.split('-').map(Number);
      return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
    };

    const guest = (id: string, last: string, email: string | null, phone: string | null) => sql.run(
      "INSERT INTO guests (id, organization_id, first_name, last_name, email, phone, country) VALUES (?, ?, 'Jan', ?, ?, ?, 'CZ')",
      [id, ORG, last, email, phone]);
    await guest('__coexp__g_mail', 'Mailová', 'mail@example.test', null);
    await guest('__coexp__g_phone', 'Telefonová', null, '+420777');
    await guest('__coexp__g_none', 'Безконтактна', null, null);
    await guest('__coexp__g_past', 'Минула', null, null);
    await guest('__coexp__g_today', 'Сьогоднішня', null, null);
    await guest('__coexp__g_cancelled', 'Скасована', null, null);
    await guest('__coexp__g_company', 'Фірмова, з комою', null, null);

    const company = await createCompanyForTests(ORG, { name: 'Kempi s.r.o.', business_id: '12345678' });
    const stay = (id: string, guestId: string, ci: string, co: string, status = 'confirmed', companyId: string | null = null) => sql.run(
      `INSERT INTO reservations (id, organization_id, property_id, guest_id, company_id, check_in, check_out, nights, adults, status, payment_status, total_price, currency)
       VALUES (?, ?, ?, ?, ?, ?, ?, 2, 2, ?, 'unpaid', 2000, 'CZK')`,
      [id, ORG, PROP, guestId, companyId, ci, co, status]);
    await stay('__coexp__r_past', '__coexp__g_past', shift(-5), shift(-1));           // виїхав учора
    await stay('__coexp__r_today', '__coexp__g_today', shift(-2), today);             // виїжджає сьогодні
    await stay('__coexp__r_cancelled', '__coexp__g_cancelled', shift(1), shift(3), 'cancelled');
    await stay('__coexp__r_company', '__coexp__g_company', shift(-9), shift(-7), 'checked_out', company);

    const names = async (f: Parameters<typeof listGuests>[1]) =>
      (await listGuests(ORG, f, 1, 100)).data.map((g: any) => String(g.last_name)).sort();

    assert.deepStrictEqual(await names({ hasContacts: true }), ['Mailová', 'Telefonová'],
      'є контакти — пошта АБО телефон, не тільки пошта');
    console.log('  ok  «є контакти»: пошта або телефон; без обох — не в списку');

    assert.deepStrictEqual(await names({ hasUpcoming: true }), ['Сьогоднішня'],
      'виїзд СЬОГОДНІ — ще в домі; виїхав учора — ні; скасована броні не дає');
    console.log('  ok  «має майбутні броні»: день виїзду включно (день готелю), скасована не рахується');

    assert.deepStrictEqual(await names({ hasCompany: true }), ['Фірмова, з комою']);
    console.log('  ok  «має компанію»: платник-юрособа хоч однієї броні');

    // Два фільтри разом звужують, а не заміняють один одного.
    assert.deepStrictEqual(await names({ hasContacts: true, hasUpcoming: true }), [],
      'разом — обидві умови; у «Сьогоднішньої» немає контактів');
    assert.deepStrictEqual(await names({}), [
      'Mailová', 'Telefonová', 'Безконтактна', 'Минула', 'Скасована', 'Сьогоднішня', 'Фірмова, з комою',
    ].sort(), 'без фільтрів — усі семеро');
    console.log('  ok  фільтри звужують разом; без фільтрів — увесь список');

    // ── експорт віддає ТОЙ САМИЙ список ────────────────────────────────────
    const simple = await exportGuestsCsv(ORG, { hasCompany: true }, 'simple');
    const simpleLines = simple.trimEnd().split('\r\n');
    assert.strictEqual(simpleLines.length, 2, 'заголовок і один гість — фільтр діє й в експорті');
    assert.strictEqual(simpleLines[0].split(',').length, 6, 'простий набір — шість колонок');
    assert.ok(simpleLines[1].includes('"Фірмова, з комою"'), 'прізвище з комою не розʼїхалось по колонках');
    assert.ok(!simple.includes('12345678'), 'у простому наборі компанії немає');

    const extended = await exportGuestsCsv(ORG, { hasCompany: true }, 'extended');
    const extLines = extended.trimEnd().split('\r\n');
    assert.strictEqual(extLines[0].split(',').length, 17, 'розширений набір — сімнадцять колонок');
    assert.ok(extended.includes('Kempi s.r.o.'), 'розширений називає компанію-платника');
    assert.ok(extLines[1].includes('"Фірмова, з комою"'));
    console.log('  ok  експорт: ті самі фільтри, простий — 6 колонок, розширений — 17 і компанія');
  });
} finally {
  await cleanup();
}

console.log('guests-export: фільтри звужують разом, експорт віддає той самий список, кома в імені не ламає CSV');
