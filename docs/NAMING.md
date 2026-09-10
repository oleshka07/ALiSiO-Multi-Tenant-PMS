# Naming Charter

Одна мова на весь проєкт. Це не смакова угода: половина знайдених багів
починалася з того, що ту саму річ у двох місцях звали по-різному, і скоуп,
фільтр або перевірка «не бачили» одне одного. Правило просте: **нове ім'я
береться звідси; якщо тут відповіді немає — спершу дописується сюди.**

Charter описує, ЯК називати. Він не вимагає негайного перейменування всього
старого — воно перейменовується тоді, коли код і так торкається (Фаза 3),
щоразу з міграцією і згадкою тут.

---

## 1. Мови

| Де | Мова |
|---|---|
| Код, схема, комміти, API | англійська |
| UI-тексти для персоналу | українська |
| Тексти для гостя | мова гостя (guest-page translations, widget locales) |
| Юридичні документи | мова юрисдикції (зараз čeština) |
| Коментарі в коді | англійська; пояснення «чому» важливіше за «що» |

## 1.1 Як називається продукт

**ALiSiO — ERP для готельного бізнесу.** Не «PMS»: PMS — це один із модулів
усередині, і називати ним ціле стало неправдою десь між подвійним записом і
інвесторською звітністю. Готель, у якого в одній системі номерний фонд,
фінансовий контур із рахунками й ISDOC, канали продажу, задачі, звітність
власникам і мультитенантна ізоляція на юрособу, працює вже не в PMS.

| Де | Як |
|---|---|
| Назва продукту | `ALiSiO` |
| Що це таке | `ERP для готельного бізнесу` |
| Довга форма | `ALiSiO — ERP для готельного бізнесу, з PMS усередині` |
| Метадані документів (PDF, XLSX, ISDOC, iCal) | `ALiSiO ERP` |
| `User-Agent` до чужих сервісів | `ALiSiO-ERP` |

Слово PMS **не викидається**, у нього лишається два законних значення:

1. **Модуль розміщення** — номерний фонд, бронювання, поселення, тарифи.
   «PMS-частина», «PMS check-in» у коментарях — правильно.
2. **Наша сторона в розмові з каналом.** На екрані імпорту Booking.com
   «вже у PMS», «reservation_id з PMS» протиставляють наш запис запису
   каналу. Перекладати це в «ERP» — зробити гірше: читач там порівнює дві
   системи, а не читає назву продукту. Ці рядки лишаються як є.

Чого не робимо: масового перейменування внутрішніх ідентифікаторів
(`PMS_BASE_URL` і подібні). Ім'я змінної нікому не показується, а
перейменування заради симетрії — це дифф без користі й з ризиком.

---

## 2. База даних

- **Таблиці**: `snake_case`, множина: `reservations`, `booking_sites`.
- **Колонки**: `snake_case`, однина. Час — `*_at` (TIMESTAMPTZ у Postgres),
  календарна дата — `*_date` або читабельне ім'я (`check_in`), гроші —
  `NUMERIC(14,2)`, прапорці — `is_*` / `has_*` / `show_in_*` (0/1 → BOOLEAN).
- **Діапазон дат**: `*_from` / `*_to`, обидві межі **включно** (`valid_from`,
  `date_from`/`date_to` у `availability_blocks` — виняток зі спадку: там кінець
  ВИКЛЮЧНИЙ, як `check_out`). Якщо початок уже названий `*_date`, кінець —
  `*_date_to`, NULL = один день (`cm_outbox.stay_date_to`). Не `*_until`, не
  `end_*`: одне слово на одне поняття.
- **Тенант**: кожна таблиця або несе `organization_id`, або досяжна через
  FK-ланцюг до `properties` (як `reservations`). Третього не буває —
  це перевіряє `audit-tenant.mjs`.
- **Префікси доменів**: одна підсистема — один префікс. Історичне роздвоєння
  `fin_*` (10 таблиць) проти `finance_*` (6) — визнаний борг; нові фінансові
  таблиці називаються `fin_*`, зведення в один префікс — під час розбиття
  finance у Фазі 3.
- **Статуси** — словники закриті і задокументовані тут:
  - `reservations.status`: `draft | tentative | confirmed | checked_in |
    checked_out | cancelled | no_show`
  - `reservations.payment_status`: `unpaid | payment_requested | prepaid |
    partial | paid`
  - `gift_cards.status`: `draft | active | paid | activated | cancelled |
    expired`
  - `tasks.status`: `todo | in_progress | done | cancelled`
  - `properties.checkout_balance_policy`: `none | warning | blocking` — що
    робить виселення з несплаченим залишком (0091); дефолт `warning`;
    невідоме слово читач бере як `blocking`
  - `reservation_files.kind`: `document | photo | other` — вільний рядок, не
    CHECK: словник вкладень не має вимагати міграції (0090)
  - `unit_cleaning_log.source`: `manual | checkout` — звідки прийшла зміна
    стану прибирання (борд/чекліст або автоматика виселення); вільний рядок
    (0092). Самі стани — `units.cleaning_status`: `clean | dirty | in_progress`
  - `cm_outbox.kind`, `cm_sends.lane`: `availability | rate` — дві смуги
    менеджера каналів; `cm_outbox.field_mask` — біти в порядку `RATE_FIELDS`
    домену (`prices, closed, minStay, maxStay, noArrival, noDeparture`),
    NULL = усі поля
  - `rate_plans.sell_mode`: `per_room | per_person` — як тариф рахує гостей
    (Ц26): за номер — одна ціна на будь-яку кількість гостей, у вендора одна
    опція заселеності; за особу — своя ціна на кожну кількість дорослих,
    опція на кожну. Без вибору — `per_person`; замкнений після заведення
    у вендора. CHECK не ставиться (0059, 0063) — перевіряє писач
  - `price_calendar.source` (**звідки ціна дня**, 0068/0069): `season` —
    розгорнуто з клітинки сезону | `manual` — редактор дня чи масовий,
    точкове перевизначення дати | `import` — файл готелю | `derived` —
    порахований від бази рядок похідного тарифу. Обмеження джерела
    не мають — вони на базовому рядку типу
  - `extra_occupancy_rules.guest_kind`: `adult | child` — хто доплачує
    (Ц30): дорослий понад `base_occupancy` або дитина за віковою вилкою;
    `lodging_mode`, `meal_mode`: `fixed | percent` — сума за ніч або відсоток
    від ціни ночі за базову заселеність; `age_band_index` — індекс вилки з
    `organizations.child_age_bands` (NULL = усі вилки), рахується з нуля.
    Вилка — «band», не «group»: група в Hoteliera — це тариф × типи, тобто
    фільтр екрана, а не сутність
  - `price_rules.kind`: `rule | promo` — правило діє само, промо — за кодом
    (Ц31); `condition_kind`: `period_of_stay | period_of_checkin |
    period_of_checkout` — до чого прикладати дати й дні тижня (NULL з датами
    = проживання); `action`: `decrease | increase`; `value_kind`: `percent |
    fixed` — відсоток від поточної ціни ночі або сума за ніч. Промокод —
    `code`, у верхньому регістрі без пробілів; `booked_days_before_*` — «за
    скільки днів до заїзду заброньовано», не «lead time»
  - `rate_plans.pricing_type`: `manual | derived` — свої ціни чи від бази
    (Ц28); `adjustment_kind`: `percent | fixed`; `adjustment_direction`:
    `increase | decrease`. Похідний від похідного не буває — тримає писач
  - `fees_taxes.type` (**множник**, як розмазати суму): `per_night |
    per_stay | per_person | per_person_per_night | percentage`
  - `fees_taxes.applies_to` (**кого рахувати**): `all | adults`
  - `fees_taxes.collected_for` (**чиї гроші**): `property` — виручка готелю |
    `authority` — збір для громади, готель лише передає
  - `properties.property_type` (**рід житла**, 0113): одне з 22 значень
    `@core/lodging-kinds` — `hotel`, `hostel`, `camping`, `apartment`,
    `villa`, … Українською в текстах — **«рід житла»**, не «тип обʼєкта» і
    не «тип житла»: «тип» у цьому продукті вже зайнятий типом номера
    (`unit_types`), і два «типи» в одному реченні читаються як одне.
    В аргументах коду — `lodgingKind` (`provisionOrganization`,
    `setupProgress`), у файлі готелю — `property.propertyType`. Колонка
    називається `property_type` історично (0113) і не перейменовується:
    воно ще й збігається з іменем поля вендора. CHECK у базі немає свідомо
    (О9) — перевіряє писач. Дефолту немає ніде (В1, К16): не назвали —
    названа відмова
  - `app_connections.status` (**стан звʼязку із чужою системою**, 0140):
    `connected | degraded | error | disabled`; на картці ще `soon` (коду
    немає) і `unknown` (ще не зверталися) — обчислені, у базу не пишуться.
    `app_connections.app` і `app_wishes.app` — `id` з реєстру `core/apps.ts`
    (`fiskaly`, `smtp`, `winhotel_import`, …); `channel_manager` у
    `app_connections` не буває — менеджер каналів читається з `cm_connections`
  - `fin_fiscal_settings.tse_admin_pin`, `tse_admin_puk` (0141) — секрети TSS
    під `seal()` (`enc1:`), як і секрети `channel_credentials`; поруч із
    `tse_client_id` і `tss_id`, які секретами не є; `tse_pending_tss_id`
    (0142) — id TSS, створеної у вендора, але не завершеної (NULL = немає),
    `tse_connecting_at` — замок на час походу до вендора (NULL = вільно)
  - `winhotel_snapshots.status` (**стан знімка бази Winhotel**, 0143):
    `received | extracting | extracted | imported | failed` — прийнято
    застосунком → міст узяв → міст витяг `*.jsonl` → імпортовано в ядро
    (частина Б) / відмова з текстом у `error`; переводить лише застосунок,
    читаючи маркери мосту з тією самою назвою (`<id>.extracting`,
    `.extracted`, `.failed`). `winhotel_snapshots.mode` (**як агент зняв
    базу**): `backup` — готовий `.fbk` з теки бекапів Winhotel | `gbak` —
    `gbak -b` агентом | `copy` — копія `winhotel.fdb` при закритому Winhotel.
    Таблиці застосунку — префікс `winhotel_*`, кожна з `organization_id`;
    у таблиці ядра колонок застосунок не додає.
    `winhotel_refs.entity` (**що за рядок Winhotel став нашим**, 0144):
    `address` — `ADRESSEN` без `DEBI_NR` → `guests` | `company` — з `DEBI_NR`
    → `companies` | `reservation` — `GASTKONT` → `reservations` |
    `reservation_guest` — адреса броні → `reservation_guests` (LNR =
    `GASTKONT.LNR·100 + слот 1..9`) | `folio_line` — `BUCHKONT` →
    `fin_folio_items` | `payment` — `ZAHLUNGEN` → `fin_folio_payments`.
    `winhotel_staging.entity` — ті самі слова плюс `invoice`, `balance`,
    `consent`, `cash_book`. `winhotel_staging.reason` (**чому не в ядрі**):
    `frozen` — заморожена фактура з чужою нумерацією | `frozen_sammelrechnung`
    — те саме, виставлена дебітору | `fiscal_guard` — готівка/картка на
    обʼєкті DE без `fiscal_de` | `method_unmapped` — `DEVISEN` поза чотирма
    класами оплати | `overlap` — бронь поверх зайнятого номера |
    `no_unit_type` — бронь без категорії, що є в нас | `no_guest` — бронь без
    жодної адреси | `changed` — рядок або оплата змінені у Winhotel після
    нашого імпорту, дверей на зміну немає | `refused_by_core` — фасад відмовив
    (текст у payload) | `core_gap_gdpr_journal`, `core_gap_cash_book` —
    CORE-GAPS 6 і 9 | ключі агрегатів (`open_guest_balances`, …) — сальдо
    числом. Нова причина = рядок тут + слово у `STAGING_REASON` картки.
  Новий статус = міграція + рядок тут + бейдж у UI. Статус, якого немає в
  мапі UI, — баг (`partial` у календарі був невидимим саме так).
- **Без назв юрисдикцій у схемі** (AGENTS.md, інваріант 22): ні в таблиці, ні
  в колонці, ні у значенні CHECK. `collected_for = 'authority'` — ядро;
  `tax_type = 'tourist_tax'` — ні, це українське/чеське слово, вбите в
  спільну колонку. Країна живе в модулі (`fiscal_ua`, `fiscal_de`), не в типі.
- **Без словників клієнта в схемі**: жодних CHECK-переліків з бізнес-слів
  (типи категорій були `CHECK (type IN ('glamping',…))` — знято). Словник
  бізнесу живе в даних організації.

## 3. Ідентифікатори рядків

Historично співіснують `r001`, `u_dlx1`, `org_demo` (сіди) та
`lower(hex(randomblob(16)))` (міграції). **Нові таблиці**: TEXT PK
`DEFAULT (lower(hex(randomblob(16))))`. **Нові рядки в коді**: або дефолт
бази, або `crypto.randomUUID()`. Префіксовані id (`r_${Date.now()}`) не
плодити — час і так лежить у created_at.

## 4. Шари

| Шар | Що там |
|---|---|
| `src/core/` | наскрізна інфраструктура: `db`, `auth` (сесії + права), `mail`, `i18n`, `features`, `money`, `security`, `event-bus` |
| `src/modules/` | домени (див. нижче) |
| `src/ui/` | клієнтські хуки й контексти, спільні для сторінок |
| `src/components/` | React-компоненти спільного вжитку |
| `src/app/` | лише маршрути й сторінки — тонкі, вся логіка в модулях |
| `src/lib/` | **тільки `db.ts`** — схема й міграції. Нічого нового сюди не кладемо |

**Клієнт vs сервер.** Фасад, який тягне за собою базу, не можна імпортувати з
клієнтського компонента — браузерний бандл падає на `Can't resolve 'fs'`.
Тому модель прав живе окремо: сервер бере `@core/auth`, клієнт —
`@core/auth/permissions`.

## 5. Модулі та файли

- Модулі — `src/modules/<domain>/`, домен — іменник у множині там, де це
  колекція (`bookings`, `guests`, `tasks`), однина для наскрізних
  (`auth`, `finance`, `widget`).
- Всередині: `api/` (хендлери + `index.ts` — єдиний вхід), `data/`
  (`*.repo.ts`), `domain/` (чиста логіка), `ui/`, `events/`.
- Файли хендлерів: `<річ>.handlers.ts`; репозиторії: `<річ>.repo.ts`;
  самоперевірки: `<річ>.check.ts` (підключені в `npm run check`).
- Імпорт чужого модуля — тільки через аліас фасаду (`@bookings`), ніколи в
  нутрощі. Це тримають tsconfig-аліаси і `check-boundaries.mjs`.

## 6. API-маршрути

- Шляхи — `kebab-case`, ресурси в множині: `/api/booking-sites/[id]/...`.
- Публічні (без сесії) живуть під зафіксованими префіксами з allowlist у
  `src/proxy.ts`; новий публічний шлях = свідома правка allowlist + перевірка
  в `check-isolation.mjs`.
- Хендлери називаються дією: `listReservations`, `createWidgetReservation`,
  `updateOrgFeature`. Опції CORS — `<назва>Options`.
- Вебхуки ззовні — `/api/webhooks/<хто-стукає>/[token]`, і «хто стукає» —
  роль, не вендор: `channel-manager`, не імʼя фірми. Провайдера називає
  рядок, знайдений за токеном; заголовок секрету — `X-Webhook-Secret`.

## 7. Фічі реєстру

Ключі `organization_features.feature` — короткі, плоскі, без крапок:
`hostex`, `pricelabs`, `widget`, `fiscal_de`. Каталог і підписи —
тільки в `src/core/features.ts`.

## 8. Слова, які вже мають значення

| Слово | Значить | Не плутати з |
|---|---|---|
| `property` | об'єкт розміщення (готель/кемп) | `booking_site` — сайт-вітрина |
| `unit` | конкретний номер/будиночок | `unit_type` — тип номера |
| `guest` | людина | `reservation_guest` — рядок реєстрації в броні |
| `source` | канал продажу броні (`booking_sources`) | `utm_source` — маркетинг |
| `activate` (gift card) | погашено і прив'язано до броні | `active` — ще не використано |
| `organization` | тенант, платить нам | `property` — його об'єкт |
| `season` (сезон) | період року обʼєкта з датами включно, у якому клітинка ціни на тип × тариф (`seasons`, `season_prices`); правило, яке рендериться в `price_calendar` | `price_occupancy.valid_from/valid_to` — періоди матриці, спадок, мігрують у сезони (Блок 2) |
| `derived` (похідний тариф) | тариф без своїх цін: база ± коригування, рядки рахуються й рендеряться в календар з `source = 'derived'` | `derived_option` Channex — не використовується (Ц7); `site_rate_plans.derived_from_plan_id` — спадок сайтів |
| `override` (перевизначення дати) | рядок `price_calendar` з ціною і `source = 'manual'`, який перерендер сезону не затирає | `manual` без ціни — рядок обмеження, не перевизначення |
| `property scope` (область обʼєкта) | два шари одного поняття. **В інтерфейсі** — який обʼєкт зараз на екрані: `usePropertyScope()`, кука `property_scope`. **У даних** — тип `PropertyScope` (`{ kind: 'one'; id }` \| `{ kind: 'all' }`) з `@core/property-scope`, який читач scoped-таблиці приймає замість `property_id?: string`; `propertyScopeFilter()` перетворює його на `WHERE`, `requestPropertyScope()` — на двері з запиту. **Імʼя осі в запиті — `property_id`** (канонічне, рішення 09.09.2026); `?property=` — застарілий синонім, який лише читається, бо його пише провайдер в адресу вкладки. **Порожнє значення = «усі обʼєкти» СКАЗАНО, відсутнє = «нічого не сказано»** — це різні стани | орендар — той на сесії й зʼєднанні; область його не заміняє. `propertyScopeSql()` з `properties/data/tenant-scope.ts` — попри імʼя, вісь ОРЕНДАРЯ («усі обʼєкти рахунку»), а не область: після звуження означення 09.09.2026 такий запит НЕ вважається таким, що називає обʼєкт. Тип `PropertyScope` у `src/ui/PropertyScopeContext.tsx` — значення React-контексту, тобто третє значення того самого імені; перейменувати його на `PropertyScopeValue` — окремою правкою власника того файла |
| `company` | компанія-платник, рядок довідника `companies` (0093): `business_id` — реєстраційний ІД (IČO), `vat_id` — податковий (DIČ / USt-IdNr.), `registry_no` — запис у реєстрі (суд, розділ, вкладка) | `invoice_company_*` на броні — ЗНІМОК платника для документа, не посилання; `organization` — тенант |

## 9. Заборонене

- Імена, домени, реквізити, категорії конкретного клієнта — в коді їх нуль,
  тримає `check-no-tenant-names.mjs`.
- Лінива зміна схеми в хендлерах (`ALTER TABLE` поза `db.ts`) — схема живе
  лише в `buildSchema`/`runMigrations`; розбіжності ловить
  `check-fresh-schema.mjs`.
- Валюта, ставки податків, відсотки — не літералами в коді, а полями
  організації/об'єкта.
