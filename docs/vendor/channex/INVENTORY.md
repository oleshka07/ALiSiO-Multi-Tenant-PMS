# Інвентар Channex — що є, а не що робити

**Знято 30 серпня 2026** з копії в цій теці. Кожен рядок можна перевірити
`grep`-ом по сусідніх файлах; посилання дано на файл, а не на сайт.

**Звірено з живим API 31 серпня 2026** на `staging.channex.io` — крок 3
з [§0.1 ТЗ](../../CHANNEX-INTEGRATION.md). Розбіжності документації й API
позначені 🔴 просто в таблицях, зведення — у §14. **Де 🔴, там правда за
API**: документація лише описує, а приймає запити сервер.

## Як читати

Це **перелік фактів**, а не технічне завдання. Тут навмисно немає наших
висновків, схеми, назв наших таблиць і слова «треба». Рішення живуть у
[docs/CHANNEX-INTEGRATION.md](../../CHANNEX-INTEGRATION.md) і мусять
посилатися сюди, а не навпаки.

| Позначка | Значення |
|---|---|
| — | документація мовчить: **не задокументовано**, не додумано |
| ⓘ | факт із документації, який суперечить іншому місцю документації |
| 🔴 | **живий API відповів інакше, ніж каже документація** — правда за API |
| 🟢 | документацію перевірено на живому API і вона підтвердилась |

Порядок каналів у таблицях — той, що зафіксував власник: Booking.com,
Airbnb, VRBO.

---

## 1. Об'єкт (`property`)

`POST /api/v1/properties`, тіло обгортається ключем `property`.
Джерело: `api-v.1-documentation/hotels-collection.md`.

| Поле | Тип | Обов'язк. | Дефолт | Допустимі значення / межі |
|---|---|---|---|---|
| `title` | string | **так** | — | 1–255 символів |
| `currency` | string | **так** | — | ISO 4217, 3 символи |
| `email` | string | ні* | — | валідний email |
| `phone` | string | ні* | — | ≤32; цифри, пробіли, дужки, спецсимволи |
| `zip_code` | string | ні* | — | ≤32 |
| `country` | string | ні* | — | ISO 3166-1 alpha-2, 2 символи |
| `state` | string | ні* | — | ≤255 |
| `city` | string | ні* | — | ≤255 |
| `address` | string | ні* | — | ≤255 |
| `longitude` | string (десятковий) | ні* | — | ≤10 символів, ≤7 знаків після коми, −180…+180 |
| `latitude` | string (десятковий) | ні* | — | ≤9 символів, ≤7 знаків після коми, −90…+90 |
| `timezone` | string | ні | — | назва з бази IANA tz |
| `facilities` | array&lt;uuid&gt; | ні | — | id із Facilities Collection |
| `property_type` | enum | ні | — | `apart_hotel`, `apartment`, `boat`, `camping`, `capsule_hotel`, `chalet`, `country_house`, `farm_stay`, `guest_house`, `holiday_home`, `holiday_park`, `homestay`, `hostel`, `hotel`, `inn`, `lodge`, `motel`, `resort`, `riad`, `ryokan`, `tent`, `villa` |
| `group_id` | uuid | ні | Default User Group | — |
| `logo_url`, `website` | string | ні | — | — |
| `content.description` | string | ні | `null` | — |
| `content.photos[]` | array | ні | — | `url`, `position` (0 = обкладинка), `description`, `author`, `kind` ∈ `photo\|ad\|menu` |
| `content.important_information` | string | ні | — | — |

\* «optional at initial setup step, but **required when you try connect first
3rd party service**» — дослівно в документації для email, phone, zip_code,
country, state, city, address, longitude, latitude.

**`property_type` впливає на рахунок:** «Recommended you set this value since
it affects billing. Set to "hotel" for hotels or "apartment" for vacation
rentals.»

### 1.1 `property.settings`

| Ключ | Тип | Дефолт | Примітка з документації |
|---|---|---|---|
| `allow_availability_autoupdate` | boolean | — | **deprecated** |
| `allow_availability_autoupdate_on_confirmation` | boolean | `true` | **read only**, не можна поставити `false` |
| `allow_availability_autoupdate_on_modification` | boolean | `false` | «Recommended Setting is `false`» |
| `allow_availability_autoupdate_on_cancellation` | boolean | `false` | «Recommended Setting is `false`» |
| `min_stay_type` | enum | `both` | `both`, `arrival`, `through`. При `arrival`/`through` можна слати `min_stay` одним ключем — Channex сам обере потрібний тип і налаштує мапінги каналів |
| `min_price` | string \| integer | `null` | нижча ціна автоматично **піднімається** до цієї |
| `max_price` | string \| integer | `null` | вища ціна автоматично **опускається** до цієї |
| `state_length` | integer | 500 (у прикладі) | мін. 100, макс. **730** днів — довжина таблиці інвентарю |
| `cut_off_time` | time | `00:00:00` | крок 30 хвилин; у цей час інвентар закривається на сьогодні + `cut_off_days` |
| `cut_off_days` | integer | `0` | скільки днів закривати |
| `max_day_advance` | integer \| null | `null` | «we **override existed Availability values to 0** and can't restore it without Full Sync» |

🟢 **Дефолти перевірено на свіжому об'єкті.** Надіслано лише
`min_stay_type` і `state_length`; сервер дописав решту:

```json
{"min_stay_type":"both","allow_availability_autoupdate":true,
 "allow_availability_autoupdate_on_cancellation":false,
 "allow_availability_autoupdate_on_confirmation":true,
 "allow_availability_autoupdate_on_modification":false,
 "cut_off_days":null,"cut_off_time":null,"max_day_advance":null,
 "max_price":null,"min_price":null,"state_length":500}
```

Два рекомендованих Channex значення (`…on_modification`,
`…on_cancellation`) **уже стоять `false` за замовчуванням** — виставляти їх
руками не треба. `cut_off_time` приходить `null`, а не `00:00:00` 🔴.

**Поля об'єкта, яких немає в документації** 🔴: `property_category`
(повернулось `"hotel"` — окреме від `property_type`), `location_precision`,
`is_active`, `acc_channels_count`, `expected_removal_date` (порожнє, поки
об'єкт не під загрозою автовидалення — див. §12), `min_stay_type` **на
верхньому рівні атрибутів**, дублем до `settings.min_stay_type`, і чотири
`max_count_of_*` із §3.3.

🔴 **`POST /properties` відповідає `201`, не `200`** — як і `/room_types`
та `/rate_plans`. `200` віддають лише ARI-ендпоінти.

---

## 2. Тип номера (`room_type`)

`POST /api/v1/room_types`. Джерело: `api-v.1-documentation/room-types-collection.md`.

| Поле | Тип | Обов'язк. | Дефолт | Значення / межі |
|---|---|---|---|---|
| `property_id` | uuid | **так** | — | — |
| `title` | string | **так** | — | 1–255 |
| `count_of_rooms` | integer > 0 | **так** | — | «**affects billing if the property is a Vacation Rental**» |
| `occ_adults` | integer > 0 | **так** | — | дорослих спальних місць |
| `occ_children` | integer ≥ 0 🔴 | **так** | — | місць **лише для дітей**. Документація каже «> 0» і тут же «якщо таких немає — `0`»; API **приймає `0`** (створено 31.08) |
| `occ_infants` | integer ≥ 0 🔴 | **так** | — | те саме: `0` приймається |
| `default_occupancy` | integer > 0 | **так** | — | **не більше за `occ_adults`** |
| `facilities` | array&lt;uuid&gt; | ні | — | — |
| `room_kind` | enum | ні | — | `room`, `dorm` |
| `capacity` | integer | ні | — | ліжок у фізичній кімнаті; **лише для `dorm`** |
| `content` | object | ні | — | як у property |

**Поля відповіді, яких немає в документації** 🔴: `position` (integer,
0-базований порядок типів у об'єкті — присвоюється сервером), `meta`,
`codes`. Повний перелік атрибутів відповіді на 31.08: `capacity`, `codes`,
`content`, `count_of_rooms`, `default_occupancy`, `id`, `meta`,
`occ_adults`, `occ_children`, `occ_infants`, `position`, `room_kind`,
`title`.

---

## 3. Тарифний план (`rate_plan`)

`POST /api/v1/rate_plans`. Джерело: `api-v.1-documentation/rate-plans-collection.md`.

| Поле | Тип | Обов'язк. | Дефолт | Значення |
|---|---|---|---|---|
| `title` | string | **так** | — | 1–255. 🔴 **НЕ унікальний у межах об'єкта.** Документація каже «unique within property»; API створив другий «Best Available Rate» у тому самому об'єкті на іншому типі номера — `201`. Це не дрібниця: сертифікаційні тести 3, 5, 6, 7 усі вимагають однойменного `Best Available Rate` на двох типах номерів, тобто за документацією вони були б нездійсненні |
| `property_id` | uuid | **так** | — | — |
| `room_type_id` | uuid | **так** | — | — |
| `options` | array | **так** | — | масив Occupancy Option |
| `tax_set_id` | uuid | ні | Tax Set об'єкта | — |
| `parent_rate_plan_id` | uuid | ні | — | — |
| `currency` | string | ні | валюта об'єкта | ISO 4217; «Property can have Rate Plans with different Currencies» |
| `sell_mode` | enum | ні | `per_room` | `per_room`, `per_person`. **Скільки опцій заселеності вимагає кожен режим** (`rate-plans-collection.md:668`): `per_room` — ОДНУ, на максимальну місткість («price is equal to any count of allowed guests»); `per_person` — по одній на кожну кількість **ДОРОСЛИХ** гостей, діти окремо через `children_fee`/`infant_fee`. 🟢 Переміряно 01.09.2026: поле **оновлюване** через `PUT /rate_plans/:id` в обидва боки (200, читання назад підтверджує). 🔴 А **`options` через `PUT` не змінюються взагалі**: додати, прибрати чи лишити той самий набір — усі три дають 200 і НУЛЬ змін; спроба перевести `is_primary` на іншу заселеність дає 422 «Duplication in Rate Plan title». Механізм: основна опція має той самий id, що й тариф (§4.5), тож перецілити її = завести другу сутність із тією ж назвою. Наслідок: створений тариф можна перевести в інший режим, але не переоснастити опціями. 🔴 Заселеність понад `occ_adults` типу — 422 «occupancy N exceeds the room type's max adults occupancy of M», і це валить створення всього каталогу |
| `rate_mode` | enum | ні | `manual` | `manual`, `derived`, `auto`, `cascade` |
| `auto_rate_settings` | object | ні** | — | **обов'язковий при `rate_mode: auto`** |
| `meal_type` | enum | ні | — | `none`, `all_inclusive`, `breakfast`, `lunch`, `dinner`, `american`, `bed_and_breakfast`, `buffet_breakfast`, `carribean_breakfast`, `continental_breakfast`, `english_breakfast`, `european_plan`, `family_plan`, `full_board`, `full_breakfast`, `half_board`, `room_only`, `self_catering`, `bermuda`, `dinner_bed_and_breakfast_plan`, `family_american`, `breakfast_and_lunch`, `lunch_and_dinner` |
| `children_fee`, `infant_fee` | string \| integer ≥ 0 | ні | — | доплата за дитину/немовля |
| `max_stay` | integer > 0 **або масив із 7** | ні | — | одне число або по числу на день тижня |
| `min_stay_arrival` | integer > 0 або масив 7 | ні | — | те саме |
| `min_stay_through` | integer > 0 або масив 7 | ні | — | те саме |
| `closed_to_arrival` | boolean або масив 7 | ні | — | те саме |
| `closed_to_departure` | boolean або масив 7 | ні | — | те саме |
| `stop_sell` | boolean або масив 7 | ні | — | те саме |
| `inherit_*` | boolean | ні | `false` без `parent_rate_plan_id`, `true` з ним | `inherit_rate`, `inherit_closed_to_arrival`, `inherit_closed_to_departure`, `inherit_stop_sell`, `inherit_min_stay_arrival`, `inherit_min_stay_through`, `inherit_max_stay`, `inherit_max_sell`, `inherit_max_availability`, `inherit_availability_offset` |

### 3.1 Occupancy Option

Документація описує чотири поля. Живий API віддає чотирнадцять, і три з
чотирьох описаних поводяться не так, як написано.

| Поле | Тип | Примітка |
|---|---|---|
| `id` | uuid | 🔴 **у документації відсутнє, і це найважливіше поле розділу.** Опція **основна** (`is_primary: true`) має **той самий `id`, що й сам тарифний план**; неосновні мають власні UUID. Тобто «id тарифного плану» і «id основної опції заселеності» — це одне число |
| `occupancy` | integer | скільки осіб |
| `is_primary` | boolean | основна опція |
| `derived_option` | object \| null | 🔴 у документації **завжди `null`** у всіх трьох прикладах. Насправді `null` тільки в основної опції; неосновні при `rate_mode: manual` отримують `{"rate": []}` |
| `rate` | integer на вхід, **рядок «100.00» на вихід** 🔴 | ціна для цієї заселеності. Надіслано `10000` — повернулось `"100.00"`, тобто вхідне ціле це **мінорні одиниці** (сотi), а вихідне — десятковий рядок у мажорних. Документація типізує обидва боки як integer |
| `inherit_rate` | boolean | 🔴 не задокументовано на рівні опції. Дефолт `false` в обох випадках |
| `inherit_closed_to_arrival`, `inherit_closed_to_departure`, `inherit_stop_sell`, `inherit_min_stay_arrival`, `inherit_min_stay_through`, `inherit_max_stay`, `inherit_max_availability`, `inherit_availability_offset` | boolean | 🔴 не задокументовані на рівні опції. **Дефолт залежить від `is_primary`**: в основної опції всі `false`, у неосновних усі `true` |
| `rate_category_id` | uuid \| null | 🔴 не задокументоване |

**Порядок масиву `options` не є порядком, у якому його надіслали, і не
відсортований за `occupancy`** 🔴. Надіслано `[1, 2, 3]` (основна — 2),
повернулось `[2, 3, 1]`: спершу основна, далі решта в невизначеному
порядку. Код, який читає `options[0]` як «заселеність 1», прочитає основну.
Зіставляти треба **за полем `occupancy`**.

**Заселеність тарифу понад `occ_adults` типу номера — жорстка помилка** 🟢.
Тип із `occ_adults: 2`, тариф з опцією `occupancy: 3`:

```
HTTP 422
{"errors":{"code":"validation_error","title":"Validation Error",
 "details":{"options":["occupancy 3 exceeds the room type's max adults occupancy of 2"]}}}
```

Документація попереджала про це прозою («It will cause an error») — тепер є
код, форма тіла й текст.

**`options[].rate` — це не лише дефолт, це засів усього календаря** 🔴.
Ніде не сказано, але перевірено: ціна, задана при створенні тарифу, одразу
читається через `GET /restrictions` **на кожну майбутню дату**, а не лише
там, куди її поклали окремим викликом. Тариф із `rate: 9000` віддає
`"90.00"` на будь-яку дату поза діапазонами, які потім перезаписали.
Наслідок для нас: створення тарифу з ненульовою ціною **вже публікує ціну**
в канали, якщо об'єкт до них підключений.

### 3.2 Режими ціни (`rate_mode`)

| Режим | Що робить |
|---|---|
| `manual` | ціна в `options.rate` |
| `derived` | ціна від батька **для основної** опції заселеності |
| `cascade` | ціна від батька **для кожної** опції |
| `auto` | рахується з основної опції за `auto_rate_settings` |

### 3.3 Стеля розміру об'єкта

Джерело: `api-v.1-documentation/property-size-limits.md`.

| | Готель | Оренда (VR) |
|---|---|---|
| Типів номерів | 20 | 50 |
| Тарифних планів | 200 на об'єкт | 10 на тип номера |
| Заселеність у `per_person` | 18 | 18 |
| Перевищення | $1 за тип номера (макс. $7 на об'єкт); $0.05 за тариф | $0.05 за тариф |

Обмеження змінюються вручну через `support@channex.io`.

🔴 **Живий об'єкт віддає інші три числа.** Свіжостворений `property` з
`property_type: "hotel"` повертає у своїх атрибутах:

| Поле відповіді | Значення на staging | Документація для готелю |
|---|---|---|
| `max_count_of_room_types` | **50** | 20 |
| `max_count_of_rate_plans` | **400** | 200 |
| `max_count_of_occupancies` | **10** | 18 |
| `max_count_of_users` | **20** | не задокументовано |

Два перші **вищі** за документовані, третій — **удвічі нижчий**. Останній і
є той, який може вкусити: `per_person` тариф із 18 опціями заселеності
документація дозволяє, а цей об'єкт — ні. Числа лежать у самому об'єкті,
тобто **питати треба об'єкт, а не документацію**: перед створенням тарифів
читається `GET /properties/{id}` і межі беруться звідти.

Чи це межі саме staging, чи новий тариф для всіх — з відповіді не видно;
питання до `support@channex.io` (§11.1 ТЗ).

**Окреме правило з тієї ж сторінки:** «If you set Room Type to 2 Persons you
cannot create Rate Plan for above 2 persons. It will cause an error»
(`guides/pms-integration-guide.md`).

---

## 4. Наявність, ціни, обмеження (ARI)

Джерело: `api-v.1-documentation/ari.md`.

### 4.1 `POST /api/v1/availability`

| Поле | Тип | Обов'язк. |
|---|---|---|
| `property_id` | uuid | **так** |
| `room_type_id` | uuid | **так** |
| `date` | `YYYY-MM-DD` | так, якщо немає `date_from` |
| `date_from` / `date_to` | `YYYY-MM-DD` | так, якщо немає `date` |
| `availability` | integer ≥ 0 | **так** |

### 4.2 `POST /api/v1/restrictions`

| Поле | Тип | Примітка |
|---|---|---|
| `property_id` | uuid | **обов'язковий** |
| `rate_plan_id` | uuid | **обов'язковий** |
| `date` \| `date_from`+`date_to` | `YYYY-MM-DD` | **минулі дати не дозволені** |
| `days` | array | `mo tu we th fr sa su` — оновити лише ці дні тижня |
| `rate` | string або integer | `"200.00"` **або** `20000` (мінорні одиниці). **Значення має бути > 0**. 🟢 Обидві форми перевірені в одному виклику: `24100` лягло як `"241.00"`, `"312.66"` — як `"312.66"`. 🔴 Цей ключ міняє **тільки основну опцію заселеності**; решта лишаються з попереднім значенням (документація цього не каже). 🔴 **Переміряно 01.09.2026: пастка НЕ обмежена `per_person`.** Тариф `sell_mode: per_room` із трьома опціями, голий `rate: 13000` → `occ1*=130.00, occ2=0.00, occ3=0.00`, відповідь `200 OK` БЕЗ warnings. Тобто ознаки помилки немає взагалі, і раніший запис «на тарифі per_person» звужував умову так, що з нього випливало б, ніби на `per_room` голий `rate` безпечний. 🟡 **Але це наслідок, а не пастка:** на `per_room` опція за контрактом ОДНА (§3, «pass Occupancy Option for maximum occupancy»), тож рух самої лише основної послідовний — зайві опції були наші |
| `rates` | array | `{occupancy, rate}` — ціна на заселеність в одному об'єкті. 🟢 Перевірено: `[{1,5000},{2,6000},{3,7000}]` дало `50.00 / 60.00 / 70.00` на трьох опціях одного тарифу за один виклик |
| `min_stay_arrival` | integer > 0 | |
| `min_stay_through` | integer > 0 | |
| `min_stay` | integer > 0 | віртуальне; **лише якщо `property.settings.min_stay_type` ≠ `both`** |
| `max_stay` | integer ≥ 0 | |
| `closed_to_arrival` | boolean або `0`/`1` | |
| `closed_to_departure` | boolean або `0`/`1` | |
| `stop_sell` | boolean або `0`/`1` | |

«At least one restriction should be present on the request.»

**Читання** (`GET /restrictions?filter[restrictions]=…`) додатково віддає
`availability_offset` і `max_availability` — обидва помічені **Read Only**.

### 4.3 Відповіді

| Ситуація | HTTP | Тіло |
|---|---|---|
| Успіх | `200` | `data: [{id, type: "task"}]`, 🔴 `meta: {"message":"Success"}` — ключа `warnings` при чистому успіху **немає взагалі**, а не порожній масив |
| **Помилка валідації** | **`200`** | `data: []`, `meta.warnings: [ … ]` |
| Частковий успіх | `200` | `data` непорожній **і** `warnings` непорожній |
| Ліміт | `429` | `errors.code = http_too_many_requests` |
| Поганий ключ | `401` | `errors.code = unauthorized` |

Дослівно: «this response will be marked at Success and will have header
`200 OK`. It is happened, because one message can be rejected, but another
will be successfully produced.»

🟢 **Пастка відтворена наживо, і вона гірша, ніж описано.** Один виклик із
трьох значень, де перше правильне, а два хибні:

```
HTTP 200
{"data":[{"id":"…","type":"task"}],
 "meta":{"message":"Success",
         "warnings":[
   {"warning":{"rate":["must be greater than 0"]},
    "date":"2026-12-01","property_id":"…","rate_plan_id":"…","rate":0},
   {"warning":{"min_stay":["property doesn't support `min_stay` restriction, please use `min_stay_through` or `min_stay_arrival`"]},
    "date":"2026-12-01","property_id":"…","rate_plan_id":"…","min_stay":3}]}}
```

Два з трьох значень відхилено — і `meta.message` при цьому дослівно
**`"Success"`**. Перевіркою потім підтверджено: відхилені дати лишились зі
старими цінами, прийняте значення лягло.

Звідси два правила для клієнта:

1. **`meta.message` не є ознакою успіху.** Єдина ознака — `meta.warnings`
   порожній або відсутній. Код, який дивиться на `message`, звітуватиме
   «синхронізовано» про кожну відхилену ціну.
2. **`warnings[].warning` — це об'єкт, а не рядок** 🔴. Форма —
   `{ім'я_поля: [текст, …]}`, тобто `{"rate":["must be greater than 0"]}`.
   Попередня редакція цього інвентаря (і документація) наводила самі тексти,
   ніби `warning` це рядок. Поруч у тому ж елементі лежить **уся відхилена
   вимога цілком** (`date`, `property_id`, `rate_plan_id` і саме поле) — тобто
   для журналу нічого доскладати не треба.

🟢 **Віртуальний `min_stay` відхиляється, поки `min_stay_type: both`** — з
точним текстом вище. Це стосується **сертифікаційного тесту 5**: він
сформульований у стовпці «Min Stay Value», і надісланий як `min_stay` він
на дефолтних налаштуваннях об'єкта не пройде. Або об'єкту ставиться
`min_stay_type` = `arrival`/`through`, або шлеться `min_stay_arrival` /
`min_stay_through`.

**Помилки інвентарю й помилки ARI мають різну форму** 🔴 — і це
найпрактичніший висновок розділу:

| Група ендпоінтів | Невалідне значення |
|---|---|
| `/properties`, `/room_types`, `/rate_plans` | **`422`**, `errors.code = validation_error`, `errors.details.{поле}: [текст]` — падає **весь** запит |
| `/restrictions`, `/availability` | **`200`**, `meta.warnings[]` — інші значення того ж виклику **проходять** |

Тобто один обробник помилок на обидві групи неможливий: у першій ознака —
код статусу, у другій статус завжди `200`.

### 4.4 Ліміти й розміри

Джерело: `api-v.1-documentation/rate-limits.md`,
`guides/best-practices-guide.md`, `guides/pms-integration-guide.md`.

| Факт | Значення |
|---|---|
| Ціни й обмеження | **10 запитів/хв на об'єкт** |
| Наявність | **10 запитів/хв на об'єкт** |
| Разом | 20 ARI/хв |
| Розмір виклику | до **10 МБ**; кількість змін усередині не обмежена |
| Після будь-якої помилки | «pause updates for the property for **1 minute**» |
| Рекомендована пачка | «batch messages per property each **30–60 seconds**»; «combine into 1 api call each 6 seconds» |
| Обробка | FIFO, послідовно; всередині повідомлення діє «Last Win» |
| Наявність окремим повідомленням | «we like to have a separate message for availability. We **push these updates to the front of the queue**» |
| Повний синк | 500 днів, **2 виклики**; дозволено «once every 24h», в непікові години, з паузою між об'єктами |

---

### 4.5 Чим індексований календар — ключова знахідка 🔴

Документація показує відповідь `GET /restrictions` як
`data: { "<id>": { "<дата>": {…} } }` і називає `<id>` ідентифікатором
тарифного плану. **Це не ідентифікатор тарифного плану — це ідентифікатор
опції заселеності.**

Об'єкт із **трьох** тарифних планів (по три, три і дві опції заселеності)
віддав **вісім** ключів. Кожен ключ — одна опція:

| Ключ | Що це |
|---|---|
| `78b0166c…` | BAR, заселеність 2, **основна** — і це водночас `id` самого тарифного плану |
| `749a9f4c…` | BAR, заселеність 3 |
| `fd59bc31…` | BAR, заселеність 1 |
| `47be9969…` | B&B, заселеність 2, основна = `id` тарифного плану B&B |
| ще 4 | решта опцій двох інших тарифів |

Тобто «ціна на тариф і дату» насправді має **три** координати:
тариф → заселеність → дата. Ключ, який ми знаємо як `rate_plan_id`,
адресує лише **основну** заселеність; ціни решти опцій лежать під
ідентифікаторами, які **не повертаються ніде, крім `options[]` самого
тарифу**.

Практичний наслідок: щоб прочитати ціни назад (звірка, екран порівняння,
сертифікаційний тест 1), самих наших `rate_plan_id` **недосить** — треба
спершу забрати `options[]` кожного тарифу і побудувати мапу
`option_id → (тариф, заселеність)`. Інакше п'ять із восьми рядків
відповіді нема з чим зіставити.

**Наявність приходить у ту саму відповідь, але вона спільна.** Обидва
тарифи типу «Double Room» показують `availability: 4`, тариф типу «Twin
Room» — `availability: 5`; ставилась вона `POST /availability` на
`room_type_id`. Тобто **наявність належить типу номера, ціна й обмеження —
опції тарифу**, і в одній відповіді вони просто лежать поруч.

Ще одне поле відповіді, якого немає в документації 🔴:
`unavailable_reasons: []` — приходить у кожному дні поряд з `availability`.

---

## 5. Бронювання

Джерело: `api-v.1-documentation/bookings-collection.md`.

**Стрічка:** `GET /api/v1/booking_revisions/feed` — лише **непідтверджені**
ревізії. Фільтр `filter[property_id]=…`; порядок `order[inserted_at]=asc`
(не типовий, треба просити). Підтвердження:
`POST /api/v1/booking_revisions/:id/ack`.

Непідтверджена ревізія віддається **30 хвилин**, далі — лист і подія
`non_acked_booking`.

### 5.1 Поля ревізії

| Поле | Що це |
|---|---|
| `id` | ідентифікатор **ревізії**, змінюється |
| `booking_id` | ідентифікатор **бронювання**, стабільний між ревізіями |
| `property_id` | об'єкт |
| `unique_id` | код OTA + код броні; «usually same for all booking revisions» |
| `system_id` | унікальний **на ревізію**; «Used to detect have we that message or not» |
| `ota_reservation_code` | код броні в OTA |
| `ota_name` | назва OTA |
| `status` | `new`, `modified`, `cancelled` |
| `rooms[]` | Booking Room |
| `services[]` | Booking Service |
| `guarantee` | картка (див. §7) |
| `customer` | дані гостя |
| `occupancy` | `adults`, `children`, `infants` |
| `arrival_date`, `departure_date` | `YYYY-MM-DD` |
| `arrival_hour` | `HH:MM`, 24 год |
| `amount`, `currency` | сума й валюта |
| `notes` | нотатки гостя |
| `payment_collect` | `property`, `ota`, `null` (`null` зазвичай = платить об'єкт) |
| `payment_type` | `credit_card`, `bank_transfer`, `null` |
| `ota_commission` | «Currently available for Booking.com and Airbnb channels» |
| `inserted_at` | коли Channex отримав ревізію |

### 5.2 Поля Booking Room

| Поле | Примітка |
|---|---|
| `checkin_date`, `checkout_date` | `YYYY-MM-DD` |
| `room_type_id` | **`null`, якщо номер не змаплено** |
| `rate_plan_id` | **`null`, якщо номер не змаплено** |
| `occupancy` | `adults`, `children`, `infants`; при `children > 0` є `ages[]` |
| `guests[]` | імена, якщо OTA їх дає |
| `services[]`, `taxes[]` | — |
| `collected_taxes[]` | **лише Booking.com** |
| `amount` | сума за номер |
| `days` | розбивка по днях: `{"2019-05-09": "100.00"}` — **рядок** |
| `meta` | може містити `parent_rate_plan_id` — справжній тариф, коли бронь на похідному тарифі або опції заселеності |
| `ota_unique_id` | «right now only Booking.com supported» |

---

## 6. Листування

Джерело: `api-v.1-documentation/messages-collection.md`.

**Підтримка:** «Booking.com, Expedia and Airbnb (**only these 3 channels are
supported currently**)». Бронювання через **Expedia Partner Solutions
(Expedia Affiliate Network) не підтримують Messages API взагалі**.

Вмикається встановленням застосунку на об'єкт (`applications-api.md`,
код `channex_messages`).

| Об'єкт | Поле | Значення |
|---|---|---|
| Message | `message` | текст; може бути порожнім, якщо є `attachments` |
| | `attachments[]` | посилання |
| | `sender` | **`guest`** або **`property`** |
| | `inserted_at`, `updated_at` | час |
| Message Thread | `title` | зазвичай ім'я гостя |
| | `is_closed` | boolean |
| | `provider` | `BookingCom`, `Airbnb`, `Expedia` ⓘ у прикладі відповіді трапляється `AirBNB` |
| | `message_count` | integer |
| | `last_message` | Message |
| | `last_message_received_at` | час |

**Дії:** `POST /api/v1/message_threads/:id/messages` (тіло
`{"message": {"message": "…"}}`), `.../no_reply_needed` (порожнє тіло,
**лише Booking.com**), закриття нитки.

**Нитка без бронювання:** запит Airbnb («Inquiry») — «will be represented as
a Message Thread **without associated booking**». Прив'язка приходить
подією `message_thread_booking_assigned`.

`message_thread_id` бронювання лежить у
`relationships.message_thread.data.id` відповіді `GET /bookings/:id`.

---

## 7. Картки

Джерело: `guides/guide-to-pci.md`, `bookings-collection.md`.

- «To get card details from Channex you must be PCI compliant or use a 3rd
  party PCI tokenisation system. **If you are not PCI compliant you can use
  Channex but we will not provide you with any card details.**»
- Доказ відповідності: **SAQ D (Service Provider) AOC, рівня 1 або 2, не
  старший за 12 місяців**; або AOC токенізатора.
- Названі токенізатори: Vaultera, PCI Booking, PCI Proxy.
- Окремий хост: `secure-staging.channex.io` / `secure.channex.io`, плюс
  білий список IP через `support@channex.io`.
- Поля `guarantee` (для тих, хто має доступ): `card_number` (маскований),
  `card_type`, `cardholder_name`, `cvv`, `expiration_date`, `is_virtual`,
  `meta` (для віртуальних карток — валюта, баланс, дати).

---

## 8. Канали

### 8.1 Дескриптор адаптера

`GET /api/v1/channels/adapter?code={code}`; каталог —
`GET /api/v1/channels/list`. Джерело: `api-v.1-documentation/channel-api.md`.

| Поле дескриптора | Тип | Значення |
|---|---|---|
| `code`, `title` | string | код і назва |
| `kind` | enum | **`ota`, `meta`, `cm`** |
| `params` | object | поля форми **підключення**, за іменем |
| `rate_params` | object | поля форми **мапінгу**, за іменем |
| `mapping_mode` | enum | **`room_rate_multioccupancy`, `direct`, `listing`, `tree`** |
| `message_support` | boolean | чи підтримує листування |
| `property_mapping` | enum | **`single`** або **`multiple`** — один об'єкт на підключення чи кілька |
| `actions` | array | «Possible values: `load_future_reservations`» |

Тип поля форми (`params[*].type`): **`string`, `boolean`, `integer`,
`number`, `select`, `switch`, `password`, `hidden`, `slug`**. Поле має
`position`, `title`, `default`, `options` (для `select`/`switch`) і `rules`
(умовне приховування залежно від іншого поля).

> `message_support` і `mapping_mode` — машинозчитувані. Тобто «який канал
> уміє листування» і «як він мапиться» **не треба зашивати**: адаптер
> відповідає сам.

### 8.2 Об'єкт підключення (`channel`)

`POST /api/v1/channels`. Обов'язкові: **`channel`, `group_id`, `settings`**.

| Поле | Примітка |
|---|---|
| `channel` | код адаптера |
| `group_id` | uuid групи |
| `title` | генерується з назв каналу й об'єкта, якщо не задано |
| `properties[]` | uuid; при `property_mapping: single` приймається один |
| `currency` | «For channels that report their own currency, **the reported currency wins**» |
| `is_active` | **не має ефекту при створенні**: підключення завжди створюється вимкненим |
| `settings` | ключі визначає адаптер (`params`), плюс `derived_option` |
| `rate_plans[]` | мапінги; можна додати пізніше |
| `expected_removal_date` | дата планового видалення або `null` |
| `actions[]` | що можна викликати через `POST /channels/{id}/execute/{action}` |

**Життєвий цикл:** `POST /channels` → `POST /channels/{id}/check_readiness`
→ `POST /channels/{id}/activate` → `…/deactivate` → `DELETE` (лише
вимкнене). Мапінг знімається надсиланням його з `settings: null`.

`check_readiness` повертає перелік перешкод: `entity` (напр. `Channel`),
`relation` (напр. `Mapping`), `error_code` (напр. `required`).

Допоміжні виклики: `POST /channels/test_connection` (перевірити налаштування,
підключення не створюється), `POST /channels/mapping_details` (кімнати й
тарифи **на боці каналу**), `POST /channels/connection_details` (деталі
рівня підключення — напр. валюта; для деяких каналів — список доступних
об'єктів/контрактів).

Наш бік для мапінгу: `GET /api/v1/room_types/options?filter[property_id]=…`
і `GET /api/v1/rate_plans/options?filter[property_id]=…&multi_occupancy=true`.

### 8.3 Налаштування кожного каналу

Коди каналів: **BDC** Booking.com, **ABB** Airbnb, **VRB** VRBO
(`api-v.1-documentation/channel-codes.md`).

#### Booking.com (`BookingCom`)

Джерело: `channel-api-examples/booking.com.md`.

`kind`: `meta` · `actions`: `load_future_reservations`

| `params` (підключення) | Тип | Дефолт | Примітка |
|---|---|---|---|
| `hotel_id` | string | — | ID об'єкта в Booking.com |
| `machine_account` | **hidden** | — | Machine Account ID |
| `send_email_notifications` | boolean | `false` | — |
| `email` | string | — | приховується, коли `send_email_notifications` = false |

| `rate_params` (мапінг) | Тип | Значення |
|---|---|---|
| `rate_plan_code` | string | код тарифу в Booking.com |
| `room_type_code` | string | код номера в Booking.com |
| `occupancy` | integer | заселеність |
| `pricing_type` | select | **`Standard`, `OBP`** |
| `primary_occ` | boolean | основна заселеність |
| `readonly` | boolean | — |

`channel_restrictions` у прикладі: `currency: EUR`, `min_price: 500`.

Підключення з боку готелю (`channel-mapping-guides/booking.com.md`): в
екстранеті Account → Connectivity Provider, вибір Channex, згода з XML
Service Agreement, стан очікування, доки Channex не прийме. Попередження
звідти ж: «Once you connect a channel manager to Booking.com you should
check the settings of all derived rates… as they might be changed
automatically by booking.com.»

#### Airbnb (`ABB`)

Джерело: `channel-api-examples/airbnb.md`, `channel-mapping-guides/airbnb.md`.

**Підключення — OAuth, а не форма.** Генерується посилання, власник
відкриває його, авторизує Channex, підключення створюється автоматично й
**вимкненим**. Посилання живе **2 години**. Після успіху редірект на
`redirect_uri` з `?success=true&channel_id={id}&token={token}`, після
невдачі — на `failure_redirect_uri` з `?success=false`. Поле `token` —
довільне наше значення для зв'язки із сесією.

Один акаунт Airbnb = одне підключення. Переприєднання — нове посилання з
тим самим `channel_id`.

| `settings` підключення | Значення |
|---|---|
| `min_stay_type` | **`Arrival` або `Through`** — «Airbnb supports a **single** minimum-stay type» |
| `booking_amount_settings` | **`Payout Amount` або `Total Paid Amount`** — яку суму зберігати на броні |
| `cohost_payout_calculations` | boolean — зменшувати суму на комісію співхоста |
| `send_email_notifications` | boolean |
| `email` | адреса для сповіщень |

**Мапінг** — не масивом `rate_plans`, а **по одному лістингу** через
`POST /channels/{channel_id}/mappings`. Лістинги: `id`, назва, тип,
розташування, опції заселеності, статус якості, категорія синхронізації.
Лістинги без назви не віддаються.

Через підключення керуються також самі лістинги: ціни, правила
доступності, налаштування бронювання, стан публікації, промоакції.

З гайда інтерфейсу: потрібен доступ до акаунта власника, або кнопка
**Copy Link** — надіслати посилання власнику. Заважає вже підключений
інший channel manager; заважає непідтверджений email хоста.

#### VRBO (`VRB`)

**Гайда рівня API немає.** У `channel-api-examples/` VRBO відсутній —
є лише інтерфейсний `channel-mapping-guides/vrbo.md`. Отже `params`,
`rate_params`, `mapping_mode` і `message_support` для VRBO —
**не задокументовані** і читаються з живого
`GET /api/v1/channels/adapter?code=VRB`.

Що каже інтерфейсний гайд:

| Факт | Значення |
|---|---|
| Підключення | **Username + Password** акаунта VRBO, кнопка Authenticate, потім **SMS-код 2FA** власника, потім Test Connection |
| Мапінг | **на лістинги**: кожному лістингу — номер і тариф |
| Валюти | USD, CAD, EUR, AUD, NZD, JPY, SGD, BRL, MXN, GBP |
| Підтримується | ARI, бронювання (нові, змінені, скасовані) |
| **Не підтримується** | **Messages, Reviews** («Not supported yet») |
| Відома проблема | канал сам відключається, коли користувач змінює пароль |
| Передумова | акаунт не має бути під'єднаний до попереднього ПЗ по XML API; iCal-з'єднання треба прибрати, бо вони перезаписують надіслане Channex |

#### Зведення по трьох каналах

| | Booking.com | Airbnb | VRBO |
|---|---|---|---|
| Код | BDC | ABB | VRB |
| Спосіб підключення | форма (`hotel_id`) + дія в екстранеті | OAuth-посилання | логін, пароль, SMS 2FA |
| Модель мапінгу | код номера + код тарифу + заселеність | **лістинг ↔ тариф, по одному** | лістинг ↔ номер + тариф |
| Скільки тарифів | багато | — | — |
| Листування | так | так | **ні** |
| Відгуки | не задокументовано тут | не задокументовано тут | **ні** |
| `min_stay` | обидва типи | **лише один**, обирається | не задокументовано |
| Створюється активним | ні | ні | не задокументовано |
| API-гайд | є | є | **немає** |

### 8.4 «Primary rate» і «один тариф» — точні формулювання

Обидва твердження в документації є, але вужчі, ніж звучать переказом.

**Booking.com, `channel-mapping-guides/booking.com.md:132`**, у розділі
*Occupancy Based Mapping*:

> «**Primary Rate** — This will be the rate plan that sends the restrictions
> such as min stay or stop sell. Since it is only one rate plan in
> booking.com.»

Тобто це про мапінг **за заселеністю**: коли один тип номера мапиться
кількома заселеностями, обмеження несе одна з них. У дескрипторі адаптера це
булеве поле `primary_occ` («Primary Occupancy»), не окрема сутність
«primary rate plan». Змінюється наведенням на іншу опцію заселеності.

**Airbnb, `channel-mapping-guides/airbnb.md:87`**:

> «You must choose **both a room and a rate plan**.»

Мапінг **на лістинг**: кожен лістинг Airbnb отримує один номер і один
тариф. Це «один тариф **на лістинг**», а не «один тариф на об'єкт» — акаунт
може мати багато лістингів, і одне підключення обслуговує кілька об'єктів
(`property_mapping`).

Порада звідти ж: якщо ціна залежить від кількості гостей, мапити треба
тариф **найменшої** заселеності («map your lowest occupancy rate plan like
the 1 person rate»), бо доплата за особу налаштовується далі в самому
лістингу.

---

## 9. Channel iFrame

Джерело: `api-v.1-documentation/channel-iframe.md`.

**Крок 1 — разовий токен:**
`POST /api/v1/auth/one_time_token` з тілом
`{"one_time_token": {"property_id": …, "group_id": …, "username": …}}`.
Відповідь: `data.token`.

| Факт | Значення |
|---|---|
| Час життя токена | **15 хвилин**, **одноразовий** |
| Після завантаження iframe | **терміну дії немає** |
| Під ким працює користувач | «under the **same user, who requested the Access Token**» |
| `username` | ім'я користувача, залогіненого в нашій PMS |

**Крок 2 — сам iframe:**

```
{{server}}/auth/exchange?oauth_session_key={{TOKEN}}&app_mode=headless&redirect_to=/channels&property_id={{PROPERTY_ID}}
```

| Параметр | Що робить |
|---|---|
| `redirect_to` | яку сторінку Channex показати |
| `property_id` | об'єкт, з яким працює екран |
| `group_id` | група для нового каналу |
| `channels=BDC,ABB` | і фільтрує список, **і** обмежує, що можна підключити |
| `channels_filter` | фільтрує **лише показ** |
| `available_channels` | обмежує **лише підключення** |
| `lng=XX` | `en`, `pt`, `es`, `ru`, `de`, `el`, `it`, `hu`, `th` — **українську не підтримано** |
| `allow_notifications_edit=true` | показати налаштування сповіщень (у вбудованому режимі приховані) |
| `messages_show_booking=true` | кнопка «відкрити бронювання» на екрані повідомлень |
| `read_only_availability=true` | заборонити редагування наявності на екрані інвентарю |
| `hide_messages_attach_btn=true` | сховати кнопку вкладення в повідомленнях |

**Які сторінки можна вбудувати:** «This API will allow you to **iframe any
page from Channex**, you will need to edit the redirect. All pages will
generally work with property ID option.» Названі прямо: `/channels`,
`/messages`, `/messages/{message_thread_id}`. Наявність прапорця
`read_only_availability` означає, що екран інвентарю теж вбудовується.

**Обмеження, назване документацією:** «The provided iframe UI is limited and
only allows the user to **create / edit / remove channels** with the provided
Property ID. There is **no access policy yet** for example "Read-Only" mode.»

### 9.1 Що робить екран `/channels`

Джерело: `application-documentation/channels-management.md` і три
інтерфейсні гайди каналів.

| Дія на екрані | Є |
|---|---|
| Створити підключення (форма / OAuth / логін-пароль) | так |
| **Мапінг номерів і тарифів** | так — «Edit → Goes into the channel connection settings page»; у гайдах Booking.com, Airbnb і VRBO мапінг робиться саме там |
| Налаштування каналу | так |
| Переглянути логи каналу | так |
| Увімкнути / вимкнути | так |
| **Full Sync** (500 днів) | так |
| **Pull Future Bookings** | так — лише Booking.com, Expedia, Airbnb |
| Видалити підключення | так, лише вимкнене |

### 9.2 Чого на екрані `/channels` немає

Факти, не висновки:

- Токен видається **на вже наявний `property_id`** — отже об'єкт, типи
  номерів і тарифи мусять існувати до відкриття iframe.
- ARI (`/availability`, `/restrictions`) — окремі виклики API; iframe їх не
  робить.
- Стрічка бронювань і підтвердження (`/booking_revisions/feed`, `/ack`) —
  окремі виклики API.
- Вебхуки (`/webhooks`) — окремі виклики API.
- Відповідності «наш ідентифікатор ↔ ідентифікатор Channex» iframe не знає:
  він працює всередині Channex.

### 9.3 Чи потрібен White Label для Channel API

**Твердження не підтверджується.** Пошук `white.?label` по всіх 111
сторінках дає **чотири** входження, і жодне не про доступ до Channel API:

| Файл | Контекст |
|---|---|
| `about-channex-and-faq.md:27` | про ринок: інші компанії готові дати PMS white label |
| `about-channex-and-faq.md:29` | «We only offer white label services to PMS» — модель продажу |
| `changelog.md:1347` | «Add new White Label Feature flags» |
| `changelog.md:1563` | «Add White Label Domain settings» |

Сторінка `channel-api.md` описує авторизацію як `user-api-key` і не
згадує жодного тарифу чи рівня акаунта.

Єдине обмеження доступу, знайдене в документації, — про **ключі API
взагалі**, не про Channel API: «This feature is not available for all Users
by default, to enable it you will need to have an active subscription… **In
Staging Server it is available to all users**»
(`application-documentation/api-key-access.md`).

Окремо: на `channex.io/pricing` тариф **один** («One plan · no tiers»), і
він називається WhiteLabel. Тобто розрізнення «White Label проти не-White
Label» у їхній продуктовій лінійці не існує.

---

## 10. Вебхуки

Джерело: `api-v.1-documentation/webhook-collection.md`.

| Поле | Тип | Дефолт |
|---|---|---|
| `callback_url` | string (uri) | — (обов'язкове) |
| `event_mask` | string | — (обов'язкове); `*` або перелік через `;` |
| `property_id` | uuid \| null | — (обов'язкове); `null` лише для глобального |
| `request_params` | object&lt;string&gt; \| null | — додаткові GET-параметри |
| `headers` | object&lt;string&gt; \| null | — власні заголовки запиту |
| `is_active` | boolean | **`false`** |
| `send_data` | boolean | **`false`** |
| `protected` | boolean | `false` |
| `is_global` | boolean | `false` |

- «By default, webhooks are scoped to a **single property**.»
- Глобальний і property-рівневий на ту саму подію → приходить **один**,
  **перемагає property-рівневий**.
- **Підпису немає:** «Channex webhooks currently **do not include a built-in
  HMAC signature** or cryptographic signing mechanism». Рекомендовано:
  власний заголовок-секрет (приклад із документації —
  `X-Channex-Webhook-Secret`), HTTPS, за бажанням білий список IP, власна
  ідемпотентність.
- **Повтори лише на `5XX`**: 1, 2, 4, 8, 15, 30 хв, 1, 2, 4, 6, 10 год —
  максимум **11 спроб**, остання ≈ через добу.
- **Порядок не гарантований:** «Sequence of incoming webhook calls can be
  different from sequence of events which trigger that calls. **Webhooks may
  come out of order.**» Рекомендація звідти ж — використовувати вебхук як
  тригер, щоб піти по стан.
- Подія `ari` містить `user_id` того, хто зробив зміну — «useful if you would
  like to **ignore changes made by your own app**».

**Події:** `ari`, `booking`, `booking_new`, `booking_modification`,
`booking_cancellation`, `booking_unmapped_room`, `booking_unmapped_rate`,
`non_acked_booking`, `message`, `sync_error`, `sync_warning`, `rate_error`,
`reservation_request`, `alteration_request`, `accepted_reservation`,
`declined_reservation`, `inquiry`, `review`, `updated_review`,
`new_channel`, `updated_channel`, `disconnect_channel`, `disconnect_listing`,
`activate_channel`, `deactivate_channel`, `channel_removal_warning`,
`property_removal_warning`, `message_thread_booking_assigned`.

`booking_unmapped_room` **глушить** `booking_unmapped_rate`.

---

## 11. Правила доступності (буфер інвентаря)

Джерело: `api-v.1-documentation/availability-rules-collection.md`,
`application-documentation/availability-rules.md`.

`POST /api/v1/channel_availability_rules`, тіло під ключем
`channel_availability_rule`.

| Поле | Значення |
|---|---|
| `type` | **`close_out`, `availability_offset`, `max_availability`** |
| `value` | integer; **обов'язковий лише** для `availability_offset` і `max_availability` |
| `affected_channels[]` | uuid каналів |
| `affected_room_types[]` | uuid типів номерів |
| `start_date`, `end_date` | діапазон |
| `days[]` | `mo tu we th fr sa su` |
| `property_id` | uuid |
| `title` | назва правила |

- `availability_offset`: значення **віднімається** від наявності типу номера
  на боці Channex.
- `max_availability`: стеля значення, що йде в OTA.
- В інтерфейсі: сторінка Inventory → Actions → Availability Rules.

---

## 12. Ретенція на боці Channex

Джерело: `guides/channex-retention-periods.md`.

| Що | Скільки |
|---|---|
| Бронювання | 3 місяці після виїзду — видаляється |
| Дані картки | 7 днів після виїзду або скасування; «if booking is acknowledged no CC provided via API» |
| Журнал об'єкта | 3 місяці |
| Журнал каналу | 3 місяці |
| Журнал вебхуків | 7 днів |
| Live Feed | 1 місяць |
| Об'єкт без каналу | **90 днів — видаляється** |
| Канал у вимкненому стані | **1 місяць — видаляється** |

Попередження приходять подіями `property_removal_warning` (30, 7, 1 день) і
`channel_removal_warning` (7 і 1 день).

---

## 13. Сертифікація

Джерело: `api-v.1-documentation/pms-certification-tests.md`.

П'ять стадій; вирішальна — **четверта: живий дзвінок із демонстрацією
екрана**, де просять змінити ціну в UI нашої PMS і дивляться, чи полетів
виклик із робочого шляху.

**Підстави для відмови, названі дослівно:** окремий скрипт/CLI/Postman із
значеннями з таблиць; «сертифікаційний UI»; повний синк за таймером замість
дельт; виклик на дату або на тариф там, де сказано «1 API call»; захардкожені
UUID або значення з документа в продакшн-шляху; логіка інтеграції в тестових
файлах.

Тести: 1 повний синк (500 днів, 2 виклики) · 2 одна дата один тариф ·
3 одна дата кілька тарифів (1 виклик) · 4 діапазони кілька тарифів
(1 виклик) · 5 min stay (1 виклик) · 6 stop sell (1 виклик) ·
7 кілька обмежень (1 виклик) · 8 пів року (1 виклик) · 9–10 наявність
(1–2 виклики) · 11 бронювання: створення, зміна, скасування **з ack** ·
12 ліміти · 13 дельти, не таймер · 14 анкета можливостей.

Окремо: «please, be sure that you **do not use `GET api/v1/bookings...`
endpoints, use `GET api/v1/booking_revisions...` instead**».

Форма: <https://forms.gle/xA8F3eSYBPBd8apYA>. Термін інтеграції за
`channex.io/pricing` — «typically 2–4 weeks».

---

## 14. Живий API проти документації — зведення (31 серпня 2026)

Крок 3 з [§0.1 ТЗ](../../CHANNEX-INTEGRATION.md). Ключ staging перевірено,
через API створено об'єкт-пісочницю: один `property`, два типи номерів,
на одному з них два тарифи — «Best Available Rate» і «Bed & Breakfast», —
тобто рівно конфігурація сертифікаційних тестів 3 і 4. Далі на ній
прогнано тести 4 і 7 і кілька навмисно хибних запитів.

**Головне питання, заради якого це робилось**, — чи можна двом тарифам
одного типу номера задати **незалежні** ціни на ту саму дату. Відповідь:
**так, і Channex іншого способу не має.** Доказ — §14.1.

### 14.1 Доказ незалежності цін

Один `POST /restrictions`, три значення, діапазони перетинаються
(сертифікаційний тест 4 дослівно). Прочитано назад на 2026-11-13, коли
обидва діапазони по «Double Room» діють одночасно:

| Тип номера | Тариф | `rate` | `min_stay_through` | `closed_to_arrival` | `availability` |
|---|---|---|---|---|---|
| Double Room | Best Available Rate | **312.66** | 2 | true | 4 |
| Double Room | Bed & Breakfast | **111.00** | 10 | false | 4 |
| Twin Room | Best Available Rate | 90.00 | 1 | false | 5 |

Два перші рядки — **один тип номера, одна дата, різні ціни, різні
обмеження**. Наявність при цьому спільна (4), бо належить типу номера.
Жодного відсотка, жодного модифікатора: значення задані незалежно й
незалежно ж прочитані.

Порядок цін у Channex, як він є насправді:

```
тип номера ──> наявність (одна на всіх)
   └─ тариф ──> опція заселеності ──> дата ──> ціна + обмеження
```

Чотири рівні, з яких у нашій `price_calendar` є **два** (тип номера, дата).

### 14.2 Перелік розбіжностей

| № | Місце | Документація | Живий API |
|---|---|---|---|
| 1 | `GET /restrictions`, ключ `data` | ідентифікатор **тарифного плану** | ідентифікатор **опції заселеності**; 3 тарифи дали 8 ключів (§4.5) |
| 2 | `rate_plan.options[].id` | поля немає | є; в **основної** опції збігається з `id` тарифного плану |
| 3 | `rate_plan.title` | «unique within property» | **не унікальний**: другий однойменний тариф на іншому типі номера створюється (`201`) |
| 4 | `derived_option` | у всіх прикладах `null` | `null` лише в основної; у неосновних `{"rate": []}` навіть при `rate_mode: manual` |
| 5 | `options[]`, порядок | не сказано | не той, що надіслали, і не за `occupancy`: основна перша |
| 6 | `options[].rate` | integer в обидва боки | вхід — мінорні одиниці (`10000`), вихід — рядок `"100.00"` |
| 7 | `options[].rate` | «ціна для цієї заселеності» | **засіває календар на всі майбутні дати**, а не лише дефолт |
| 8 | `options[].inherit_*` | на рівні опції не описані | вісім прапорців; дефолт залежить від `is_primary` (основна — `false`, решта — `true`) |
| 9 | `rate` у `POST /restrictions` на `per_person` | не уточнено | міняє **лише основну** опцію заселеності |
| 10 | `meta` при успіху | `warnings: []` | `{"message":"Success"}`; ключа `warnings` немає |
| 11 | `meta.message` при частковому провалі | не описано | дослівно `"Success"`, хоча значення відхилені |
| 12 | `warnings[].warning` | рядок із текстом | **об'єкт** `{поле: [текст]}` |
| 13 | помилки `/rate_plans` тощо | не зведено | `422` + `errors.details`, падає весь запит — на відміну від ARI |
| 14 | `max_count_of_room_types` | 20 (готель) | **50** |
| 15 | `max_count_of_rate_plans` | 200 на об'єкт | **400** |
| 16 | `max_count_of_occupancies` | 18 | **10** — удвічі нижче |
| 17 | `occ_children`, `occ_infants` | «integer > 0», обов'язкові | `0` приймається |
| 18 | `POST /properties`, `/room_types`, `/rate_plans` | приклади показують `200` | `201` |
| 19 | `settings.cut_off_time` | дефолт `00:00:00` | `null` |
| 20 | поля відповідей | — | не описані: `property_category`, `location_precision`, `is_active`, `acc_channels_count`, `expected_removal_date`, `position` і `codes` у типі номера, `rate_category_id` і `ui_read_only` у тарифі, `unavailable_reasons` у календарі |
| 21 | межі частоти (`rate-limits.md`) | 10 цін + 10 наявності на хвилину на обʼєкт, `429` | **на staging не діє**: 27 викликів за 8 с на один обʼєкт у двох смугах (12 + 15), кожен окремим клієнтом — жодного `429` (01.09.2026, `channex-ari-live.mjs --probe-429`) |
| 22 | `stop_sell: true` без `rates` у `POST /restrictions` | не описано, що з ціною | ціна в календарі ЛИШАЄТЬСЯ останньою (`1650.00` поруч із `stop_sell: true`); «закрито» означає «не продавати», а не «ціни немає» |
| 23 | `POST /webhooks/test`, відповідь | `{ status_code, body }` (OpenAPI на сторінці) | **`{ status, body, headers }`** — поле зветься `status` (02.09.2026). Клієнт читав документоване `status_code`, діставав 0 і не падав; звідси інваріант 28 і реєстр `live-fields.json` проти зразків у `live/` |
| 24 | `GET /restrictions` при нульовій наявності | не описано | `stop_sell` читається `true`, поки `availability` типу нуль — попри `stop_sell: false` із ціною в `POST /restrictions`; знімає його `POST /availability`, не прапорець. Поруч: ніч без ціни — `rate: "0.00"`; `max_stay: 0` — «без межі»; `min_stay` на записі повертається як `min_stay_arrival` + `min_stay_through` (живе 02.09.2026, звірка П6) |

### 14.3 Підтверджене, не спростоване 🟢

- обидві форми ціни (`24100` і `"312.66"`) приймаються в одному виклику;
- `date_from`/`date_to` **включають обидві межі**: діапазон 10–16 листопада
  дав нову ціну і на 10-те, і на 16-те, а 17-те лишилось попереднім;
- `rates: [{occupancy, rate}]` задає всі заселеності одного тарифу за один
  виклик;
- три значення з різними тарифами й різними діапазонами йдуть **одним**
  викликом і повертають **одну** задачу — тобто вимога сертифікації «1 API
  call» здійсненна саме так;
- заселеність тарифу понад `occ_adults` типу — помилка `422`;
- віртуальний `min_stay` відхиляється, поки `min_stay_type: both`.

Батчером, 01.09.2026 (`scripts/channex-ari-live.mjs`, один прохід, читання
назад за мапою опцій):

- `rates: [{occupancy, rate}]` **разом із `stop_sell: false`** в одному
  значенні кладе ціну на кожну опцію І знімає липкий прапорець шапки — 21 з
  21 клітинок тариф × заселеність × дата, одним викликом на 9 координат;
- `POST /availability` лягає як `availability` тієї самої відповіді
  `GET /restrictions` на кожній опції типу — 4 і 2, звірено;
- `stop_sell: true` без `rates` закриває ніч і лишає останню ціну поруч
  (розбіжність 22) — «закрито» в обидва боки тим самим шляхом.

### 14.4 Чого цей прогін НЕ перевіряв

Щоб наступний не вважав перевіреним те, що ним не є:

- **канали**: жодного OTA не підключено, `acc_channels_count` = 0. Усе в
  §8 і §9 лишається за документацією;
- **бронювання й вебхуки** (§5, §6, §10): нічого не надсилалось і не
  приймалось;
- **`rate_mode`** `derived`, `auto`, `cascade`: створювались лише `manual`
  тарифи, тож поведінка похідних цін — досі проза;
- **`sell_mode: per_room`**: обидва тарифи створені `per_person`;
- **межі частоти** (10/хв): ~~виклики робились поодинці, `429` не бачили~~ — **01.09 перевищено навмисно: 27 за 8 с, `429` не отримано** (розбіжність 21). Тобто `429` не бачив ніхто, і на staging його, схоже, не побачити;
- **обмеження розміру об'єкта**: числа прочитані з відповіді, а не
  досягнуті;
- **iFrame** (§9): токен не запитувався.

### 14.5 Об'єкт-пісочниця

Живе в staging-акаунті власника. Іменований нейтрально й навмисно не
містить даних жодного готелю: `ALiSiO Integration Sandbox`, типи номерів
`Twin Room` і `Double Room` — назви взяті з таблиць сертифікаційних тестів.

> **Він зникне за 90 днів** без підключеного каналу (§12), і це нормально:
> він відтворюваний з цього розділу за чотири виклики. Ідентифікатори тут
> навмисно не записані — вони протухнуть разом з об'єктом, а прив'язаний до
> них текст перетворить інвентар на пастку.

> ⚠️ **У тому ж staging-акаунті вже є об'єкт справжнього готелю** — з його
> назвою, адресою, телефоном і GPS. Створений не цією сесією. Він **не
> згадується в репозиторії ніде**: половина його полів — рівно ті рядки, що
> їх ловить `check-no-tenant-names`. Хто працює з цим акаунтом далі —
> фільтрує `GET /properties` за потрібним `id`, а не переносить відповідь у
> код, тест чи фікстуру.
