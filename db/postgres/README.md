# Postgres

Postgres is the running database on beta and prod since 2026-08-07/08. SQLite
is what a developer machine still uses by default, and what `DB_DRIVER=` (empty)
falls back to — that is the rollback path, not the current state.

| Файл | Що це |
|---|---|
| `schema.sql` | **згенерований** — не редагувати руками |
| `rls-check.sql` | доказ, що row-level security справді ізолює |

## Згенерувати

```bash
node scripts/pg-schema.mjs           # перезаписує schema.sql
node scripts/pg-schema.mjs --print   # у stdout
```

Генератор читає **живу** SQLite-базу (`data/alisio.db`), а не код міграцій.
Причина: `db.ts` створює таблицю, а потім перебудовує її нижче, і схема з
коду — це форма таблиці *до* міграцій.

Рішення, які не випливають із назви колонки, живуть у мапі `OVERRIDE`
всередині генератора. Якщо ви правите тип — правте там, інакше наступний
запуск його затре.

## Перевірити

```bash
docker run -d --name pgtest -e POSTGRES_PASSWORD=probe -e POSTGRES_DB=alisio postgres:16-alpine
# зачекати, поки сервер підніметься остаточно — образ стартує тимчасовий
# сервер для initdb і перезапускає його, тож одного pg_isready замало
psql "postgres://postgres:probe@localhost/alisio" -v ON_ERROR_STOP=1 -f db/postgres/schema.sql
psql "postgres://postgres:probe@localhost/alisio" -v ON_ERROR_STOP=1 -f db/postgres/rls-check.sql
docker rm -f pgtest
```

Очікується: 92 таблиці, 84 політики, `rls: all checks passed`.
Решта 8 таблиць — спільні для всього сервера (курси валют, довідники),
у них немає organization_id, тож і політики немає. Генератор рахує їх
окремо і падає, якщо зʼявиться таблиця з organization_id без політики.

## Перехід зі SQLite — по кроках

Порядок має значення. `DB_DRIVER=postgres` без кроків 1–4 просто покладе
застосунок: він підключиться до порожньої бази й не знайде жодного користувача.

```bash
# 1. Підняти Postgres
docker compose up -d postgres          # локально, порт 5433

# 2. Схема: 92 таблиці, 84 політики ізоляції
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/postgres/schema.sql

# 3. Доказ, що ізоляція справді працює. Очікується `rls: all checks passed`
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/postgres/rls-check.sql

# 4. Дані. Спершу вхолосту — покаже, що переїде і що загубиться
node scripts/pg-import.mjs "$DATABASE_URL" --dry-run
node scripts/pg-import.mjs "$DATABASE_URL"

# 5. Тільки тепер перемикач
DB_DRIVER=postgres DATABASE_URL="$DATABASE_URL" npm run start

# 6. Перевірити на живому: 39 тверджень ізоляції і 129 маршрутів
node scripts/check-isolation.mjs
node scripts/smoke-routes.mjs
```

Застосунок має підключатися РОЛЛЮ, яка не є власником таблиць.
`FORCE ROW LEVEL SECURITY` покриває й власника, але покладатись лише на це
означає, що одна таблиця без `FORCE` — це тихе читання всієї таблиці.

Перед кроком 4 зупиніть застосунок. Перелив одноразовий і не доганяє зміни,
які приходять під час роботи.

Відкат: SQLite-файл нікуди не дівається. Приберіть `DB_DRIVER` — і застосунок
працює як працював. Тому перемикач і зроблено окремою змінною, а не
похідною від наявності `DATABASE_URL`.

## Що змінюється порівняно з SQLite (Фаза 1.4)

| Було | Стало | Чому |
|---|---|---|
| `REAL` для сум | `NUMERIC(14,2)` | double не представляє 0.10 точно; `2870.55 * 0.15` зберігається як `430.58250000000004`, і рік таких сум не сходиться до копійки |
| `TEXT` для моментів часу | `TIMESTAMPTZ` | ISO-рядки правильно сортуються, і саме тому проблема була непомітна: над ними неможлива ні арифметика, ні часовий пояс |
| `TEXT` для календарних дат | `DATE` | `check_in` — це день, а не мить |
| `INTEGER` 0/1 | `BOOLEAN` | |
| `TEXT` з JSON | `JSONB` | |
| курс валют у `REAL` | `NUMERIC(18,8)` | курсу потрібно більше знаків, ніж грошам |

Свідомо **не** зроблено: переведення сум у цілі мінорні одиниці (копійки).
Це торкнулося б кожного обчислення й кожного екрана продукту, а одна
пропущена конверсія — це рахунок, помилковий у сто разів. `NUMERIC` дає точну
десяткову арифметику без жодної зміни в коді застосунку.

## Row-level security

Кожна таблиця, яка дістається до організації, має політику:

```sql
ALTER TABLE "x" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "x" FORCE ROW LEVEL SECURITY;
CREATE POLICY "x_tenant" ON "x"
  USING (organization_id = current_setting('app.organization_id'))
  WITH CHECK (organization_id = current_setting('app.organization_id'));
```

Таблиці, які дістаються до організації через зв'язок, отримують політику через
батька:

```sql
USING (property_id IN (SELECT id FROM properties
                       WHERE organization_id = current_setting('app.organization_id')))
```

Кожне з'єднання зобов'язане назвати орендаря перед першим читанням:

```sql
SET LOCAL app.organization_id = '<org id>';
```

Без цього запит поверне нуль рядків: на свіжому з'єднанні `current_setting()`
кидає `undefined_object`, а якщо параметр уже десь ставили в цій сесії — читає
порожній рядок, який ні з чим не збігається. Забутий скоуп — це помилка або
порожній результат, **ніколи не читання всієї таблиці**.

Застосунок має підключатися роллю, яка **не є власником таблиць**. `FORCE`
покриває і власника, але покладатися лише на нього означає, що одна таблиця без
`FORCE` — це тихе читання всієї таблиці.

Дев'ять таблиць-довідників політики не мають навмисно: `organizations`,
`sessions`, `rate_limits`, `settings`, `content_translations`,
`email_processed`, `fin_system_state`, `hostex_sync_log`,
`hostex_property_map`.

## Міграції

`schema.sql` — для **порожньої** бази. База, яка вже існує, оновлюється
файлами з `migrations/`, по порядку, кожен повторюваний:

| | |
|---|---|
| `0001-app-users-readable-before-login.sql` | логін має знайти людину до того, як відома організація |
| `0002-auto-assigned-integer-keys.sql` | послідовності для цілочисельних ключів |
| `0003-language-columns.sql` | `organizations.language`, `app_users.language` |
| `0004-booking-sites-organization.sql` | віджет: сайт називає свій готель сам |
| `0005-inserted-rows-know-their-tenant.sql` | `organization_id` дефолтиться від контексту — без цього 14 `INSERT` відхиляються політикою, серед них handshake віджета |
| `0006-organization-language-not-null.sql` | базова мова готелю більше не NULL |
| `0007-guest-portal-finds-its-hotel.sql` | гостьовий портал знаходить бронювання за токеном — без цього він відповідає 404 на всі свої маршрути |
| `0008-a-link-is-the-whole-credential.sql` | `partner_reports` (звіт за посиланням) + `app.guest_token` → `app.public_token`: одне налаштування на обидві таблиці, які відкриваються токеном |
| `0009-services-stop-naming-one-hotels-categories.sql` | знімає `CHECK (available_for IN ('glamping','resort','camping','all'))` — словник бізнес-слів одного клієнта в схемі, через який німецький готель чи хостел не міг привʼязати послугу до власної категорії |
| `0010-vat-rates-with-dates.sql` | `fin_tax_rates` — ставки ПДВ організації з датами дії. Ставка обирається за датою послуги і записується на нарахування числом; таблиця потрібна, щоб обрати, а не щоб перерахувати старий документ |
| `0011-invoice-series-are-configuration.sql` | `invoice_series` — серії нумерації і форма номера як налаштування організації. Порожня таблиця = поведінка не змінюється ні на символ |

**Накочує їх деплой.** `deploy/deploy.sh` викликає `deploy/migrate.sh` між
збіркою і рестартом: журнал застосованого лежить у таблиці
`schema_migrations`, тож застосовується лише те, чого база ще не бачила.
Окремо це теж запускається:

```bash
./deploy/migrate.sh prod --list   # що чекає, нічого не змінюючи
./deploy/migrate.sh prod          # накотити
```

Порядок — за іменем файла, тому вони й нумеровані. Кожен файл — власна
транзакція і кожен переживає повторний запуск (перевірено: два проходи по
всіх восьми на чистій схемі). Тому на базі, яка ще не має журналу, перший
запуск чесно застосовує всі — це нічого не змінює в тому, що вже на місці.

Чому це віддано скрипту, а не пам'яті: **0008 має накотитися разом із
деплоєм, який його вводить.** Код починає ставити `app.public_token`; база,
що досі перевіряє `app.guest_token`, тоді знову віддає 404 на весь гостьовий
портал — тихо, без жодної помилки в логах. Раніше це був крок, який хтось
мусив пам'ятати.

Не перевіряйте це руками — є команда, яка питає саму базу про всі відбитки
одразу:

```bash
DATABASE_URL=postgres://… node scripts/check-deployed-db.mjs
```

## Чого тут ще немає

- **Асинхронний шар доступу.** Зроблено: `core/db/async.ts` — інтерфейс `Sql`
  із двома реалізаціями; жоден модуль не знає, яка база відповіла.
- `booking_service_orders.completed_at` — єдиний дефолт, який генератор не
  переносить (`NULL`, що те саме, що його відсутність).
