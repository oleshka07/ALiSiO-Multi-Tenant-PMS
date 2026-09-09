# Звіт: Блок «Застосунки» — сесія 4

Задача: `docs/tasks/2026-09-09-block-apps.md`. Гілка `claude/block-apps`.

## Стан блоку

**Блок зроблено цілком (3.1–3.7, §5, §6) і чекає одного чекпоінта — рецензії
контролера перед злиттям.** Два пункти зупинені на «потрібна зміна в чужій
теці» (нижче, розділ «Що не вдалося»): проба fiskaly кнопкою і екран «Канали»
без ключа модуля. Обидва не блокують решту блоку і не потребують власника.

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

(заповнюється після кожного коміту — див. кінець файлу)

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

(заповнюється після прогону Playwright)

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
3. **Посилання на `/app/platform/apps` з `/app/platform`** —
   `src/app/app/platform/page.tsx` (не мій): один `<Link>`.

## 8. Що потрібно від власника

Нічого. Девʼять рішень §2 записані в DECISIONS; нових питань блок не породив.
Продуктове питання п. 7.2 — контролеру.
