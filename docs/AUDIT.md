# Аудит застосунку: шари, інструменти, знахідки

Стан: **2026-08-24**. Цей документ відповідає на питання «як перевірити весь
застосунок цілком» — не одним натиском, а п'ятьма шарами, кожен з яких ловить
свій клас поломок. Половина шарів у репозиторії вже існувала (гейти в
`npm run check`, CI, ізоляційні перевірки); цей документ додає відсутні й
каже, що чим ловиться, щоб те саме не шукали руками двічі.

Розділ 2 — повний реєстр знахідок прогону 2026-08-24. Вони лишаються тут,
поки не виправлені: чат ніхто не перечитує, а документ — читають.

---

## 1. П'ять шарів

| Шар | Що ловить | Чим | Коли |
|---|---|---|---|
| 1. Статика | мертві файли/експорти/залежності, цикли, типи | `npx tsc --noEmit` · `npm run audit:dead-code` (knip) · madge | перед комітом / раз на тиждень |
| 2. Гейти | доменні інваріанти — усе з таблиці в AGENTS.md §4 | `npm run check` | кожен коміт + CI |
| 3. Обхід UI | мертві кнопки, консольні помилки, 4xx/5xx, крахи сторінок | `npm run audit:ui` | після помітних змін UI |
| 4. AI-рев'ю | race conditions, недороблені гілки, логічні дірки | `/code-review`, `/security-review` по модулю | на PR / по модулю |
| 5. Runtime | помилки з реальними даними реальних клієнтів | Sentry/GlitchTip — **ще не підключено** | постійно, після інтеграції |

### Шар 1 — статика

`tsc` уже тримає CI. Нове — **knip** (`npm run audit:dead-code`): файли, які
ніхто не імпортує, експорти, які ніхто не кличе, залежності, які ніхто не
використовує. Конфіг у `knip.jsonc` пояснює, чому скрипти й `public/` не
рахуються мертвими. Це звіт, не гейт: список треба читати очима, бо «ніхто не
імпортує» інколи означає «викликається ззовні способом, якого knip не бачить».

Цикли залежностей: `npx madge --circular --ts-config tsconfig.json
--extensions ts,tsx src` — разовий інструмент, ставити в залежності не треба.

### Шар 2 — гейти

Були до цього аудиту; список і причини — AGENTS.md §4. Аудит додав один:
`check-price-source.mjs` (інваріант 16 — ціну ночі рахує лише
`modules/pricing`; історію див. розділ 2.1). Біль лінтера тут свідомо не
чіпається: `npm run lint` має ~5000 успадкованих зауважень і не гейтиться,
поки їх не розгребено (пояснення — у коментарі `.github/workflows/checks.yml`).

### Шар 3 — обхід UI (краулер)

`scripts/audit-ui.mjs` логіниться оператором, обходить усі внутрішні
посилання BFS-ом (і сторінки, відкриті через `router.push`, і сідинг зі
списку `find src/app`), тисне кожну видиму кнопку і записує: кнопки без
реакції (`DEAD_BUTTON`), кнопки без імені для скрінрідера (`BUTTON_NO_NAME`),
консольні помилки, запити з 4xx/5xx, крахи сторінок, `href="#"`.

```bash
npm run build:win && npm start &                # прод-збірка: dev на 183 маршрутах вмирає
node scripts/provision-org.mjs --name "Audit" --slug audit \
  --email audit@test --password '…' --language uk
find src/app/app -name page.tsx | sed 's|^src/app||;s|/page.tsx||;s|/(dashboard)||' \
  | grep -v '\[' > /tmp/seeds
AUDIT_EMAIL=audit@test AUDIT_PASSWORD='…' AUDIT_SEED=/tmp/seeds npm run audit:ui
```

Скільки сторінок відкриється — залежить від наповнення тестової організації:
реєстр фіч ховає пункти меню, порожній готель — цілі екрани (гола організація
дає ~16 сторінок; з увімкненими фічами, даними і сідингом — 51+). Найкорисніший
прогін — по організації, наповненій як реальна, але без прод-даних.

**Тільки на одноразовій базі** — правило те саме, що в `smoke-writes.mjs`:
краулер у safe-режимі не тисне submit і деструктивні кнопки й відповідає
Cancel на кожен `confirm()`, але це все одно залогінений користувач, який
клікає все підряд. `DEAD_BUTTON` — робочий список для перегляду, не вирок:
кнопка, чия реакція повільніша за 800мс, може потрапити хибно. `HTTP_5XX` і
`PAGE_CRASH` — справжні завжди. **Важлива межа шару 3:** він тисне лише
кнопки, видимі одразу на сторінці. Мертві кнопки в модалках (треба спершу
відкрити бронь), у публічному віджеті (поза `/app`) і за станом він не
бачить — їх ловить шар 4. Прогін 2026-08-24 по 51 сторінці не дав жодного
`DEAD_BUTTON`/4xx/5xx: верхньорівневий UI цілий, зламане — глибше.

### Шар 4 — AI-рев'ю

По модулю за раз (`/code-review src/modules/finance`), не по всьому проєкту —
на великому обсязі рев'ю змиває деталі. Для безпеки — `/security-review`;
знахідки, що підтвердились, ідуть у SECURITY-FINDINGS.md за звичним правилом.
Саме цей шар (11 паралельних ревʼюерів, по модулю) дав більшість реєстру
нижче — статика й краулер його не бачать.

### Шар 5 — runtime

Єдиний шар, якого немає зовсім. Половина багів — це не логіка, а реальні
дані реальних клієнтів; їх ловить тільки збирач помилок на проді. Кандидати:
Sentry SaaS (швидко) або self-hosted GlitchTip поруч на VPS (дані не
покидають сервер — для гостьових PII це аргумент). Інтеграція: DSN в env,
`Sentry.captureException` у глобальний error handler і в `console.error`
гілки хендлерів. Це окрема задача; поки її немає, цей рядок — визнана діра.

### Прогін по специфікації (Spec Inventory)

Окремого SPEC.md **немає навмисно**: [PRODUCT.md](PRODUCT.md) вже написаний
за правилом «нічого з майбутнього часу» і є переліком тверджень про те, що
система вміє. Друга копія розійшлася б із першою (див. CLAUDE.md — чому один
файл, а не два). Прогін робиться так:

> Візьми docs/PRODUCT.md, розділ N. Для кожного твердження знайди код, який
> його реалізує, і клас: **реалізовано** (з file:line) / **частково** (що
> саме бракує) / **не знайдено**. Нічого не виправляй, тільки звітуй.

Розбіжність «написано є — у коді нема» — це або баг документа (виправити
PRODUCT.md у тому ж коміті), або знахідка сюди в розділ 2 (§2.8).

---

## 2. Повний реєстр знахідок 2026-08-24

**Як зібрано.** 11 паралельних ревʼюерів по модулях (finance, bookings,
guests, channels, widget/sites, pricing/events, properties/dashboard/reports/
tasks, core/auth, легасі-роути), механічна матриця «516 викликів `fetch` ×
259 маршрутів», звірка PRODUCT.md з кодом, плюс власний арсенал репозиторію
(`audit-tenant` 681 незіскоуплений запит, `audit.mjs`, `audit-dead-data`,
краулер по 51 сторінці). Кожна знахідка ревʼюера підтверджена читанням обох
сторін; найгостріші — ще й живим запитом (позначено ✅, деталі — §3).

**Наскрізний множник — SQLite проти Postgres.** Багато tenant-знахідок нижче
на **проді (Postgres) прикриті RLS**, але на **SQLite (локальна розробка,
демо, `.check.ts`, CI-крок `static`) відкриті повністю** — бо там RLS не
існує. Це не «лише dev»: це порушення власного стандарту кодової бази
(явний `WHERE organization_id = ?` стоїть у сусідніх файлах) і захист **в
один шар** там, де решта системи тримає два. Кожен такий пункт нижче
позначений `[SQLite]`.

Пріоритети: **P0** — гроші/дані клієнта виходять неправильні або течуть між
компаніями просто зараз; **P1** — функція зламана або відкрита за легкої умови;
**P2** — дрібніше, косметика, борг.

---

### 2.1 P0 — Гроші виходять неправильні

| # | Де | Що | Наслідок |
|---|---|---|---|
| A1 | `modules/finance/data/folio.repo.ts:262` ✅ | `folio.currency ?? 'EUR'`, а колонки `fin_folios.currency` **не існує** в жодній схемі (перевірено: 0 згадок) → завжди `undefined` → EUR. `folio` типізовано `any`, тож tsc мовчить. Legacy-шлях `reservation-invoice.repo.ts:99` бере `res.currency \|\| 'CZK'` правильно | **кожен інвойс через фоліо/split-bill виходить у EUR**. Готель у CZK видає гостю євро-фактуру з євро-суми через `Intl…currency` |
| A2 | `modules/channels/domain/booking-com/ari.ts:150` | ARI-пуш у Booking.com рахує ціни **тільки** з `price_calendar`, зі своєю копією weekend-правила; матриця заселеності `price_occupancy` і LOS-знижки ігноруються (інваріант 16). Тепер тримає гейт `check-price-source.mjs` | готель із заповненою матрицею продає напряму за одними цінами, а OTA-гість бачить інші |
| A3 | `components/booking/BookingViewModal.tsx:489-500` | зміна дат броні рахує ціну лінійно `total/oldNights × newNights` — без переквоти. Продовження на вікенд/інший сезон дає ціну, якої нема в жодному прайсі | ціна броні розходиться з прайсом готелю |
| A4 | `components/booking/BookingViewModal.tsx:1346-1352` | турзбір у вкладці: `дор. × ночі × 25 CZK` — **захардкоджені** ставка й валюта; `BookingForm` поруч бере з налаштувань | німецький готель бачить чужу ставку в чужій валюті |
| A5 | `app/app/(dashboard)/reports/city-tax/page.tsx:108-176` | звіт турзбору жорстко пише `CZK` у всіх сумах; головний звіт `reports/page.tsx:88-90` цю саму проблему вже виправив (`organization?.currency`) | для EUR/PLN/UAH готелю податковий звіт у чужій валюті |
| A6 | `modules/finance/api/reports.pnl2.ts` | паралельна класифікація витрат за укр/рос ключовими словами («оренда», «прибиральниця», «airbnb»), дивіденди виключені лише тут, «Роялти = 30%» лише для BU з назвою «glamping». Канон — `money-metrics.ts:42-56` за `ec.classifier` | EBITDA на PNL-2 розходиться з P&L/Overview за той самий місяць; для готелю з іншою мовою категорій усе падає у «Прочие» |
| A7 | `components/booking/BookingViewModal.tsx:51,626` + `MobileBookingDetail.tsx:65,450` | захардкоджений курс `CZK→EUR = 25.5` у двох файлах, застосовується до будь-якої не-EUR валюти (і до USD як до крон) | конвертована сума дедалі неточніша; окрема константа від турзбору A4 |
| A8 | `app/app/(dashboard)/finance/reports/…` (`getExpectedPayments` `reports.handlers.ts:948-973`, `getBalanceSheet` `:627-644`) `[SQLite]` | «Очікувані платежі» і «Баланс» (передоплати + активи) без `organization_id`, хоча сусідні запити тієї ж функції скоуплять | звіти сумують суми **всіх** організацій |

Контекст, щоб не шукати заново: операторська `BookingForm` квотує через
`/api/pricing/quote` лише коли поле ціни порожнє — введена руками ціна свідомо
перемагає (фіча). Віджет `widget-reserve` дисциплінований: `priceNights()`,
відмова 409 на непокриті ночі, `occupancyPriced` вимикає подвійну доплату.

### 2.2 P0 — Безпека

| # | Де | Що | Наслідок |
|---|---|---|---|
| B1 | `deploy/docker-compose.yml:24-37` + `app/api/cron/*`, `hostex/sync`, `webhook-hostex.handlers.ts` ✅ | compose прокидає в контейнер лише 7 змінних — `CRON_SECRET`/`HOSTEX_WEBHOOK_SECRET`/`ICAL_CRON_SECRET` серед них **немає** → у контейнері вони назавжди `undefined`. Крон-роути тоді падають на дефолт `\|\| 'local-cron'` (публічно відомий з коду) або `if(!SECRET) return true`. `NODE_ENV=production` захардкоджено | **будь-хто з інтернету** може смикнути крон із `Authorization: Bearer local-cron` і змусити сервер розсилати листи гостям, анонімізувати дані, запускати синк; Hostex-вебхук приймає непідписані події. ✅ `guest-reminders` з `local-cron` → 200 |
| B2 | `core/security/secrets.ts` (весь файл) + `core/integration-credentials.ts:170-199` | `encryptSecret`/`decryptSecret` **не викликаються ніде** (knip); `saveIntegrationCredentials` пише Hostex-токен, PriceLabs-ключ, Booking.com secret, Fiskaly secret у `channel_credentials` відкритим `TEXT`. `deploy.sh`/`DEPLOY.md` обіцяють шифрування через `APP_SECRET_KEY` | секрети інтеграцій усіх готелів лежать у БД відкритим текстом; обіцянка «encryption at rest» не виконана жодним рядком |
| B3 | `modules/bookings/api/service-orders.handlers.ts:19,21,80,82` ✅ | `?date=` вставляється в SQL string-interpolation (`service_date = '${dateParam}'`) без параметризації | **SQL-ін'єкція**. ✅ `date=x'`→500, `date=2026-01-01' OR '1'='1`→200 |
| B4 | `core/privacy/ocr-consent.ts:19-31` (усі 3 виклики без `organizationId`: `guest/[token]/ocr`, `bookings/ocr`, `widget-ocr.handlers.ts:37`) | без аргументу читає `ocr_cloud_fallback` **найстаршої** організації (`ORDER BY created_at LIMIT 1`) і застосовує її GDPR-згоду до документів гостей **усіх** готелів. Власний коментар визнає недоробку | готель, що заборонив хмарний OCR, усе одно шле паспорт гостя в OpenAI, якщо перший клієнт платформи дозволив — реальний GDPR-витік |
| B5 | `app/api/guest/[token]/ocr/route.ts:11-17` | `token` йде лише як ключ rate-limit, у БД **не перевіряється** (`'ocr' as any` обходить типізацію) | rate-limit обходиться будь-яким рядком-токеном → безкоштовне навантаження на платний OpenAI Vision |
| B6 | `app/api/accounting/invoices/list/route.ts:28-65`, `isdoc-batch/route.ts:75-98` `[SQLite/prod?]` | `requireOwner`, але запит **без** `organization_id`, `LIMIT 1000` → до 1000 рахунків / ISDOC усіх організацій (імена, адреси, суми гостей) власнику одного тенанта. На PG залежить від того, чи guard встановив контекст — треба живий тест | крос-тенант витік фінансових документів |
| B7 | `app/api/uploads/[...path]/route.ts:15-49` `[SQLite]` | GET лише `withActor`, без перевірки власника файлу; коментар сам: «guest documents, bank statements, registration scans — leaked filename was enough». Ім'я передбачуване (`baseName_${Date.now()}`) | будь-який залогінений юзер будь-якого готелю читає чужі скани документів/виписок |
| B8 | 18 легасі-роутів (grep) | `error.message` у тілі 500-відповіді клієнту (порушення інваріанта §6 AGENTS.md): `accounting/*`, `payments/*`, `coupons/[id]`, `bookings/ocr`, `file-upload`, `test-email`, … | деталі внутрішніх помилок/структури БД витікають клієнту |

### 2.3 P0/P1 — Ізоляція тенантів (порушення стандарту; `[SQLite]` = відкрито без RLS)

Головний клас. `audit-tenant.mjs` рахує **681** запит без обмеження за
організацією (114 critical). Ревʼюери підтвердили конкретні читанням обох
сторін. На проді PG здебільшого тримає RLS; винятки й `[SQLite]`-відкритість —
нижче.

| # | Де | Що |
|---|---|---|
| C1 | `app/api/booking-sites/[id]/**` — 6 файлів (`route.ts`, `listings`, `rate-plans`, `services`, вкладені) | **0 викликів `runWithOrganization`**; RLS `booking_sites` унікально permissive (`schema.sql:2771-2773`: `OR app.organization_id = ''`) → на **проді** GET віддає чужий `design_config`/`widget_config`/`allowed_domains` (id дістається публічно через `/api/booking/site-config?slug=`). PATCH/DELETE на PG падають RLS → **редагування сайту зламане для всіх на проді**; на SQLite — повний cross-tenant read/write/delete, ще й без перевірки `manage_sites`. `booking-sites/route.ts` (список/POST) — правильно |
| C2 | `modules/bookings/api/group-bookings.handlers.ts`, `group-booking.handlers.ts`, `group-booking-assign.handlers.ts` `[SQLite]` | список/оновлення/видалення груп по `WHERE rg.id=?` без org; `createGroupBooking` бере `unitIds`/`buildingId` з тіла без `ownedUnit` → бронь пишеться на чужий `property_id` |
| C3 | `modules/bookings/api/sub-bookings.handlers.ts:12-156` `[SQLite]` | IDOR: суб-бронювання будь-якої броні без `ownedReservation` |
| C4 | `modules/bookings/api/reservation.handlers.ts:159-188` | PATCH `unit_id` без `ownedUnit` → перенос броні на чужий юніт |
| C5 | `modules/bookings/api/audit-log.handlers.ts:68-105` `[SQLite]` | лише `role==='owner'`, без `organizationId`; без `reservation_id` віддає **всі** логи з повними before/after знімками чужих бронювань |
| C6 | `modules/finance/api/operations.handlers.ts` (get/update/delete/merge), `accounts.handlers.ts:101-175`, `capex-item.handlers.ts`, `budgets.handlers.ts:81-93` `[SQLite]` | читання/запис/видалення/злиття фін-об'єктів по `WHERE id=?` без org (list/create поруч — правильно). id відтворюваний (`inc_${Date.now()}`) |
| C7 | `modules/finance/api/reports.handlers.ts` `finance/history` | докстрінг сам: «ALL audit entries across all operations»; `where[]` без org |
| C8 | `app/api/coupons/[id]`, `package-offers(+[id])`, `gift-cards/workflow` `[SQLite]` | `WHERE id=?`/`site_id=?` без org, тоді як `gift-cards/route`+`[id]` зроблені правильно (контрольний приклад) |
| C9 | `app/api/invoices/[id]/route.ts:25,33` | DELETE рахунку без `organization_id` **і** без перевірки `locked`/`isPeriodLocked` → замкнений бухгалтерський період обходиться видаленням через окремий ендпоінт |
| C10 | `modules/properties/api/photos.handlers.ts:12-99`, `app/api/photos/[...path]` `[SQLite]` | upload/delete фото property/unit_type: id з клієнта без перевірки власності |
| C11 | `modules/channels/api/ical-channels.handlers.ts`, `ical-channel.handlers.ts` `[SQLite]` | список/оновлення/видалення iCal-каналів (URL, export-токени) без org — єдині в модулі без захисту в SQL |
| C12 | `modules/widget/api/site-analytics.handlers.ts:811` | ліди зіставляються з `reservations` без `site_id` → між сайтами однієї організації конверсія плутається; `getAnalyticsFunnel:779` не має гілки `siteId==='all'` → воронка звернень завжди 0 |
| C13 | `modules/guests/data/guest-actions.repo.ts:44` | `orderServices`: `SELECT price FROM additional_services WHERE id=?` без `property_id` → послуга чужої property того ж тенанта замовляється по чужому id |
| C14 | `modules/finance/api/business-units.handlers.ts:8` `[SQLite]` | `SELECT * FROM business_units WHERE is_active` без org — живить піклер «Об'єкт» задач (див. D1) |

### 2.4 P1 — Функції, які ніколи не працюють

| # | Де | Що (усі ✅ де позначено — перевірено живим запитом) |
|---|---|---|
| D1 | `modules/tasks/data/tasks.repo.ts:107,~140` + `tasks/page.tsx:1415` | прив'язка задачі до «Об'єкта»: `LEFT JOIN business_units ON id=t.property_id`, а FK вимагає `properties(id)`; піклер наповнюється з `/api/business-units` → запис падає FK-помилкою. **Ніколи не міг працювати** |
| D2 | `app/app/(dashboard)/tasks/page.tsx:481-500,1604-1642` | помилка D1 ковтається: `fetch` без `res.ok`, порожній `catch`, `onUpdated()` безумовно → UI показує «успіх», після F5 поле порожнє |
| D3 | `modules/properties/api/general-settings.handlers.ts:117-136` ✅ | `UPDATE organizations` має **17** плейсхолдерів, а масив — **16** значень (загублено `ocr_cloud_fallback`) → `WHERE id=?` лишається без параметра → **кожне** збереження «Загальних налаштувань» падає 500. ✅ `PUT /api/settings/general` → 500 «Too few parameter values» |
| D4 | `app/app/(dashboard)/bookings/page.tsx:526` ✅ | кнопка «Позначити no-show» шле `PUT /api/bookings/[id]`, а роут експортує лише GET/PATCH/DELETE → 405; без `res.ok` алерт зникає, статус лишається `confirmed`. ✅ PUT→405 |
| D5 | `finance/_components/ReconcileWidget.tsx:19` + `ReconcileModal.tsx:34` ✅ | звірка не працює з обох боків: віджет на головній finance фетчить неіснуючий `/api/finance/reconcile` (тихо зникає); кнопка «Створити коригування» шле на `/api/finance/accounts/[id]/reconcile` — хендлер `reconcileAccount` **готовий** (`accounts.handlers.ts:190`), але `route.ts` не створено → 404. ✅ обидва → 404 |
| D6 | `components/booking/RoomAllocationModal.tsx:285-415` | «обмін кімнатами»: `canAccept()` + зелена підсвітка `ram-swap` запрошують перетягнути, а `attemptMove` завжди `throw 'Обмін поки не підтримується'`. Stub під виглядом робочої функції |
| D7 | `modules/channels/api/poll.handlers.ts` + `booking-com/reservations.ts:282` | Booking.com «pull reservations» кличе `requireOrganizationId()`/`requirePropertyId()` без сесії → з 2+ org або 2+ properties кидає, виняток ковтається → **резервації з Booking.com Connectivity ніколи не зберігаються** в мультитенант-інсталі; `findOrCreateGuest` без org чіпляє гостя одного готелю до броні іншого |
| D8 | `modules/pricing/data/pricelabs-sync.ts` + `cron-pricelabs-sync.handlers.ts` | PriceLabs-cron не встановлює org-контекст → на PG `scopeToTenant` ставить `app.organization_id=''` → `SELECT units` = 0 → cron **завжди** `{ok:false,'No listings resolved'}` 500. На SQLite працює випадково. Той самий клас уже виправляли в `cron/guest-reminders` — тут фікс відсутній |
| D9 | `modules/channels/api/ical-cron.handlers.ts:35-41` | iCal-cron фетчить `/api/ical-sync/sync` **без кукі**, а той під `withPermission` → завжди 401; `res.ok` не перевіряється, рапортує «Synced N» → **автоматичний iCal-синк (5/15/30/60 хв) не працює**, лише ручне натискання |
| D10 | `modules/channels/data/hostex-client.ts:22-26` | Hostex-орендар у module-level змінній; `setHostexOrganization()` кличуть лише 3 сесійні GET-хендлери, а `hostexSync()` (кнопка+cron+вебхук) — ні → з 2-м готелем синк працює «чиїм завгодно» токеном. Вебхук реєструє одну глобальну URL з одним env-секретом — не розрізняє орендарів |
| D11 | `modules/pricing/domain/pricelabs-client.ts:61-71` | PriceLabs API-ключ теж у module-level змінній; сеттер кличе лише preview → cron/кнопка читають ключ **останньої** організації, що відкривала Preview → змішування цінових даних між орендарями |
| D12 | `app/api/settings/general` etc. → `general-settings.handlers.ts` | (див. D3) — блокує назву, таймзону, валюту, мову, реквізити, IBAN одразу |

### 2.5 P1 — Мертві кнопки, вкладки, обірвані підключення

| # | Де | Що |
|---|---|---|
| E1 | `modules/widget/ui/BookingIframePage.tsx:1093` | кнопка «застосувати промокод/сертифікат» — `onClick={() => { }}`. Гість тисне — нічого (грошовий шлях віджета) |
| E2 | `components/booking/BookingViewModal.tsx:742` | кнопка «Відгук» у банері дії — `onClick: () => {}`, показується для checked_out 1-7 днів тому |
| E3 | `sites/[siteId]/_components/SiteHelpers.tsx:21` + `page.tsx:143` | вкладка «Форми» (Inbox) є в TABS і рендериться кнопкою, але `FormsTab` не існує → клік = порожня панель. Мала показувати `site_incoming_leads` |
| E4 | `sites/[siteId]/_components/SiteGiftCardsTab.tsx` | **єдиний** спосіб випустити подарунковий сертифікат (єдиний `POST/PATCH/DELETE /api/gift-cards*`) не підключений до меню → продавати сертифікати нема як, гасити вже можна |
| E5 | `modules/widget/ui/BookingIframePage.tsx:454-458` | `applyCoupon` не кличе API — завжди `{success, offerApplied}` для будь-якого рядка. Гість бачить «Успішно застосовано» для неіснуючого коду (у `BookingV2` цей шлях правильний) |
| E6 | `app/app/(dashboard)/settings/page.tsx:92` | плитка «AI База знань» → `/app/settings/ai-knowledge` (сторінки нема) + `ChatWidget.tsx:81` → `POST /api/ai/query` (роуту нема). Увесь «AI-ресепшн» недобудований: плитка є, сторінки й API немає |
| E7 | `components/booking/BookingViewModal.tsx:1507` | «+ Додати рядок» шле PATCH без `subtotal` → заголовок картки й індикатор ✅/⚠️Δ рахують застаріле `subtotal`, показують хибне |

### 2.6 P1 — Мертві виклики API і переходи (матриця fetch↔маршрути + жива перевірка)

Усі ✅ підтверджені живим запитом (§3). 259 маршрутів × 516 `fetch`; ре-експорти route.ts усі коректні.

- **404 (шлях не існує):** `ChatWidget.tsx:81` `POST /api/ai/query` ✅ (компонент і сам мертвий); `ReconcileWidget.tsx:19` `GET /api/finance/reconcile` ✅; `ReconcileModal.tsx:34` `POST /api/finance/accounts/[id]/reconcile` ✅; `payments/services/page.tsx:73` `GET /api/finance/paid-services` ✅; `MobileGuests.tsx:295` `GET /api/guests/[id]/reservations`.
- **405 (метод):** `bookings/page.tsx:526` `PUT /api/bookings/[id]` ✅ (єдиний з ~150 write-запитів — D4).
- **Мертві переходи на сторінки:** `/app/finance/reconcile`, `/app/finance/clearing` (×2), `/app/finance/payments/orphans` (×3), `/app/settings/ai-knowledge`.
- **Мертві embed-скрипти на сайтах готелів (P0 для тих, хто їх поставив):** `public/widget/native-bundle.js` не перезібраний після фіксу `d1d52b4` — досі кличе видалений `/api/booking/checkout-session`; `service-embed.js:339` те саме + `:293` `GET /api/booking/promo` (перейменовано на `/activate`) → промокод завжди «Invalid»; `collector.js:27` `POST /api/public/capture` (роуту нема) → ліди з форм губляться мовчки.
- **Аналітика віджета не долітає:** `WidgetTab.tsx:92` роздає готелям `embed.v2.js`, а `postMessage`-протокол (purchase, UTM) розуміє лише `public/embed.v2.js` (корінь), не `public/widget/embed.v2.js` → Meta/GA4/TikTok Pixel purchase не спрацьовує в жодного готелю, що поставив за інструкцією.
- **Сироти (бекенд готовий, входу з UI нема):** `partner-reports` (+revoke/rotate) → тому `/report/:token` недосяжний; `finance/cash-closings` (закриття каси); `finance/budgets/[id]` DELETE; `tasks/projects/[id]`, `tasks/tags/[id]` (ред/видал); `guests/[id]/gdpr` (експорт/стирання — комплаєнс без кнопки); `settings/language` (перемикача мови нема).

### 2.7 P1 — Мова, дати, специфіка юрисдикцій

| # | Де | Що |
|---|---|---|
| F1 | `core/i18n/resolve.ts:92-97` `guestLanguage()` мертвий; `modules/widget/ui/hooks/useBookingWidget.ts:21,189` | мову віджета обирає клієнт, fallback жорстко `'uk'` → готель із базовою de/cs показує віджет **українською** кожному гостю без `?lang=`, чий браузер не влучив у `['uk','en','cs','de']`. Суперечить задокументованому наміру `resolve.ts:88-90` |
| F2 | `modules/guests/domain/ai/mrz-parser.ts:47` + `meldeschein.ts:51` + `registry.repo.ts:96` | 3-літерні коди громадянства (DEU/CZE — з MRZ і з підказки форми `page.tsx:690`) проти 2-літерних перевірок (`=== 'DE'`, `!= 'CZ'`); конвертера alpha3→alpha2 в репо нема → німець **ніколи** не звільняється від Meldeschein, чех завжди «іноземець» в Evidenční kniha |
| F3 | `modules/guests/data/registration.repo.ts:41-42,74,76` | `guest.nationality` пишеться в колонку `country`; `guests.nationality` лишається NULL для самозареєстрованих; `meldeschein.repo.ts:55` читає саме `guests` → бланк показує «Staatsangehörigkeit» **бракуючим**, хоча гість вводив |
| F4 | `modules/guests/api/gdpr.handlers.ts:119-129` | `eraseGuestData` не обнуляє `nationality`, але каже `identityErased:true` — право на стирання виконується не повністю |
| F5 | dashboard/alerts/reports/city-tax (`.handlers.ts`) | «сьогодні» = `new Date().toISOString()` (**UTC**), а не `organizations.timezone` (існує, ніхто не читає) → для Праги/Києва перші 1-3 год доби списки заїздів/виїздів, occupancy і авто-архівація no-show зсунуті на добу |
| F6 | `modules/finance/domain/invoice-document.ts:265` | документ «усіма 7 мовами» насправді 2 (de-DE, cs-CZ), решта → en-GB (підтверджено власним тестом `invoice-document.check.ts:152`) — PRODUCT.md §3.4 перебільшує |

### 2.7a P0 — Захардкоджений контакт першого клієнта для всіх готелів

| # | Де | Що |
|---|---|---|
| G1 | `app/guest/[token]/page.tsx:143,508,1636` | `WHATSAPP_NUMBER = '420723565616'` — єдиний номер для кнопки WhatsApp у **всіх** готелів; поля в `property_guest_config` нема. Той самий клас уже ловили й виправляли поруч (`FarBeforeScreen.tsx:111` — `property_phone`) → гість готелю B/C пише пілотному готелю |
| G2 | `modules/widget/data/site.repo.ts:9` (коментар, виправлено), але `app/guest/[token]/translations.ts:257` + `page.tsx:1199` | адреса «Loketská, Karlovy Vary» у футері гостьової сторінки; `svc_sauna`/`svc_breakfast` із fallback-ціною 600 у віджеті (`BookingIframePage.tsx:511`); плейсхолдери «Stealth House»/«Будова F». Гейт `check-no-tenant-names` цих рядків не знає — сліпа зона словника |

### 2.8 P2 — Хвіст видалених модулів і розбіжності PRODUCT.md

- `tsconfig.json:47-48` — аліас `@payments` → неіснуючий `src/modules/payments` (Teya вирізано; збірка не падає, бо ніхто не імпортує).
- `modules/finance/README.md`, `channels/README.md` — описують `teya-reconcile-engine`, `clearing.handlers`, `reconcile-dashboard`, `testChannels`, таблиці `channel_unit_mappings`/`channel_sync_queue`, яких нема (реальні: `channel_room_mapping`/`ari_sync_queue`).
- Шина подій порожня: єдиний підписник `payment.completed` (`bookings/events/subscribers.ts:7`) — цю подію ніхто не емітить (Teya вирізано); реальні `booking.created`/`booking.payment_status_changed` — без підписників → **пост-оплатне підтвердження броні не надсилається ніколи** (миттєве «заявку отримано» — окреме, працює). 9 файлів `modules/*/events/published.ts` — мертві.
- PRODUCT.md розбіжності: §7 `getGlampingReport` — функції **не існує** (лише в застарілому README); §6 «інвесторського коду немає» — насправді Є мертвий `performance-score.ts`, читає таблиці `investor_investments`/`investor_payouts`, яких нема в схемі → виклик упав би; «Teya під корінь» — рядок «Teya Payment Gateway» досі в `BookingV2.tsx:909` (мертва гілка).
- ARCHITECTURE.md: «14 модулів» — на диску **12** (`notifications`, `payments` вирізані); числа пробоїв меж у §8 застаріли (актуальні: `check-boundaries` — finance 19, bookings/properties 9/8…).

### 2.9 P2 — Дублікати логіки й формул (розійдуться при наступній правці)

- **«Завантаженість» — дві формули:** `dashboard.handlers.ts:32-38` (сьогодні; активні non-pool; checked_in+confirmed) vs `reports.handlers.ts:78-100` (період; **всі** юніти; усі статуси крім cancelled/draft). Підпис однаковий → власник бачить різні числа за той самий день.
- `TASK_STATUS_CONFIG`/`PRIORITY_CONFIG`: канон `tasks/domain/types.ts:62` мертвий (ніхто не імпортує), `tasks/page.tsx:110` тримає власну копію.
- `parseBlockPrices` (events) живий у repo, але `events/page.tsx:35` має ідентичну клієнтську копію.
- `appUrl()`/`appUrlConfigured()` мертві; 7 місць вручну конкатенують `appBaseUrl()+/guest/token`.
- `unauthorized`/`forbidden` з `session.ts` продубльовані приватно в `route-guard.ts:32`.
- `quote.repo.ts:25-36` рахує `isWeekend`/`dayName` локальним часом проти UTC у канонічній `dayPrice()` (сама ціна ок).

### 2.10 P2 — Мертвий код, залежності, таблиці, цикли

- **20 файлів** нікого не імпортують (`npm run audit:dead-code`): `OfferWorkflowTab`, `ChatWidget`, `MobileCardList`, `vrbo-parser`, `cashback-calculator`, `pdf-loader`, `performance-score`, `chat.repo` (готовий чат гостя без API-маршруту й UI), `secrets.ts` (див. B2), 9× `events/published.ts`.
- **8 залежностей** ніхто не імпортує: `date-fns`, `imapflow`, `mailparser`, `xml2js` (+ `@types`), dev `esbuild`. `imapflow`/`mailparser` — слід вирізаного finance-wrapper.
- **21 таблиця** без коду (`audit-dead-data`): `payment_webhook_log`, `audit_log`, `import_*`, `fin_*_inboxes`, `*_new`/`*__rebuilt` (migration-temp).
- **`fees_taxes` недосяжна:** `quote.repo.ts:43` рахує збори з таблиці, яку наповнює лише demo-seed — ні екрана, ні CRUD-хендлера → у реального клієнта міське мито/прибирання в квоті завжди 0.
- **15 циклів** (`madge`): 14 пар `*Tab.tsx ↔ *Modal.tsx` у `finance/settings/_components`; 15-й — `ocr-document.ts ↔ mrz-parser.ts`.
- **Cron без планувальника:** у репо нема crontab/systemd/workflow для `/api/cron/*` — можливо, крон на VPS поза git; якщо ні — `gdpr-retention`, `guest-reminders`, `abandoned-carts`, `sync-cnb-rates`, `sync-pricelabs` не запускаються ніколи (перевірити на сервері).

### 2.11 P2 — Дрібніше

- `service-orders.handlers.ts` / `sub-bookings` — крім B3/C3: `updateServiceOrder` IDOR (статус чужого замовлення).
- `group` edit дат без перевірки `checkOut>checkIn` (`GroupViewModal.tsx:188`) → інвертовані дати як «1 ніч».
- `changeStatus` на календарі (`calendar/page.tsx:546`) — `if(res.ok)` без `else` → 422 «без оплати» = тиша, кнопка «зависла».
- `MobileBookingDetail` — мертва `canCheckIn:136`, невикористана `STATUS_LABELS:30`; статус `no_show` відсутній у 6 UI-словниках → фільтра нема, бейдж сірий сирим кодом.
- `pii-mask.ts` — 6 функцій маскування мертві (живуть лише `*ForSheets`).
- `test-email` — owner шле на будь-який `?to=` через SMTP тенанта (open-relay у межах тенанта).
- `.env.example` мертві ключі: `STRIPE_SECRET_KEY`, `GOPAY_API_KEY`, `HOSTEX_API_KEY` (реальна `HOSTEX_ACCESS_TOKEN`), `NEXT_PUBLIC_APP_DOMAIN`; **відсутній** `DB_DRIVER` (хоча `DATABASE_URL` є → копія лишає застосунок мовчки на SQLite) і всі cron/webhook-секрети (див. B1).
- 2 booking-віджети паралельно: `/w/[siteSlug]` (BookingV2) і старий `app/booking/page.tsx` (2100 рядків) — патчити окремо.

---

## 2.12 Виправлено (оновлюється в міру розбору)

| # | Коміт | Як доведено |
|---|---|---|
| A1 | `11cd7e6` | колонка `fin_folios.currency` (міграція 0031, CREATE+ALTER), валюта заморожується при створенні з броні → організації, ніде літерала. Гейт `folio-currency.check.ts` у `npm run check`, доведений зворотним: повернув `?? 'EUR'` — упав. Сторно в тому ж файлі мало ту саму ваду, теж виправлено |
| B3 | `e468fdf` | `?date=` параметризовано + перевірка форми. Живим запитом: `x'` → 400, `2026-01-01' OR '1'='1` → 400, звичайна дата → 200. Дорогою: обидва запити скоуплено за організацією і прибрано SQLite-специфічний `date(?, '+7 days')` |
| D3 | `6f07b1c` | 17-й плейсхолдер отримав значення; `PUT /api/settings/general` → 200 і значення справді в базі. `ocr_cloud_fallback` читається явно: відсутнє поле лишає збережене, а не скидає GDPR-згоду в нуль |
| B4/B5 | `d56f594` | `cloudOcrAllowed()` вимагає організацію (без неї — вимкнено); токен гостя резолвиться ПЕРШИМ (три вигадані токени → 404, ліміт не витрачається). `widget-ocr.handlers.ts` видалено — маршруту не мав, а спитати згоди не міг |
| F1/F6 | (цей коміт) | F1: віджет відкривався `useState('uk')`, і зрушити це міг лише браузер, чия мова випадково одна з uk/en/cs/de. Тобто польський, голландський чи італійський гість німецького готелю бронював номер **українською** — мовою, якої не знає ні готель, ні гість, на сторінці, де він вирішує, чи платити. Тепер порядок такий, як його й описує `core/i18n/resolve.ts` для гостя: `?lang=` → `__BOOKING_LANG__` на сторінці готелю → браузер → **мова готелю** → англійська. Мова готелю приїжджає з `/api/booking/site-config` (нове поле `language`), а не з `Accept-Language` на сервері: ця відповідь однакова для всіх гостей сайту й кешується як така — браузер читається в браузері. Мова, якої віджет не вміє (продукт знає сім, віджет чотири), провалюється далі, а не рендериться напівпорожньою. Полагоджено обидва віджети — `BookingV2` і `BookingIframePage` (у другого немає навіть перемикача, тобто вийти з української не було як). Доведено живим запитом на Postgres: готель із `language='de'` → `"language":"de"`, готель із `pl` → `null` (віджет польської не має), плюс гейт `widget-language.check.ts`. F6: PRODUCT.md §3.5 казав, що рахунок виходить «усіма 7» мовами — насправді власну форму мають дві юрисдикції, de-DE і cs-CZ, решта → en-GB. Код чесний і це стверджує його ж тест; перебільшував опис — виправлено, і додано рядок про віджет, у якого мов чотири |
| F5 | (цей коміт) | `@core/hotel-day`: `todayFor(organizationId)` читає `organizations.timezone` (є в схемі з DEFAULT `Europe/Prague`, і до цього коміту його не читав ніхто). Прага взимку +1, влітку +2, Київ +2/+3 — тобто перші одну-три години кожної місцевої доби сервер вважав, що ще вчора: список заїздів показував тих, хто приїхав учора, список виїздів гнався за гостями, які вже виїхали, occupancy рахувалася не за той день, а авто-архівація no-show — яка **пише** — міряла проти вчорашнього. Найбільше це б'є по нічному портьє, що заступає опівночі, а «перша година зміни показує не те» — рівно та поломка, яку обходять, а не повідомляють. Переведено 25 місць у dashboard, alerts, city-tax, reports, day-sheets, service-orders і всьому `finance/api`; регулярні операції рахують «майбутнє» за календарем свого готелю, а не сервера. Гейт `check-hotel-day.mjs --strict` тримає нуль, `hotel-day.check.ts` фіксує момент, який був неправильним (23:30 UTC у Празі й Києві — уже завтра), зиму проти літа, від'ємний зсув Нью-Йорка й невідому таймзону (падає на UTC, а не валить сторінку). Попутно: `expected-payments` — прогноз «хто ще винен гроші» — вибирав із `reservations`, не називаючи орендаря взагалі, і повертає ім'я та e-mail гостя; на Postgres ховала RLS, на SQLite фінансовий екран одного готелю перелічував боржників іншого поіменно. Плюс шаблони регулярних операцій (`fin_recurring_templates`) адресувалися по id без організації — читання, редагування, вимкнення й «виконати зараз». Доведено зворотним: без фільтра проба падає «B's payment forecast lists A's unpaid booking»; перша версія проби проходила вхолосту (бронь без ціни випадала з `outstanding > 0`), тому тепер стверджується й те, що прогноз **самого A** свою бронь містить |
| F2/F3/F4 | (цей коміт) | F2: один нормалізатор `@core/country-code` — `alpha2()` — і всі три правила кличуть його. `DEU` ≠ `DE` вирішувало два юридичні обов'язки: німець **ніколи** не звільнявся від Meldeschein (готель заповнював бланк, якого закон не вимагає, для власних громадян), а чех **завжди** був іноземцем у Evidenční kniha — реєстрі, який читає поліція. Помилка без симптому: бланк друкувався, реєстр вивантажувався, просто не про тих людей. Чеські порівняння в SQL приймають обидва написання. Гейт `country-code.check.ts` доведено зворотним: повернув `.toUpperCase()` — упало на «a German passport still demanded a Meldeschein». F3: самореєстрація писала громадянство в `guests.country`, а `meldeschein.repo` читає `g.nationality` — тобто бланк показував «Staatsangehörigkeit» **порожнім** для гостя, який щойно його ввів; тепер пишеться в обидві колонки, бо це різні поля (громадянство і країна проживання). F4: `eraseGuestData` не обнуляв `nationality`, `email`, `phone`, `whatsapp`, `city`, але відповідав `identityErased: true` — ст. 17 не виконується частково, і готель міг сумлінно відповісти суб'єкту даних і помилитися |
| G1/G2/E1/E5 | (цей коміт) | G1: номер WhatsApp став полем готелю (`property_guest_config.whatsapp_phone`, міграція 0033) — раніше константа в коді гостьової сторінки вела на телефон пілота, а вкладка WhatsApp стоїть у нижній панелі поруч із «Головна», тож гість, замкнений о другій ночі, писав чужому власнику; порожнє поле — вкладки нема, бо кнопка в чат ні з ким гірша за її відсутність. G2: адреса пілота була `footerLocation` **у семи мовах** — саме переклад її і сховав, бо у словнику вона читається як продуктовий текст; тепер береться з property, а гейт `check-no-tenant-names` навчено номера, вулиці й міста. Ціни-заглушки послуг (600/600/300/500/500) прибрано: `null` до відповіді сервера і `null` назавжди, якщо готель цієї послуги не продає — картка просто не показується. Число, вигадане клієнтом, — це ціна, якої готель не називав. E1/E5: `applyCoupon` більше не приймає будь-що — кличе `/api/booking/activate`, той самий, що й `BookingV2`; кнопка сертифіката мала `onClick={() => { }}` і не робила нічого взагалі |
| D1/D2/D4/D5/D9 | (цей коміт) | D1: піклер «Об'єкт» брав id із `/api/business-units`, а FK у `tasks.property_id` веде на `properties` — тобто поле не зберігалось **жодного разу з моменту появи**, ні на Postgres (500 від FK), ні на SQLite (записувалось у нікуди); JOIN у репозиторії теж читав не ту таблицю. D2: `res.ok` тепер перевіряється й `onUpdated()` виконується лише після справжнього збереження — раніше `fetch` на 500 не кидає, тож порожній `catch` навіть не спрацьовував, а шухляда перемальовувалась зі свого ж локального стану. Додано банер «не збережено»: екран зберігає по дебаунсу без кнопки, тож тиша — єдиний зворотний зв'язок, і вона означала і «збережено», і «відмовлено». D4: кнопка no-show шле PATCH замість PUT (роут експортує GET/PATCH/DELETE) і перевіряє відповідь. D5: створено `accounts/[id]/reconcile/route.ts` — хендлер `reconcileAccount` був готовий увесь час, бракувало чотирьох рядків, які його відкривають; віджет «Reconciliation Inbox» видалено (фетчив неіснуючий маршрут, ловив помилку, рендерив null — тобто був невидимий — і вів на неіснуючу сторінку). D9: iCal-cron кличе `syncChannel` напряму замість HTTP-запиту до власного маршруту під `withPermission` (звідки й брався вічний 401), а кожен канал виконується в контексті своєї організації — без цього на Postgres RLS відмовила б кожен запис. Лічильник рахує успіхи, а не спроби. **Живі проби**: задачу прив'язано до об'єкта й перечитано з БД; надіслав туди id бізнес-юніта, як це робив старий піклер, — 500 від FK |
| C10–C14 | (цей коміт) | C10: `ownsEntity` перед завантаженням і видаленням фото — id property/unit_type приходили полем форми, тож фото додавалось у чужий тип кімнати (і з'являлось на його публічній сторінці), а видалення знімало чуже й розлінковувало файл. C11: iCal-канали ходять через `ownedChannel` (join до `properties`) — у рядках лежить import-URL від OTA і **export-токен, який САМ по собі є доступом** до календаря готелю з іменами гостей. C12: воронка — `1=1` для `siteId === 'all'` замінено на власні сайти; ліди для 'all' більше не шукаються по `site_id = 'all'` (звідки й бралися нулі); зіставлення ліда з бронню по e-mail/телефону скоуплено за property — інакше гість, який написав у два готелі, зараховувався в конверсію обом. C13: `orderServices` бере ціну `AND property_id = ?` — id послуг приходять із браузера гостя, і без цього замовлялась чужа послуга за чужою ціною. C14: `business_units` фільтрується за організацією. **Доведено на SQLite**, а не на Postgres: там RLS тримає ці таблиці незалежно, тож реінтродукція на ній нічого не показує — прогін по SQLite із прибраною перевіркою дав «B repointed A's iCal import: 200» |
| C6–C9 | (цей коміт) | C6: `ownedFinanceRow` у `finance/data/owned.repo.ts` — операції (get/update/delete/**merge**), рахунки (update/archive/delete), capex, бюджети; злиття резолвить ОБИДВА id за організацією, бо воно видаляє одну операцію й перетворює другу на переказ. C7: `/api/finance/history` — докстрінг сам казав «ALL audit entries across all operations», і `where[]` починався порожнім; кожен запис несе `before_json`/`after_json`, тобто це були журнали всіх готелів, ще й із `?search=`. C8: купони, пакети та автоматизація ваучерів брали `site_id` із запиту й тіла на віру — GET показував чужі пакети з цінами, POST створював правила й **реальні промокоди на чужому сайті**, підшиваючи їх під ЧУЖУ організацію через субселект. C9: видалення рахунку тепер перевіряє орендаря, `locked` і закритий період — інакше закритий місяць можна було змінити заднім числом через цей один маршрут, лишивши дірку в нумерації, яку податкова очікує суцільною. Помилковий документ виправляють сторно, яке модуль уже вміє |
| C2–C5 | (цей коміт) | `reservations` не має власного `organization_id` — орендар приходить через `property_id`, тож `WHERE id = ?` тут не «покладається на RLS», а не питає нічого. C2: список груп скоуплено через `properties`, а `unitIds`/`buildingId` з тіла запиту перевіряються `ownedUnit` — інакше група писалась у чужі кімнати й потім підшивалась під готель ПЕРШОЇ з них. C3: усі чотири хендлери суб-бронювань питають `ownedReservation`, юніт із тіла — `ownedUnit`. C4: PATCH `unit_id` перевіряє цільовий юніт — володіти бронню не означає володіти кімнатою, у яку її переносять. C5: журнал змін фільтрує за організацією, а `?reservation_id=` теж звіряється; раніше один GET без параметрів віддавав усі записи всіх орендарів разом із `before_json`/`after_json` — повними знімками рядків чужих бронювань. Доведено живим прогоном: прибрав перевірку юніта — «A moved its booking onto B's room: 200». Заразом виявилось, що проба C4 мовчки пропускалась, бо в B узагалі не було жодного юніта — тепер B заводить власну property, категорію, тип і кімнату справжнім API |
| C1 | (цей коміт) | шість файлів під `booking-sites/[id]/**` ходять через `_owned-site.ts`: контекст орендаря відкривається, сайт читається `AND organization_id = ?`, чужий → 404 (не 403 — 403 підтверджує існування, а id сайту публічний). Каталог послуг і юніти в лістингах теж скоуплено: володіти сайтом не означає володіти кімнатою. **Обидві половини доведено живою перевіркою**: B не читає й не змінює сайт A, і A редагує свій — це та половина, яка на проді була зламана для всіх. Цікаве з реінтродукції: прибрати `AND organization_id = ?` при живому контексті на Postgres витік НЕ повертає (RLS ловить), а прибрати контекст — повертає одразу, 200 замість 404. Тобто на Postgres тримає контекст, на SQLite — явний фільтр; поодинці жоден не покриває обидва двигуни |
| B6 | (цей коміт) | `accounting/invoices/list`, `isdoc-batch` і `invoice-batch/zip` називають організацію в SQL, а не покладаються лише на RLS. У ZIP-маршруті id рахунків приходять у тілі запиту, тому належність стала параметром пошуку: чужий id просто не резолвиться. Місячний експорт — саме те місце, де відсутній фільтр орендаря стає витоком, який виходить із будівлі поштою бухгалтеру |
| B8 | (цей коміт) | 142 заміни кодемодом `scripts/codemod-server-errors.mjs` + одна руками (`bookings/ocr`, там текст vision-провайдера). `serverError(scope, err)` з `@core/http/errors` пише деталь у лог із міткою місця й віддає клієнту речення — обидві половини одним викликом, бо більшість цих обробників не мали `console.error` узагалі й «санітизація» перетворилась би на втрату діагностики. 4xx не чіпали. Тримає гейт `check-error-leak.mjs` у `npm run check` |
| B7 | (цей коміт) | організація стала першим сегментом шляху (`data/uploads/<org>/<folder>/<file>`), і шлях, який читається, будується з id самого актора — тобто чужий файл не можна адресувати, а не «можна, але відмовлять». 404, не 403: 403 підтверджує існування файлу. `Date.now()` у назві замінено на 8 випадкових байтів. Доведено живою перевіркою в `check-isolation.mjs`: A завантажує файл справжнім маршрутом, B тягне його за URL → 404; прибрав перевірку сегмента — 200 |
| B2 | (цей коміт) | секрети в `channel_credentials` шифруються AES-256-GCM із префіксом `enc1:`; без `APP_SECRET_KEY` збереження відмовляє 503, а не пише відкритим текстом. Гейт `integration-secrets.check.ts` у `npm run check`, доведений зворотним: прибрав `seal()` із запису — впав на «the API key is sitting in the database in the clear». Старі відкриті рядки читаються далі й конвертуються `scripts/encrypt-credentials.mjs --write` (потребує запуску на сервері, див. DEPLOY.md) |
| B1 | `56f044f` | один `cronAuthFailure`/`secretAuthFailure` замість пʼяти написань; не заданий секрет = 503. Живим запитом: без `CRON_SECRET` усі чотири крони на `Bearer local-cron` → 503; із заданим — правильний 200, дефолт 401, без заголовка 401. **Плюс ширша причина, ніж у знахідці:** `--env-file` годує лише інтерполяцію compose, тож у контейнер не доїжджало нічого поза списком із семи змінних — включно з `OPENAI_API_KEY`, який стоїть у шаблоні env-файлу. Тепер `env_file:` бере файл цілком |

**Знято разом з інтеграціями (2026-08-25).** Рішення власника: Hostex і
PriceLabs видалено під корінь, а не виправлено на місці. Підстава — виміряна,
не смакова: пілот не вмикає жодну (`hotels/schlossberghotel.json` без
`enable`), обидві принципово зламані на другому готелі (орендар Hostex і ключ
PriceLabs жили у **змінних рівня модуля**, які ставили лише кілька сесійних
хендлерів, тож крон, вебхук і кнопка працювали «чиїм завгодно» токеном), а
запис цін PriceLabs був прибитий до 6 юнітів пілота списком у коді.
Виокремлення в модуль означало б перенести саме цю модель тенантності далі.

Тому закриті видаленням: **D8** (PriceLabs-cron без org-контексту),
**D10** (орендар Hostex у змінній модуля), **D11** (ключ PriceLabs так само).
Дані лишились читабельними: колонки `reservations.hostex_*` і мітка
`source='hostex'` у `fin_operations`.

**Booking.com Connectivity API — видалено 2026-08-25.** Те саме рішення,
поширене на третю інтеграцію, і з іншою підставою: цю ніколи не було
підключено до живого акаунта. Не «ще не в проді» — взагалі: шість таблиць
(`channel_connections`, `channel_room_mapping`, `ari_sync_queue`,
`ari_sync_log`) порожні на кожній базі проєкту, форма облікових даних вказувала
на змінну оточення, якої ніхто не ставив, а ARI-пуш рахував ціни з
`price_calendar` зі своєю копією weekend-правила. Тобто ~3 500 рядків коду
(OAuth, OTA-XML, черга з ретраями, маппінг кімнат, лог RUID) коштували уваги на
кожному аудиті й не приносили нічого.

Закриті видаленням: **A2** (ARI рахує ціну повз `priceNights()` — запис із
LEGACY-списку `check-price-source.mjs` прибрано разом із файлом) і **D7**
(pull reservations без сесії). Схему прибирає міграція
`0032-a-channel-nobody-connected-is-not-a-channel.sql`; заразом падають
`hostex_sync_log` і `hostex_property_map`, які Hostex лишив по собі й які не
були скоуплені за орендарем узагалі. Міграція **зупиняється з поясненням**,
якщо хоч одна бронь має `bcom_reservation_id` — тобто якщо припущення «ніколи
не працювало» десь хибне, це буде видно, а не затерто.

Дані лишились читабельними й тут: `source = 'booking_com'` на історичних
бронях, значок каналу, пункт у списку джерел, правила `channel_rate_rules` для
ПДВ з однієї суми OTA. `channel_credentials` теж лишається — у ній тепер живуть
ключі фіскалізації (`@core/integration-credentials`).

**Потребує дії на сервері:** доки `CRON_SECRET`, `HOSTEX_WEBHOOK_SECRET` і
`ICAL_CRON_SECRET` не вписані в `deploy/env.prod` та `deploy/env.beta`,
відповідні крони й вебхук відповідають **503**. Це навмисно: мовчазне
виконання за публічно відомим паролем гірше за червоний крон. Зразки — у
`deploy/env.*.example`.

---

## 3. Що підтверджено живою перевіркою (2026-08-24, прод-збірка + наповнена організація)

Проти запущеного `npm start` з провіженою організацією й увімкненими фічами:

- **SQL-ін'єкція B3:** `?date=x'` → 500 «Failed to load», `?date=2026-01-01' OR '1'='1` → 200. Реальна.
- **Крон fail-open B1:** `GET /api/cron/guest-reminders` з `Authorization: Bearer local-cron` (дефолт із коду) → **200**. Секрет публічний, а docker-compose його не прокидає.
- **Валюта EUR A1:** колонки `fin_folios.currency` нема в жодній схемі (0 згадок) — `?? 'EUR'` завжди спрацьовує.
- **general-settings D3:** `PUT /api/settings/general` → 500 «Too few parameter values» (17 плейсхолдерів проти 16).
- **Мертві маршрути:** `/api/finance/reconcile`, `/api/finance/accounts/[id]/reconcile`, `/api/ai/query`, `/api/finance/paid-services` → усі 404; `PUT /api/bookings/[id]` (no-show) → 405.
- **Ізоляція тримається на PG:** `check-isolation.mjs` — усі 48 тверджень green; `audit-routes` — 322/322 операторські хендлери під вартою; `check-await` — 0. Тобто фундамент RLS на проді цілий; `[SQLite]`-знахідки — про другий шар захисту й локальне середовище.
- **Краулер:** 51 сторінка, 0 `DEAD_BUTTON`/4xx/5xx/crash (верхньорівневий UI цілий).

---

## 4. Межі аудиту (що НЕ перевірено)

- **Живий Postgres із двома тенантами не піднімався** — усі `[SQLite]`/RLS-висновки виведені зі схеми + коду; чи PATCH/DELETE `booking-sites/[id]` дає саме 500 на PG (C1), чи `invoices/list`/`isdoc-batch` течуть на PG (B6) — треба підтвердити на реальному PG-стенді.
- **Планувальник кронів поза git** — не видно, чи 5 cron-роутів реально викликаються на VPS (§2.10).
- **Математика фінансів** (ISDOC-XML, §14 UStG, VAT-снапшоти, ota-split) — перевірено, що файли підключені, не звірено числа по рядках.
- **Регекс-парсери OTA XML** (`ota-parser.ts`) — без реальних Booking.com пейлоадів (беруть перший `<Email>` — букер/гість можуть плутатись).
- **`fin_operations`/`capex`/`budgets` та ін. RLS-текст** — звірено вибірково (`fin_operations`, `reservations`, `booking_sites`), не кожна таблиця.
- **Мобільні екрани** (`components/mobile/**`) — вибірково; `settings/properties`/`units` на телефоні візуально не перевірені.
- **`in-memory` rate-limiter** при кількох інстансах, залипання `set_config` на пулі PG — не трасовано.

---

## 5. Порядок розбору

**Спершу — гроші й безпека, що діють просто зараз:**

1. **A1** — EUR-фактури через фоліо: додати колонку `fin_folios.currency` (міграція в CREATE **і** ALTER — AGENTS.md §4) або брати валюту з резервації; це найдорожча тиха помилка.
2. **B1** — крон/вебхук секрети: додати їх у `docker-compose.yml` **і** зробити fail-closed (503), як уже роблять `guests/gdpr-cron`/`cron-pricelabs`. Поки не зроблено — будь-хто керує розсилками й синком.
3. **B2** — увімкнути `secrets.ts` у `saveIntegrationCredentials`, перешифрувати наявні рядки.
4. **B3** — параметризувати `?date=` у `service-orders`.
5. **B4/B5** — передати `organizationId` у `cloudOcrAllowed()` (є в `actor`), валідувати токен у `/ocr`.
6. **D3** — general-settings: 16→17 параметрів (тривіально, але блокує весь екран налаштувань).

**Далі — функції, що не працюють, і cross-tenant:**

7. **C1** — `runWithOrganization` у 6 файлах `booking-sites/[id]/**` (і редагування сайту почне працювати на проді).
8. **D4/D5/D1** — no-show PUT→PATCH; створити `accounts/[id]/reconcile/route.ts`; задача→об'єкт (business_units vs properties).
9. **D7/D8/D9/D10** — cron/синки без org-контексту: обгорнути в `runWithOrganization`, як `cron/guest-reminders`.
10. **G1/G2** — прибрати захардкоджені WhatsApp/адресу/послуги першого клієнта; розширити `check-no-tenant-names`.

**Прибирання (окремими комітами, за процедурою AGENTS.md §2):**

11. Мертвий код/залежності/таблиці (§2.10), хвіст `@payments`/README/PRODUCT (§2.8), embed-скрипти перезібрати (§2.6).
12. Дублікати формул (§2.9) — звести «Завантаженість» до одного джерела.

**Інфраструктура:** шар 5 (Sentry/GlitchTip) окремою задачею з деплоєм —
половина знахідок §2.4/§2.5 у проді проявилась би як тиха відмова, яку без
збирача помилок видно лише коли поскаржиться клієнт.
