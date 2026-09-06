# Блок 5a — робочі нотатки сесії 3

Гілка `claude/block-5a-settings` від `f7f4738` (голова головної гілки; Блок 3
на момент відгалуження ще не злитий — за §«Гілка» задачі це дозволений випадок).

## Що вже є (перед кодом, §0)

**Номер і тип.** `units` уже несе `floor`, `zone`, `beds`, `room_status`,
`cleaning_status`, `lock_code`, `entry_photo_url`, `is_pool`, `sort_order`,
`UNIQUE(property_id, code)`; `unit_types` — місткості, ліжка, `photos`,
`bookable_online`. Писач один — `properties/data/units.repo.ts`
(`createUnit`, `bulkCreateUnits` до 200 з `ownsAllRefs`, `updateUnit` з білим
списком колонок), маршрути під `manage_properties`. Екран
`settings/units` уже редагує типи й номери і вміє масове створення. Тобто
поля номера **нікуди додавати не треба, крім самої таблиці**: і форма, і
писач, і межа орендаря на місці.

**Гостьова сторінка.** Рівнів уже два, і резолвер один —
`getGuestPageConfig()` у `guests/data/guest-portal.repo.ts`: `guest_page_config`
на ТИП (`wifi_network`, `wifi_password`, `lock_code`, `entry_photo_url`,
`amenities` текстом) поверх `property_guest_config` на ОБʼЄКТ, а для
`lock_code`/`entry_photo_url` уже є третій рівень — `units`. Тобто «рівень
номера» існує в зародку рівно для двох полів, і 2.1 його не винаходить, а
дописує wi-fi у ту саму щілину.

**Зручності.** Свого довідника немає взагалі: є текстове поле
`guest_page_config.amenities` (і `external_amenities`) — вільний рядок на тип,
який ніхто не може ані порахувати, ані віддати каналу. Референс Hoteliera
(`org-settings-amenities/text.txt`) дає 155 позицій у 16 категоріях і, головне,
**область** кожної: `L` (обʼєкт), `R` (тип номера), `L+R` (обидва) — це і є
форма таблиці, а не просто список назв. Категорія `VIEW` там теж зручність
типу (Sea/Mountain/Garden/City…).

**Валюти.** `organizations.default_currency` — основна й єдина, через
`organizationCurrency()`; запасних значень немає і храповик `currency.check`
тримає стелю 0 (було 77 місць `|| 'CZK'`). `organization_currencies`
(`code`, `rate_source manual|cnb`, `sort_order`, до трьох) — це «у чому ще
показуємо», курс там **навмисно відсутній**: ARCHITECTURE §2.2.1 каже, що
колонка курсу поруч зі списком валют була б другим джерелом істини, і курс
живе лише в `finance_exchange_rates` (`NUMERIC(18,8)`, історія, `CHECK rate > 0`).
Є `core/fx/cnb.ts` і крон `sync-cnb-rates`; НБУ і ЄЦБ джерел не мають.
`setManualRate`, `latestRate`, `convert`, `secondaryCurrencies` — уже двері
`core/currency.ts`.

**Заведення готелю.** `provisionOrganization()` (`core/provisioning.ts`) в
одній транзакції створює організацію, обʼєкт, категорію, джерела бронювань і
рядок на кожну фічу; `scripts/apply-hotel.mjs` накочує файл готелю секціями
(`categories`, `unitTypes`, `units`, `channelRules`, `services`, `fees`,
`bookingSources`, `acceptance`), ідемпотентно, з приймальними перевірками в
кінці; `hotels/_example.json` — зразок, `check-hotels` не пропускає файл без
`acceptance`.

## Рішення, які я ухвалюю сам (названі в задачі як мої)

1. **`units.view` — вільний текст, не довідник.** Вид із вікна конкретного
   номера («у двір», «на липу») готель пише словами; довідник змусив би його
   вигадувати код для одиничного випадку. Стандартизований вид, який їде в
   OTA, — це зручність ТИПУ з категорії `VIEW` (2.2), і вона є довідником.
   Тобто дві різні речі не змішуються в одну колонку.
2. **Зручності — у `properties`, не окремим модулем.** Вони не мають власного
   життєвого циклу: без обʼєкта й типу номера зручність нема на що вішати, а
   `check-boundaries` для нового модуля стартує зі стелею нуль і будь-який
   читач (гостьова, віджет) одразу став би пробоєм. Двері — фасад
   `@properties`.
