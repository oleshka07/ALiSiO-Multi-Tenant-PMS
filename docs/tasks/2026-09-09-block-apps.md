# Блок «Застосунки» (Anwendungen / Aplikace / Apps) — сесія 4

**Від:** контрольна сесія Schlossberghotel/Застосунки, 09.09.2026. **Ухвалив:** власник
09.09 (дев'ять відповідей — розділ 2 нижче). **Місце в плані:** `claude/schlossberg/02-ROADMAP.md`
Етап 0, п. 0.9; передумова для `winhotel-import`, PriceLabs, Unzer.
**Гілка:** `claude/block-apps`, відгалужена від `origin/claude/channex-integration-66kv65`
(голова `4ba22911` або свіжіша). У гілку робіт і в `main` **не пушити**. Злиття робить контролер
**після `beta → main`** — блок чіпає рівно ті спільні файли, за які зараз працюють сесії 1–3.
**Міграції: `0140–0149`.** **Рішення: новий розділ «Застосунки» у `docs/DECISIONS.md`, префікс
`З1, З2…`.** Правила — `docs/tasks/README.md`, `docs/tasks/AUTOLOOP.md`; inbox цієї сесії —
`docs/tasks/inbox/session-4.md`.

---

## 0. Прочитати перед початком (з гілки, не з робочої копії)

`AGENTS.md` §3 (інваріанти 4, 7, 13, 20, 22, 24, 26 — особливо), §3.2 і §3.2.1;
`docs/ARCHITECTURE.md` §2.1, **§2.3 (реєстр фіч — усе)**, §3.3 (постачальник), §4;
`src/core/features.ts` цілком (коментарі — це специфікація); `src/core/features.check.ts`
цілком (`EXPECTED_DEFAULT`, `OWNERS`, як він робить збірку червоною);
`src/core/integration-credentials.ts` цілком (`IntegrationChannel`, `INTEGRATION_FEATURE`,
`INTEGRATION_FIELDS`, `seal()`); `src/core/payments.ts` (`PAYMENT_PROVIDERS.live` — зразок, який
цей блок узагальнює); `src/core/payments.check.ts` (як два списки тримаються чесними без циклу
імпортів); `src/core/navigation.ts` (поле `feature`); `src/components/layout/ModuleGate.tsx`;
`src/app/app/(dashboard)/settings/features/page.tsx` і `src/modules/auth/api/integration-credentials.handlers.ts`
(екран і API, які цей блок розділяє надвоє); `src/modules/channels/port.ts` і
`scripts/check-vendor-isolation.mjs` (И1 — межа вендора, її не переходити);
`src/modules/invoicing/domain/fiscal/fiscal-device.ts` і `src/modules/invoicing/data/fiskaly-sign-de.ts`
(перший клієнт, який писатиме стан зв'язку); `src/core/mail/email.ts` і `email.check.ts`
(другий); `src/core/auth/platform.ts`, `src/app/app/platform/page.tsx`,
`src/app/api/platform/organizations/**` (де живе сторінка постачальника);
`db/postgres/schema.sql` — `channel_credentials`, `cm_connections`, `fin_fiscal_settings`,
`fin_fiscal_outages`, `organization_features`.

Джерело задуму: `claude/schlossberg/01-CORE-vs-APPS.md` (у проєкті Cowork; копія
`Jorg Hotel temp/_analysis/` на диску власника) — §1–§3 і **§8** (перевірка по коду).

**Перед кодом — абзац «що вже є»** з прочитаного, своїми словами. Обов'язково назвати: скільки
ключів у `FEATURE_SPEC` і які з них мають ключі вендора; де сьогодні лежить стан зв'язку кожної
з трьох інтеграцій; що саме тримає `features.check.ts`; чому `payments.ts` не імпортує назад
`integration-credentials.ts`.

---

## 1. Теки

**Твої:** `src/core/apps.ts` (новий), `src/core/apps.check.ts` (новий),
`src/core/features.ts` і `src/core/features.check.ts` (**лише** поле `kind` і твердження про
нього — інших правок у реєстрі не робити), `src/core/integration-credentials.ts` (перевести
три експорти на виведення з реєстру застосунків, **не міняючи** їхньої форми для решти коду),
`src/core/app-connections.ts` (новий), `src/app/app/(dashboard)/settings/apps/**` (новий),
`src/app/app/(dashboard)/settings/features/page.tsx` (звузити до модулів),
`src/app/api/settings/apps/**` (новий), `src/app/api/settings/integration-credentials/**` і
`src/modules/auth/api/integration-credentials.handlers.ts` (лише те, що потрібно для
поділу екрана), `src/app/app/platform/apps/**` і `src/app/api/platform/apps/**` (нові),
`src/core/navigation.ts` (**лише** один рядок — пункт «Застосунки» в розділі Налаштування),
`src/core/i18n/messages/*.json` (**лише свої** нові ключі, дописувати в кінець),
`db/postgres/migrations/0140-*.sql` … `0149`, `src/lib/db.ts` (дзеркало SQLite — свої міграції
в кінець блоку), `docs/ARCHITECTURE.md` §2.3 (новий підрозділ «Застосунки») і §8 (свій
підрозділ), `docs/DECISIONS.md` (новий розділ «Застосунки»), `package.json` (`"check"` — свої
гейти в кінець ланцюжка).

**Не твої:** `src/modules/channels/**` цілком (Channex — не застосунок, рішення власника;
`cm_*` не чіпати), `src/modules/invoicing/**` крім **одного** виклику запису стану в
`data/fiskaly-sign-de.ts` (див. 3.4), `src/core/mail/**` крім **одного** виклику запису
стану в `email.ts` (див. 3.4), `src/core/payments.ts` (читати; не міняти форму
`PAYMENT_PROVIDERS`), `src/modules/{bookings,pricing,properties,guests,widget,finance}/**`,
`hotels/**`, `docs/MASTER-PLAN.md`, `docs/INDEX-FOR-NEW-SESSION.md`, inbox сесій 1–3.
Файл, названий чужим, не редагується; якщо без цього не обійтись — у звіт «потрібна зміна в
чужій теці: файл, рядок, чому» і зупинка на цьому пункті.

---

## 2. Рішення власника 09.09 (не перепитувати; кожне — рядок у DECISIONS «Застосунки»)

- **З1.** Застосунок — окрема одиниця, буває **безкоштовна і платна**; пізніше — відкритий
  код, щоб сторонні писали свої. `winhotel-import` — безкоштовний.
- **З2.** Каталог показує і те, чого в готелю ще немає, зі станом **«скоро»** і кнопкою
  **«хочу»**, яка рахує попит.
- **З3.** «Застосунки» — **вкладка в Налаштуваннях**, не пункт головного меню.
- **З4.** **Channex — не застосунок.** Менеджер каналів — частина ядра/модуля `channels`
  (через нього піде листування, через нього підключатиметься більшість готелів). Порядок
  нових застосунків: `winhotel-import` → `dirs21` → `fiskaly`.
- **З5.** Гілка зливається **після** `beta → main`; спершу живе на беті.
- **З6.** Назва: uk «Застосунки», de **«Anwendungen»**, cs **«Aplikace»**, en «Apps».
- **З7.** Помилка зв'язку показується готелю **з текстом** останньої помилки.
- **З8.** Сторінка постачальника «стан застосунків усіх готелів» — **потрібна**.
- **З9.** Пошта (`smtp`) — у каталозі здоров'я **так**.

Наслідок З4 для коду: у реєстрі `channels` лишається `kind: 'module'`; ключ вендора
`channel_manager` **не** переїжджає на екран застосунків; але **стан зв'язку** Channex
(з `cm_connections`) показується в здоров'ї — це зв'язок із чужою системою, і власник хоче
його бачити, хоч це й не застосунок (див. 3.4, 3.6).

Наслідок для `dirs21`: у TourOnline AG **немає публічної документації** (перевірено 07.09,
`00-JOURNAL.md` §3.3). Тому `dirs21` у цьому блоці — **картка «скоро» з кнопкою «хочу»**,
без коду адаптера. Запит до TourOnline про Schnittstellenvertrag — дія власника, не сесії.

---

## 3. Обсяг

### 3.1 Ключ реєстру знає, ким він є — `kind`
`FEATURE_SPEC[key].kind: 'core' | 'module' | 'app'`. Значення:
`core` — `booking_engine`, `invoicing`, `dashboard` (усі ON);
`module` — `tasks`, `events`, `reports`, `day_sheets`, `accounting`, `channels`, `guest_page`,
`sites`; `app` — `fiscal_de`, `online_payments`.
Це **не** змінює жодного дефолту, жодної варти, жодного рядка в `organization_features`. Це
позначка, яку читають екрани й гейт. Тип `FeatureKey` не змінюється.

### 3.2 Реєстр застосунків — `src/core/apps.ts`
Одне джерело правди для каталогу. Форма запису (дані, не код — З1 «відкритий код пізніше»
означає, що це має читатись як маніфест, який колись прийде з теки застосунку):

```
id            'fiskaly' | 'stripe' | 'paypal' | 'teya' | 'smtp' | 'winhotel_import' | 'dirs21' | 'pricelabs' | 'unzer'
kind          'fiscal' | 'payment' | 'mail' | 'import' | 'channel' | 'pricing' | 'device' | 'accounting'
feature       FeatureKey | null      — вимикач, який стереже; null = «скоро» АБО без вимикача (smtp)
fields        [{ field, label, hint }] — те, що сьогодні в INTEGRATION_FIELDS
where         string                — де готель бере свої ключі
live          boolean               — код, що говорить із вендором, ІСНУЄ (зразок: PAYMENT_PROVIDERS.live)
pricing       'free' | 'paid' | 'included'
status        обчислюється: 'soon' якщо !live; інакше зі стану зв'язку (3.4)
```
Записи першої поставки: `fiskaly` (live, included у `fiscal_de`), `stripe`/`paypal`/`teya`
(live=false — як і сьогодні в `PAYMENT_PROVIDERS`; вони **не дублюються**: `apps.ts` бере їх із
`payments.ts`, а не переписує), `smtp` (live, feature null, без вимикача — як сьогодні),
`winhotel_import` (**soon**, free), `dirs21` (soon), `pricelabs` (soon), `unzer` (soon).

**Три експорти `integration-credentials.ts` — `IntegrationChannel`, `INTEGRATION_FEATURE`,
`INTEGRATION_FIELDS` — стають виведеними з цього реєстру.** Їхня форма для решти коду не
змінюється (жоден інший файл не правиться заради цього). Цикл імпортів `payments.ts ↔
integration-credentials.ts ↔ apps.ts` **заборонений** — розв'язати так, як уже розв'язано в
`payments.check.ts` (перевірка тримає списки чесними замість імпорту).

**П5 тримається:** запис зі `status = 'soon'` **не має вимикача** і не має поля ключів —
лише картку і кнопку «хочу». Вимикач з'являється разом із `live = true` і вартою. Ключ
`FEATURE_SPEC` для `winhotel_import`/`dirs21`/`pricelabs`/`unzer` у цьому блоці **не
заводиться**.

### 3.3 «Хочу» — попит
Міграція `0140`: `app_wishes(id, organization_id NOT NULL, app TEXT NOT NULL, created_at,
UNIQUE(organization_id, app))` + індекс по `organization_id`, RLS як у решти tenant-таблиць
(інваріанти 2, 3, 12). Ідемпотентно: другий натиск не створює другого рядка і не падає.
Лічильник «скільки готелів хочуть» читає **лише постачальник** (3.6); готель бачить лише
свій стан «ви вже позначили».

### 3.4 Стан зв'язку — одне місце, `app_connections`
Міграція `0140` (та сама): `app_connections(id, organization_id NOT NULL, property_id NULL,
app TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('connected','degraded','error',
'disabled')), last_ok_at, last_error_at, last_error TEXT, updated_at, UNIQUE(organization_id,
COALESCE(property_id,''), app))` + індекси + RLS. `src/core/app-connections.ts`:
`reportOk(app, orgId, propertyId?)` і `reportError(app, orgId, error, propertyId?)` —
upsert; **обидва ніколи не кидають** (стан зв'язку не має ламати операцію, яку описує).

Закон, який записується в ARCHITECTURE і в DECISIONS: **креденшели належать організації
(`channel_credentials`), підключення — об'єкту.** `property_id` тут **обов'язково NULL** для
smtp (пошта організації) і **обов'язково заповнений** для fiskaly (TSE — на об'єкт,
`fin_fiscal_settings.property_id`). Це перевіряє гейт.

Хто пише в цьому блоці — рівно три виклики, по одному в кожному:
1. `src/modules/invoicing/data/fiskaly-sign-de.ts` — після кожного звернення до fiskaly:
   `reportOk` на успіх, `reportError` з текстом на відмову. (Один виклик у чужій теці —
   дозволений цим пунктом явно.)
2. `src/core/mail/email.ts` — `reportError('smtp', …)` на відмову транспорту, `reportOk` на
   успішну відправку. (Так само — один виклик.)
3. Channex — **не пише** сюди (не твоя тека). Натомість читач здоров'я (3.5, 3.6)
   **читає** `cm_connections.is_enabled`, `last_full_sync_at`, `catalog_synced_at` і показує
   як рядок «Менеджер каналів» у тому ж списку. Без нового запису, без правки каналів.

**Не робити:** спільного журналу викликів (`app_calls`). Відкликано контролером 09.09
(`01-CORE-vs-APPS.md` §8.5): у fiskaly є `fin_fiscal_outages`, у каналів — `cm_sends`/
`cm_events`. Здоров'я — так; журнал — ні.

### 3.5 Екран «Застосунки» — `/app/settings/apps`
Вкладка в Налаштуваннях (З3), рядок у `navigation.ts` у розділі «Налаштування», без ключа
`feature` (екран є завжди; **картки** на ньому гейтяться кожна своїм ключем). Лише власник —
як `/app/settings/features` сьогодні.

Дві частини на одному екрані:
- **Каталог** — картка на кожен запис `apps.ts`: назва, `kind`, ціна (`free/paid/included`),
  стан. Для `live` — вимикач (той самий `PUT /api/settings/features`, нічого нового) і поля
  ключів (той самий `integration-credentials` API). Для `soon` — бейдж «скоро» і кнопка
  «хочу» (`POST /api/settings/apps/:id/wish`), після натиску — «ви позначили».
- **Здоров'я** — рядок на кожен зв'язок із чужою системою: fiskaly, пошта, менеджер каналів
  (з `cm_connections`), онлайн-оплата (ключ є / коду немає — чесно, як `PaymentGatewayNotice`).
  Стан кольором **і** словом; для `error` — **текст останньої помилки** (З7) і час.

`/app/settings/features` після цього показує **лише** `kind: 'core' | 'module'` і зветься
«Модулі»; поля ключів fiskaly з нього зникають (вони тепер на картці застосунку). Посилання
«онлайн-оплата → /app/settings/payments» лишається як є.

Тексти — чотирма мовами, ключі в `catalogue.json` + `de.json` + `cs.json` (uk — джерело):
«Застосунки / Anwendungen / Aplikace / Apps», «скоро», «хочу», «ви позначили», «підключено»,
«помилка», «останній успіх», «остання помилка», «Модулі».

### 3.6 Сторінка постачальника — `/app/platform/apps`
Лише для платформної сесії (`getPlatformSession`, як `/app/platform`). Таблиця: організація ×
зв'язок × стан × останній успіх × остання помилка (з текстом) — з `app_connections` **і**
`cm_connections` (менеджер каналів). Плюс друга таблиця: попит — застосунок × скільки готелів
натиснули «хочу». API `GET /api/platform/apps` відмовляє всім, хто не постачальник
(інваріант 13: не знайшов сесію — відмовив). Читання **поза** контекстом орендаря — свідомо
і з коментарем чому (це єдиний екран, який бачить усіх; зразок — `/api/platform/organizations`).

### 3.7 Документація
`docs/ARCHITECTURE.md` §2.3 — новий підрозділ «Застосунки»: три рівні, що таке `kind`, чому
`channels` — модуль (З4), закон «креденшели — організації, підключення — об'єкту», де стан,
чого немає (`app_calls`) і чому. §8 — свій підрозділ із числами гейтів. `docs/DECISIONS.md` —
розділ «Застосунки» З1–З9 + свої рішення `З10…`. `INDEX-FOR-NEW-SESSION.md` і MASTER-PLAN —
**не чіпати** (контролер).

---

## 4. Чого не робити

- Не переносити Channex у застосунки і не чіпати `src/modules/channels/**` (З4).
- Не писати адаптер DIRS21 (нема специфікації) і не заводити для нього ключ реєстру.
- Не заводити `FEATURE_SPEC`-ключів для «скоро»-застосунків — прапорець без варти (П5).
- Не будувати `app_calls` і не переносити `fin_fiscal_outages`/`cm_sends` нікуди.
- Не перейменовувати `channel_credentials` і не міняти `seal()`/`unseal()`.
- Не будувати завантажувач маніфестів «з теки застосунку» (відкритий код — пізніше);
  достатньо, щоб `apps.ts` був **даними**, які такий завантажувач зможе замінити.
- Не змінювати дефолти `FEATURE_SPEC` і `EXPECTED_DEFAULT`.
- Не чіпати переклади поза своїми ключами; дублікатів не додавати (гейт на дублікати
  ставить сесія 1).

---

## 5. Гейти — червоними ДО коду (AGENTS §3.2, §3.2.1, інваріант 24, 26)

`src/core/apps.check.ts`, підключити в `package.json` `"check"` **в кінець**:

1. **Кожен ключ `FEATURE_SPEC` має `kind`**, і значення названі поіменно тут (не виведені з
   реєстру — інакше перевірка звіряється сама з собою).
2. **`kind: 'module'` ⇒ є `feature: '<key>'` у `navigation.ts`; `kind: 'app'` ⇒ його там
   НЕМАЄ.** Це властивість, не візерунок: застосунок без розділу меню, модуль — із розділом.
   Червоне до коду: сьогодні `kind` відсутній — перша ж асерція падає.
3. **`INTEGRATION_FIELDS`/`INTEGRATION_FEATURE`/`IntegrationChannel` збігаються з `apps.ts`**
   один в один — у обидва боки (зайвий запис з будь-якого боку — червоне).
4. **Запис зі `status = 'soon'` не має `feature` і не має `fields`**; запис із `live = true`
   має `feature` (крім `smtp` — названий виняток) **і** названий файл варти в
   `features.check.ts OWNERS` або в списку `INTEGRATION_FEATURE`.
5. **Платіжні шлюзи не дублюються**: `apps.ts` віддає ті самі об'єкти, що `PAYMENT_PROVIDERS`
   (за посиланням або структурною рівністю з `live`).
6. **Стан зв'язку пишеться на обох гілках.** Фікстура з **двома** результатами (успіх і
   відмова з текстом) для fiskaly-клієнта і для транспорту пошти: після успіху рядок
   `connected` з `last_ok_at`; після відмови — `error` з `last_error`, що містить текст
   відмови, і `last_error_at`; **два різні значення на кожній осі** (інваріант 26).
   `reportError` **не кидає** навіть коли база недоступна (перевірити).
7. **Об'єкт або організація — за законом:** `smtp` з `property_id` не NULL — червоне;
   `fiskaly` з `property_id` NULL — червоне.
8. **«Хочу» ідемпотентно:** два виклики поспіль — один рядок; чужа організація не бачить
   рядка (RLS, `rls-check.sql` дописати).
9. **Сторінка постачальника відмовляє** звичайній сесії власника готелю 401/403, а
   платформній — віддає **усі** організації (фікстура з двома орендарями).
10. **i18n:** кожен новий ключ є в усіх словниках (`npm run check:i18n`), дублікатів нуль.
11. **`check-vendor-isolation` лишається зеленим** — слово `channex` у `apps.ts` і на екранах
    не з'являється (там «менеджер каналів»).

Перед кодом — прогнати `node src/core/apps.check.ts` і **процитувати у звіті**, на чому саме
впало (на справжньому дефекті — відсутній `kind`, — а не на імітації).

---

## 6. Приймання

Playwright-сценарій (у `tests/`, як решта): власник заходить у Налаштування → бачить вкладку
«Застосунки» → на ній картка fiskaly зі станом і полями ключів, картки Winhotel/DIRS21/
PriceLabs/Unzer зі «скоро» і «хочу» → натискає «хочу» на Winhotel → «ви позначили» → повторний
натиск нічого не змінює → у розділі «Здоров'я» є пошта, fiskaly, менеджер каналів → симулювати
відмову fiskaly (мок, як у `channex.check.ts`) → картка показує «помилка» **з текстом** → зайти
платформною сесією на `/app/platform/apps` → той самий рядок червоний, у попиті Winhotel = 1.
Знімки обох екранів у звіт. `/app/settings/features` показує лише модулі, полів fiskaly там
немає.

Повний прогін перед звітом: `npx tsc --noEmit`, `npm run check`, `npm run check:pg` роллю
`alisio_app`, `check-schema-drift`, `check:i18n`, `check:routes`, `build`.

**ЧЕКПОІНТ (один):** перед злиттям — рецензія контролера по коду. Зупинка лише там. Усе інше
в блоці не залежить від рішення власника — робиться за один підхід (AUTOLOOP, «задача — це
блок»).

---

## 7. Звіт

Після кожного коміту — `docs/tasks/2026-09-09-block-apps.report.md`, формат
`docs/tasks/README.md` §5: коміти й CI; було → стало по кожному пункту 3.1–3.7 з файл:рядок;
міграція `0140` і що з наявними даними (нічого — таблиці нові); гейти, які були червоними до
коду, і **на чому саме**; **самостійні рішення окремим списком** (форма `apps.ts`, назви
статусів, як розв'язано цикл імпортів, як показано «менеджер каналів» без правки каналів);
що не вдалося; що потрібно від власника (команди дослівно). Знахідки поза обсягом — у
`2026-09-09-block-apps.notes.md` (наприклад: `fin_fiscal_settings` має `UNIQUE("property_id")`
двічі — слід дрейфу, це тека сесії 1).
