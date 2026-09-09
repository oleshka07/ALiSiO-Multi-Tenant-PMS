/**
 * Писач обʼєкта: рід житла НАЗИВАЮТЬ при створенні, і його не стирають правкою.
 *
 *   node src/modules/properties/data/property-lodging-kind.check.ts
 *
 * ── Навіщо ця перевірка існує ───────────────────────────────────────────
 *
 * `provisioning-lodging-kind.check` стереже ЗАВЕДЕННЯ ГОТЕЛЯ — перший обʼєкт,
 * що народжується разом з організацією. Але обʼєкти створюють і потім, формою
 * налаштувань, і цей шлях не стеріг ніхто: правило В1 трималося рівно на
 * тому, що форма надсилає поле.
 *
 * Ціна помилки та сама, що в К12: рід житла — вісь, за якою менеджер каналів
 * виставляє рахунок (готельна група за обʼєкт, оренда за юніт). Другий обʼєкт
 * готелю, створений без роду, каталог у канал не відправить, а на екрані це
 * виглядатиме як «канал не працює».
 *
 * ── Три твердження, і третє неочевидне ──────────────────────────────────
 *
 * 1. СТВОРЕННЯ без роду — названа відмова (400, мовою продукту, з предметом).
 * 2. Рід поза переліком — теж відмова, і вона називає САМЕ ЗНАЧЕННЯ: «рід
 *    невідомий» без нього лишає людину з питанням «а що я ввів».
 * 3. ПРАВКА без поля лишає збережене як є. Це не послаблення правила, а його
 *    друга половина: форма обʼєкта надсилає різні набори полів, і екран, який
 *    міняє телефон, стер би вибір роду, якби відсутнє поле означало «порожньо»
 *    (В1: «один раз обирається і ЗАКРІПЛЮЄТЬСЯ за готелем»).
 *
 * ── Фікстура ────────────────────────────────────────────────────────────
 *
 * Рід, який кладемо, — `camping`, не `hotel` (§26). `hotel` тут був би
 * правильним випадково: саме його підставляв мовчазний дефолт, тож твердження
 * лишилось би зеленим і після повернення дефолту. `camping` з ним арифметично
 * несумісний, і він же з ІНШОЇ групи тарифікації вендора.
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';

const { runWithOrganization } = await import('@core/auth/tenant-context');
const { getSql } = await import('@core/db/async');
const repo = await import('./properties.repo.ts');

const sql = getSql();
const ORG = '__lodging_kind_check__org';

/** Названа відмова — властивість, не формулювання (§3.2.1, як у catalog-sync). */
function namedRefusal(subject: RegExp) {
  return (e: unknown) => {
    const err = e as { isRefusal?: boolean; status?: number; message?: string };
    const text = err?.message ?? String(e);
    assert.ok(err?.isRefusal, `очікували названу відмову, а прилетів голий виняток: ${text}`);
    assert.strictEqual(err.status, 400, `названа відмова їде своїм 400, а не ${err.status}`);
    assert.ok(/[а-яіїєґ]/i.test(text), `відмова не мовою продукту: ${text}`);
    assert.ok(subject.test(text), `відмова не називає предмет (${subject}): ${text}`);
    return true;
  };
}

async function cleanup() {
  await runWithOrganization(ORG, async () => {
    await sql.run('DELETE FROM properties WHERE organization_id = ?', [ORG]);
  });
  await sql.run('DELETE FROM organizations WHERE id = ?', [ORG]);
}

await cleanup();
await sql.run(
  `INSERT INTO organizations (id, name, slug, timezone, default_currency, language)
   VALUES (?, ?, ?, ?, ?, ?)`,
  [ORG, 'Lodging kind probe', '__lodging-kind-check__', 'Europe/Kyiv', 'EUR', 'uk']);

await runWithOrganization(ORG, async () => {
  // ── 1. Створення без роду — відмова ───────────────────────────────────
  await assert.rejects(
    () => repo.createProperty(ORG, { name: 'No kind', slug: 'no-kind' }),
    namedRefusal(/рід житла/i),
    'обʼєкт без роду житла створився — мовчазний дефолт повернувся',
  );
  // Порожній рядок — те саме, і це окрема сцена: `NOT NULL` його дозволяє, а
  // `catalog-sync` перевіряє саме порожнечу, тож `''` у колонці був би
  // «названо» для писача і «не названо» для каталогу.
  await assert.rejects(
    () => repo.createProperty(ORG, { name: 'Empty kind', slug: 'empty-kind', property_type: '' }),
    namedRefusal(/рід житла/i),
    'порожній рядок пройшов як рід житла',
  );

  // ── 2. Рід поза переліком — відмова, і вона називає значення ──────────
  await assert.rejects(
    () => repo.createProperty(ORG, { name: 'Bogus', slug: 'bogus-kind', property_type: 'castle' }),
    namedRefusal(/castle/),
    'рід поза переліком записався б у колонку',
  );

  // ── 3. Названий рід лягає, і правка його не стирає ────────────────────
  const made = await repo.createProperty(ORG, {
    name: 'Camp', slug: 'camp-kind', property_type: 'camping',
  });
  assert.strictEqual(made.property_type, 'camping',
    `рід житла не ліг на обʼєкт (${made.property_type ?? 'null'})`);

  // Правка БЕЗ поля роду — телефон міняється, рід лишається. Це друга
  // половина В1: вибір закріплюється, а не стирається кожним екраном, який
  // про нього мовчить.
  const patched = await repo.updateProperty(ORG, made.id, { phone: '+380000000000' });
  assert.strictEqual(patched?.property_type, 'camping',
    `правка без поля стерла рід житла (${patched?.property_type ?? 'null'})`);
  assert.strictEqual(patched?.phone, '+380000000000', 'правка не застосувалась узагалі');

  // А свідома зміна роду — проходить: закріплюється не значення, а вибір.
  const changed = await repo.updateProperty(ORG, made.id, { property_type: 'villa' });
  assert.strictEqual(changed?.property_type, 'villa', 'свідому зміну роду відхилено');
});

await cleanup();

const left = await sql.row<{ n: number }>(
  'SELECT COUNT(*) AS n FROM organizations WHERE id = ?', [ORG]);
assert.strictEqual(Number(left?.n ?? 0), 0, 'після прибирання лишилась організація-проба');

console.log('✓ property-lodging-kind: писач вимагає рід житла і не стирає його правкою');
