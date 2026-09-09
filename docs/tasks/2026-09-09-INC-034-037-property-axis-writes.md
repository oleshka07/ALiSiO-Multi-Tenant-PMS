# INC-034…INC-037 — вісь обʼєкта: чотири записи і одна цифра для податкової

**Дата:** 09.09.2026
**Хто підтвердив:** контролер, читанням коду на голові гілки робіт
`claude/channex-integration-66kv65` (`c83b2eb9`) — не за звітом сесії.
**Звідки взялося:** класифікація сесії 1 у
`docs/tasks/2026-09-08-INC-029-property-axis.report.md`, розділ «Класифікація
сесії 1»: 47 пар у 18 файлах, з них 9 справжніх дір у 5 файлах, чотири з них —
**записи**.

Сесія 1 назвала дев'ять. Контролер перевірив кодом чотири записи і найдорожче
читання; кожне підтвердилось у тій формі, в якій було описано, і два з них — з
**додатковою обставиною, якої в звіті немає** (нижче помічені як «додано
контролером»). Решта чотири пари (`services` читання, бейдж чернеток) лишаються
описом сесії й підтвердження не потребують — вони не записи.

---

## INC-034 — сайт одного обʼєкта продає номер іншого (ЗАПИС)

**Файл:** `src/app/api/booking-sites/[id]/listings/route.ts:76` (юніт) і `:83`
(тип юніта), обидва в `POST`.

Варта `withOwnedSite` (`src/app/api/booking-sites/_owned-site.ts:69`) звіряє
сайт із **рахунком**:

```sql
SELECT * FROM booking_sites WHERE id = ? AND organization_id = ? AND status != 'deleted'
```

`booking_sites."property_id" TEXT NOT NULL` (`db/postgres/schema.sql:227`) —
тобто сайт **належить обʼєкту**, і варта цього не питає. Далі в `POST`:

```sql
SELECT u.id FROM units u JOIN properties p ON u.property_id = p.id
 WHERE u.id = ? AND p.organization_id = ?
```

Знову рахунок. Коментар над цим запитом (рядки 71–74) називає полагоджену
половину дослівно: «Owning the SITE does not make a room yours» — і має рацію
про сусідній РАХУНОК; сусідній ОБʼЄКТ проходить повністю. Оператор із двома
готелями кладе в `site_listings` сайта готелю А номер готелю Б, і сайт А його
**продає**.

**Чому це дешево лагодиться.** `withOwnedSite` уже повертає ввесь рядок сайта в
`ctx.site` — обидва маршрути деструктурують із нього лише `organizationId`.
`site.property_id` є в області видимості і `NOT NULL`. Правка — умова
`AND u.property_id = ?` зі значенням `site.property_id`, без нового запиту.
(додано контролером: у звіті сесії цього немає)

---

## INC-035 — той самий сайт налаштовується чужими послугами (ЗАПИС + читання)

**Файл:** `src/app/api/booking-sites/[id]/services/route.ts:58` (`POST`,
запис) і `:18` (`GET`, читання).

```sql
SELECT s.id FROM additional_services s JOIN properties p ON s.property_id = p.id
 WHERE s.id = ? AND s.is_active = TRUE AND p.organization_id = ?
```

Той самий рід, що INC-034, і той самий коментар-напівправда: «one hotel's
site-services screen offered the neighbour's spa treatments» — сусідній рахунок
справді не видно, сусідній обʼєкт видно повністю. `additional_services` теж
`property_id NOT NULL` (`schema.sql:46`). Лагодиться тим самим `site.property_id`.

---

## INC-036 — послуга чужого обʼєкта лягає в рахунок гостя з чужою ціною і чужим ПДВ (ЗАПИС)

**Файл:** `src/modules/invoicing/data/stay-charges.repo.ts:431` (`postCatalogService`).

Фоліо читається так, що обʼєкт **уже обчислено**:

```sql
SELECT f.id, COALESCE(r.property_id, f.property_id) AS property_id, …
  FROM fin_folios f LEFT JOIN reservations r ON r.id = f.reservation_id …
 WHERE f.id = ? AND f.organization_id = ?
```

і `folio.property_id` за двадцять рядків нижче вживається — рядок 445, мова
документа. А послуга звіряється лише з рахунком:

```sql
SELECT s.id, s.name, s.name_de, s.price, s.vat_code, s.vat_split
  FROM additional_services s JOIN properties p ON p.id = s.property_id
 WHERE s.id = ? AND p.organization_id = ?
```

Два звірені значення, **між собою не звірені жодного разу**. Наслідок не
косметичний: у нарахування їдуть `price` і `vat_code` **чужого** обʼєкта, тобто
ставка чужої юрисдикції (інваріант 22), тоді як мова документа береться від
обʼєкта фоліо. Один рахунок склеюється з двох податкових режимів.

**Підбирач уже полагоджено, приймач — ні.** Список послуг для оператора
(`src/modules/bookings/api/additional-services.handlers.ts`) на гілці
`claude/inc-029-core` переведено на `requestPropertyScope`; після злиття
екран перестане ПОКАЗУВАТИ чужі послуги, але API прийме їх так само. Дірка
закривається лише з боку приймача.

**Обставина, якої в звіті немає (додано контролером): `folio.property_id`
може бути NULL.** `fin_folios."property_id" TEXT` (`schema.sql:816`) —
нульове, `reservations` теж підставляється через `LEFT JOIN`, і
`createFolio` (`src/modules/invoicing/data/folio.repo.ts:44`) приймає обидва
як `null`. Тобто фоліо без броні й без обʼєкта — досяжний стан. Вузьке
`AND s.property_id = ?` на такому фоліо відмовить у **кожній** послузі, і це
виглядатиме як «функція зникла» — рівно та поломка, про яку AGENTS §7.

Тому правка з двох частин, і другу не можна пропустити:

1. послуга звіряється з `folio.property_id`, коли він є;
2. фоліо **без** обʼєкта відмовляє **поіменно** (`{ reason: 'folio_without_property' }`
   і повідомлення на екрані), а не мовчки і не «отже, будь-яка послуга».
   Це рішення 3 контролера від 09.09 дослівно: невпізнана форма — це
   «невизначено», а не «мовчить».

---

## INC-037 — цифра міського збору для подання рахується по всіх обʼєктах одразу

**Файли:** `src/modules/guests/data/registry.repo.ts:84` (список) і `:155`
(підсумок), і `src/app/app/(dashboard)/guest-registry/page.tsx:91–99`.

Це **читання**, і воно тут не тому, що витікає, а тому, що з нього виходить
**число, яке подають державі**:

```sql
SUM(CASE WHEN COALESCE(rg.fee_exempt, FALSE) = TRUE THEN 0
         ELSE r.nights * p.city_tax_per_night END) AS totalFees
```

`city_tax_per_night` — ставка ОБʼЄКТА. Сума множить ночі кожного обʼєкта на
його власну ставку і **додає різні обʼєкти в одну цифру**. Подання —
за закладом; цифра неправильна за побудовою, а не за обставинами.

Вісь у репозиторії **вже є і мертва**: `if (filters.propertyId) { query += ' AND
r.property_id = ?' }` в обох запитах, маршрут
(`src/modules/guests/api/registry.handlers.ts:28,96`) її передає — а екран її
**ніколи не ставить**: `fetchData` збирає `month`, `foreignersOnly`,
`unregisteredOnly`, `search` і на цьому все.

**Обставина, якої в звіті немає (додано контролером): імена не збігаються.**
Маршрут читає `searchParams.get('propertyId')`. Провайдер області
(`usePropertyScope()`) і решта чотирнадцяти екранів шлють `property_id`
(NAMING §8, підтверджено `src/core/auth/property-scope.ts`). Тобто екран,
переведений «як усі», відправив би `property_id`, маршрут прочитав би `undefined`,
і **нічого б не змінилось** — а правка виглядала б зробленою. Маршрут
переводиться на `requestPropertyScope`, не на другий `searchParams.get`.

---

## Що з цього не інцидент

**Бейдж чернеток** (`src/app/api/booking/drafts-count/route.ts:31`) —
не витік і не запис: лічильник по рахунку проти сторінки, яка ось-ось візьме
`PropertyScope`. Ламається він **злиттям гілки `inc-029-core`**, а не чиєюсь
новою помилкою, тож іде в ту саму задачу, що й переведення `/app/bookings`, і
живе в черзі сесії 3.

## Порядок

INC-034, INC-035, INC-036 — записи, робляться **негайно**, як INC-033.
INC-037 — читання, але з нього виходить подання, тож у той самий підхід.
INC-034 і INC-035 — тека сесії 2 (сайти); INC-036 і INC-037 — тека сесії 1.
