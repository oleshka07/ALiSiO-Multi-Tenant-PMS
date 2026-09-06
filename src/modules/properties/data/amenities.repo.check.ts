/**
 * Зручність — слово довідника, а не текст у полі.
 *
 *   node src/modules/properties/data/amenities.repo.check.ts
 *
 * Написано ДО реалізації і мусило бути червоним (інваріант 24). Питання, на
 * які сцени відповідають доказом:
 *
 *   1. каталог сіється рівно один раз — повторне заведення не подвоює його;
 *   2. ОБЛАСТЬ тримає: зручність будинку не вішається на тип номера, і
 *      навпаки — інакше матриця пропонує ліфт у двомісному;
 *   3. призначення — це НАБІР: зняте зникає, додане лишається, повторний
 *      запис того самого нічого не міняє;
 *   4. чужа організація не існує ні для читання, ні для запису — ні свого
 *      каталогу сусіда, ні призначення на свій обʼєкт чужої зручності.
 *
 * Червоність перевірено чотирма зламами; один із них — «не замінювати набір,
 * а дописувати» — має два прочитання, і це варто знати: наївне дописування
 * (звичайний INSERT) валить UNIQUE(property_id, amenity_id), тобто його ловить
 * база й гейт червоніє повідомленням бази; правдоподібна помилка
 * (`ON CONFLICT DO NOTHING`) проходить повз базу — і саме її ловить твердження
 * про неперетинний набір нижче.
 *
 * Фікстура не вироджена по осях, про які сцени стверджують (інваріант 26):
 * дві РІЗНІ області (`property` і `unit_type`, плюс `both`), ДВА обʼєкти
 * призначення (обʼєкт і тип), ДВА орендарі.
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';

const { runWithOrganization } = await import('@core/auth/tenant-context');
const { getSql } = await import('@core/db/async');
const repo = await import('./amenities.repo.ts');

const sql = getSql();
const ORG = '__amen_check__org';
const OTHER = '__amen_check__other';
const PROP = '__amen_check__prop';
const PROP_OTHER = '__amen_check__prop2';
const CAT = '__amen_check__cat';
const TYPE = '__amen_check__type';

async function cleanup() {
  for (const org of [ORG, OTHER]) {
    await runWithOrganization(org, async () => {
      await sql.run('DELETE FROM unit_type_amenities WHERE organization_id = ?', [org]);
      await sql.run('DELETE FROM property_amenities WHERE organization_id = ?', [org]);
      await sql.run('DELETE FROM amenities WHERE organization_id = ?', [org]);
      await sql.run('DELETE FROM amenity_categories WHERE organization_id = ?', [org]);
      await sql.run("DELETE FROM unit_types WHERE id LIKE '__amen_check__%'", []);
      await sql.run("DELETE FROM categories WHERE id LIKE '__amen_check__%'", []);
      await sql.run("DELETE FROM properties WHERE id LIKE '__amen_check__%'", []);
    });
    await sql.run('DELETE FROM organizations WHERE id = ?', [org]);
  }
}

await cleanup();
await sql.run('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)', [ORG, 'Amen', ORG]);
await sql.run('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)', [OTHER, 'Amen2', OTHER]);

try {
  await runWithOrganization(ORG, async () => {
    await sql.run('INSERT INTO properties (id, organization_id, name, slug) VALUES (?, ?, ?, ?)', [PROP, ORG, 'A', PROP]);
    await sql.run('INSERT INTO categories (id, property_id, name, type) VALUES (?, ?, ?, ?)', [CAT, PROP, 'Rooms', 'room']);
    await sql.run('INSERT INTO unit_types (id, property_id, category_id, name, code) VALUES (?, ?, ?, ?, ?)',
      [TYPE, PROP, CAT, 'DZ', 'DZ']);
  });
  await runWithOrganization(OTHER, async () => {
    await sql.run('INSERT INTO properties (id, organization_id, name, slug) VALUES (?, ?, ?, ?)', [PROP_OTHER, OTHER, 'B', PROP_OTHER]);
  });

  // ── 1. Каталог сіється один раз ───────────────────────────────────────
  await runWithOrganization(ORG, async () => {
    const first = await repo.seedAmenityCatalog(ORG, 'uk');
    assert.ok(first.categories > 0 && first.amenities > 0, 'каталог не завівся');
    const again = await repo.seedAmenityCatalog(ORG, 'uk');
    assert.strictEqual(again.categories, 0, 'повторне заведення подвоїло категорії');
    assert.strictEqual(again.amenities, 0, 'повторне заведення подвоїло зручності');

    const catalog = await repo.amenityCatalog(ORG);
    const codes = catalog.flatMap((c) => c.amenities.map((a) => a.code));
    assert.strictEqual(new Set(codes).size, codes.length, 'у каталозі є дубль коду');
    assert.ok(codes.includes('elevator') && codes.includes('sea_view'),
      'у каталозі немає базових позицій — сіявся не той словник');
    // Назва мовою готелю, а не англійською константою.
    const lift = catalog.flatMap((c) => c.amenities).find((a) => a.code === 'elevator');
    assert.strictEqual(lift?.name, 'Ліфт', 'назва не мовою готелю');
    console.log('  ok  каталог заводиться один раз, мовою готелю, без дублів');
  });

  // ── 2. Область тримає ─────────────────────────────────────────────────
  await runWithOrganization(ORG, async () => {
    const catalog = await repo.amenityCatalog(ORG);
    const all = catalog.flatMap((c) => c.amenities);
    const elevator = all.find((a) => a.code === 'elevator')!;   // property
    const hairDryer = all.find((a) => a.code === 'hair_dryer')!; // unit_type
    const breakfast = all.find((a) => a.code === 'breakfast')!;  // both

    const badOnType = await repo.setUnitTypeAmenities(ORG, TYPE, [elevator.id]);
    assert.strictEqual(badOnType, null,
      'ліфт повісили на ТИП НОМЕРА — область не тримає, і матриця пропонуватиме це далі');
    const badOnProperty = await repo.setPropertyAmenities(ORG, PROP, [hairDryer.id]);
    assert.strictEqual(badOnProperty, null, 'фен повісили на ОБʼЄКТ — область не тримає');

    const okBoth = await repo.setPropertyAmenities(ORG, PROP, [breakfast.id, elevator.id]);
    assert.ok(okBoth, `«обидва» і «обʼєкт» мали лягти на обʼєкт: ${JSON.stringify(okBoth)}`);
    const okType = await repo.setUnitTypeAmenities(ORG, TYPE, [breakfast.id, hairDryer.id]);
    assert.ok(okType, '«обидва» і «тип» мали лягти на тип номера');
    console.log('  ok  область тримає: ліфт не вішається на номер, фен — на будинок');
  });

  // ── 3. Призначення — це НАБІР ─────────────────────────────────────────
  await runWithOrganization(ORG, async () => {
    const all = (await repo.amenityCatalog(ORG)).flatMap((c) => c.amenities);
    const breakfast = all.find((a) => a.code === 'breakfast')!;
    const elevator = all.find((a) => a.code === 'elevator')!;
    const sauna = all.find((a) => a.code === 'sauna')!;
    const parking = all.find((a) => a.code === 'parking_free')!;

    await repo.setPropertyAmenities(ORG, PROP, [breakfast.id, elevator.id, sauna.id]);
    const three = await repo.propertyAmenities(ORG, PROP);
    assert.deepStrictEqual(three.map((a) => a.code).sort(), ['breakfast', 'elevator', 'sauna']);

    // Другий набір НЕ ПЕРЕТИНАЄТЬСЯ з першим, і це вісь кроку.
    //
    // Спершу тут прибиралась одна позиція з трьох, і реалізацію «дописуємо
    // замість замінювати» валив UNIQUE на рядку, який лишився, — тобто гейт
    // червонів, але повідомленням бази, а не твердженням про набір. З
    // неперетинним набором дописування дає чотири зручності замість однієї, і
    // це ловить саме те твердження, яке про це говорить.
    await repo.setPropertyAmenities(ORG, PROP, [parking.id]);
    const one = await repo.propertyAmenities(ORG, PROP);
    assert.deepStrictEqual(one.map((a) => a.code), ['parking_free'],
      'старий набір не зник — призначення дописується замість заміни набору');

    // Той самий набір ще раз — рядки не подвоюються.
    await repo.setPropertyAmenities(ORG, PROP, [parking.id]);
    const stillOne = await repo.propertyAmenities(ORG, PROP);
    assert.strictEqual(stillOne.length, 1, 'повторний запис того самого набору подвоїв рядки');

    await repo.setPropertyAmenities(ORG, PROP, []);
    assert.strictEqual((await repo.propertyAmenities(ORG, PROP)).length, 0,
      'порожній набір мав зняти все — інакше «нічого не позначено» неможливо зберегти');
    console.log('  ok  призначення — набір: зняте зникає, повтор не двоїть, порожнє зберігається');
  });

  // ── 4. Чужа організація не існує ──────────────────────────────────────
  await runWithOrganization(OTHER, async () => {
    await repo.seedAmenityCatalog(OTHER, 'cs');
    const mine = await repo.amenityCatalog(OTHER);
    const codes = new Set(mine.flatMap((c) => c.amenities.map((a) => a.id)));
    const foreign = await runWithOrganization(ORG, async () =>
      (await repo.amenityCatalog(ORG)).flatMap((c) => c.amenities));
    assert.ok(foreign.every((a) => !codes.has(a.id)),
      'каталог сусіда потрапив у мій — рядки спільні, і перейменування в одного змінить іншого');

    // Чужа зручність на СВІЙ обʼєкт: id приходить із тіла запиту, і без
    // перевірки він ляже — рівно клас INC-010.
    const stolen = await repo.setPropertyAmenities(OTHER, PROP_OTHER, [foreign[0].id]);
    assert.strictEqual(stolen, null, 'чужу зручність повісили на свій обʼєкт');

    // Свою зручність на ЧУЖИЙ обʼєкт.
    const onForeign = await repo.setPropertyAmenities(OTHER, PROP, [mine[0].amenities[0].id]);
    assert.strictEqual(onForeign, null, 'зручність лягла на обʼєкт сусіда');
    console.log('  ok  каталог і призначення сусіда не існують ні для читання, ні для запису');
  });

  // Мовна вісь: другий орендар сіявся чеською — назва в нього СВОЯ.
  await runWithOrganization(OTHER, async () => {
    const lift = (await repo.amenityCatalog(OTHER)).flatMap((c) => c.amenities).find((a) => a.code === 'elevator');
    assert.strictEqual(lift?.name, 'Výtah',
      'каталог другого готелю не його мовою — сіється константа замість перекладу');
  });
  console.log('  ok  два готелі — дві мови каталогу, і рядки в кожного свої');

  console.log('amenities: зручність — слово довідника, і воно належить одному готелю');
} finally {
  await cleanup();
}
