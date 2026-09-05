# Блок 3 — Канали до живого готелю (паралельна кодова сесія 3)

**Від:** контрольна сесія, 06.09.2026. **Ухвалив:** власник. **План:** `docs/MASTER-PLAN.md` §4,
Блок 3 — цей файл його деталізує і має перевагу в конфлікті.
**Гілка:** `claude/block-3-channels`, відгалужена від `origin/claude/channex-integration-66kv65`.
Правила паралельної роботи — `docs/tasks/README.md` (читати першим). **Міграції: 0100–0109.
Рішення: розділ «Канали», продовжити К4, К5…** У головну гілку і в `main` не пушити. Бета не твоя:
там іде перегравання сертифікації, туди деплоїть лише власник із головної гілки.

## 0. Прочитати перед початком (з гілки, не з робочої копії)

1. `docs/tasks/README.md`; `AGENTS.md` §3 (особливо И1–И14 і 25–28: досліди лише на своїх обʼєктах
   staging, живий прохід закриває фазу лише читанням назад, поле чужої відповіді має бути побачене
   живим — `channex/live-fields.json`), §4.
2. `docs/DECISIONS.md`: П9, Ц6, Ц8, Ц10, Ц16, Ц20, Ц22, К1–К3, Ц34–Ц35.
3. `docs/CHANNEX-INTEGRATION.md` §3–4, §7 (iFrame), §10.3 (тестовий акаунт Booking.com);
   `docs/ARCHITECTURE.md` §8 «Channex» (стрічка ревізій, `cm_*`, `multi_room_not_supported`).
4. Вендор: `docs/vendor/channex/api-v.1-documentation/channel-api.md`, `channel-iframe.md`,
   `channel-codes.md`, `bookings-collection.md`, `booking-crs-api.md`, `rate-limits.md`;
   `docs/vendor/channex/INVENTORY.md` (20 розбіжностей документації з живим API).
5. `docs/MASTER-PLAN.md` §4 Блок 3; §1.2 (Reservations → Channel manager / OTAs).
6. Джерело форми: `docs/research/hoteliera-screens/org-settings-otas/` (Connected OTAs · In setup ·
   Available OTAs · Contracts), `hoteliera-product-map.md` §6 (майстер OTA, мапінг з афордансами,
   контроль розбіжностей місткості, «last sent»).

Перед кодом — абзац «що вже є»: `channels/data/pull-bookings.ts:128-136` (`rooms.length > 1` →
`skipped`, ревізія не підтверджується), `inbound-bookings.repo.ts` (`applyRevision`: журнал першим,
бронь потім), `channex/revision-map.ts`, `bookings` sub-bookings (`reservation_sub_bookings`, двері
`createSubBooking` у фасаді `@bookings`), `cm_mappings`, `channex/client.ts`,
`settings/channel-manager/**` (майстер, черга, «Останні відправлення», `cm_sends`),
`scripts/channex-*-live.mjs` (зразки живих проходів, включно з `channex-mappings-live.mjs`).

## 1. Теки

**Твої:** `src/modules/channels/data/{pull-bookings,pull-all,inbound-bookings.repo,events.repo}.ts`,
`src/modules/channels/channex/{revision-map,pull-adapter,client}.ts` (у `client.ts` — лише нові
методи, наявні не міняти), `src/modules/channels/domain/feed.ts`, новий `src/modules/channels/data/
channels.repo.ts` і `channex/channels-adapter.ts`, екран `src/app/app/(dashboard)/settings/
channel-manager/channels/**` (новий), маршрути `src/app/api/channels/connections/[id]/channels/**`
(нові), `scripts/channex-channels-live.mjs`, `scripts/channex-multiroom-live.mjs`.

**Не твої:** `channels/domain/ari-batch.ts`, `channels/data/{outbox*,full-sync,outbox-notes,
sends.repo,catalog-sync}.ts`, `channex/{ari-adapter,ari-payload,verify-adapter,catalog-target,
full-sync}*` — це сесія 1 (Блок 0.6); `src/modules/pricing/**`, `src/modules/bookings/**` (сесія 2 —
дочірні броні створюєш лише через наявні двері фасаду `@bookings`; якщо дверей бракує — назви в звіті
і зроби мінімальну функцію у **своєму** `inbound-bookings.repo.ts`, як уже робить `applyRevision`),
`settings/channel-manager/page.tsx` і `connect/**` (сесія 1 щойно їх правила; свій екран — окремим
маршрутом і посиланням з картки зʼєднання — один рядок, у кінці файла).

## 2. Обсяг

### 2.1 Мультикімнатні броні з каналу (К1)

Одна ревізія з `rooms[] > 1` → **батьківська бронь + дочірні** (по одній на кімнату, кожна на свій тип
без номера, П9), сума й гості — за ревізією; статус і оплата дзеркаляться з батьківської (як у
sub-bookings). Ревізія-зміна застосовується до всієї групи (додалась/зникла кімната — дочірня
створюється/скасовується; зміна дат — на всіх); скасування — вся група. `ack` **після** коміту всієї
групи (И5); падіння посередині — ревізія не підтверджена, повторна доставка впізнає дубль
(`UNIQUE(connection_id, remote_revision_id)`, CP4). Наявність: кожна дочірня кладе координату свого
типу через наявні двері (`noteStay` викликається з `bookings`; переконайся, що дочірні його
проходять). Картка броні показує групу (сесія 2 переробляє картку — не чіпай UI, лише дані:
`external_uid` на батьківській і `parent_id` на дочірніх, як у sub-bookings).
Гейт червоним першим: `inbound-bookings.check.ts` сцени «дві кімнати різних типів: створити →
змінити дати → прибрати одну кімнату → скасувати»; `pull-bookings.check.ts` — `ack` лише після
коміту групи. Живий прохід `channex-multiroom-live.mjs` через Booking CRS на staging (обʼєкт власника,
інваріант 25) з читанням назад; ключ — як у сесії 1 (тимчасово опечатана локальна база), фікстуру
прибрати.

### 2.2 Рівень OTA — власний екран (К2; лише читання в цьому блоці)

Таблиця `cm_channels` (міграція 0100: `organization_id`, `connection_id`, `remote_channel_id`, `ota_code`,
`title`, `is_active`, `settings_json`, `mapped_json` (тарифи вендора, змаплені на цей OTA, як
повернув `GET /api/v1/channels`), `synced_at`; RLS як у `cm_mappings`). Дзеркало заповнюється
`GET /api/v1/channels` (+ `GET /channels/{id}`) через адаптер (И1 — імʼя вендора лише в адаптері),
рукою кнопкою «Оновити» і при проході стрічки не частіше разу на годину (лімітер вендора —
`rate-limits.md`). Екран Settings → Channel manager → **«Канали (OTA)»**: як у Hoteliera
`org-settings-otas` — Підключені · У налаштуванні · Доступні (список кодів з `channel-codes.md`),
для кожного підключеного — які **наші** пари тип × тариф продаються на ньому (переклад
`mapped_json` через `cm_mappings`), і попередження «тариф є в дзеркалі, але не змаплений на жоден
канал» (звірка Ц8, яка досі була інструкцією готельєру). Кнопка «Відкрити мапінг у вендора» — наявне
вікно iFrame (Ц19). **Запис мапінгу з нашого боку — НЕ в цьому блоці** (ЧЕКПОІНТ рецензента після
живого виміру по одному OTA — лише підготувати `channels-adapter` з методом і сцену, без маршруту).
Гейти: `channels.repo.check.ts` (тенант, дзеркало ідемпотентне, чужий `connection_id` → 404),
`channex/channels-adapter.check.ts` на живому зразку відповіді (`live-fields.json` — додати побачені
поля, И28), `check-vendor-isolation` зелений.

### 2.3 Живий прохід 2.1/2.2 старого Блоку 2 (Ц25, Ц26) з читанням назад

`channex-ari-live.mjs --retire <rpId>` / `--restore <rpId>` і каталог `per_room` — сесія 1 не змогла
без ключа. Зроби тим самим способом, що й свій прохід (тимчасовий ключ), запиши в `live-fields.json`
і в `HANDOVER §0.2–0.3` як «доведено живим». Тарифи/дати — далеко від дат сертифікаційних тестів
(листопад 2026 – травень 2027 не чіпати!) — наприклад, 2027-08.

### 2.4 Чого не робити

Не чіпати батчер, чергу, повний синк, звірку (сесія 1). Не змінювати наявні тарифи й ціни тестового
обʼєкта в датах тестів. Не заводити продакшн-середовище (К3 — акаунта немає). Не писати мапінг у
вендора.

## 3. Приймання

Сцена «дві кімнати» зелена на моку і доведена живим на staging (task id, читання назад у звіті);
екран каналів показує Booking.com і Airbnb тестового обʼєкта з парами; `npm run check`, `check:pg`,
`next build`, CI зелені; `check-vendor-isolation`, `check-outbox-writers`, `check-boundaries` не
зросли.

## 4. Документація і звіт

`ARCHITECTURE.md` §8 — підрозділ «Блок 3»; `cm_channels` у таблиці `cm_*`; `CHANNEX-INTEGRATION.md`
§4.3 (рівень каналу — тепер є дзеркало); `DECISIONS.md` К4+ у розділі «Канали»; `live-fields.json`.
Знахідки — `docs/tasks/2026-09-06-block-3-channels.notes.md`. Звіт після кожного коміту — за README.
