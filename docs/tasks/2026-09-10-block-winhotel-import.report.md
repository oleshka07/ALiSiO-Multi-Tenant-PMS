# Звіт: застосунок `winhotel-import` — частина А (сесія 5, задача 6)

**Гілка:** `claude/winhotel-import` (від `origin/claude/block-apps`, злито
`origin/claude/winhotel-schema`). **Задача:** `docs/tasks/2026-09-10-block-winhotel-import.md`.
**Обсяг цього звіту:** §2.1–2.4 + §2.7 + §2.8 (частина А: знімок доходить і витягається;
у ядро нічого не пишеться). Частина Б (§2.5–2.6) — після рецензії.

## 1. Коміти

| Коміт | Що |
|---|---|
| `b47ec44` | копія задачі з гілки контролера |
| (цей) | частина А цілком: агент, приймальний маршрут + 0403, міст, картка, гейт, документи |

## 2. Що зроблено — по пунктах задачі

### §2.1 Агент — `apps/winhotel-agent/`

`winhotel-agent.ps1` (PowerShell 5.1+), `install.ps1` (планувальник Windows, 03:00,
`agent.token` з ACL лише Administrators/SYSTEM), `README.de.md`. Три режими в порядку
задачі, кожен логує, який спрацював, без пароля й токена в лозі: (а) найсвіжіший `.fbk`
з `-BackupDir`, якщо молодший за 24 год; (б) `gbak -b` з паролем — `SYSDBA.password` у
теці Firebird → `-Password` → `masterkey`; (в) копія `winhotel.fdb`, лише якщо файл
відкривається ексклюзивно на запис (інакше названа відмова). gzip (`GZipStream`), sha256,
`POST {ALISIO_URL}/api/apps/winhotel-import/snapshots`, тіло — файл (`-InFile`), поля —
заголовки `X-Winhotel-Sha256 / -Mode / -Taken-At / -Hostname`, `Authorization: Bearer`.
Три спроби з паузою 60/120 с; на 400/401/404/409 повтору немає (це відповідь, не мережа).
Код виходу 0 лише на 201/200. Тимчасова тека видаляється в `finally`; тека Winhotel не
чіпається.

**Не перевірено живим PowerShell:** у контейнері немає `pwsh`. Зроблено баланс дужок
`()`/`{}`/`[]` після вирізання рядків і коментарів (99/99, 55/55, 25/25 в агенті; 27/27,
5/5, 10/10 в інсталяторі) і вичитка. Перший запуск на Windows — контролер/оператор; це
названа прогалина.

### §2.2 Прийом знімка

`src/app/api/apps/winhotel-import/snapshots/route.ts` → `src/apps/winhotel-import/api/
snapshots.handlers.ts receiveSnapshot`. Публічний (`src/proxy.ts` — рівно цей шлях,
не `/api/apps/` цілком; `check-route-guards` PUBLIC, `check-public-routes` PUBLIC_PREFIX +
двері `organizationByAgentToken`). Порядок: токен → організація (401) → `hasFeature(org,
'winhotel_import')` (404, не 403) → під `runWithOrganization`: sha256 hex (400), режим
з трьох (400), той самий sha256 → 200 з тим самим id, другий за добу → 409 → тіло
потоком у `<id>.part` через `pipeline` з хешем по дорозі → порожнє 400 → sha не збігся:
файл видалено, 400 → `rename` у `.fbk.gz` → рядок → `.ready` останнім → `reportOk` → 201.
Кожна відмова після встановлення організації — `reportError` з нашим текстом.

**Токен → організація — відхилення від букви задачі, назване.** Задача: «токен →
організація» і «хеш у `channel_credentials`». `channel_credentials` під політикою
орендаря, тож до того, як орендар відомий, рядок з хешем не прочитати. Два виходи:
відкрити таблицю ключів для читання за токеном (`PUBLIC_TOKEN_READ`) або назвати
організацію в самому токені. Обрано друге: токен = `<організація>.<секрет>`,
у базі `sha256(секрет)` під `seal()` у `channel_credentials.access_token` (канал
`winhotel_import`), звірка сталим часом уже під `runWithOrganization` названої
організації. Ідентифікатор організації не секрет — він у кожній адресі кабінету.
DECISIONS З23.

Міграція **0403** `winhotel_snapshots` — колонки за задачею; `counts_json` **JSONB**
(мапа генератора: усі `*_json` → JSONB; репозиторій зводить обʼєкт Postgres і рядок
SQLite до рядка); `UNIQUE (organization_id, sha256)` табличним констрейнтом, не окремим
індексом (генератор переказує унікальний індекс ще й констрейнтом, і новий клієнт дістав
би два обмеження проти одного в мігрованого). SQLite-дзеркало `migrateWinhotelImport()`.
`schema.sql` перегенеровано зі **свіжої** SQLite (`ALISIO_DATA_DIR` у тимчасову теку →
`DB_PATH` генератору): diff — рівно 31 рядок нової таблиці. З локальної `data/alisio.db`
генератор давав ще 58 чужих рядків (FK `business_units`/`expense_categories`/
`finance_counterparties` — порядок і `ON DELETE`): локальна база мігрована старішим
кодом, і це не моя зміна; у схему не потрапило.

`nginx`: окремий `location = /api/apps/winhotel-import/snapshots { client_max_body_size
200m; … }` в обох server-блоках (рядки 42–46 і 81–85), решта `25m` як була.

### §2.3 Міст — `deploy/bridge/`

`Dockerfile` (`node:22-bookworm-slim` + `firebird3.0-utils` + `firebird3.0-server-core`,
uid 1001 як `nextjs`), `bridge.mjs` (`--watch` у контейнері / `--once` локально),
`lib/convert.mjs` (перетворення), `lib/extract.mjs` (gbak -c → isql → jsonl → aggregates).
Compose: сервіс `bridge` під `profiles: ["bridge"]`, `network_mode: none`, без портів,
томи `winhotel-snapshots` (спільний з `app`, там `/app/data/winhotel`) і `bridge-work`,
`mem_limit ${BRIDGE_MEM_LIMIT:-768m}`, `cap_drop: [ALL]`, `no-new-privileges`.
`docker compose --profile bridge config` — валідний (перевірено з `env.beta.example`).

**Обрано `isql`, не `node-firebird`.** Драйвер говорить із сервером по TCP: у
контейнері довелося б тримати fbserver, порт і пароль SYSDBA — три речі, що ламаються
окремо. Вбудований `gbak -c` + `isql -q -b -charset NONE` відкривають файл самі — так
`extract.sh` пройшов справжні 407 МБ 10.09. Формат: кожен `apps/winhotel-import/sql/
<сутність>.sql` — запускний рукою SELECT, поля через `ASCII_CHAR(31)`, запис
закінчується `ASCII_CHAR(30)` (переноси всередині тексту нічого не ламають); шапка
`-- columns: name:type, …` каже мосту імена й роди полів. 27 сутностей за 14 кроками
плану + `aggregates.sql` (крок 7 `extract.sh`, 31 число). DECISIONS З25.

**`read_only` не поставлено** — вбудований Firebird пише таблицю блокувань і
`firebird.log`; замість цього немає мережі, `cap_drop ALL`, `no-new-privileges` (З27).
**Стеля памʼяті не виміряна** на живому знімку — це робить перший прохід на беті
(DEPLOY.md «Міст Winhotel»).

### §2.4 Картка

`settings/apps/page.tsx`: для `winhotel_import` (live, увімкнено) — останній знімок
(дата, режим, розмір, стан), «Створити/Замінити токен агента» (значення один раз, з
попередженням), таблиця останніх 10 (стан, текст відмови, числа звірки з `counts_json`),
«Імпортувати знімок» для `extracted`. Читає `GET /api/settings/apps/winhotel-import/
snapshots` (той ще й звіряє маркери мосту — `syncMarkers`), пише `POST …/token`,
`POST …/snapshots/<id>/import` — усе `withOwner`. **Кнопка імпорту відповідає названою
відмовою 409** «імпорт у ядро ще не підключений: частина Б» — не вдаваним успіхом.
22 нові рядки в каталозі: `check:i18n` 3543 → **3565**, de/cs 100 %.

`core/apps.ts`: `winhotel_import` `live: true`, `feature: 'winhotel_import'`, `fields: []`
(ключ генерують, не вставляють — коментар у маніфесті); `features.ts` — ключ `winhotel_import`
OFF, kind APP; `apps.check.ts` EXPECTED_KIND; `features.check.ts` дефолт + INTEGRATIONS
(варта в хендлері приймального маршруту, бо сесії немає). Сцени «хочу» в `apps.check.ts`
переведено з `winhotel_import` на `dirs21` — застосунок став live і зі списку «скоро»
випав (звіт постачальника рахує попит лише для не-live).

### §2.7 Гейт — червоним першим, цитати

`src/apps/winhotel-import/winhotel-import.check.ts`, у `check` і `check:pg`. Дві
організації (A — застосунок увімкнено, B — вимкнено, в обох токен), 11 сцен. Зелений на
SQLite, PGlite і — сцена 11 — на справжньому Firebird зі стабом `fixture/stub-db.sql`
(вигадані дані, по два значення на кожній осі). Червоність — девʼятьма мутаціями, кожна
відкочена (`git status` чистий по цих файлах):

| Мутація | Рядок гейта |
|---|---|
| `agent-token.ts`: будь-який секрет приймається | `A з секретом B очікували 401, отримали 201` |
| `snapshots.handlers.ts`: без `hasFeature` | `вимкнений застосунок: очікували 404, отримали 201` |
| без звірки sha256 | `битий sha256: очікували 400, отримали 201` |
| без `findSnapshotBySha` (дедуплікація) | `повтор: очікували 200, отримали 409` |
| `convert.mjs`: межа дат 1800 замість 1900 | `нуль Delphi не став null` |
| `units.sql`: `WHERE ZINR IS NOT NULL` | `units.sql: WHERE «ZINR IS NOT NULL» не відсікає видалене` (сцена 10) |
| `units.sql`: `(TA_STATUS < 1000 OR TA_STATUS = 1000)` — літерал на місці | `units: витягнуто 5, стаб має 4 живих` (сцена 11 — ловить те, чого сцена 10 не бачить, §3.2.1) |
| `extract.mjs`: не прибирає робочу теку | `робоча тека з відновленою базою лишилась` |
| `snapshots.repo.ts`: `.failed` не читається | `Expected values to be strictly equal` (стан лишився `received`) |

Один чужий гейт спрацював по-справжньому на першому повному `npm run check`:
`check-refusal-status --strict` → `snapshots.handlers.ts:67 — refuse(…, status): статус не
літерал`. Помічник `refuseReported(org, msg, status)` передавав статус змінною — гейт
не може довести 4xx. Переписано на дві гілки з літералами `409`/`400`; тип аргумента
звужено до `400 | 409`.

Дві правки самого гейта під час написання: подвійне читання тіла відповіді у власному
повідомленні (undici «Body is unusable»); і перша редакція сцени 10 стерегла ВІЗЕРУНОК
(«без фільтра» в коментарі) і почервоніла на `invoice_ledger.sql` — переписано на
властивість: файл без `TA_STATUS < 1000` мусить мати шапку `-- deleted: kept — <чому>`,
а файл із такою шапкою — бути в названому списку винятків гейта (шість).

Сцени задачі, які **належать частині Б** і в гейт ще не входять: незнайдений код категорії;
три адреси → три `reservation_guests`; повторний імпорт з новою датою виїзду; Sammelrechnung
→ staging з лічильником; гість чужої організації через refs; «той самий знімок двічі →
нуль нових рядків у ядрі». Стаб бази вже несе для них дані (бронь 101 з трьома адресами,
фактура 22591 з `M_DEBIRECHN = 1`, компанія з `DEBI_NR`).

### §2.8 `bridge-local.sh`

`apps/winhotel-import/bridge-local.sh <fbk> <тека>` і `--stub <тека>` (збирає стаб через
`fixture/make-stub.sh`: isql → .fdb → gbak -b → .fbk). На стабі — вихід 0. Числа:

```
entities: address_types 2, addresses 4, age_bands 3, booking_refs 1, bookings 5, cash_book 1,
  consent_types 2, consents 2, day_closings 2, folio_lines 5, invoice_ledger 2, invoice_lines 3,
  invoices 3, mandant 1, occupancy 4, payment_methods 5, payments 4, price_splits 1, prices 3,
  rate_codes 3, seasons 2, segments 2, service_groups 4, services 7, tax_codes 3, unit_types 3, units 4
numbers: snapshot_max_invoice_at 2026-09-09 08:11:00 · invoice_no_generator 22591 ·
  invoice_no_max_live "22591 2" · bookings_live 4 · bookings_future 2 ·
  booking_status_mix "0 2 0 2 | 0 0 1000 2 | 0 0 0 1 | 100 0 0 1" · occupancy_junk_dates 1 ·
  addresses_live 4 · addresses_with_debtor_no "1 10001 10001" · units_real_pseudo "3 1" ·
  folio_lines_live "5 1032.0" · payments_live "4 375.5" · open_guest_balances "2 283.500" ·
  vouchers_sold "1 100.0" · vouchers_redeemed "1 100.0" · deposits_on_future_bookings "1 50.0" ·
  last_day_closing "2026-09-08 750.0"
```

Кожне число читається зі стаба очима: 5 броней = 4 живі + сторнована з датою (видалена
без дати 105 — ні); `units 4` = 102, 103, 201, 9999 (104 з `TA_STATUS 1000` — ні);
`folio_lines 5` (рядок 1006 видалений — ні); `payments 4` (платіж 5 видалений — ні);
`ÜF Übernachtung/Frühstück`, `141000 → 141`, `GEBDAT 1899-12-30 → null`, BLOB з `\r\n` —
у `*.jsonl`. `open_guest_balances` — процедура `GET_OFFEN_ZAHLBETRAG` є в стабі (як у
Winhotel), тож `EXECUTE BLOCK` з `extract.sh` працює й тут. На порожній базі (жодного
рядка) міст не падає: `COUNT(*)` дає 0, `MAX` — `<null>`, сутність — 0 рядків.

**Живий прохід на справжньому `WINHOTEL.fbk` — контролер** (у хмарі, `aggregates.json`
у `extract-out/`). У контейнері сесії справжньої бази немає і не буде (§3 задачі).

### CI гілки після першого пушу — ЧЕРВОНИЙ, і чому (AGENTS §4)

Запуск 801 (`76f8a6f`): `types, self-checks, build` — зелений; `hotel onboarding` (schema
drift, hotel files) — зелений; `onboarding and tenant isolation` — `check:pg` роллю
`alisio_app` **зелений** (мій гейт у складі), провізія, ізоляція, живі маршрути, два готелі до
фактури — зелені; **`public site` (Playwright) — червоний.** Причина — `tests/e2e/apps.spec.ts`
блоку «Застосунки» стверджував, що картка Winhotel — «скоро» з кнопкою «хочу»; тепер вона live.
Відтворено локально на прод-збірці і свіжій SQLite з `provision-org.mjs`:
`Locator: getByTestId('app-status-winhotel_import') · Expected /скоро|bald|brzy|soon/ ·
Received "noch nicht angesprochen"`. Спец переведено: «скоро» — три картки, «хочу» — на DIRS21
(і попит платформи — DIRS21), а Winhotel — окремий крок: без «хочу», вимикач, картка знімків,
«Створити токен агента» → значення виду `org_….<64 hex>` показане один раз. Локально
`33 passed (8.0m)` на всьому e2e; другий пуш — дивитись на запуск.

## 3. Що пішло в staging і чому

Нічого — частина А в ядро не пише. `winhotel_refs`/`winhotel_staging` — частина Б
(міграція 0404+).

## 4. Правки deploy-файлів рядок у рядок

| Файл | Рядки |
|---|---|
| `deploy/docker-compose.yml` | `app.volumes`: `+ winhotel-snapshots:/app/data/winhotel` (з коментарем); новий сервіс `bridge` (профіль, `network_mode: none`, томи, `mem_limit`, `cap_drop`, `security_opt`, logging); `volumes`: `+ winhotel-snapshots`, `+ bridge-work` |
| `deploy/nginx/alisio.conf` | prod (порт 3130) і beta (3131): `+ location = /api/apps/winhotel-import/snapshots { client_max_body_size 200m; proxy_pass …; include …; }` перед `location /`; `25m` лишається |
| `deploy/env.beta.example`, `deploy/env.prod.example` | `+ BRIDGE_MEM_LIMIT=` з коментарем |
| `deploy/bridge.sh` | новий: `up | down | status | logs` для профілю (оператору не диктуються compose-команди, AGENTS §5) |
| `deploy/bridge/*` | новий образ і код мосту |
| `Dockerfile` застосунку, `checks.yml` | **не змінено** |

## 5. Приймання (§4 задачі)

| Пункт | Стан |
|---|---|
| `tsc` | 0 |
| `npm run check` | зелений з другого прогону (перший — `check-refusal-status` на моєму помічнику, §2.7); новий гейт у складі |
| `check:pg` роллю `alisio_app` | локально — PGlite зелений (сцена 6 без політики); справжній Postgres — CI гілки, дивитись на запуск |
| `check-route-guards`, `public-tenant`, `check-public-routes` | зелені з новим маршрутом: 416 під вартою; 30 без сесії — 15 перепусткою (+1: `organizationByAgentToken`), 14 орендарем, 1 нічим |
| `check-boundaries` | без змін: `src/apps` не модуль, у модулі не заходить |
| `check:i18n` | 3543 → 3565, de/cs 100 %; `check:unwrapped`, `check:i18n-leak` чисті |
| `build` | `npm run build` — ок; чотири нові маршрути в переліку (`/api/apps/winhotel-import/snapshots`, `/api/settings/apps/winhotel-import/{token,snapshots,snapshots/[id]/import}`) |
| `docker compose --profile bridge config` | валідний |
| `bridge-local.sh --stub` | вихід 0, числа вище |
| `bash -n` | `bridge-local.sh`, `make-stub.sh`, `bridge.sh` — ок; `check-fatal-grep` 24 скрипти чисто |
| `pwsh`/PSScriptAnalyzer | **немає в контейнері** — баланс дужок і вичитка; названо в §2.1 |
| Документи | ARCHITECTURE (застосунки: розділ Winhotel; §5 публічна поверхня; §7 гейт; §8 «Лишається»), DEPLOY («Міст Winhotel»), DECISIONS З22–З28, NAMING (`winhotel_snapshots.status/mode`) |
| `check-no-tenant-names`, `audit-dead-data` | чисто; `winhotel_snapshots.imported_at` ніхто ще не читає — частина Б |

## 6. Що не вдалося / названі межі

- PowerShell не запускався (немає `pwsh`).
- Стеля памʼяті мосту не виміряна (перший прохід на беті).
- Заголовок `X-Winhotel-Hostname` приймається, у базу не пишеться (колонки в задачі
  немає); іде лише в лог відмови sha256.
- Сцена 8 гейта (імпорт → 409 з назвою частини Б) перевіряє наявність хендлера, не
  його відповідь: `withOwner` вимагає сесії, а сцени з сесією прийдуть у частині Б разом
  зі справжнім імпортом.

## 7. Далі

Цикл очікування з `origin/claude/controller-2` (`MINE=6`). Після рецензії — частина Б:
0404 `winhotel_refs` + `winhotel_staging`, довідники-звірка, гості/компанії через
`@guests`/`@companies`, брони через `@bookings`, рядки/оплати через `@invoicing`,
заморожені фактури → staging, сальдо, ідемпотентність, `counts_json` §2.6, сцени §2.7,
які лишились.

---

# Задача 7 — §1: масштаб сум (блокуюча знахідка рецензії А)

**Що було не так.** Стаб оголошував колонки сум `BIGINT` зі значенням `141000` (тип
ЗБЕРІГАННЯ з `table-columns.tsv`), і міст ділив на 1000. Справжні колонки — домени
`N_BETRAG NUMERIC(12,3)`, `BETRAG2 NUMERIC(12,2)`, `BETRAG4 DECIMAL(12,4)`; `CAST … AS VARCHAR`
віддає вже `141.000`. На живій базі ніч за 141 € приходила як `0.141`. Гейт був зелений, бо
стаб мав форму здогаду, не живого зразка (інваріант 28) — рівно випадок §2.8.

**Порядок, як велено.**

1. Стаб — на справжні домени: `CREATE DOMAIN` дослівно з `extract-out/main/DDL.sql` (19
   доменів: `N_BETRAG`, `BETRAG2`, `BOOL`, `TV*`, `INT`, `INT0`, `DOMDATUM`, `DOM_DATUMZEIT`),
   типи кожної колонки — з розібраного DDL (не з tsv); значення `141.000`, `89.500`,
   `12.000`, `-1.500`, `KURS_FAKT 1.000000`. Виявлено попутно: `AUSGBUCH` і
   `RECHNUNGSDRUCK` не мають `TA_STATUS` взагалі (у стабі колонка прибрана; їхні SQL і так
   без фільтра). `STEUSTAM.STSATZ` і `ADRESSEN.RABATT` — `NUMERIC(6,2)`, у SQL сутностей
   переведені з `int` на `amount`.
2. **Гейт червоним** на переробленому стабі, до правки мосту:
   `AssertionError: депозит 50000 → 50 · 0.05 !== 50` (сцена 11, `GASTKONT.ANZA_BETRAG`
   `50.000` після `/1000`).
3. `convert.mjs`: `convertAmount` читає десятковий рядок як є (`/^-?\d+(\.\d+)?$/`), без
   ділення, зі знаками домену. Сцена 9 переписана: `141.000 → 141`, `12.50 → 12.5`,
   `-1.500 → -1.5`, `0.038 → 0.038`, `141.0010 → 141.001`, `1.000000 → 1`, і ціле без крапки
   `141000` — це 141000, не «×1000». Гейт зелений: сцени 9 і 11 (живий Firebird).
4. `aggregates.sql`: усі `/ 1000.0` прибрано; процедура стаба `GET_OFFEN_ZAHLBETRAG` — без
   ділення. Живі агрегати контролера (`extract-out/aggregates-2025-03.json`) лишено як є з
   полем `note`: лічильники правильні, суми в тому проході поділені зайвий раз — справжні
   ×1000 (`folio_lines_live` 3 317 206.4 €); перерахунок — наступним живим проходом.
5. `bridge-local.sh --stub` — вихід 0, числа очима: `folio_lines_live 5 1032.000`,
   `payments_live 4 375.500`, `open_guest_balances 2 283.500`, `deposits 1 50.000`,
   `last_day_closing 2026-09-08 750.000`; `services.betrag` 0/12/3/141/0/19/9.5,
   `prices.betrag` 89/141/118, `tax_codes.stsatz` 7/19/5, `kurs_fakt` 1.

Документи, що казали «ділити на 1000», виправлено разом: `MAPPING.md` правило 2,
`IMPORT-PLAN.md` §2.1, `notes.md`, ARCHITECTURE (розділ Winhotel), DECISIONS З26,
шапка `convert.mjs`, коментарі SQL сутностей.


---

# Задача 7 — §2: Частина Б (імпорт у ядро)

**Коміт:** `98d21685` — код, схема, UI, i18n і документи одним; звіт — окремим комітом після нього. Гілка `claude/winhotel-import`.
**CI гілки — запуск 815 (`5433afe5`) ЗЕЛЕНИЙ усіма трьома роботами:** `types,
self-checks, build`; `hotel onboarding` (schema.sql і міграції з 0404 описують одну базу,
готелі заводяться двічі); `onboarding and tenant isolation` — крок `check:pg` на справжньому
Postgres роллю `alisio_app` (гейт у ньому, тобто Б6 з політиками 0404) 12:18→12:31, ізоляція,
маршрути, два готелі до фактури, Playwright `public site` — усе зелене. Рядки гейта в логу CI
очима не перечитані: інструмент сесії віддає останні 5000 рядків, і це лог контейнера бази;
доказ — стан кроку, не цитата.

## Б.1 Що зроблено — по пунктах §2.5–2.6 і уточненнях власника

| Пункт | Де | Що |
|---|---|---|
| 0404 `winhotel_refs`, `winhotel_staging` | `db/postgres/migrations/0404-…sql`, `src/lib/db.ts migrateWinhotelImport`, `db/postgres/schema.sql` (+53 рядки, рівно дві таблиці — зі СВІЖОЇ SQLite: `ALISIO_DATA_DIR` у тимчасову теку → `apps.check.ts` мігрує → `wal_checkpoint(TRUNCATE)` → `DB_PATH` генератору) | обидві з `organization_id` NOT NULL, `DEFAULT NULLIF(current_setting(…))`, FK на `organizations` за ОЗНАЧЕННЯМ (`pg_get_constraintdef … LIKE 'FOREIGN KEY (organization_id)…'`), UNIQUE (організація, сутність, LNR) табличним констрейнтом, індекс по `organization_id`, RLS `USING`+`WITH CHECK`. `payload_json` — JSONB на Postgres, TEXT у SQLite; читає його поки ніхто (UI показує лічильники), тож різниця форми ще не коштує |
| памʼять імпорту | `data/refs.repo.ts` | `refsOf`/`findRef`/`putRef` (UPDATE-потім-INSERT, без `ON CONFLICT` — SQLite-дзеркало без відповідного індексу), `stage` (той самий upsert), `stagingCounts`, `fingerprintOf` (стабільний JSON із сортованими ключами → sha256/32) |
| довідники — ЗВІРКА, не створення | `import/importer.ts verifyDictionaries` | категорія ↔ `unit_types.code` (без регістру), номер ↔ `units.code` (псевдо `ZINR ≥ 9000` і `STOCK = 99` не звіряються), послуга ↔ `additional_services.name` (без регістру; послуги груп проживання/сніданку з `BETRAG 0` — не потребують), `STS` ↔ `fin_tax_rates.code`; хоч один незнайдений → `refuse(409)` з ПЕРЕЛІКОМ і нуль записів. **AP 111/112** (уточнення власника) — звичайна категорія: у готелі має бути `unit_types.code = 'AP'`, інакше відмова її назве. **STOCK** як поверх не переноситься нікуди |
| адреси | крок 2–3 | `DEBI_NR > 0` → `createCompanyForTests` (`@companies/kernel`; це єдині двері модуля без HTTP, назва — справа модуля, З29) з `business_id = DEBI_NR`; решта → `findOrCreateGuest` (`@guests`): дедуплікація — правило фасаду (З32), не `SUCHNAME+PLZ+GEBDAT`; стать (`GESCHLECHT`/`ANREDE`), мова (`SPRACHE`), примітки (`BEMERK`, `BEMERK2`, `WUNSCH_ZI`) — лише в порожнє (`COALESCE`). Банк, картки, пароль — не приходять узагалі (міст їх не вибирає, З26) |
| брони | крок 4 | `GASTKONT` → `reservations`: майбутні (заїзд > дати знімка) усі, минулі — із `since` (дефолт 2025-01-01, поле дати на картці, тіло `{since}`); категорія — `RESV_KATE_LNR` або `LNR_KATE`; номер — за кодом, псевдо → `unit_id NULL`; статус — `bookingStatus` (TA ≥ 1000 → cancelled, CI 2 → checked_out, CI 1 → checked_in, BUCH 100 → tentative); гість — перша з `GASTNR_1..3`, що є гостем; фірмова бронь без гостя → гість «представник фірми» (`NAME2`/`NAME1`); `MARKSEG` → `booking_sources` за назвою, інакше `direct`; `total_price` = Σ `BUCHKONT.GBETRAG` броні; депозит `ANZA_BETRAG`; `INSERT … external_uid = 'winhotel:GASTKONT:<LNR>'` під `insertingStay` (`@bookings/overlap`; перетин → staging `overlap`) + `noteAvailabilityChanged` (`@channels/outbox`); три адреси → `reservation_guests` з `guest_id`, супутник і діти з `ADRESSEN` за прапорцями `BEGLEITOK`/`KIND1OK…`; `VERK_NR ≠ LNR` → `parent_id` другим проходом |
| рядки рахунків | крок 5 | `BUCHKONT` → `addCharges` (`@invoicing/kernel`) у фоліо броні (`ensureReservationFolio`); `kind` за `LEISTUNG.WG`, ставка — `pickRate` за датою послуги (інваріант 18), кількість×ціна — `lineQuantity` (ME/TAGE/E_PREIS, інакше 1×GBETRAG); рядок, виставлений дебітору (`RECHNUNGSPOS.M_DEBIRECHN` → `BK_LNR`), — в окреме фоліо платника-компанії (`openFolio`, «Sammelrechnung (Winhotel)») |
| оплати | крок 6 | `ZAHLUNGEN` → `recordReservationPayment`; `DEVISEN` → чотири класи (`paymentMethod`: gutschein → voucher; bar/kasse → cash; ec/karte/visa/… → card_terminal; debitor/überweisung/bank/paypal/online/**unzer** → transfer — уточнення власника: Unzer лише назва); без класу → staging `method_unmapped`; **готівка/картка на обʼєкті DE без `fiscal_de` → staging `fiscal_guard`** (З31); потім `recalcPaymentStatusFromFolio` |
| фактури | крок 7 | усі `RECHNUNG` + `RECHNUNGSPOS` + `RECHNUNGSDRUCK` → staging `frozen` / `frozen_sammelrechnung` цілим JSON; у `invoices` нічого (чужа нумерація не імітується, §1 задачі) |
| сальдо, GDPR, каса | крок 8 | вісім чисел `aggregates.json` → staging `balance` (LNR = порядковий, причина = ключ агрегату); `ZUSTIMMUNGEN` → `consent`, `KASSENBUCH` → `cash_book` |
| Kurtaxe | — | немає (уточнення власника): жодної мапи на `fees_taxes` |
| ідемпотентність | усі кроки | ref + відбиток після кожного рядка; той самий знімок → нуль змін (Б3); новіший → бронь `UPDATE` з обома вікнами дат у outbox (Б4), гість дописується, рядок/оплата без дверей на зміну → `changed`; зникла бронь → `cancelled`, ніколи `DELETE` (Б5, З33) |
| `counts_json` | `snapshots.repo.ts markImporting/markImported/markImportFailed` | `import: {phase:'importing', startedAt}` під час роботи (стан лишається `extracted` — CHECK статусів без «importing»); після — звіт: `entities{winhotel, imported, updated, staged, skipped{…}}`, `staging[]`, `reconcile{mustMatch[10], explained[6]}`, `mismatch`, `refs`, `since`, `durationMs`; відмова → `error` знімка, стан `extracted`, `import` прибрано |
| звірка (IMPORT-PLAN §5) | крок 9 | **мусить зійтись:** категорії, номери, ставки, `reservations` = GASTKONT у вікні − staging, майбутні живі, `fin_folio_items` кількість і сума, платежі кількість і сума (у фоліо + staging), фактури = RECHNUNG у staging. **Пояснене:** гостей ≤ адрес (злиті дублікати), компанії, брони до дати «з», брони у staging, фіскальна варта, псевдо-номери. Хоч одне не зійшлось → `mismatch:true`, картка червоним з назвами й числами |
| маршрут | `api/snapshots.handlers.ts importSnapshot` | 202 і робота у фоні (50 тис. броней не влазять у HTTP-запит); повторний натиск → 409 «вже триває»; `importSnapshotNow` — той самий код для гейта |
| картка | `settings/apps/page.tsx` | бейдж «імпорт триває», рядок «у ядрі: брони N+M · гості · рядки · оплати · з <дата>», «відкладено N: <причина> n …» (словник `STAGING_REASON` ↔ NAMING.md), «Числа не зійшлись: …» червоним, поле дати «з», «Імпортувати знову» для `imported`; 28 нових рядків у каталозі (3565 → 3593 — зрушення числа, не стеля, §3.2 сьомий випадок), de/cs 100 % |

## Б.2 Гейт — червоним першим, цитати

Сцени Б1–Б6 (`winhotel-import.check.ts`), фікстура — `fixture/extracted/*.jsonl` (те, що
міст робить зі стаба; з Firebird у системі сцена 11 ще й звіряє, що живий витяг стаба дає
ті самі лічильники, що закомічений). Готель A сіється рівно тим, що імпорт має ЗНАЙТИ.

| Сцена | Твердження |
|---|---|
| Б1 | категорії «SD» немає → `409`, текст називає «категорія «SD»», нуль броней і гостей, стан `extracted`, текст у `error` |
| Б2 | 5 броней (4 живі + сторно з датою), 3 гості + 1 компанія, 3 `reservation_guests` броні 101 з `guest_id` і «Müller-Stub», `141.000 × 3 → 423`, депозит 50, «Späte Anreise», бронь 101 на номері 102, 102 `checked_out` + `partial` (ваучер 100 із 327), 104 `cancelled`, 106 на псевдо 9999 → без `unit_id`, 105 (видалена без дати) не імпортована; 5 рядків, 1 оплата у фоліо, 3 у staging `fiscal_guard`, 3 фактури у staging (1 `frozen_sammelrechnung`); `counts_json.import.mismatch === false` і числа |
| Б3 | той самий знімок удруге: `imported + updated === 0` по бронях, рядках, оплатах, гостях; лічильники `reservations`, `guests`, `winhotel_refs` ті самі |
| Б4 | `BISAUFH` 101 → 2027-03-14: `updated === 1`, `imported === 0`, `check_out` і `nights = 4` нові, броней стільки ж |
| Б5 | бронь 102 зникла зі знімка: `skipped.cancelled_missing_in_snapshot === 1`, статус `cancelled`, рядків стільки ж |
| Б6 | B не знаходить ref адреси A; у B нуль гостей; під Postgres — голий `COUNT(*)` по `winhotel_refs`/`winhotel_staging` з B дає 0 |

Червоним — трьома зломами `importer.ts` (кожен відновлено, `diff -q` порожній):

```
злам 1: `known.fingerprint === fp` → `false` (повтор пише знову)
AssertionError: повтор: {"winhotel":5,"imported":0,"updated":5,"skipped":{},"staged":0}
5 !== 0

злам 2: UPDATE … status = 'cancelled' → DELETE FROM reservations
AssertionError: бронь, якої немає в новому знімку, не cancelled

злам 3: total_price / 1000 (клас §1 цієї задачі)
AssertionError: total_price 141.000 × 3 → 0.423
0.423 !== 423
```

Зелений: SQLite і `DB_DRIVER=pglite` (форма SQL і JSONB); політики 0404 — лише `check:pg` у
CI (`alisio_app`). Один хибний очікуваний: перша редакція Б2 чекала 4 гостей — у стабі 4
адреси, з них одна компанія; виправлено твердження, не код.

## Б.3 Що пішло в staging на стабі і чому

| Сутність | Причина | n | Чому не в ядрі |
|---|---|---|---|
| `payment` | `fiscal_guard` | 3 | готівка і картка на обʼєкті DE без `fiscal_de` — варта `folio-payments.repo` відмовляє свідомо (З31) |
| `invoice` | `frozen` | 2 | чужа нумерація; ядро не імітується (§1) |
| `invoice` | `frozen_sammelrechnung` | 1 | те саме, виставлена дебітору |
| `balance` | ключ агрегату | 8 | сальдо числом; у ядрі немає «відкритого сальдо гостя» окремо від фоліо |
| `consent` | `core_gap_gdpr_journal` | 2 | CORE-GAPS 6 |
| `cash_book` | `core_gap_cash_book` | 1 | CORE-GAPS 9 |

## Б.4 Відхилення від задачі — названі

- **Транзакції на сутність немає** (§2.5 п. 9): фасади беруть `getSql()` самі, на Postgres у
  `sql.tx` це інше зʼєднання — обгортка прикидалась би. Замість неї ref одразу після рядка
  (З30). Ціна: падіння посередині лишає частину сутності імпортованою — але наступний прогін
  продовжує без дублів, і саме це гейт Б3 стверджує.
- **Компанія — через `createCompanyForTests`**: інших дверей у `@companies/kernel` без HTTP
  немає; писати в `companies` своїм SQL — пробій межі (гейт `check-boundaries`).
- **Дедуплікація гостей — правило `@guests`**, не IMPORT-PLAN §2.2 (З32).
- **`payload_json`** — JSONB на Postgres, TEXT у SQLite; поки читають лише лічильники.
- **`check-property-scope --strict`** зловив 4 читання без осі обʼєкта — названо
  `ALL_PROPERTIES` з причиною (знімок належить рахунку, звірка рахує всі обʼєкти).
- **Живого імпорту не було** — лише стаб. Перший живий: `bridge-local.sh` на `.fbk` готелю →
  довідники під коди Winhotel на беті → «Імпортувати знімок» → `reconcile` очима.

## Б.5 Документи

ARCHITECTURE (розділ Winhotel — таблиця кроків частини Б, рядок застосунку, рядок гейта,
«Лишається»), NAMING (`winhotel_refs.entity`, `winhotel_staging.reason`), DECISIONS З29–З33,
`schema.sql` перегенеровано. `check-docs-current`, `check-decisions-registry` — чисто.

---

# Задача 8 — живі розриви частини Б, денна дельта і незатирання для кіоска

**Коміти:** `d95bfc5a` — код, схема, агент і документи; `53550ce7` — звіт; далі за §0: `06446093` — злиття `block-apps`; наступний — перейменування 04xx, двері `adoptDebtorNo` і цей розділ (хеш у `git log`). **CI гілки — ЗЕЛЕНИЙ двічі:** запуск 833 (`53550ce7`, задача 8 до злиття) і запуск 842
(`11b52fe9`, після злиття `block-apps`, перейменування 04xx і дверей `adoptDebtorNo`) —
усі три роботи: `types, self-checks, build`; `hotel onboarding` (`schema.sql` і міграції
0400–0405 описують одну базу, готелі заводяться двічі); `onboarding and tenant isolation`
(`check:pg` роллю `alisio_app` 14:37→14:51 — гейт Б1–Б9 з політиками 0403–0405 на
справжньому Postgres, `debtor-no.check` з перегонами, `folio-payments.check` із З34;
ізоляція, маршрути, два готелі до фактури, Playwright `public site`).

## 8.0 Дописка §0 — злиття `block-apps` і смуга 04xx

Першим комітом задачі (за дописаною §0, `5e755115`) злито `origin/claude/block-apps`
(`06446093`): міграції застосунків прийшли як 0400–0402 замість 0140–0142 (git побачив
перейменування, старих імен у дереві немає — `ls db/postgres/migrations | grep 014` дає лише
`0140-a-debtor-number…` сесії 1), разом із ними — дебітор (0140), згоди й злиття гостей
(0300). Чотири конфлікти зведено обʼєднанням обох сторін: `package.json` (гейти обох гілок +
`winhotel-import.check.ts` у `check` і `check:pg`), `src/lib/db.ts` (мігратор згод +
`migrateWinhotelImport`), NAMING і ARCHITECTURE. Свої міграції перейменовано `git mv`:
`0143 → 0403`, `0144 → 0404`, `0145 → 0405` (ніде не накочені); 42 згадки в `db.ts`, репо
застосунку, шапках міграцій, ARCHITECTURE, NAMING, DECISIONS і цьому звіті — за новими
іменами. `schema.sql` після злиття перегенеровано зі свіжої SQLite — diff порожній (злитий
файл уже описував ту саму базу). Злиття принесло `companies.debtor_no` — тож §1.2 нижче пише
`DEBI_NR` у колонку, а не в staging (див. рядок 1.2).

## 8.1 Блокери живого проходу (§1) — кожен червоним першим

Стаб перебудовано так, щоб він мав форму ЖИВОГО знімка, а не документації (інваріант 28,
26): `LEISTSTA.WG` = LNR групи (1…6), коди груп `WARENGRU.WGNR` 100/200/300/600/700/750 —
**`wg ≠ wgnr` на кожній послузі**; адреса 6 «Gast Sechs» з `DEBI_NR 10002` і `ADR_WAHL 0`;
нові послуги «Tanken» (група 750), «Kurtaxe» (600), «Haustier» (200, без пари в каталозі);
«Frühstück - Speisen» (дефіс із пробілами) проти каталожного «Frühstück – Speisen» (тире);
нові рядки BUCHKONT 1007 Tanken 30 (на 103) і 1008 Kurtaxe 8 (на 102). `fixture/extracted`
перегенеровано (`bridge-local.sh --stub`), сцена 11 — 10 послуг, 6 груп, 5 адрес, 7 рядків,
сальдо 321.5.

**Червоне до правки коду — той самий текст, що бачив контролер на живому:**

```
Refusal: Імпорт не почато: у готелі немає 8 з довідника Winhotel — послуга «Logis»,
послуга «Frühstück - Speisen», послуга «ÜF Übernachtung/Frühstück», послуга «Gutschein
für Hotel», послуга «Aufbettung», послуга «Tanken», послуга «Kurtaxe», послуга «Haustier»
```

| § | Правка | Червоне (злом після зеленого) |
|---|---|---|
| 1.1 | `groupCodeOf(service, groups)` — код групи ЛИШЕ джойном `wg → WARENGRU.lnr → wgnr`; `lineKind(code, groupName)`: 100 або «Logis/Übernachtung» → `lodging`, 600 → `city_tax`, ≥ 700 → `cash_article`; `needsCatalogMatch(s, code)` пропускає 100 і ≥ 600. Касові статті — staging `cash_article` (ідемпотентно через `stagedLnrs`), поза фоліо гостя і поза сумами звірки; у `explained` — кількість і сума. На стабі «Gutschein für Hotel» (700 Geldtransit) і «Tanken» (750) → staging; `lodging 3 / city_tax 1 / service 1` | код групи з `WG` без джойна → «рядків рахунку 7, у фоліо гостя мають бути 5 із 7 — 7 !== 5» |
| 1.2 | `isCompany(a) = a.adr_wahl === 1`; `business_id` компанії більше не вигадується з `DEBI_NR`. Після злиття `block-apps` (§0) колонка `companies.debtor_no` (0140, сесія 1) на гілці є, тож `DEBI_NR` фірми приймається дверима **`adoptDebtorNo`** (`@companies/kernel`, нові двері: ставить номер замість виданого лічильником, зсуває `organizations.next_debtor_no` за ним; `taken` — коли номер уже в іншої фірми рахунку → staging `debtor_no_pending` з `why`). Сцена в `debtor-no.check.ts`: adopted / already / taken / not_found і лічильник. Для гостя `DEBI_NR` не переноситься | компанія за `DEBI_NR > 0` → «гостей 3, адрес з ADR_WAHL 0 у стабі 4 — 3 !== 4»; до підключення дверей → «DEBI_NR мав лягти в companies.debtor_no, а не в staging: 1 !== 0» |
| 1.3 | `verifyDictionaries` повертає `unmatchedServices`, не відмовляє: звіряються послуги груп 200–500, ім'я нормалізоване (`normalizeServiceName`: NFC, регістр, `‐‑‒–—−` → `-`, пробіли навколо дефіса й подвійні пробіли) — «Frühstück - Speisen» знаходить «Frühstück – Speisen»; незнайдені → `explained` «послуги без пари в каталозі: N» з переліком (до 40 назв) | до правки — refusal вище; після — Б2 стверджує рівно «Haustier» у переліку і жодного «Speisen» |
| 1.4 | `recordPayment({ source: 'import', origin: 'winhotel:<LNR>' })`: імпортна йде повз варту й підпис, `tse_status` NULL; `source = 'import'` без `origin` виду `/^winhotel:\d+$/` — відмова; `origin` без `source` — відмова. `recordReservationPayment` передає обидва. 0405: `fin_folio_payments.source`, `origin`. `folio-payments.check.ts`: дві нові сцени (імпортна без походження → відмова; після імпортної — рецепційна готівка на DE без `fiscal_de` відмовляється як раніше). Імпортер: `fiscal_guard` прибрано, усі 4 оплати стаба у фоліо (готівка й картка на DE) | вимога походження вимкнена → «Missing expected rejection: імпортна оплата без походження мала бути відмовлена» |

**Очікувані числа для повторного живого проходу контролера** (той самий знімок,
`since 2025-01-01`): послуги більше не відмовляють; компаній = адрес з `ADR_WAHL 1` ≈ **2 143**,
гостей — решта живих (≈ 17 000 з дублікатами за правилом `@guests`); `fin_folio_items` —
3 457 мінус рядки груп 700/750/800 (вони в staging `cash_article`, число і сума — у
`explained`), і серед них `lodging` — рядки «Logis»/«Übernachtung» (більшість суми);
платежів у фоліо **436** (141 + 295 колишніх `fiscal_guard`), усі з `source = 'import'`;
`staging.payment.fiscal_guard` = 0; майбутні брони — рядок звірки віднімає staging (912 − 12 =
900 → `ok`); `mismatch: false`, якщо жоден інший рядок не розійшовся. `booking_sources`
готелю мають носити назви каналів, як у `GASTKREF.EXT_SOURCE` («Booking.com», «DIRS21»…),
інакше джерело — `direct`, а розподіл значень — у `explained`.

## 8.2 Числами (§2)

- **Майбутні 912 ≠ 900** — рядок звірки тепер «майбутні брони (після знімка), живі, без
  staging»: staging майбутніх лічиться (`skipped.staged_future`) і віднімається. 12 = ті, що в
  staging (`no_unit_type`/`no_guest`/`overlap`), і кожна з них має свій рядок у `winhotel_staging`
  з повним JSON — не втрата.
- **`overlap` 23** — тепер із причиною в payload і в лічильниках `overlap_winhotel_double` (інша
  ЖИВА бронь Winhotel на тому ж `LNR_ZINR` з перетином дат — його власний овербукінг),
  `overlap_umzug` (`UMZUG_ZINR` непорожній), `overlap_other`; рядок у `explained`. Ніч виїзду
  наше обмеження не рахує зайнятою (`daterange(check_in, check_out)` напіввідкритий), тож
  третьої причини «наш `insertingStay`» немає — лишається `other` для решти, і на живому
  проході її число покаже, чи є щось, чого мапа не бачить.
- **`MARKSEG` — не канал.** Джерело — `GASTKREF.EXT_SOURCE` (є у витягу `booking_refs` з
  частини А: «Booking.com» у стабі), за назвою в `booking_sources`; без пари → `direct`.
  Розподіл значень `EXT_SOURCE` на живому — рядок `explained` «брони з посиланням каналу».
  Гейт: бронь 106 стаба → `booking_com`, 101 без GASTKREF → `direct`.
- **`merged_by_name` 1 495** — правило не міняється (З32); імпорт лічить, скільки злиттів лише
  за імʼям мають іншу дату народження або інше місто (`merged_by_name_other_birthdate`,
  `merged_by_name_other_city`, рядок у `explained`) — число для сесії 3 з'явиться в
  `counts_json.import` живого проходу.
- **`ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint`** при старті свіжої
  SQLite — це `src/lib/db.ts:3690–3700`, «per-organization invoice numbering migration»
  (коміт `96d9243f`, 26.08.2026, feat(services)): `INSERT INTO invoice_counters … ON
  CONFLICT(organization_id, series, year)`, а `CREATE TABLE invoice_counters` вище має
  `PRIMARY KEY (series, year)` без організації. На свіжій базі таблиця порожня, `catch` друкує
  й іде далі — не моє і не зламане, але лічильник фактур на свіжій базі не пересівається
  цим шляхом. Названо; правити — власнику мігратора (`src/lib/db.ts`, поза застосунком).

## 8.3 Кіоск (§3)

**Режим агента `-Mode Delta`** (`winhotel-agent.ps1`): `isql.exe` (шукається поруч із
`gbak.exe`), паролі — ті самі три джерела (`Get-Passwords`), вікно −1…+3 дні (`-DeltaDaysBefore`/
`-DeltaDaysAfter`), шаблони `sql-delta/*.sql` з `{{FROM}}`/`{{TO}}`, вивід кожної сутності —
секцією `ASCII 29 + ім'я + LF + сирий текст` в один файл → gzip → той самий маршрут із
`X-Winhotel-Mode: delta` і `X-Winhotel-Window: від..до`. `install.ps1` реєструє другу задачу
«ALiSiO Winhotel-Delta» кожні 15 хв (`-DeltaMinutes`, `-NoDelta`). README.de.md — розділ
«Tagesdelta» і три нові рядки в таблиці помилок. Шаблони — 13 файлів: 6 із вікном (bookings,
occupancy, addresses трьох `GASTNR`, folio_lines, payments, booking_refs) і 7 довідників
цілком; `-- columns:` дослівно як у SQL мосту (гейт Б9 звіряє кожен).

**Сервер:** 0405 розширює `winhotel_snapshots.mode` на `delta` (Postgres — CHECK за
означенням, SQLite — перебудова таблиці зі зняттям і поверненням індексів, лічильник
звіряється); `parseWindow` — без заголовка 400, і рядка немає; дельти не рахуються в «один
на добу»; файл `<id>.delta.gz`, `.ready` несе вікно. **Міст:** `processDelta` — секції →
`convertOutput` за колонками SQL мосту → `jsonl` + `aggregates.json {mode:'delta', window}`;
без вікна — відмова; без секції `bookings` — відмова. **Імпорт:** `mode` з агрегатів; дельта
без вікна → названа відмова; `since` не застосовується; кроки 7–8 (фактури, сальдо, згоди,
каса) пропускаються; скасування за відсутністю — лише для повного; `winhotel_refs.source_taken_at`
(0405) — знімок, старіший за той, що писав рядок, його не переписує (`older_snapshot`).

**Незатирання** — `statusForward(current, incoming)`: ранг `tentative 0 < confirmed 1 <
checked_in 2 < checked_out 3`, назад не пишеться; `cancelled` — лише з TA_STATUS або
відсутності в повному; з `cancelled` назад — лише коли знімок каже TA_STATUS < 1000 (Winhotel
зняв сторно). `UPDATE reservations` не згадує `registration_status`; `reservation_guests`
вставляються лише для нової броні (кіоскові — без ref — не чіпаються); `fin_folio_payments`
імпорт лише вставляє (з `source = 'import'`).

**Гейт (сцени Б7–Б9) і червоне:**

| Сцена | Твердження | Злом → червоне |
|---|---|---|
| Б7 | кіоск: `status = checked_in`, `registration_status = registered`, гість броні без ref, оплата рецепції `transfer` без `source`; знімок зі зміненою приміткою й `CI_STATUS 0` → примітка оновлена (UPDATE справді був), стан `checked_in`, реєстрація, гість і оплата ті самі, `status_kept_forward = 1` | стан як у знімку → «стан мав лишитись checked_in, а став confirmed» |
| Б8 | дельта (taken_at 13.09 09:15) без вікна → відмова; з вікном 03-09..03-13 і новою датою виїзду 101 → `updated 1`, `cancelled_missing 0`, 103 поза вікном без змін, фактур/сальдо 0; повторний імпорт повного знімка (09.09) → `older_snapshot 1`, дата виїзду лишилась; прийом без `X-Winhotel-Window` → 400 і без рядка, з вікном → 201, `.delta.gz` і вікно в `.ready`; друга дельта за добу → 201 | дельта скасовує за відсутністю → «updated 3 !== 1 (cancelled_missing 2)»; старіший знімок переписує → «older_snapshot 0 !== 1» |
| Б9 | кожен `sql-delta/*.sql` має ті самі `-- columns:`, що `sql/*.sql`, і або `{{FROM}}`, або позначку довідника; з Firebird: стаб → 13 шаблонів через `isql-fb` у вікні 03-09..03-13 → пакет → `processDelta` → bookings 1, addresses 3, folio_lines 1, payments 1, services 10; умлаут «Späte Anreise» у дельті; без вікна — відмова | (структурний; без Firebird — «ПРОПУЩЕНО живий isql») |

Зелений: SQLite і PGlite (усі Б1–Б9; Б9 живий isql — локально). `check:pg` на справжньому
Postgres — CI.

## 8.4 Відхилення й межі — названі

- `companies.debtor_no` прийшов злиттям `block-apps` (дописка §0), тож `DEBI_NR` пишеться дверима
  `adoptDebtorNo`; staging `debtor_no_pending` лишається лише для зайнятих номерів. Виданий
  лічильником номер імпортованої фірми замінюється — це номери, яких бухгалтерія не бачила.
- Дельта на сервері готелю ще не запускалась: шаблони доведені на стабі живим `isql-fb`
  (Linux, вбудований режим); на Windows агент ходить через `localhost:` до сервісу Firebird —
  та сама відмінність, що в `gbak -b` режиму (b), уже пройденого.
- `check-boundaries` зловив у гейті SQL до `fin_folio_payments` — оплати читаються дверима:
  `listPayments` додано до фасаду `@invoicing/kernel` (єдина зміна в модулі поза `recordPayment`).
- Гейт `listPayments`/`check-property-scope`: читання у `verifyDictionaries` без осі обʼєкта названо `ALL_PROPERTIES` ще в задачі 7.
- `payload_json` staging на Postgres — JSONB, на SQLite — TEXT (як і раніше).

## 8.5 Документи

ARCHITECTURE (кроки частини Б — довідники, адреси, брони, рядки, оплати; незатирання; денна
дельта; рядок гейта Б7–Б9 і шість зломів; «Лишається» з очікуваними числами), NAMING (`mode
delta`, причини `cash_article`/`debtor_no_pending`, `cause` перетину, `fiscal_guard` скасовано),
DECISIONS З34–З37 (З31 скасовано), DEPLOY (дельта в описі агента), `apps/winhotel-agent/README.de.md`,
`install.ps1`, MAPPING.md (компанія за `ADR_WAHL`, `WG` — LNR, джерело — `EXT_SOURCE`),
IMPORT-PLAN.md (крок 7, джерело), `schema.sql` перегенеровано зі свіжої SQLite (+2 колонки
оплат, +1 колонка refs, CHECK `mode` з `delta`).

---

# Задача 9 — хвости живого проходу №3

**Коміти:** `93c2bfc3` — код, стаб, гейт і документи; звіт — окремим. **CI — запуск 852 (`96098723`) ЗЕЛЕНИЙ** усіма трьома роботами (`types, self-checks, build`; `hotel onboarding` — schema.sql і міграції 0400–0405 описують одну базу; `onboarding and tenant isolation` — `check:pg` на Postgres роллю `alisio_app` з гейтом Б1–Б10, ізоляція, маршрути, два готелі до фактури, Playwright). Запуск 849 (`e4df2906`, лише звіт) скасовано наступним пушем.

| П. | Що зроблено | Червоне першим |
|---|---|---|
| 1 | Рядок «майбутні брони, живі» рахує ОБИДВА боки з тих самих рядків: Winhotel-бік = живі майбутні `GASTKONT`, які **мають наш рядок** (`winhotel_refs`), наш бік — той самий SQL, що й був. Причина розриву 889 ≠ 901 на живому: 12 броней, які ми вже тримали (імпортовані раніше), у наступному проході стали перетином на UPDATE (`winhotel_double`) — вони лягали в staging і лічились у `staged_future`, а рядок у ядрі лишався (незатирання). Формула «Winhotel мінус лічильник» віднімала їх, SQL — ні. Той самий принцип — і для рядка «reservations = GASTKONT у вікні»: `resCount === inWindowHeld`, а не `inWindow − staged` (упав на тій самій фікстурі). Пояснені: «майбутні живі без нашого рядка» і «з них відкладені на UPDATE, рядок лишився». Фікстура: нова жива майбутня бронь 107 (номер 103, 01–03.04.2027) і сцена **Б10** — 101 переноситься на номер і дати 107 → перетин на UPDATE → staging, рядків стільки ж, рядок звірки 3 = 3, `mismatch: false` (вісь «staged майбутніх ≠ 0» більше не вироджена) | стара формула на Б10 → «рядок майбутніх бреше: Winhotel 2 ≠ наші 3»; і другий рядок → «reservations = GASTKONT у вікні: winhotel 6, ours 6, ok false» |
| 2 | `GASTKREF`: витяг (повний і дельта) дістає `TEXT1..TEXT5`; `channelOf(ref)` шукає назву каналу за словом по всіх текстових колонках (`text1..5`, потім `ext_source`, `ref_nr`, `inet_ref_nr`, `ext_refnr`: Booking.com / Expedia / HRS / Airbnb / DIRS21 / Onlinebuchung), номер каналу — перше числове значення з `ext_refnr`/`ext_source`/`inet_ref_nr`/`ref_nr`. Назва → `booking_sources` (за назвою, з нормалізацією), **номер і назва → `reservations.hostex_reservation_code` / `hostex_channel_type`** — `external_ref` у схемі немає, а ці дві колонки екрани броні вже читають як «канал і його код» (`isChannelBooking`, бейдж). Рядок `explained` каже, У ЯКІЙ колонці знайдено назву і скільки посилань мають номер — живий прохід покаже, чи це `TEXT1`; якщо назви немає ніде — `direct`, і рядок скаже «не впізнано жодного», а колонки, що є у витягу, — у `booking_refs.sql`. Стаб: два посилання з числовими `EXT_SOURCE` (як на живому) і назвами в `TEXT1` («Booking.com», «DIRS21 Onlinebuchung»); Б2 стверджує `booking_com`/`4100000001` і `dirs21`/`77001`, розподіл «Booking.com 1, DIRS21 1», «колонка з назвою: text1 2» | до правки — `res106.source` = `direct` (EXT_SOURCE — число) |
| 3 | Зроблено в задачі 8 за допискою §0: злиття `block-apps` (`06446093`), `0143→0403`, `0144→0404`, `0145→0405`, `db.ts`/ARCHITECTURE/звіти/`schema.sql` за новими іменами (`11b52fe9`). `ls db/postgres/migrations \| sed 's/-.*//' \| sort \| uniq -d` → лише `0034` | — |
| 4 | CI 833 (`53550ce7`) і 842 (`11b52fe9`) — зелені, рядок у розділі «Задача 8» (`e4df2906`) | — |

**Числа для проходу №4:** рядок «майбутні живі з нашим рядком» має зійтись (обидва ≈ 901,
якщо 12 перетинів на UPDATE тримають рядок); `source` ≠ `direct` там, де `TEXT1..5` несуть назву
каналу — число і колонка в `explained`; `hostex_reservation_code` = номер каналу.

**Примітка про колонки.** Коментар у міграторі (`db.ts`, `hostexCols`) каже про
`hostex_*`: «нових рядків не буде». Імпорт пише їх свідомо як єдині колонки роду «канал і його
код», які читають екрани; перейменування на нейтральне (`channel_type`/`channel_code`) — окрема
міграція ядра, не застосунку.

---

**Блок winhotel-import вичерпано 10.09.2026, голова `81502d63`** (задача 10, рецензія Б3: живий
прохід №4 — `mismatch: false`; канал у `GASTKREF` на живому не знайдено, лишається `direct` +
рядок `explained`, евристик за формою числа не робимо). Гілка йде в гілку робіт контролером 1.
Наступна задача Winhotel — перший знімок із сервера готелю і звірка на беті — у нову сесію.
