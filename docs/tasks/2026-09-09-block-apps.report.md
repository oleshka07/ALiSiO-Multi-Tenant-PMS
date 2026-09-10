# Звіт: Блок «Застосунки» — сесія 4

Задача: `docs/tasks/2026-09-09-block-apps.md`. Гілка `claude/block-apps`.

## Стан блоку

**CI гілки червоний — і це не код.** Усі запуски `checks.yml` у репозиторії з
20:17 09.09 (`b5067fa`, `44c5a22` контролера, `3070d15`, `8b0e7db` мої, і
`7e28abd` гілки робіт о 20:49) завершуються `failure` за 2–5 секунд: три
завдання «completed/failure» без жодного кроку і без логів (API логів — 404),
тоді як `5d04ed1` гілки робіт о 19:59 пройшов за 11 хвилин. Раннер не
стартує — ймовірно ліміт/оплата Actions в акаунті; це видно власнику на
сторінці Actions, не мені. Локально повний набір §6 зелений (таблиця §2).
Перезапуск CI зі свого боку не робив: він упав би так само і нічого б не
довів.

**Блок зроблено цілком (3.1–3.8, §5, §6, задача 3 — А1/А2, Б1–Б4) і чекає
одного чекпоінта — рецензії контролера перед злиттям.** Проба fiskaly і
двері у фасаді — закрито задачею 3 (розділ наприкінці); екран «Канали» без
ключа модуля — не мій, іде іншому контролеру (рецензія 1, п. 5).

Оновлюється після кожного коміту.

## 0. Що вже є (прочитано з гілки, до першого рядка коду)

**Реєстр фіч.** `FEATURE_SPEC` у `src/core/features.ts` має **13 ключів**:
`booking_engine`, `fiscal_de`, `online_payments`, `tasks`, `events`, `reports`,
`dashboard`, `day_sheets`, `invoicing`, `accounting`, `channels`, `guest_page`,
`sites`. Кожен несе лише `label` і дефолт `on`; поля `kind` немає — родини
(«інтеграції» / «ядро» / «платні модулі») існують лише в коментарях і в таблиці
ARCHITECTURE §2.3. **Ключі вендора** (рядок у `channel_credentials`) сьогодні мають
три ключі реєстру: `fiscal_de` ← канал `fiskaly`; `online_payments` ← `stripe`,
`paypal`, `teya`; `channels` ← `channel_manager`. Четвертий канал, `smtp`, вимикача
не має навмисно (`INTEGRATION_FEATURE.smtp = null`). Усе це — три експорти
`integration-credentials.ts`: `IntegrationChannel` (юніон із шести назв, написаний
руками), `INTEGRATION_FEATURE` (канал → ключ реєстру або null), `INTEGRATION_FIELDS`
(канал → поля з підписами).

**Де сьогодні лежить стан звʼязку трьох інтеграцій.** *fiskaly* — стану звʼязку
немає ніде: `fiskaly-sign-de.ts` кидає виняток із текстом (`fiskaly PUT … → 500: …`),
а `folio-payments.repo.ts` перетворює це на `tse_failed` на платежі та рядок у
`fin_fiscal_outages` (початок/кінець простою, нотатка) — це журнал простоїв, не
«зараз підключено чи ні». *Пошта* — стану немає взагалі: успіх лишає `console.log`
(`[Email] Sent to …`), відмова — виняток nodemailer до того, хто слав; транспорти
кешуються за «хост|логін». *Менеджер каналів* — єдиний, у кого стан є, і він на
рядку `cm_connections`: `is_enabled`, `last_full_sync_at` (ARI), `catalog_synced_at`
(каталог, 0130), `channels_synced_at`; історія відправок — `cm_sends`/`cm_events`.
Три інтеграції — три різні місця і три різні форми; «здоровʼя» цілком не бачить ніхто,
і саме це збирає `app_connections` (3.4).

**Що тримає `features.check.ts`.** (1) `EXPECTED_DEFAULT` — дефолт кожного з 13 ключів
названий поіменно, окремо від реєстру, щоб перевірка не звірялась сама з собою; новий
ключ без рядка тут — червона збірка. (2) `FEATURES` (каталог для екрана) збігається
з `FEATURE_SPEC`, підписи непорожні. (3) `INTEGRATIONS` — чотири ключі, у яких варта
живе не в маршрутах модуля, а у названому файлі (`fiscal_de` →
`folio-payments.repo.ts`, `online_payments` → `integration-credentials.ts`, `channels`
→ `pull-cron.handlers.ts`, `booking_engine` → `widget-site.handlers.ts`); файл мусить
називати ключ. (4) Решта — модулі: кожен має `feature: '<key>'` у
`core/navigation.ts` (меню, пошук і `ModuleGate` читають звідти), а ключі в
`nav-items.ts` і хабі звітів існують у реєстрі й у каталозі. (5) `OWNERS` — для
кожного модуля названі файли з `withModule('<key>'` / `hasFeature(…, '<key>')`;
модуль без файла варти — червона збірка (П5). (6) У цих файлах немає експортів на
голому `withActor`/`withPermission`. Тобто гейт стереже дефолти, меню й маршрути, але
**не знає, ким є ключ** — застосунком чи модулем; поділ екрана надвоє йому нема на що
спертись.

**Чому `payments.ts` не імпортує назад `integration-credentials.ts`.** Він імпортує
її *вперед*: `integrationConfigured` і тип `IntegrationChannel`, щоб відповісти
«чи є в готелю збережені ключі шлюзу». Тому `integration-credentials.ts` не може
вивести `IntegrationChannel` з `PAYMENT_PROVIDERS` — це був би цикл. Юніон написаний
руками, а `payments.check.ts` **читає текст** `integration-credentials.ts` регуляркою
і падає, якщо в юніоні немає імені шлюзу; так само він вимагає, щоб у кожного шлюзу
були поля в `INTEGRATION_FIELDS` і вимикач `online_payments` у `INTEGRATION_FEATURE`.
Списки тримаються чесними перевіркою, а не імпортом. Той самий прийом і для
`apps.ts`: він не імпортує `payments.ts` (бо `payments → integration-credentials →
apps`), шлюзи в ньому — записи без `label`/`where`/`live`, ці три поля підставляються
з `PAYMENT_PROVIDERS` у місці читання (`appCatalog(PAYMENT_PROVIDERS)`), а гейт
доводить, що підставлений обʼєкт — той самий за посиланням.

**Інші факти з прочитаного, які змінюють план.** `settings/features/page.tsx` рендерить
поля ключів як `fields[key]`, де `key` — ключ реєстру (`fiscal_de`), а `fields`
приходить із `INTEGRATION_FIELDS`, ключованого каналом (`fiskaly`): збіг неможливий,
тож **сьогодні на цьому екрані не показується жодне поле ключів** — ні fiskaly, ні
smtp, ні менеджера каналів. Ключ менеджера каналів (`channel_manager`) не вводиться
ніде в UI (grep по `src/app`, `channels/ui`, `components` — нуль). Це те, що екран
«Застосунки» має полагодити для fiskaly і smtp; менеджер каналів — не моя тека
(записано в notes). `fin_fiscal_settings` у `schema.sql` має `UNIQUE("property_id")`
двічі — слід дрейфу, тека сесії 1 (notes).

## 1. Гейт червоним до коду

`src/core/apps.check.ts` написаний до коду і запущений на дереві `b5067fa` (без
`apps.ts`, без `kind`). Перше твердження читає лише `features.ts`, тому падіння — на
справжньому дефекті, а не на відсутньому модулі:

```
AssertionError [ERR_ASSERTION]: ключ «booking_engine» реєстру не має kind — екран не
знає, чи це модуль (перемикач у «Модулях») чи застосунок (картка в «Застосунках»)
    at file:///…/src/core/apps.check.ts:62:10
```

Далі по ходу кожне з тверджень 3–9 бачилось червоним окремо (цитати — нижче в
розділі «Гейти червоними»).

## 2. Коміти й CI

| Коміт | Що | Перевірки |
|---|---|---|
| `b167997` | увесь блок: 3.1–3.7, гейт, міграція 0140, екрани, e2e | `tsc` 0; `npm run check` зелений; `check:pg` роллю `alisio_app` на локальному Postgres 16 зелений; `rls-check.sql` — усі; `check-schema-drift` — «збігаються — 124 таблиць, 1582 колонок, 404 індексів, 361 обмежень»; `check:i18n` 3532/3532; `check:unwrapped` чисто; `check:i18n-leak` чисто; `check-docs-current --strict` чисто; `check-boundaries --strict` у межах стелі; `check-no-tenant-names` чисто; `build` ok; `check:routes` по живому серверу — усі; `smoke-routes` — 5xx лише крони без секрету і `/api/test-email` з навмисно битим SMTP; Playwright `tests/e2e/apps.spec.ts` — 1 passed (1.1 хв) |
| `36b5c41` | злиття `origin/claude/channex-integration-66kv65` (19 комітів; конфлікти в `package.json` і трьох словниках зведені ОБʼЄДНАННЯМ, AUTOLOOP п. 1) | після злиття: `tsc` 0, `check:i18n` 3533/3533, `check:unwrapped`, `check:i18n-leak`, `check-boundaries`, `check-docs-current`; повний `npm run check` зелений, `check:pg` роллю `alisio_app` (з 0131 накоченою) зелений, `rls-check.sql` — усі, `check-schema-drift` — збігаються, `build` ok |
| `8b0e7db` | 3.8 «Підключити TSE» (задача контролера `44c5a22`): `fiskalyConnect`, `POST /api/settings/apps/fiskaly/connect`, міграція 0141, картка; читачі стану з віссю обʼєкта (INC-029, храповик `check-property-scope` після злиття); юніон каналів називає шлюзи текстом (`payments.check` після злиття) | `tsc` 0; `npm run check` зелений; `check:pg` роллю `alisio_app` (0141 накочена) зелений; `rls-check.sql` — усі; `check-schema-drift` — «124 таблиць, 1584 колонок»; `check:i18n` 3540/3540; `check:unwrapped`, `check:i18n-leak`, `check-docs-current`, `check-boundaries` (стеля `invoicing` 5), `check-property-scope` у межах стелі; `build` ok |

CI (`.github/workflows/checks.yml`) — див. перший абзац: раннер не стартує в усьому репозиторії з 20:17 09.09.

## 3. Було → стало по пунктах

**3.1 `kind` у реєстрі.** Було: `FEATURE_SPEC[key] = { label, on }`
(`src/core/features.ts:34–185`). Стало: `{ label, on, kind }` з `kind: 'core' |
'module' | 'app'` (`features.ts:48–51` — тип і три сталі, `:82–203` — по
одному на ключ), плюс `FEATURE_KIND` і `featureKind()` (`features.ts:222–232`).
Дефолти, `EXPECTED_DEFAULT`, `organization_features` — не змінені (диф
`features.check.ts` порожній).

**3.2 Реєстр застосунків.** Було: `IntegrationChannel` (юніон руками),
`INTEGRATION_FEATURE`, `INTEGRATION_FIELDS` — три мапи в
`integration-credentials.ts:31, 200–275`. Стало: `src/core/apps.ts` (новий) —
`APPS` з 9 маніфестів; `integration-credentials.ts:31` `IntegrationChannel =
AppId | 'channel_manager'`, `:179–195` обидві мапи виведені з `APPS` +
`channel_manager` поіменно. Решта коду не правилась — форма та сама
(`payments.ts`, `payments.check.ts`, `folio-payments.repo.ts`, `email.ts`
читають ті самі імена). Цикл розвʼязано без імпорту `payments.ts`: шлюзи в
`APPS` — `gateway: true` без label/where/live, `appCatalog(PAYMENT_PROVIDERS)`
(`apps.ts:257–283`) підставляє їх за посиланням. П5: `winhotel_import`,
`dirs21`, `pricelabs`, `unzer` — `live: false`, `feature: null`, `fields: []`;
ключів реєстру для них немає.

**3.3 «Хочу».** Міграція `db/postgres/migrations/0140-an-app-says-whether-it-is-connected.sql:79–114`
(`app_wishes`, UNIQUE(organization_id, app), індекс, RLS); дзеркало
`src/lib/db.ts` `migrateApps()` (окремою функцією наприкінці `runMigrations`,
з тієї ж причини, що `migrateOtaMirror`). `wishApp()` / `wishedApps()` —
`src/core/app-connections.ts:171–196`; `POST /api/settings/apps/:id/wish` —
`src/app/api/settings/apps/_handlers.ts` `wishForApp` (404 на невідомий id,
409 на live-застосунок). Лічильник — лише в `platformAppsReport`.

**3.4 Стан звʼязку.** Та сама міграція `:31–77` (`app_connections`, CHECK
статусу, унікальний індекс по `COALESCE(property_id, '')`, FK на обʼєкт і
організацію, RLS). `src/core/app-connections.ts` — `reportOk`/`reportError`
(upsert UPDATE→INSERT, обидва в `try` цілком: ніколи не кидають), закон
обʼєкт/організація через `scope` маніфесту (`lawAllows`, `:60–70`),
`listConnections`, `channelManagerHealth` (читає `cm_connections`). Писачі —
рівно два, по одному місцю: `src/modules/invoicing/data/fiskaly-sign-de.ts:52–82`
(`reported()` — обʼєкт за `tss_id` у `fin_fiscal_settings`; `fiskalyDevice`
загортає `signReceipt`) і `src/core/mail/email.ts:126–158` (`reported()` —
відправка і проба). Channex — не пише; читається з `cm_connections`.

**3.5 Екран.** `src/app/app/(dashboard)/settings/apps/page.tsx` (новий): каталог
(картка: назва, рід, ціна, стан словом і кольором, вимикач через
`PUT /api/settings/features`, поля ключів через
`PUT /api/settings/integration-credentials`, «хочу»/«ви позначили», для
пошти — «Перевірити звʼязок») і здоровʼя (fiskaly по обʼєктах, пошта, менеджер
каналів з `cm_connections`, онлайн-оплата з чесним «ключ є / коду немає» і
`PaymentGatewayNotice`). API — `src/app/api/settings/apps/_handlers.ts`
(`getApps`, `wishForApp`, `probeApp`), маршрути `route.ts`,
`[id]/wish/route.ts`, `[id]/probe/route.ts` — усі під `withOwner`.
`settings/features/page.tsx` — «Модулі»: лише ключі, які не стереже жоден
запис `APPS` (`APP_FEATURES`, `:27`); поля ключів і `fields`/`status`/`drafts`
прибрано; внизу посилання на «Застосунки». `src/core/navigation.ts:81–82`:
«Модулі та інтеграції» → «Модулі», один новий рядок «Застосунки» без
`feature`. Хаб `settings/page.tsx:76–78`: картка «Модулі» і нова картка
«Застосунки» (З3 — «вкладка в Налаштуваннях»; файл не названий ні своїм, ні
чужим — самостійне рішення, нижче). Тексти — 37 нових ключів у
`catalogue.json`, `de.json`, `cs.json` (у кінець): «Застосунки / Anwendungen /
Aplikace», «скоро», «хочу», «ви позначили», «підключено», «помилка», «останній
успіх», «остання помилка», «Модулі» (вже був) та інші. `check:i18n`: 3495 →
3532 — число зрушило.

**3.6 Постачальник.** `src/app/api/platform/apps/_report.ts`
`platformAppsReport(platformSessionId)` — `getPlatformSession` або 401
(інваріант 13); організації з `organizations` (без політики за побудовою),
рядки кожної — в її контексті `runWithOrganization` (як
`/api/platform/organizations`); `app_connections` + `cm_connections` як
`channel_manager`; попит по кожному «скоро»-застосунку (нуль — теж рядок).
`route.ts` читає куку. Сторінка `src/app/app/platform/apps/page.tsx` — дві
таблиці. Посилання з `/app/platform` не додано (файл не мій) — сторінка
відкривається адресою, як і сама платформа; є зворотне посилання «Готелі».

**3.8 Картка fiskaly підключає TSE** (додано контролером 09.09 у `44c5a22`,
підібрано злиттям). Було: `fin_fiscal_settings` не писав ніхто в продукті
(єдиний INSERT — у перевірці); `FISKALY_BASE_URL` за замовчуванням —
застаріла `kassensichv.fiskaly.com`. Стало: `fiskalyConnect()` у
`src/modules/invoicing/data/fiskaly-sign-de.ts` (кроки quickstart: `PUT /tss`
→ `PATCH {UNINITIALIZED}` → `PATCH /admin` → `POST /admin/auth` → `PATCH
{INITIALIZED}` → `PUT /client {serial_number}`, під `reported()` на обʼєкт),
дефолт адреси — `kassensichv-middleware.fiskaly.com/api/v2`;
`POST /api/settings/apps/fiskaly/connect { propertyId }` → `connectTseForProperty`
(`_handlers.ts`): обʼєкт свій або 404, `tss_id` уже є → 409 з назвою, без
`APP_SECRET_KEY` → 503, відмова вендора → 502 з текстом на картці; рядок
`fin_fiscal_settings` з `recording_system_serial = ALISIO-<slug>` і PIN/PUK під
`seal()` у нових колонках `tse_admin_pin`/`tse_admin_puk` (міграція `0141`,
дзеркало в `migrateApps()`; З17). Картка: список обʼєктів зі станом TSS,
вибір обʼєкта, кнопка «Підключити TSE», результат «підключено · TSS …last4»,
підпис про TEST/LIVE-ключ. Живого проходу проти fiskaly не було (З18):
форма відповідей — з документації, гейт іде проти HTTP-стаба.

**3.7 Документація.** `docs/ARCHITECTURE.md` §2.3 — новий підрозділ
«Застосунки» (три рівні, `kind`, реєстр як маніфест, чому `channels` — модуль,
закон креденшели/підключення, де стан, чого немає і чому, що тримає гейт); §7
таблиця гейтів — рядок `apps.check.ts`; §8 — підрозділ блоку зі знахідками.
`docs/DECISIONS.md` — розділ «Застосунки»: З1–З9 власника і З10–З16 сесії.
`docs/NAMING.md` §2 — статуси `app_connections.status`, значення `app`.
`check-docs-current --strict` — чисто (45 таблиць із міграцій, 35 гейтів).

**Міграція 0140 і наявні дані.** Дві нові таблиці; наявних рядків не чіпає.
`schema.sql` перегенеровано з свіжої SQLite (`pg-schema.mjs`; диф — дві
таблиці, FK, індекси, політики і одна косметична перестановка колонок у
чужій таблиці, інваріант 10). `check-schema-drift` на локальному Postgres:
«збігаються — 124 таблиць, 1582 колонок, 404 індексів, 361 обмежень».
`rls-check.sql` доповнено рядками обох таблиць для A і B: B не бачить стану A
(з текстом помилки) і «хочу» A, не змінює; A бачить своє; покриття «кожна
таблиця з RLS» — зелене.

## 4. Гейти червоними до коду — і на чому саме

`src/core/apps.check.ts`, 11 тверджень §5, у `check` і `check:pg` (кінець
ланцюжка). Послідовність червоних, у порядку появи:

1. **Тв. 1, до коду** (дерево `b5067fa`): `ключ «booking_engine» реєстру не має
   kind — екран не знає, чи це модуль … чи застосунок` — на справжньому
   дефекті; `apps.ts` ще не існував і не імпортувався.
2. **Тв. 2, після `kind`**: `модуль «channels» не має жодного екрана в
   core/navigation.ts — вимкнути його неможливо, а в «Модулях» він є`. Це не
   імітація — справжня знахідка (notes п. 1): екран «Канали» без ключа. У гейті —
   названий виняток `MODULE_WITHOUT_SECTION`, який вимагає себе прибрати,
   щойно ключ зʼявиться.
3. **Далі**: `Cannot find module './apps.ts'` (очікувано — реєстру ще не було),
   потім `Cannot find package 'bcryptjs'` (залежності не стояли — `npm ci`).
4. **Тв. 8 на SQLite**: `у контексті B видно рядок A (політика app_wishes не
   тримає) 1 !== 0`. Червоне показало, що на SQLite це твердження нічого не
   стверджує — політик там немає. Перенесено під `DB_DRIVER === 'postgres'`
   (З14). На Postgres під `alisio_app` — зелене; **доведено, що вміє
   червоніти**: з `ALTER TABLE app_wishes DISABLE ROW LEVEL SECURITY` гейт
   падає тим самим текстом `1 !== 0`, після `ENABLE`/`FORCE` — зелений.
5. **Тв. 9**: `FOREIGN KEY constraint failed` на фікстурі сесії власника без
   рядка `app_users` — фікстура доповнена.
6. **Тв. 11**: `ENOENT …settings/apps/page.tsx` — екранів ще не було.
7. **Сцена 3.8** (після злиття з `44c5a22`): написана після коду 3.8, тому
   червоність доведена зломом — `POST /admin/auth` із PUK замість PIN →
   `auth пішов не тим PIN, який щойно поставили`; після відкату — зелена.
   Побічно тв. 9 впало на стенді з e2e-готелем (`попит Winhotel = 2, а
   натиснув один`): твердження про абсолютне число залежало від сусідніх
   даних — переписано дельтою (другий готель натискає → рівно +1).
8. **Після злиття гілки робіт — два чужі гейти на моєму коді.**
   `check-property-scope --strict` (храповик сесії 3, INC-029): чотири
   читання scoped-таблиць «мовчать» про вісь обʼєкта (`listConnections`,
   `channelManagerHealth`, пошук обʼєкта за `tss_id`, список TSS на картці) —
   тепер приймають `PropertyScope`/пишуть `ALL_PROPERTIES` словом.
   `payments.check.ts` читає ТЕКСТ юніону `IntegrationChannel` і вимагає
   бачити кожен id шлюзу — `AppId | 'channel_manager'` його не задовольняв;
   шлюзи названі й поіменно, тв. 3 гейта підправлено відповідно.
   `features.check.ts INTEGRATIONS.online_payments` називав файл варти
   `integration-credentials.ts`, який після виведення мапи вже не містить
   слова `online_payments` — тепер названо `core/apps.ts`, де кожен шлюз
   каже свій вимикач (одна правка у файлі, дозволеному лише для `kind`;
   рядок саме про це — на рецензію).
   `check-ui-tokens --strict` (П18): у двох нових екранах — 10 літералів
   кольору у запасних значеннях `var(--danger, #e5484d)` і подібних (нові
   файли — стеля нуль), а звужений екран «Модулі» став чистішим за свою
   стелю. Запасні значення прибрано (токени `--danger`, `--success`,
   `--warning`, `--border-color`, `--bg-secondary` існують у `globals.css`),
   стеля «Модулів» опущена 5 → 0 у `check-ui-tokens.baseline.json`.

Осі (інваріант 26): успіх/відмова × два різні тексти відмов
(`quota exceeded` fiskaly, `535 5.7.8` пошти, `ECONNREFUSED` проби) × два
орендарі × обʼєкт/організація × сесія власника/платформна.

`check-boundaries --strict` був червоним двічі після коду: `_handlers.ts` і
`apps.check.ts` імпортували `modules/invoicing/data`. Перше прибрано (проба
fiskaly знята — «чужа тека», нижче); друге — стеля `invoicing` 3 → 4 у
`scripts/check-boundaries.mjs` з причиною в коментарі (гейт виконує клієнт
fiskaly, бо §5.6 вимагає фікстуру для fiskaly-клієнта; двері у фасаді — тека
сесії 1). Це самостійне рішення, і воно на рецензію.

## 5. Самостійні рішення

- **Форма `apps.ts`**: маніфест з `id, kind, feature, fields, where, live,
  pricing, scope`; шлюзи — `gateway: true` без label/where/live (З10);
  `scope` — нове поле понад §3.2, бо закон обʼєкт/організація має жити в
  даних, а не в `if (app === 'smtp')` (З11). `unzer` — `kind: 'payment'`,
  але не `gateway` (у `PAYMENT_PROVIDERS` його немає; коли зʼявиться код —
  стане рядком там і `gateway: true` тут).
- **Назви статусів**: у базі `connected | degraded | error | disabled`; на
  картці ще `soon` і `unknown` (обчислені, З13). `degraded` ніхто поки не
  пише — місце під «працює, але з попередженнями» (И4 у каналів).
- **Цикл імпортів** — перевіркою, не імпортом (З10); `IntegrationChannel`
  виведений з `AppId`, гейт читає текст юніону і вимагає `AppId` +
  `'channel_manager'` і нічого більше.
- **Менеджер каналів без правки каналів**: `channelManagerHealth()` читає
  `cm_connections.is_enabled / last_full_sync_at / catalog_synced_at`; у
  здоровʼї готелю і в постачальника — рядок `channel_manager` зі станом
  `connected`/`disabled` (вимкнений модуль `channels` — `disabled` незалежно
  від рядка), «останній успіх» = `last_full_sync_at ?? catalog_synced_at`.
- **Обʼєкт для fiskaly** — за `tss_id` у `fin_fiscal_settings` тієї ж
  організації (конфіг клієнта обʼєкта не знає; `folio-payments.repo` не мій).
- **Проба «Перевірити звʼязок»** — понад §3: без неї готель бачить стан лише
  після справжньої операції, а З7 хоче текст помилки на картці. Зроблено для
  пошти (`verify()` nodemailer через той самий `reported()`); для fiskaly —
  ні (чужа тека, нижче). Ендпоінт `POST /api/settings/apps/:id/probe`.
- **Хаб налаштувань** (`settings/page.tsx`): не в переліку §1 ні своїм, ні
  чужим; З3 каже «вкладка в Налаштуваннях», а хаб — і є вкладки. Додано одну
  картку і перейменовано «Модулі та інтеграції» → «Модулі».
- **Посилання «онлайн-оплата → /app/settings/payments»** переїхало на
  «Застосунки» разом із рядком онлайн-оплати (З16) — на «Модулях» ключа
  `online_payments` більше немає.
- **Екран «Модулі» ховає ключі застосунків за `APPS`** (клієнт-безпечний),
  гейт тримає рівність із `kind: 'app'` (З15); `features.handlers.ts` не
  правився.
- **Гейт і в `check:pg`**, не лише в `check`: сцени 6–9 — про базу, а тв. 8
  про політику має сенс лише там.
- **`apps.check.ts` виконує клієнт fiskaly** — стеля `invoicing` у
  `check-boundaries` піднята 3 → 4 з причиною (див. §4).
- **Приймання §6 — відмова на пошті, не на fiskaly** (нижче).

## 6. Приймання (§6)

`tests/e2e/apps.spec.ts` — один сценарій на весь блок, проти production-збірки
(`npm run build && npm start`, SQLite, `APP_SECRET_KEY` заданий), готель
`Apps E2E Hotel` через `provision-org.mjs`, платформний акаунт через
`platform-user.mjs`. Результат: **1 passed (1.1m)**. Кроки, як у §6:

1. власник → `/app/settings` → картка «Застосунки» → `/app/settings/apps`;
2. картка fiskaly зі станом; вимикач `fiscal_de` → зʼявились поля «API key» /
   «API secret»;
3. Winhotel / DIRS21 / PriceLabs / Unzer — бейдж «скоро», кнопка «хочу»;
4. «хочу» на Winhotel → «ви позначили»; повторний `POST …/wish` — 200, після
   перезавантаження стан той самий, кнопки немає;
5. «Здоровʼя» — пошта, fiskaly, менеджер каналів (і онлайн-оплата з посиланням
   на екран оплат);
6. відмова чужої системи з текстом: збережено SMTP `127.0.0.1` (ніхто не
   слухає) → «Перевірити звʼязок» → картка «помилка», текст
   `connect ECONNREFUSED 127.0.0.1:587` і час — З7. **Відмова на пошті, не на
   fiskaly**: проба fiskaly потребує дверей у фасаді `@invoicing` (розділ 7);
   механізм звіту той самий (`app_connections`, `reported()`), відмова
   справжня, без мока;
7. `/app/settings/features` — лише модулі (`module-tasks` є, `module-fiscal_de`
   і `module-online_payments` немає, жодного поля ключів);
8. платформна сесія → `/app/platform/apps`: рядок «Apps E2E Hotel · Пошта ·
   помилка» з тим самим текстом; попит `winhotel_import = 1`.

Знімки: `docs/tasks/2026-09-09-block-apps.screens/settings-apps.png` (екран
готелю) і `platform-apps.png` (постачальник).

У CI сценарій виконується тим самим файлом (`playwright.ci.config.ts` бере
`tests/e2e/*`): власник — `owner@ci.test` із `provision-org.mjs`, платформна
частина пропускається з анотацією, бо CI не заводить платформного акаунта
(`platform-user.mjs` — лише з оболонки). Локально Chromium узято з
`/opt/pw-browsers` через тимчасовий конфіг, який не комітиться.

Повний прогін перед звітом — у таблиці §2.

## 7. Що не вдалося / потрібна зміна в чужій теці

1. **Проба fiskaly кнопкою.** Потрібна зміна в чужій теці:
   `src/modules/invoicing/api/index.ts` — один експорт
   (`export { fiskalyDevice } from '../data/fiskaly-sign-de';` або окрема
   `fiskalyProbe`), чому: клієнт TSE живе в `data/`, а імпорт `data/` з
   `app/api` — пробій межі (`check-boundaries`). Після цього — проба в
   `_handlers.ts` (`PROBEABLE` + 20 рядків) і стеля `invoicing` назад на 3.
   Зупинився на цьому пункті; решта блоку від нього не залежить.
2. **Екран «Канали» без `feature: 'channels'`** —
   `src/core/navigation.ts:71`, чому: вимкнений модуль каналів лишає екран
   відкритим (заслінка `ModuleGate` не спрацьовує); один рядок, але поза моїм
   одним рядком у цьому файлі і в темі сесії 3. Чи ховати екран підключення
   від готелю без модуля — продуктове питання контролеру. У гейті — названий
   виняток.
3. **Двері у фасаді для клієнта TSE** — та сама зміна, що в п. 1, тепер
   потрібна двічі: 3.8 (`connectFiskaly`) імпортує `fiskalyConnect` з
   `modules/invoicing/data` напряму. Стеля `invoicing` у
   `check-boundaries.mjs` — 5 (було 3), обидва рядки з причиною; один
   експорт у `src/modules/invoicing/api/index.ts` повертає 3.
4. **Посилання на `/app/platform/apps` з `/app/platform`** —
   `src/app/app/platform/page.tsx` (не мій): один `<Link>`.

## 8. Що потрібно від власника

Нічого. Девʼять рішень §2 записані в DECISIONS; нових питань блок не породив.
Продуктове питання п. 7.2 — контролеру.

---

## Задача 3 (inbox на `origin/claude/controller-2`; рецензії 1 і 2 прийнято)

**CI на гілці — зелений.** Запуск `34446374678` на `b6b56f0a` (голова після
задачі 3 і злиття гілки робіт, 21 коміт): `conclusion: success`, 06:41–06:52
UTC, усі три завдання (types/self-checks/build, hotel onboarding, onboarding
and tenant isolation з e2e). Раннер повернувся: до 06:11 усі запуски в
репозиторії, включно з гілкою робіт (`5be7f387`), падали за 3 с без кроків —
це вже не так, і «Стан блоку» вище описує минуле, не теперішнє.

### Коміти

| Коміт | Що |
|---|---|
| `6f65219f` | А1, А2, Б1–Б4, міграція 0142, гейт (сцени Б2, проба, А1, А2), e2e-крок «Підключити TSE», DECISIONS З19–З21, ARCHITECTURE, NAMING, notes п. 8 |
| `b6b56f0a` | злиття `origin/claude/channex-integration-66kv65` (21 коміт; конфлікт лише в `package.json`, зведено обʼєднанням) — після нього `tsc` 0, `npm run check` зелений, `check:pg` роллю `alisio_app` зелений, `build` ok, `check:i18n` 3542/3542, `check-boundaries` 39 у межах стелі, `check-decisions-registry` 204 |

### А1. Сирітська TSS

Було: часткова відмова після `PUT /tss` (наприклад, `PATCH /admin` → 500)
кидала виняток без id; рядка обʼєкта не було; наступний натиск робив другий
`PUT /tss`. Стало: `fiskalyConnect(…, { resume, onCreated })`
(`fiskaly-sign-de.ts`) — одразу після `PUT /tss` викликач кладе `tssId` і
PUK (під `seal()`) у `tse_pending_tss_id`/`tse_admin_puk` рядка обʼєкта
(міграція `0142`; `tss_id` лишається NULL — недороблена TSS не підписує);
відмова далі — `FiskalyConnectError` з `tssId`, текст у `app_connections`
називає її: `… [TSS <uuid> створено у fiskaly, підключення не завершено —
повторний натиск дограє]`; наступний натиск бачить `tse_pending_tss_id`,
бере PUK і дограє кроки з `PATCH {UNINITIALIZED}` на тій самій TSS, без
`PUT`. Картка показує «підключення не завершено · TSS …last4 — натисніть ще
раз». З19.

### А2. Два одночасні натиски

Було: `existing?.tss_id` читалось до вендора — два запити бачили «TSS
немає» обидва. Стало: рядок обʼєкта створюється ДО походу до вендора
(`INSERT … WHERE NOT EXISTS`), замок `tse_connecting_at` (0142) береться
одним `UPDATE … WHERE tss_id IS NULL AND (замка немає OR замок старший за 10
хв)`; `changes = 0` → 409 «підключення вже триває»; після успіху/відмови
замок знімається. З20. **Червоне по-справжньому і не там, де чекав:** перша
редакція писала `tse_connecting_at = CURRENT_TIMESTAMP`, а порівнювала з
ISO-межею з JS — на SQLite `'2026-09-10 06:22:17' < '2026-09-10T06:12:…'`
рядково істинне (пробіл < `T`), тож свіжий замок читався «покинутим» і обидва
натиски проходили (`[200,200]`). Клас INC-011; обидві мітки тепер із JS в
ISO.

### Б1. Стеля `invoicing` назад на 3

`src/modules/invoicing/api/index.ts` — один дозволений експорт
(`fiskalyDevice, fiskalyProbe, fiskalyConnect, FiskalyConnectError` + типи);
`_handlers.ts` і `apps.check.ts` імпортують `@invoicing`;
`check-boundaries.mjs`: стеля `invoicing` 5 → 3, коментарі «3 → 4» і
«4 → 5» замінено одним «4 → 3»; гейт — «39 по 16 модулях, у межах стелі».
Побічна знахідка (З21, notes п. 8): фасад `@invoicing` не завантажується
голим node — `domain/invoice-pdf.ts:23` читає `__dirname` на завантаженні;
гейт підставляє `globalThis.__dirname` перед імпортом, правка файлу — тека
сесії 1.

### Б2. Наша відмова не приписується вендору

Перевірка «чек без розбиття ПДВ» перенесена в `fiskalyDevice.signReceipt`
ДО `reported()`; `signReceipt` мапить розбиття без гілки-винятку. Гейт
(сцена 6, третя вісь): чек без розбиття → нуль викликів `fetch`, рядок
fiskaly в `app_connections` не змінюється. Був червоним на старому коді:
`чек без розбиття ПДВ дійшов до мережі (2 !== 0)`. Імпорти в
`fiskaly-sign-de.ts` — `@core/…`, як у сусідів.

### Б3. Проба fiskaly кнопкою

`fiskalyProbe({ apiKey, apiSecret, tssId }, propertyId)` = auth +
`GET /tss/{id}` через `reported()`, без транзакції; `PROBEABLE = {smtp,
fiskaly}`; обʼєкт для звіту — той, що має `tss_id`, інакше перший обʼєкт
готелю. Гейт: успіх → `connected` і серійник; 401 → `error` з текстом.

### Б4. Посилання

`src/app/app/platform/page.tsx` — `<Link href="/app/platform/apps">` поруч
із «Вийти з платформи».

### Гейти червоними в цій задачі

1. Б2: `чек без розбиття ПДВ дійшов до мережі 2 !== 0` — до коду.
2. А2: `два одночасні натиски відповіли [200,200]` — після першої редакції
   замка (мітки в різних форматах), тобто гейт знайшов справжню ваду.
3. Фасад під голим node: `ReferenceError: __dirname is not defined` —
   `invoice-pdf.ts`, не мій; підставка в гейті.
4. `TypeScript parameter property is not supported in strip-only mode` —
   `readonly` у конструкторі `FiskalyConnectError`; переписано на поля.
5. Сцена Б2 сама: `beforeOurs` брався зі знімка до сцени проби — вада
   сцени, не коду; знімок тепер береться перед самим викликом.

### Приймання

`tsc` 0; `npm run check` зелений (exit 0); `check:pg` роллю `alisio_app` на
локальному Postgres 16 з 0141–0142 накоченими — зелений; `rls-check.sql` —
усі; `check-boundaries --strict` — «39 по 16 модулях, у межах стелі» (стеля
`invoicing` = 3); `check-property-scope --strict` — у межах стелі;
`check-schema-drift` — «збігаються — 124 таблиць, 1586 колонок, 404 індексів,
361 обмежень»; `check:i18n` 3540 → **3542** (два нові рядки картки);
`check:unwrapped`, `check-ui-tokens`, `check-docs-current`,
`check-decisions-registry` (201 рішень) — чисто; `build` ok. Гейт
`apps.check.ts` зелений на SQLite і на Postgres, червоність нових сцен — у
переліку вище. Playwright `apps.spec.ts` доповнений кроком «Підключити TSE»
проти стаба fiskaly (`E2E_FISKALY_STUB_PORT`, сервер із
`FISKALY_BASE_URL` на нього): **1 passed (1.3 хв)**, знімок
`settings-apps.png` оновлено — картка fiskaly «підключено», обʼєкт
«підключено · TSS …last4». У CI крок пропускається з анотацією (сервер там
стартує без `FISKALY_BASE_URL`; `checks.yml` — не мій файл).

---

## Задача 4 (В1 — дограння TSS за станом)

**CI на гілці — зелений.** Запуск `34451740257` на `198f8f6a` (голова після
задачі 4, злиття гілки робіт і коміту звіту; код той самий, що в `3dae4441`):
`conclusion: success`, 07:47–07:58 UTC, усі три завдання. Запуск
`34451646700` на `3dae4441` скасовано самим GitHub через пуш звіту
хвилиною пізніше (concurrency), не через збій.

### Коміти

| Коміт | Що |
|---|---|
| `d80c4b10` | В1: стан-залежне дограння в `fiskalyConnect` (`GET /tss/{id}` → кроки від стану, інший стан — названа відмова з `tssId`), стаб зі станом TSS у гейті, сцена В1, коментар «живий прохід скаже» переписано, З19 + ARCHITECTURE §2.3, розділ «Задача 4» у звіті |
| `3dae4441` | злиття `origin/claude/channex-integration-66kv65` (1 коміт: `18d2cdb2`, лише `docs/tasks/…` — INC-045/046 і inbox сесій 1–3; коду не торкається) — після нього `tsc` 0, `check-docs-current` чисто |

### Було → стало

Було: `fiskalyConnect` з `resume` завжди починав з `PATCH {UNINITIALIZED}`
(`fiskaly-sign-de.ts:270` до правки). Переходи станів у fiskaly односторонні,
тож відмова після `PATCH {INITIALIZED}` (на `PUT /client`) лишала б TSS, яку
жоден натиск не дограє. Стало (`fiskaly-sign-de.ts`, `fiskalyConnect`): у гілці
`resume` — `GET /tss/{id}` (той самий виклик, що в `fiskalyProbe`), далі лише
кроки від стану: `CREATED` → з `PATCH {UNINITIALIZED}`; `UNINITIALIZED` → з
`PATCH /admin`; `INITIALIZED` → `PATCH /admin` + `POST /admin/auth` +
`PUT /client`; інший або порожній стан — названа відмова з `tssId` і станом,
без кроків (текст у `app_connections` через `reported()`). PIN на дограній TSS
ставиться заново тим самим PUK. Коментар про «живий прохід скаже» переписано
на те, що є; З19 доповнено одним реченням; ARCHITECTURE §2.3 — те саме.

### Гейт червоним спершу

Стаб fiskaly в `apps.check.ts` тепер тримає стан кожної TSS і відхиляє PATCH
у поточний стан (`E_TSS_STATE: transition UNINITIALIZED → UNINITIALIZED is not
allowed`), як вендор. На старому коді впала вже сцена А1 (відмова на
`/admin` → TSS `UNINITIALIZED` → сліпе дограння з `PATCH {UNINITIALIZED}`):

```
AssertionError: повторний натиск після часткової відмови відповів 502:
{"error":"fiskaly відмовив — текст на картці застосунку. TSS …5ed3 створено,
повторний натиск дограє підключення."}   502 !== 200
```

Нова сцена В1: відмова на `PUT /client` (TSS `INITIALIZED`) → повторний натиск
шле рівно `POST /auth`, `GET /tss/{id}`, `PATCH /tss/{id}/admin`,
`POST /tss/{id}/admin/auth`, `PUT /tss/{id}/client/{id}` — без `PUT /tss` і
без `PATCH {UNINITIALIZED}` — і завершується 200 з `tss_id = створена`;
плюс TSS у стані `DISABLED` → після `GET` жодного кроку, 502, текст називає
id і стан.

### Приймання

`tsc` 0; гейт `apps.check.ts` зелений на SQLite і на Postgres роллю
`alisio_app` (сцени 3.8, А1, А2, В1); `npm run check` exit 0; `check:pg`
exit 0; `build` ok; `check:i18n` 3542/3542 (нових рядків немає — зміна
без екрана); `check-boundaries` 39 у межах стелі; `check-docs-current`,
`check-decisions-registry` (204) — чисто. `checks.yml`, фасад, стелі, чужі
теки — не чіпав.

## Задача 5 (блок вичерпано; гілку тримаємо живою злиттям)

Рецензія 4 прийнята без зауважень (`docs/tasks/2026-09-10-review-apps-4.md` на
`origin/claude/controller-2`). Нового коду немає — лише злиття гілки робіт, коли вона
рухається:

| Злиття | Що прийшло | Конфлікт |
|---|---|---|
| `859df7ec` | `93b6187d` (`deploy/check-overlaps.sh`, `.gitignore`, README бекапів) | немає; `tsc` 0, `npm run check` зелений, CI `34455309554` зелений |
| `734a2984` + `da7800f0` | `3d8dadd1`…`f6c29b48` (INC-046/047: ключ ідемпотентності віджета, `check-public-routes`, публічний контур числом) | `package.json`, рядок `check`: обидві сторони дописували свої гейти — зведено обʼєднанням (їхні `check-public-routes --strict` і `widget-reserve.idempotency.check` + наш `apps.check`). У `check:pg` наш гейт при зведенні випав і повернутий окремим комітом — інших відмінностей від голови до злиття у файлі немає |
