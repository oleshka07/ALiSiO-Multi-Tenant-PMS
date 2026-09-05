# Блок 4 — День готелю (паралельна кодова сесія 2)

**Від:** контрольна сесія, 06.09.2026. **Ухвалив:** власник. **План:** `docs/MASTER-PLAN.md` §4,
Блок 4 — цей файл його деталізує і має перевагу в конфлікті.
**Гілка:** `claude/block-4-hotel-day`, відгалужена від `origin/claude/channex-integration-66kv65`.
Правила паралельної роботи — `docs/tasks/README.md` (читати першим). **Міграції: 0090–0099.
Рішення: розділ «День готелю», префікс Д.** У головну гілку і в `main` не пушити.

## 0. Прочитати перед початком (з гілки, не з робочої копії)

1. `docs/tasks/README.md` — гілки, діапазони, спільні файли.
2. `AGENTS.md` §3 — 29 інваріантів; §4 — перед комітом. Схема — `git show origin/beta:src/lib/db.ts`.
3. `docs/DECISIONS.md` цілком (П1–П20, Ц1–Ц35, Т1–Т9, Р1–Р15, К1–К3). Особливо П7 (бронь до оплати),
   П9 (непризначені броні видимі), П10 (область обʼєкта — жодного власного `propertyId` на екрані),
   П11/П12 (мова інтерфейсу, верхнє меню), Т5 (турзбір окремим рядком), інваріанти 15–18.
4. `docs/MASTER-PLAN.md` §0, §1 (структура), §3 (модулі: housekeeping і companies — ядро, без ключа),
   §4 Блок 4, §5 (наскрізне приймання).
5. `docs/PRODUCT.md` §4.1 (календар і броні), §4.2 (гості), §4.6 (фактурний контур, фоліо, оплати),
   §4.7 (зали — єдине місце, де фоліо доведено до кнопки: зразок).
6. `docs/ARCHITECTURE.md` §4.3 (область обʼєкта), §6.0–6.1 (фактурування, фоліо, `fin_folio_items`,
   `fin_folio_payments`), §6.3 (аркуші дня), §2.1 (межі модулів, `check-boundaries`).
7. `docs/UI-LANGUAGE.md` — токени, чотири стани, «краще за Channex»: історія різницею, видно «хто».
8. **Джерело форми — Hoteliera:** `docs/research/hoteliera-screens/` (тексти всіх 63 екранів,
   `structure.json` з полями, `page.png` ключових, і `_walk-reservation-card/` — кадри картки броні:
   вкладки Accommodation · Financials · Messages · Files, «Guests & Rooms details», «Recalculate price
   based on the new occupancy», статуси Confirmed/Checked-in/Checked-out/Canceled, Financials з
   Lodging/продуктами/оплатами, Housekeeping). Також `docs/research/hoteliera-product-map.md` §7–8,
   `settings-catalogue.md` (reservations, companies, guests, housekeeping).

Перед кодом — абзац «що вже є» з прочитаного: `BookingViewModal.tsx` (вкладки «Інформація · Історія
змін», блок фоліо), `MobileBookingDetail.tsx`, `bookings/api/reservation.handlers.ts` (статуси,
`checked_in` з перевірками 422), `bookings/api/reservations.handlers.ts`, `sub-bookings`,
`invoicing/api/folio.handlers.ts` і маршрути `/api/finance/folios/[id]/{charges,move,payments,issue}`,
`fin_counterparties` (фінанси, за ключем `accounting`), `units.cleaning_status`
(`clean|dirty|in_progress`), `availability_blocks` (ремонт/out of order), `calendar/page.tsx`
(сітка, смуга «Без номера», без перетягування), `bookings/page.tsx` (список, фільтри), `guests/page.tsx`,
`dashboard`, `api/file-upload`, `booking-history.ts`.

## 1. Теки

**Твої:** `src/modules/bookings/**`, `src/modules/guests/**`, `src/modules/dashboard/**`,
`src/app/app/(dashboard)/{bookings,calendar,guests,dashboard,housekeeping}/**`, `src/components/booking/**`,
`src/components/mobile/**` (картка броні, календар), новий `src/modules/housekeeping/**`, новий
`src/modules/companies/**` (або всередині `guests` — твоє рішення, назви його), відповідні маршрути
`src/app/api/{bookings,guests,companies,housekeeping,dashboard}/**`, `src/modules/invoicing/**` **лише
там, де фоліо доводиться до кнопки** (нові двері у фасаді `@invoicing`, без зміни розрахунку ПДВ і
нумерації).

**Не твої (не редагувати):** `src/modules/pricing/**`, `src/modules/channels/**`, `src/modules/widget/**`,
`src/modules/properties/data/{price-*,availability.ts}`, `src/app/app/(dashboard)/{pricing,settings}/**`,
`hotels/*.json` (секції цін), `docs/MASTER-PLAN.md`, `docs/INDEX-FOR-NEW-SESSION.md`,
`docs/CHANNEX-*.md`. Ціну ночі питаєш лише через фасад `@pricing` (`priceNights`/quote — інваріант 16);
наявність — через `@properties` (`availabilityByDay`); координати в канал — лише наявні двері
`bookings/data/stay-notes.ts` (`noteStay`) — вони вже викликаються при зміні броні; нових писачів у
`cm_outbox` не заводити.

## 2. Обсяг (один блок; порядок — за залежностями)

### 2.1 Картка броні з вкладками (десктоп і телефон)

Джерело: `_walk-reservation-card/611…702`, `reservations/text.txt`. Вкладки: **Проживання ·
Фінанси · Файли · Історія змін** (Історія — є, П11; «Messages» — відкладено, вкладку не малювати).

- **Проживання:** шапка (код броні, зовнішній код каналу, джерело, статус, оплата), дати, тип і
  номер (або «Без номера» з кнопкою призначити — є), гості кімнати (їхній «Guests & Rooms details»:
  імʼя, дорослі/діти, реєстрація — з `reservation_guests`), платник: **фізособа / компанія** (див. 2.3),
  примітки. Кнопки статусів: Підтвердити · Заселити · Виселити · Скасувати · No-show — серверні правила
  лишаються (422 без оплати/реєстрації при заселенні — є). «Перерахувати ціну за новою заселеністю» —
  явна кнопка, а не автоматично (їхній перемикач): викликає котирування через фасад `@pricing` і
  показує різницю до/після; підтвердження пише нову суму й рядок історії. Ціни в коді картки немає.
- **Фінанси:** фоліо броні (створюється при першому нарахуванні — як у залах): нарахування
  проживання з розкладом (з квоти), послуги/товари (з `services`), окремі рядки збору (Т5), оплати
  (готівка · термінал · переказ · ваучер — `fin_folio_payments`, є), залишок, поділ між платниками (є),
  **«Виставити документ»** → фактура/чек з фоліо (`issue`, є), список документів броні, «Скасувати
  документ» = сторно (є). Усе через наявні двері `@invoicing`; нових розрахунків ПДВ не писати.
- **Файли:** вкладення до броні (`reservation_files`, міграція 0090: `organization_id`, `reservation_id`,
  `kind`, `path`, `uploaded_by`, `created_at`; RLS як у сусідів; сховище — те саме `data/uploads/`,
  що `api/file-upload`; ретенція — разом із бронню, GDPR-цикл знеособлення не чіпає).
- **Перевірка балансу при виселенні** — налаштування обʼєкта `properties.checkout_balance_policy`
  (`none|warning|blocking`, дефолт `warning`; міграція 0091; поле в Settings → Обʼєкт → Locations
  — це твій екран лише в межах одного поля). `blocking` → 422 з назвою причини.

### 2.2 Housekeeping (ядро, без ключа модуля)

Джерело: `housekeeping/text.txt`, `dashboard/text.txt` («All rooms 7 · Dirty rooms 0 · Recent
Cleaning Activity»), `_walk-reservation-card/457`.

- Екран `/app/housekeeping` (у верхньому меню — під Reports, як у них «Housekeeping Board / Cleaning
  History»; у `nav-items.ts` — свої рядки): борд номерів за типами з фільтром обʼєкта (область — з
  провайдера, П10), стан `dirty · in_progress · clean` + `out_of_order` (з `availability_blocks`),
  зміна в один клік, хто в номері/заїзд/виїзд поруч. Історія прибирання — `unit_cleaning_log`
  (міграція 0092: `organization_id`, `unit_id`, `from_status`, `to_status`, `changed_by`,
  `changed_at`, `note`), екран «Cleaning history» з фільтрами дата/номер/хто. Експорт PDF/Excel — не
  зараз.
- **Автоматика:** виселення → номер `dirty` (у тій самій транзакції, що зміна статусу броні; через
  фасад `@properties`), заселення в `dirty` номер — попередження, не заборона.
- Дашборд: блок «Номери: усього · брудні · у роботі», «останні зміни прибирання», посилання на борд.

### 2.3 Компанії (платники-юрособи, ядро)

Джерело: `companies/text.txt`, `structure.json`, кадри «Add company», Guest → Individual person /
Legal entity. Нова таблиця `companies` (міграція 0093: `organization_id`, `name`, `business_id`,
`vat_id`, `registry_no`, `address_*`, `bank_name`, `iban`, `bic`, `email`, `phone`, `notes`,
`archived_at`; RLS; UNIQUE `(organization_id, business_id)` де не NULL). `reservations.company_id`
(nullable). Екран Guests → Companies: список з їхніми фільтрами (has contact / has bank / has
associated guests / exclude archived), картка, «Додати компанію»; на картці броні вибір платника;
документ з фоліо бере реквізити платника з `companies` (через двері `@invoicing` — реквізити вже
приймаються при `issue`, перевір). `fin_counterparties` (облік, `accounting` OFF) не чіпати; звʼязку
між ними в цьому блоці не робити — записати в рішення Д.

### 2.4 Планер

Джерело: `planner-v2/text.txt`, `planner/page.png`, `_walk` «Quick booking», «Mark as out of order».

- Перетягування броні на інший номер і/або дати з тими самими серверними перевірками, що й форма
  перенесення (409 на конфлікт, тип номера з іншого типу — підтвердження), оптимістично з відкатом.
- Швидке створення з клітинки (форма з підставленими датами/номером — форма є).
- «Позначити out of order» на діапазон — `availability_blocks` (є), з планера.
- Смуга «Без номера» лишається; перетягування з неї = призначення номера (є двері).

### 2.5 Списки

- Reservations: фільтри як у них (`reservations/structure.json`): статус, оплата (всі / оплачено /
  не оплачено / частково), «показати конфліктні», «скасовані клієнтом», сортування; пошук — є.
- Guests: фільтри «має майбутні броні / має контакти / має компанію»; експорт CSV простий/розширений.

### 2.6 Чого не робити

Messages гість↔готель; конструктор реєстраційної форми; будь-яка логіка цін, обмежень, наявності
поза фасадами; нові писачі в канал; зміни в `settings/*` крім одного поля 2.1; модулі за ключем для
housekeeping/companies (це ядро).

## 3. Гейти (червоним першими, там, де гроші і броні)

- виселення з боргом при `blocking` → 422; при `warning` — проходить, у відповіді прапорець
  (`reservation.handlers.check` — нова сцена, дві осі політики і боргу);
- після виселення номер `dirty` у тій самій транзакції; падіння запису прибирання відкочує зміну
  статусу (сцена червона до коду);
- перетягування на зайнятий номер → 409 (сцена на шлях перетягування, не лише форми);
- `companies`: чужа — 404; UNIQUE з організацією; додати твердження в `check-isolation.mjs`;
- `reservation_files`: тенант явно (інваріант 12), `check-insert-tenant` зелений;
- «перерахувати ціну» — сума з квоти, не з картки: `check-price-source` зелений, тест на різницю
  до/після на трьох ночах (інваріант 26);
- `check-boundaries --strict` — стелі не ростуть; `check-property-scope` — жодного власного
  `propertyId`; `check-route-guards`, `check-ui-tokens` храповик, i18n cs/de 100 %.

## 4. Приймання

Локальна продакшн-збірка + Playwright (як робила сесія 1): бронь руками → призначити номер → заселити
→ послуга з фоліо → оплата готівкою → документ → виселити (з `warning` і з боргом) → номер брудний →
борд: у роботі → чисто → дашборд показує лічильники. Знімки: картка броні (3 вкладки), борд, список
броней з фільтрами, компанія на картці. Усе з екранів, без API.

**ЧЕКПОІНТ — рецензент:** знімок картки броні (Проживання і Фінанси) до того, як робити планер і
списки. Надіслати разом зі звітом по 2.1.

## 5. Документація і звіт

`docs/ARCHITECTURE.md` §8 — свій підрозділ «Блок 4»; таблиці `reservation_files`, `unit_cleaning_log`,
`companies` — у §6.1/§3.1 і в таблиці гейтів (`check-docs-current` перевіряє); `docs/PRODUCT.md`
§4.1/4.2/4.6 — оновити фактами; `docs/DECISIONS.md` — новий розділ «День готелю», Д1…; знахідки —
`docs/tasks/2026-09-06-block-4-hotel-day.notes.md`. Звіт після кожного коміту — за README.
