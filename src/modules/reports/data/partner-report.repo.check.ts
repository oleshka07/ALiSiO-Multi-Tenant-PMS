/**
 * Звіт партнера — це пара «період × обʼєкт», а не період (INC-033).
 *
 *   node src/modules/reports/data/partner-report.repo.check.ts
 *
 * `publishReport` шукав «уже опублікований за цей період» БЕЗ обʼєкта, а
 * знайдений рядок переписував разом із належністю:
 *
 *   SELECT … WHERE organization_id = ? AND period = ? AND revoked_at IS NULL
 *   UPDATE … SET title = ?, html = ?, slug = ?, property_id = ? WHERE id = ?
 *
 * `id` той самий, **`token` той самий**, `property_id` новий. Тобто готель із
 * двома обʼєктами, публікуючи вересневий звіт обʼєкта Б, переписував вересневий
 * звіт обʼєкта А В ТОМУ Ж РЯДКУ — і посилання, яке партнер А вже має в пошті,
 * починало показувати числа Б.
 *
 * Чому це не той самий клас, що решта INC-029. Там — читання, де відсутність
 * обʼєкта тихо означає «всі обʼєкти», і наслідок «оператор бачить зайве». Тут —
 * ЗАПИС, і наслідок «стороння людина бачить чуже»: сторінку `/report/[token]`
 * відкриває партнер, а не оператор. Тому окремий номер і окремий гейт.
 *
 * Осі (інваріант 26). Два обʼєкти в ОДНІЙ організації — без другого «чужий»
 * ні від чого не відрізняється, а орендар тут ні до чого: RLS працює, і саме
 * тому вада прожила. Числа в звітах різні і несумісні (1000 проти 2000): з
 * однаковими «токен А відкрив числа А» було б істинним і на зламаному коді.
 * Період один і той самий навмисно — він і є тим, за чим ішов пошук.
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';

const { getSql } = await import('@core/db/async');
const { runWithOrganization } = await import('@core/auth/tenant-context');
const { provisionOrganization } = await import('@core/provisioning');
const repo = await import('./partner-report.repo');

const sql = getSql();
const SLUG = 'partnerrep-check';
const PERIOD = '2026-09';
const fails: string[] = [];
const say = (cond: boolean, what: string) => {
  if (cond) console.log(`  ok  ${what}`);
  else { fails.push(what); console.log(`  ЧЕРВОНЕ  ${what}`); }
};

async function cleanup() {
  const org = await sql.row<{ id: string }>('SELECT id FROM organizations WHERE slug = ?', [SLUG]);
  if (!org) return;
  await runWithOrganization(org.id, async () => {
    await sql.run('DELETE FROM partner_reports WHERE organization_id = ?', [org.id]);
    await sql.run('DELETE FROM expense_categories WHERE organization_id = ?', [org.id]);
    await sql.run('DELETE FROM business_units WHERE organization_id = ?', [org.id]);
    await sql.run('DELETE FROM app_users WHERE organization_id = ?', [org.id]);
    await sql.run('DELETE FROM finance_accounts WHERE organization_id = ?', [org.id]);
    await sql.run('DELETE FROM properties WHERE organization_id = ?', [org.id]);
  });
  await sql.run('DELETE FROM organizations WHERE id = ?', [org.id]);
}

await cleanup();
try {
  const { organizationId, propertyId } = await provisionOrganization({
    name: 'Partner report', slug: SLUG,
    ownerEmail: `${SLUG}@example.test`, ownerPassword: 'check-password-1234',
    currency: 'EUR', language: 'uk',
  });

  // Другий обʼєкт ТІЄЇ САМОЇ організації — вісь, якої не має жодна інша
  // фікстура в проєкті (саме тому ваду й нікому було побачити).
  const propertyB = `prop_b_${SLUG}`;
  await runWithOrganization(organizationId, () => sql.run(
    'INSERT INTO properties (id, organization_id, name, slug) VALUES (?, ?, ?, ?)',
    [propertyB, organizationId, 'Обʼєкт Б', `${SLUG}-2`]));

  say(propertyId !== propertyB, 'в організації два РІЗНІ обʼєкти');

  const publish = (property: string, title: string, html: string) =>
    runWithOrganization(organizationId, () => repo.publishReport({
      title, html, period: PERIOD, propertyId: property,
    }));

  // ── А публікує свій вересень ────────────────────────────────────────────
  const a = await publish(String(propertyId), 'Вересень, обʼєкт А', 'ЧИСЛА-А-1000');
  say(Boolean(a.token), 'звіт обʼєкта А опубліковано, токен видано');

  // ── Б публікує свій вересень — той самий період ─────────────────────────
  const b = await publish(propertyB, 'Вересень, обʼєкт Б', 'ЧИСЛА-Б-2000');

  const rows = await runWithOrganization(organizationId, () => sql.rows<any>(
    'SELECT id, property_id, token, title FROM partner_reports WHERE organization_id = ?',
    [organizationId]));
  say(rows.length === 2,
    `очікували 2 звіти (обʼєкт А і обʼєкт Б), знайшли ${rows.length}`);
  say(a.token !== b.token,
    'у звітів двох обʼєктів РІЗНІ токени — посилання партнера Б не є посиланням партнера А');

  // ── Головне: що відкриває посилання, яке партнер А вже отримав ──────────
  const byTokenA = await repo.readPublishedReport(a.token);
  say(byTokenA?.html === 'ЧИСЛА-А-1000',
    `за токеном А приходять числа А (прийшло: ${byTokenA?.html ?? 'нічого'})`);
  say(byTokenA?.property_id === propertyId,
    `рядок А лишився за обʼєктом А (${byTokenA?.property_id})`);

  const byTokenB = await repo.readPublishedReport(b.token);
  say(byTokenB?.html === 'ЧИСЛА-Б-2000',
    `за токеном Б приходять числа Б (прийшло: ${byTokenB?.html ?? 'нічого'})`);

  // ── Заміна ВСЕРЕДИНІ обʼєкта далі працює, і токен зберігається ──────────
  //
  // Без цієї сцени «розвести за обʼєктом» можна було б виконати, просто
  // вимкнувши заміну — і гейт лишився б зеленим, а виправлення числа в звіті
  // почало б розсилати партнерові нове посилання щоразу.
  const a2 = await publish(String(propertyId), 'Вересень, обʼєкт А (виправлено)', 'ЧИСЛА-А-1050');
  say(a2.token === a.token,
    'перепублікація ТОГО САМОГО обʼєкта за той самий період зберігає токен');

  const after = await runWithOrganization(organizationId, () => sql.row<{ n: number }>(
    'SELECT COUNT(*) AS n FROM partner_reports WHERE organization_id = ?', [organizationId]));
  say(Number(after?.n) === 2, `рядків досі два, а не три (${after?.n})`);

  const byTokenAgain = await repo.readPublishedReport(a.token);
  say(byTokenAgain?.html === 'ЧИСЛА-А-1050',
    `за тим самим токеном А прийшли ВИПРАВЛЕНІ числа А (${byTokenAgain?.html ?? 'нічого'})`);
} finally {
  await cleanup();
}

if (fails.length) {
  console.log(`\npartner-report: ${fails.length} червоних`);
  process.exit(1);
}
console.log('partner-report: звіт — це пара «період × обʼєкт»; заміна не переносить рядок під інший обʼєкт і не передає чужий токен');
assert.ok(true);
