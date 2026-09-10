# Звіт: застосунок `winhotel-import` — частина А (сесія 5, задача 6)

**Гілка:** `claude/winhotel-import` (від `origin/claude/block-apps`, злито
`origin/claude/winhotel-schema`). **Задача:** `docs/tasks/2026-09-10-block-winhotel-import.md`.
**Обсяг цього звіту:** §2.1–2.4 + §2.7 + §2.8 (частина А: знімок доходить і витягається;
у ядро нічого не пишеться). Частина Б (§2.5–2.6) — після рецензії.

## 1. Коміти

| Коміт | Що |
|---|---|
| `b47ec44` | копія задачі з гілки контролера |
| (цей) | частина А цілком: агент, приймальний маршрут + 0143, міст, картка, гейт, документи |

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

Міграція **0143** `winhotel_snapshots` — колонки за задачею; `counts_json` **JSONB**
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

## 3. Що пішло в staging і чому

Нічого — частина А в ядро не пише. `winhotel_refs`/`winhotel_staging` — частина Б
(міграція 0144+).

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
0144 `winhotel_refs` + `winhotel_staging`, довідники-звірка, гості/компанії через
`@guests`/`@companies`, брони через `@bookings`, рядки/оплати через `@invoicing`,
заморожені фактури → staging, сальдо, ідемпотентність, `counts_json` §2.6, сцени §2.7,
які лишились.
