# Postgres

SQLite is still the running database. This directory is the target schema —
generated, verified, and not yet in use.

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

Очікується: 127 таблиць, 118 політик, `rls: all checks passed`.

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

## Чого тут ще немає

- **Перенесення даних.** SQLite → Postgres не написано.
- **Асинхронний шар доступу.** `better-sqlite3` синхронна, драйвер Postgres —
  ні. Кожен репозиторій доведеться зробити асинхронним; це Фаза 2/3, і без неї
  ця схема нікуди не підключиться.
- `booking_service_orders.completed_at` — єдиний дефолт, який генератор не
  переносить (`NULL`, що те саме, що його відсутність).
