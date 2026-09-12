/**
 * Мета приїзду НАЗИВАЄТЬСЯ — і живе рівно в одній таблиці.
 *
 *   node src/modules/guests/data/purpose-of-stay.check.ts
 *
 * ── Дефект, проти якого це написано ─────────────────────────────────────
 *
 * Реєстрація з картки броні вписувала `'Tourism'` ЛІТЕРАЛОМ: гостя ніхто не
 * питав, а виправити потім було нічим — реєстр дозволяє змінити лише
 * поліцію і суму збору. Тобто книга гостей, та сама, що йде в поліцію,
 * казала «туризм» про кожного, кого зареєстрував портьє, і про відрядженого
 * теж. Той самий клас, що `|| 'CZK'` і `|| 'Europe/Prague'`: вигадане
 * значення, яке виглядає як дані (інваріант 17 за духом).
 *
 * Друга половина — ОДНЕ МІСЦЕ. Мета приїзду лежала в ДВОХ таблицях, і
 * розходились вони по шляху реєстрації: рецепція клала `'Tourism'` у книгу
 * і NULL у реєстрацію, портал — те саме в обидві. Виміряно дослідом, не
 * прочитано. Копію в `guest_registrations` віддавав GDPR-експорт
 * (`SELECT gr.*`), тобто це було справжнє друге джерело, а не сміття.
 *
 * ── Осі, по яких фікстура не вироджена (інваріант 26) ───────────────────
 *
 * 1. НАЗВАНО і НЕ НАЗВАНО — два різні результати, і «не названо» це порожньо,
 *    а не тихий дефолт. З одним значенням твердження зелене й на літералі.
 * 2. Значення НЕ 'Tourism' (`Business`): якби фікстура називала саме
 *    'Tourism', вона не відрізнила б назване від вигаданого.
 * 3. Два шляхи реєстрації — рецепція і портал: розходились вони саме між
 *    шляхами, тож один шлях нічого не доводить.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-purpose-'));
process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { runWithOrganization } = await import('@core/auth/tenant-context.ts');
const { seedTwoProperties } = await import('@core/fixtures/two-properties.ts');
const { addReceptionRegistration, saveRegistrations } = await import('./registration.repo.ts');
const registry = await import('./registry.repo.ts');
const { ALL_PROPERTIES } = await import('@core/property-scope.ts');

const sql = getSql();
const fx = await seedTwoProperties();
const ORG = fx.organizationId;
const RES_SILENT = fx.a.reservationIds[0];
const RES_NAMED = fx.a.reservationIds[1];
const RES_PORTAL = fx.b.reservationIds[0];

const fails: string[] = [];
const say = (cond: boolean, what: string) => {
  if (cond) console.log(`  ok  ${what}`);
  else { fails.push(what); console.log(`  ЧЕРВОНЕ  ${what}`); }
};

const purposeIn = (table: string, reservationId: string) => runWithOrganization(ORG, async () => {
  const row = await sql.row<any>(
    `SELECT purpose_of_stay FROM ${table} WHERE reservation_id = ?`, [reservationId]);
  return row?.purpose_of_stay ?? null;
});

/** Мета КОНКРЕТНОГО рядка книги — портал пише кількох гостей однією подачею. */
const purposeOf = (reservationId: string, lastName: string) => runWithOrganization(ORG, async () => {
  const row = await sql.row<any>(
    'SELECT purpose_of_stay FROM reservation_guests WHERE reservation_id = ? AND last_name = ?',
    [reservationId, lastName]);
  return row?.purpose_of_stay ?? null;
});

await runWithOrganization(ORG, async () => {
  for (const [id, last] of [['__pos__g1', 'Мовчазний'], ['__pos__g2', 'Названий']]) {
    await sql.run('INSERT INTO guests (id, organization_id, first_name, last_name) VALUES (?,?,?,?)',
      [id, ORG, 'Гість', last]);
  }

  const snapshot = (last: string) => ({
    firstName: 'Гість', lastName: last, dateOfBirth: null, address: null,
    nationality: 'UA', documentType: 'ID_CARD', documentNumber: `D-${last}`,
  });

  // ── 1. НЕ НАЗВАЛИ — порожньо, а не «Tourism» ───────────────────────────
  await addReceptionRegistration({
    reservationId: RES_SILENT, guestId: '__pos__g1', isPrimary: true, guest: snapshot('Мовчазний'),
  });
  const silent = await purposeIn('reservation_guests', RES_SILENT);
  say(silent === null || silent === '',
    `не названо — у книзі ПОРОЖНЬО, а не вигадане значення (${JSON.stringify(silent)})`);

  // ── 2. НАЗВАЛИ — саме те, що назвали ───────────────────────────────────
  //
  // Значення навмисно НЕ 'Tourism': інакше твердження зелене й на літералі.
  await addReceptionRegistration({
    reservationId: RES_NAMED, guestId: '__pos__g2', isPrimary: true, guest: snapshot('Названий'),
    purposeOfStay: 'Business', visaNumber: 'V-42',
  });
  say(await purposeIn('reservation_guests', RES_NAMED) === 'Business',
    `названо — у книзі саме воно (${await purposeIn('reservation_guests', RES_NAMED)})`);

  // ── 3. Виправно ПІСЛЯ реєстрації ───────────────────────────────────────
  //
  // Доти реєстр умів лише поліцію і збір, тож помилку в меті приїзду не
  // можна було виправити взагалі.
  const entry = await sql.row<any>(
    'SELECT id FROM reservation_guests WHERE reservation_id = ?', [RES_SILENT]);
  const changed = await registry.updatePurposeOfStay(ORG, String(entry.id), {
    purposeOfStay: 'Medical', visaNumber: null,
  });
  say(changed, 'реєстр приймає правку мети приїзду');
  say(await purposeIn('reservation_guests', RES_SILENT) === 'Medical',
    `і вона лягла (${await purposeIn('reservation_guests', RES_SILENT)})`);

  // Чужий рядок — відмова, а не тиха згода (інваріант 13).
  say(!(await registry.updatePurposeOfStay('__pos__alien_org', String(entry.id), {
    purposeOfStay: 'Hack', visaNumber: null,
  })), 'чужий орендар мети не міняє');
});

// ── 4. Портал: та сама властивість на ДРУГОМУ шляху ──────────────────────
//
// ОДНОЮ подачею двоє гостей: один назвав мету, другий ні. Перша редакція
// цього гейта перевіряла лише названого — і була ЗЕЛЕНОЮ над писачем, який
// тримав `guest.purposeOfStay || 'Tourism'`: правдиве значення проходить
// крізь `||` незмінним. Це рівно випадок з AGENTS §3.2.1: та сама помилка,
// записана в сусідньому модулі, лишалась поза гейтом.
const portalGuest = (last: string, purpose?: string) => ({
  firstName: 'Портал', lastName: last, documentNumber: `BB-${last}`,
  documentType: 'PASSPORT', nationality: 'DE',
  ...(purpose ? { purposeOfStay: purpose, visaNumber: 'V-777' } : {}),
});
await runWithOrganization(ORG, () => saveRegistrations(RES_PORTAL, ORG, [
  portalGuest('Названий', 'Business'),
  portalGuest('Мовчазний'),
] as never));
say(await purposeOf(RES_PORTAL, 'Названий') === 'Business',
  'портал пише названу мету в книгу гостей');
const portalSilent = await purposeOf(RES_PORTAL, 'Мовчазний');
say(!portalSilent,
  `портал теж НЕ ВИГАДУЄ, коли не назвали (${JSON.stringify(portalSilent)})`);

// ── 4б. І РЕЄСТР не домальовує її на читанні ──────────────────────────────
//
// Писач може чесно класти NULL, а читач — підміняти його на
// `COALESCE(rg.purpose_of_stay, 'Tourism')`, і тоді книга, яку читає
// поліція, знову каже «туризм» про кожного, кого ніхто не питав.
// Твердження про ПОРОЖНЄ без цього перевіряє лише півшляху.
const month = fx.b.checkIns[0].slice(0, 7);
const entries = await runWithOrganization(ORG, () => registry.getRegistryEntries(ORG, {
  month, scope: ALL_PROPERTIES,
}));
// Рядок беремо за БРОНЮ І прізвище: у рецепції гості звуться так само, і
// `.find()` по самому прізвищу віддав би рядок іншої броні — та сама пастка,
// про яку AGENTS §7 («твердження про рядок, якого може бути кілька»).
const ofPortal = (last: string) =>
  entries.filter((e) => e.reservation_id === RES_PORTAL && e.last_name === last);
const silentRows = ofPortal('Мовчазний');
say(silentRows.length === 1, `у реєстрі рівно один рядок мовчазного (${silentRows.length})`);
say(!silentRows[0]?.purpose_of_stay,
  `реєстр показує ПОРОЖНЄ, а не вигадане (${JSON.stringify(silentRows[0]?.purpose_of_stay)})`);
say(ofPortal('Названий')[0]?.purpose_of_stay === 'Business',
  'і названу мету він показує як є');

// ── 5. І ГОЛОВНЕ: мета приїзду лежить рівно в ОДНІЙ таблиці ───────────────
//
// Доти їх було дві, і розходились вони саме між шляхами реєстрації. Це
// твердження про СХЕМУ, а не про рядок: доки колонка є в обох, наступний
// писач знову напише в одну й забуде другу.
const dup = await sql.rows<{ table_name: string }>(
  sql.dialect.name === 'postgres'
    ? `SELECT table_name FROM information_schema.columns
        WHERE column_name = 'purpose_of_stay' AND table_schema = 'public'`
    : `SELECT m.name AS table_name FROM sqlite_master m
        JOIN pragma_table_info(m.name) p
        WHERE m.type = 'table' AND p.name = 'purpose_of_stay'`);
const names = dup.map((r) => String(r.table_name)).sort();
say(names.length === 1,
  `мета приїзду — рівно в одній таблиці, а не в ${names.length}: ${names.join(', ')}`);

fs.rmSync(tmp, { recursive: true, force: true });
if (fails.length) { console.error(`\npurpose-of-stay: ${fails.length} червоних`); process.exit(1); }
console.log('purpose-of-stay: мета приїзду називається, виправляється і живе в одному місці');
