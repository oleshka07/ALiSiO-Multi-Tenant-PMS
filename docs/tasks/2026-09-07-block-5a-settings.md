# Блок 5a — Налаштування обʼєкта: номери, зручності, валюти (сесія 3, після К4)

**Від:** контрольна сесія, 07.09.2026. **Ухвалив:** власник. **План:** MASTER-PLAN §4 Блок 5, пп. 2–4
(без ONBOARDING.md — він після Блоку 2, коли файл готелю отримає сезони/тарифи/надбавки).
**Порядок для сесії 3:** спершу закрити рецензію Блоку 3 (`docs/tasks/2026-09-07-review-round-1.md`,
розділ «Сесія 3»: К4 на рідну форму + годинне оновлення дзеркала), дочекатись «продовжуй» від
контролера, і лише тоді цей блок.
**Гілка:** `claude/block-5a-settings`, відгалужена від **свіжої** `origin/claude/channex-integration-66kv65`
(після злиття b3, якщо воно вже сталось — інакше від голови). Правила — `docs/tasks/README.md`.
**Міграції: 0110–0119. Рішення: новий розділ «Обʼєкт і налаштування», префікс О1, О2…**

## 0. Прочитати

`docs/tasks/README.md`; `AGENTS.md` §3; `docs/MASTER-PLAN.md` §1.2 (група Unit: Room types, Amenities,
Currencies), §3, §4 Блок 5; `docs/DECISIONS.md` П10, П16, П19 (валюти — кілька з фіксованим курсом на
сайті, документ у валюті обʼєкта), Ц7; `docs/ARCHITECTURE.md` §2.2.1 (валюта готелю — три джерела,
`useHotelCurrency`, `organizationCurrency`), §4.3, §8 «Курси НБУ і ЄЦБ» (інфраструктура є, джерел
нема, ручний курс працює); `docs/PRODUCT.md` §2, §4.3 (гостьова сторінка: wi-fi на обʼєкті, код замка на
типі), §4.6 (курси з ЧНБ). Джерело форми: `docs/research/hoteliera-screens/org-settings-room-types/`,
`org-settings-amenities/` (Amenity Catalog · Assign to Locations/Room types · категорії SPA/WELLNESS…),
`org-settings-currencies/` (CURRENCY · EXCHANGE RATE (FIXED) · ACTIONS · Add another currency),
`org-settings-general/`; `hoteliera-product-map.md` §2, §5; `_walk-reservation-card/` — кадри «Rooms»
(ROOM NR · FLOOR · WIFI NAME · WIFI PASSWORD · LOCKER CODE · VIEW).

Перед кодом — абзац «що вже є»: `units` (`floor`, `zone`, `beds`, `lock_code`, `entry_photo_url`,
`room_status`, `cleaning_status`), `unit_types`/`guest_page` (wi-fi на обʼєкті `properties.wifi_*`,
на типі — `wifi_network/wifi_password`, `lock_code`; `guest-page-config.handlers.ts`), екран
`settings/units` (редактор типів і номерів, масове створення до 200), `organization_currencies`
(`code`, `rate_source manual|cnb`), `finance_exchange_rates` (`from/to/rate/effective_from`), крон
`sync-cnb-rates`, `core/fx/cnb.ts`, `core/currency.check.ts` (стеля запасних валют 0),
`useHotelCurrency`/`organizationCurrency`.

## 1. Теки

**Твої:** `src/modules/properties/**` (крім `data/{price-*,availability}.ts` і `cleaning.repo.ts` —
сесія 2), `src/app/app/(dashboard)/settings/{units,properties,currencies,amenities}/**`, новий
`src/modules/amenities/**` (або всередині `properties` — назви рішення), `src/app/api/{units,unit-types,
amenities,currencies}/**`, `src/core/fx/**`, `src/core/currency*.ts`, `hotels/_example.json` **лише нові
секції** `amenities`, `currencies`, поля номера (`scripts/apply-hotel.mjs` — відповідні блоки).

**Не твої:** `src/modules/pricing/**`, `src/modules/channels/**` (крім того, що ти вже робиш у Блоці 3),
`src/modules/widget/**` (показ ціни у валюті гостя у віджеті — **не в цьому блоці**, лише модель і
налаштування), `src/modules/bookings/**`, `src/modules/guests/**`, `invoicing/**` (документ — у валюті
обʼєкта, не чіпати), `settings/{rate-plans,seasons,pricing-matrix,…}`.

## 2. Обсяг

### 2.1 Поля номера і типу — один екран (Hoteliera «Rooms» у типі)

У редакторі типу: список номерів таблицею з колонками **№ · поверх · вид · wi-fi назва · wi-fi пароль ·
код замка · зона · ліжка · активний**; додати N номерів одразу (є масове створення); вид — довідник
на обʼєкті (`unit_views`: Sea/City/Garden/Mountain… як у них, свої назви), або вільний текст — рішення
твоє, назви його. Wi-fi і код замка на **номері** мають перевагу над типом і обʼєктом (гостьова
сторінка вже вміє рівні «обʼєкт → тип»; додати рівень «номер» у резолвер `guest-page-config` — це
`properties`, твоє). Міграція 0110: `units.view`, `units.wifi_network`, `units.wifi_password`
(секрет гостя — шифрувати як `integration_credentials`? ні: це не наш секрет, а дані готелю; але не
логувати і не віддавати в списки без права `manage_properties`). Гейт: `check-isolation` —
твердження, що wi-fi/код чужого номера не читається (аналогічне вже є для типу).

### 2.2 Зручності (Amenities)

Довідник на організації: `amenity_categories` (SPA/Wellness, General, Room…), `amenities` (назва,
категорія, іконка-ключ), привʼязка `property_amenities`, `unit_type_amenities` (міграція 0111, RLS).
Екран Settings → Обʼєкт → «Зручності»: каталог (як їхній Amenity Catalog з категоріями) і матриця
призначення «зручність × (обʼєкт | типи номерів)» з «Select all». Стартовий каталог — при
`provision-org`, з `src/modules/amenities/catalog.ts` (~40 стандартних, iCal/OTA-нейтральні назви),
перекладений uk/cs/de. Споживач у цьому блоці — гостьова сторінка (секція «про номер» показує
зручності типу) і публічний конфіг віджета (`widget-config-public` віддає список; **UI віджета не
чіпати**). Файл готелю: секція `amenities` (ключі каталогу на тип/обʼєкт), `apply-hotel` ідемпотентно.

### 2.3 Валюти (П19: кілька валют, фіксований курс на сайті, документ у валюті обʼєкта)

Екран Settings → Обʼєкт → «Валюти»: таблиця як у них — валюта · курс (фіксований або з джерела) ·
дії; «Додати валюту». Модель: `organization_currencies` є; додати `fixed_rate NUMERIC(18,8) NULL`
(0112) — коли задано, він перемагає `finance_exchange_rates` для **показу гостю**; `rate_source`
лишається (`manual`/`cnb`; НБУ/ЄЦБ — джерел немає, ARCHITECTURE §8 — не вигадувати парсер без
мережі, лишити `manual`). Двері `@properties`/`@core/fx`: `displayRates(orgId)` → мапа код→курс з
пріоритетом fixed → останній `finance_exchange_rates` → відсутній. Правило (записати як О-рішення):
**ціна, бронь, фоліо, документ — у валюті обʼєкта; чужа валюта — лише відображення з підписом
«≈ за курсом»**. Споживач у цьому блоці — публічний конфіг віджета (віддає `displayRates`); показ у
UI віджета — наступний крок, після Блоку 2 (сесія 1 в тому шляху). Гейт: `currency.check` — стеля 0
не росте; нова сцена: fixed перемагає джерело, відсутній курс не дає нуля (інваріант 17 для курсу —
«курсу немає» ≠ 0).

### 2.4 Чого не робити

UI віджета і гостьової сторінки поза резолвером даних; ціни; `ONBOARDING.md`; Public API; будь-які
писачі в канал.

## 3. Гейти і приймання

`check-isolation` (wi-fi/код чужого номера, зручності чужої організації, валюти), `check-insert-tenant`,
`check-property-scope`, `check-docs-current` (три нові таблиці в ARCHITECTURE), `check-hotels`
(нові секції прикладу), `check-boundaries` не росте, i18n cs/de 100 %, `next build`. Приймання
Playwright: тип з 5 номерами і полями; каталог зручностей з призначенням на тип; валюти EUR/CZK з
фіксованим курсом; `apply-hotel` двічі без змін.

## 4. Документація і звіт

`ARCHITECTURE.md` §8 підрозділ «Блок 5a», таблиці в §3.1; `PRODUCT.md` §2/§4.3; `DECISIONS.md`
розділ «Обʼєкт і налаштування» О1…; `hotels/_example.json` + `README`. Звіт — за README.
