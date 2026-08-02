# Архітектура ALiSiO PMS SaaS

Мультитенантна система управління готелем: один сервер обслуговує багато
готелів (організацій), кожен бачить лише свої дані.

Цей документ описує, **як система влаштована і чому саме так**. Правила тут —
не поради, а інваріанти: якщо ви їх порушуєте, ви створюєте витік між
клієнтами. Перелік того, що вже ламалося, — у [SECURITY-FINDINGS.md](SECURITY-FINDINGS.md).

---

## 1. Стек

| | |
|---|---|
| Фреймворк | Next.js 16 (App Router, Turbopack, `output: standalone`) |
| UI | React 19, CSS-токени, без UI-бібліотеки |
| БД | SQLite через `better-sqlite3` — **синхронна** |
| Розгортання | Docker, два незалежні compose-проєкти за nginx |
| Мова коду | TypeScript, `strict`, `ignoreBuildErrors` вимкнено |

**SQLite синхронна.** Це визначає багато рішень: транзакції не потребують
`await`, `db.transaction(fn)()` атомарна, конкурентних записів немає — один
процес, один writer. Перехід на Postgres запланований (Фаза 1.5) і саме тому
`organization_id` є колонкою на кожній таблиці: на неї спиратиметься
row-level security.

---

## 2. Шари

```
src/app/          маршрути й сторінки — тонкі, лише експорт хендлера
src/modules/      14 доменних модулів — уся бізнес-логіка
src/core/         інфраструктура, спільна для всіх модулів
src/lib/          історичний шар; поступово розходиться по modules/
```

### 2.1 Модулі

`auth bookings channels dashboard finance guests notifications payments
pricing properties reports tasks`

Вирізано як напівзроблене й дуже індивідуальне:

| Що | Гілка / тег |
|---|---|
| CRM | `archive/crm` · `crm-before-removal` |
| Інвестори | `archive/investors` · `investors-before-removal` |
| Фінансова обв'язка | `archive/finance-wrapper` · `finance-wrapper-before-removal` |

Повертатися туди за досвідом, а не за кодом.

З фінансів лишилося те, що потрібне кожному готелю: журнал `fin_operations`,
інвойси, рахунки і звіти. Пішли банк, імпорт виписок, майстер імпорту, чеки з
пошти, звірка, кліринг, нарахування і фінансовий календар.

Кожен має однакову структуру:

```
src/modules/<name>/
  api/        хендлери + index.ts — єдиний публічний вихід модуля
  data/       репозиторії: усі SQL-запити модуля
  domain/     чисті функції без БД (тут же .check.ts-тести)
  ui/         компоненти модуля
  events/     публікація й підписка на події
```

**Фасад обов'язковий.** У `tsconfig.json` прописані аліаси, які вказують
**лише** на `api`:

```json
"@finance":   ["./src/modules/finance/api"],
"@finance/*": ["./src/modules/finance/api/*"]
```

Тобто `import { getPnl } from '@finance'` можливий, а дотягнутися до
`modules/finance/data/...` з іншого модуля — ні. Це навмисно: репозиторій
модуля має право припускати, що його викликали через його ж хендлер, який уже
встановив організацію.

### 2.2 core

| Файл | Роль |
|---|---|
| `core/auth/session.ts` | **єдине місце**, де встановлюється особа запиту |
| `core/auth/tenant-context.ts` | організація, доступна вниз по стеку |
| `core/security/route-guard.ts` | guard для маршрутів поза модулем finance |
| `core/privacy/ocr-consent.ts` | згода організації на хмарний OCR |
| `core/db` | доступ до з'єднання |
| `core/money.ts` | округлення сум перед записом |
| `core/event-bus` | внутрішні події між модулями |

---

## 3. Модель тенантності

```
organizations                      ← клієнт SaaS (готель або мережа)
  └── properties                   ← об'єкт (будівля, кемпінг, готель)
        ├── buildings
        ├── categories
        ├── unit_types
        ├── units                  ← номер / місце
        └── reservations
              ├── guests           (через reservation_guests)
              └── invoices
```

98 таблиць. Кожна дістається до організації одним із трьох способів:

- **напряму** — має колонку `organization_id`;
- **через зв'язок** — має FK, який веде до організації;
- **глобальна** — довідник, однаковий для всіх (10 таблиць:
  `organizations`, `sessions`, `rate_limits`, `settings`,
  `content_translations`, `hostex_property_map` тощо).

**Таблиць без жодного шляху — нуль.** Це перевіряється:

```bash
node scripts/audit-tenant.mjs
```

Наскільки модуль ізольований — окрема перевірка:

```bash
node scripts/check-boundaries.mjs            # усі модулі
node scripts/check-boundaries.mjs bookings   # що тримає один
```

**Пробій** — це коли хтось лізе повз фасад у `data/`, `domain/` чи `ui/`, або
пише SQL до таблиці, якою володіє лише цей модуль. Нуль пробоїв означає, що
модуль можна вимкнути або переписати, не зачепивши решту.

Нуль пробоїв мають: `dashboard`, `reports`, `tasks`.

### 3.1 Правило нових таблиць

Нова таблиця отримує `organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE`
і індекс по ньому — навіть якщо здається, що достатньо FK на `properties`.
Причина проста: Postgres RLS вмикається політикою на колонці, і таблиця без
колонки залишиться поза нею.

### 3.2 Правило UNIQUE

Будь-яке значення, яке **обирає людина** (код промокоду, код ваучера, артикул,
номер документа), унікальне **в межах організації**:

```sql
UNIQUE (organization_id, code)
```

Виняток — випадкові токени (`export_token`, `portal_token`, `session_id`): вони
є всім ключем пошуку з публічного URL, тому глобально унікальні навмисно.

---

## 4. Особа запиту

Middleware (`src/proxy.ts`) перевіряє лише **наявність** cookie. Він її не
валідує і не дістає з неї організацію. Тому:

> Хендлер, який не пройшов через guard, працює без особи. Будь-який
> залогінений користувач будь-якої компанії може його викликати.

Guard-и:

| Обгортка | Звідки | Що вимагає |
|---|---|---|
| `withActor` | `@core/auth/session` | валідна сесія з організацією |
| `withPermission(p, h)` | `@core/auth/session` | + конкретний дозвіл |
| `withOwner` | `@core/auth/session` | + роль owner/director |
| `requireOwner`, `requirePermission` | `@core/security/route-guard` | те саме + політика доступу до фінансів |
| `withFinanceRead`, `withPermission` | `@finance/_guard` | + step-up пароль фінансів + per-user ACL |

Усі три сімейства віддають хендлеру один і той самий `Actor`:

```ts
interface Actor { user: SessionUser; organizationId: string; }
```

Приклад:

```ts
export const listThings = withPermission('manage_bookings',
  async (req, _ctx, actor: Actor) => {
    const rows = getDb()
      .prepare('SELECT * FROM things WHERE organization_id = ?')
      .all(actor.organizationId);
    return NextResponse.json(rows);
  });
```

**На чужий id відповідаємо 404, а не 403** (`notFound()` з
`@core/auth/session`). 403 підтверджує, що рядок існує, і дозволяє перебирати
ідентифікатори.

### 4.1 Tenant context

Багато репозиторіїв викликаються глибоко і не мають доступу до `Actor`. Для них
організація лежить в `AsyncLocalStorage`:

```ts
import { requireOrganizationId, requirePropertyId } from '@core/auth/tenant-context';

const orgId = requireOrganizationId(db);
const propId = requirePropertyId(db, body.property_id); // явний id перевіряється на власність
```

Guard-и самі загортають виклик хендлера в `runWithOrganization(...)`, тому в
будь-якому запиті контекст уже стоїть.

Поведінка `requireOrganizationId` поза запитом (cron, вебхук):
єдина організація → повертає її; кілька → **кидає помилку**. Тобто фонова
задача, яку забули проскоупити, падає гучно, а не пише в чужі дані тихо.

Якщо фонова задача обробляє всіх клієнтів, вона зобов'язана обійти
організації сама і виконати роботу в `runWithOrganization(orgId, fn)`.

---

## 5. Публічна поверхня

Список публічних префіксів — у `src/proxy.ts`. Усе, що там перелічене, обходить
middleware і **зобов'язане** довести право іншим способом:

| Спосіб | Приклад |
|---|---|
| Спільний секрет | `Bearer CRON_SECRET`, `TELEGRAM_BRIDGE_TOKEN` |
| Токен рядка | гостьовий портал `guest_page_token`, інвесторський `portal_token` |
| Підпис вебхука | Teya, Hostex |
| Ідентифікатор орендаря в запиті | віджет: `siteId` / `propertyId` / slug |

**Публічний endpoint не має права на мовчазний дефолт.** Якщо віджет не сказав,
який це готель, правильна відповідь — 400, а не «перший активний об'єкт».

---

## 6. Гроші й документи

- `fin_operations` — єдиний журнал руху коштів.
- `invoices` — юридичні документи. `UNIQUE (organization_id, invoice_number)`.
- `invoice_counters` — ключ `(organization_id, series, year)`.
- `invoice_periods` — блокування місяця; після блокування номери заморожені,
  виправлення лише через сторно.

Серії: `HOUSE` (прямі, формат `YYYY-NNN`), `BKG`, `AIR`, `TEYA`.

Суми зберігаються в `REAL`, тому будь-яке **обчислене** значення округлюється
перед записом через `money()` з `@core/money`. Причина конкретна: комісія
`2870.55 * 0.15` — це `430.58250000000004`, і рік таких хвостів не сходиться до
копійки. У Postgres ці колонки — `NUMERIC(14,2)`, де арифметика точна.

```ts
import { money, sumMoney, percentOf, splitMoney } from '@core/money';

const commission = percentOf(total, 15);   // не total * 0.15
const line = money(price * qty);
```

`splitMoney` існує окремо: поділити суму на n частин, округливши кожну, втрачає
або вигадує до n/2 копійок — залишок роздається по одній.

Функції видачі номера **не мають дефолтної організації**. Її передають явно; у
фоні (вебхук оплати, синк каналу) вона береться з об'єкта бронювання — саме
бронювання є джерелом істини про те, чий це інвойс.

Перевірка: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON src/lib/invoice-numbering.check.ts`

---

## 7. Перевірки

```bash
npx tsc --noEmit          # 0 помилок — обов'язково перед комітом
npm run lint              # biome
npm run check             # доменні self-check'и (.check.ts)
npm run build:win         # повний build перед push складних змін
```

Аудити:

```bash
node scripts/audit-tenant.mjs      # ізоляція: таблиці, запити, UNIQUE
node scripts/audit-routes.mjs      # маршрути без особи
node scripts/audit.mjs             # мертвий UI та маршрути
node scripts/pg-schema.mjs         # перегенерувати цільову схему Postgres
```

Цільова схема Postgres і доказ RLS — у [db/postgres/](../db/postgres/README.md).

Прогін по всіх GET-маршрутах під справжньою сесією — **по production-збірці**,
бо dev-сервер компілює кожен маршрут при першому зверненні і на 183 маршрутах
помирає від нестачі памʼяті:

```bash
npm run build:win && npm run start
node scripts/smoke-routes.mjs
```

Очікується нуль 5xx. 503 для неналаштованих інтеграцій — це норма.

Живий доказ ізоляції (потребує запущеного сервера):

```bash
node scripts/check-isolation.mjs
```

Створює дві справжні організації, ходить API від імені кожної, перевіряє, що
друга не бачить і не нищить дані першої, і прибирає за собою. **Це головна
перевірка перед підключенням клієнта.** Статичний аналіз каже, що запит
обмежений; цей скрипт каже, що він справді ізолює.

Нова функція, яка торкається чужих даних, додає сюди твердження.

---

## 8. Стан і що далі

Зроблено:

- таблиць без організації — 0; UNIQUE на людських значеннях без організації — 0;
- маршрутів без визначення особи — 0; публічних без перевірки — 0;
- нумерація документів — на організацію;
- tenant context замість «першого рядка в таблиці».

- типи даних: цільова схема Postgres описує суми як `NUMERIC(14,2)`, моменти
  як `TIMESTAMPTZ`, дати як `DATE`, прапорці як `BOOLEAN`, JSON як `JSONB`;
  обчислені суми округлюються в коді через `@core/money`;
- Postgres DDL і row-level security — згенеровані з живої бази та перевірені на
  справжньому Postgres: 127 таблиць, 118 політик, `db/postgres/rls-check.sql`
  доводить, що другий орендар не бачить і не змінює рядки першого.

Лишається:

- **Фаза 2/3** — асинхронний шар доступу і перенесення даних. `better-sqlite3`
  синхронна, драйвер Postgres — ні; без цього схема з `db/postgres/` нікуди не
  підключиться. Це те, що робить Фазу 1.5 живою, а не описаною.
- **Фаза 4** — SaaS-обв'язка: реєстр інтеграцій, помодульна підписка
  (`features` + `organization_features`), онбординг.
- Аудити A/B/C/E — мертвий UI, мертві маршрути, мертві колонки, заглушки.
- 243 агрегатні запити, які статичний аудит позначає критичними: переважно
  звіти всередині вже проскоупленого модуля, але кожен треба переглянути.
- `/api/checklists` падає на кожному виклику (читає неіснуючу таблицю
  `bookings`, правило зашите під «сауна»).
- Міський збір у реєстрі гостей рахується як `nights * 20` — ставка має бути
  налаштуванням.
