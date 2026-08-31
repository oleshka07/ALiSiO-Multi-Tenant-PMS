# Інвентар Channex — що є, а не що робити

**Знято 30 серпня 2026** з копії в цій теці. Кожен рядок можна перевірити
`grep`-ом по сусідніх файлах; посилання дано на файл, а не на сайт.

## Як читати

Це **перелік фактів**, а не технічне завдання. Тут навмисно немає наших
висновків, схеми, назв наших таблиць і слова «треба». Рішення живуть у
[docs/CHANNEX-INTEGRATION.md](../../CHANNEX-INTEGRATION.md) і мусять
посилатися сюди, а не навпаки.

| Позначка | Значення |
|---|---|
| — | документація мовчить: **не задокументовано**, не додумано |
| ⓘ | факт із документації, який суперечить іншому місцю документації |

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

---

## 2. Тип номера (`room_type`)

`POST /api/v1/room_types`. Джерело: `api-v.1-documentation/room-types-collection.md`.

| Поле | Тип | Обов'язк. | Дефолт | Значення / межі |
|---|---|---|---|---|
| `property_id` | uuid | **так** | — | — |
| `title` | string | **так** | — | 1–255 |
| `count_of_rooms` | integer > 0 | **так** | — | «**affects billing if the property is a Vacation Rental**» |
| `occ_adults` | integer > 0 | **так** | — | дорослих спальних місць |
| `occ_children` | integer > 0 | **так** | — | місць **лише для дітей**; якщо таких немає — `0` |
| `occ_infants` | integer > 0 | **так** | — | дитячих ліжечок |
| `default_occupancy` | integer > 0 | **так** | — | **не більше за `occ_adults`** |
| `facilities` | array&lt;uuid&gt; | ні | — | — |
| `room_kind` | enum | ні | — | `room`, `dorm` |
| `capacity` | integer | ні | — | ліжок у фізичній кімнаті; **лише для `dorm`** |
| `content` | object | ні | — | як у property |

---

## 3. Тарифний план (`rate_plan`)

`POST /api/v1/rate_plans`. Джерело: `api-v.1-documentation/rate-plans-collection.md`.

| Поле | Тип | Обов'язк. | Дефолт | Значення |
|---|---|---|---|---|
| `title` | string | **так** | — | 1–255, **унікальний у межах об'єкта** |
| `property_id` | uuid | **так** | — | — |
| `room_type_id` | uuid | **так** | — | — |
| `options` | array | **так** | — | масив Occupancy Option |
| `tax_set_id` | uuid | ні | Tax Set об'єкта | — |
| `parent_rate_plan_id` | uuid | ні | — | — |
| `currency` | string | ні | валюта об'єкта | ISO 4217; «Property can have Rate Plans with different Currencies» |
| `sell_mode` | enum | ні | `per_room` | `per_room`, `per_person` |
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

| Поле | Тип | Примітка |
|---|---|---|
| `occupancy` | integer | скільки осіб |
| `is_primary` | boolean | основна опція |
| `derived_option` | object \| null | як виводиться з основної |
| `rate` | integer | ціна для цієї заселеності |

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
| `rate` | string або integer | `"200.00"` **або** `20000` (мінорні одиниці). **Значення має бути > 0** |
| `rates` | array | `{occupancy, rate}` — ціна на заселеність в одному об'єкті |
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
| Успіх | `200` | `data: [{id, type: "task"}]`, `meta.warnings: []` |
| **Помилка валідації** | **`200`** | `data: []`, `meta.warnings: [ … ]` |
| Частковий успіх | `200` | `data` непорожній **і** `warnings` непорожній |
| Ліміт | `429` | `errors.code = http_too_many_requests` |
| Поганий ключ | `401` | `errors.code = unauthorized` |

Дослівно: «this response will be marked at Success and will have header
`200 OK`. It is happened, because one message can be rejected, but another
will be successfully produced.»

Приклади текстів у `warnings[].warning`: `"must be greater than 0"`,
`"must be greater than or equal to 1"`, `"is invalid"`,
`"Should be a non null value or not existed field"`.

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
